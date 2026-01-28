//! Transfer Stealth instruction - private transfer of existing zkBTC to stealth address
//!
//! Enables private transfer of existing commitment to recipient's stealth address
//! with on-chain announcement for recipient scanning.
//!
//! Flow:
//! 1. Verify ZK proof (proves knowledge of input note)
//! 2. Check input nullifier not already spent
//! 3. Record input nullifier as spent
//! 4. Add output commitment to merkle tree
//! 5. Create StealthAnnouncement PDA with ephemeral_pub

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::constants::PROOF_SIZE;
use crate::error::ZVaultError;
use crate::state::{
    CommitmentTree, NullifierOperationType, NullifierRecord, PoolState,
    StealthAnnouncement, NULLIFIER_RECORD_DISCRIMINATOR, STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
};
use crate::utils::{
    get_test_verification_key, verify_transfer_proof, Groth16Proof,
    validate_program_owner, validate_account_writable,
};

/// Transfer stealth instruction data
/// Layout:
/// - proof: [u8; 256] (Groth16 proof)
/// - merkle_root: [u8; 32] (Input merkle root)
/// - input_nullifier_hash: [u8; 32] (To prevent double-spend)
/// - output_commitment: [u8; 32] (New commitment for recipient)
/// - ephemeral_pub: [u8; 33] (For recipient to scan)
/// - amount_sats: u64 (Transfer amount)
/// Total: 256 + 32 + 32 + 32 + 33 + 8 = 393 bytes
pub struct TransferStealthData {
    pub proof: [u8; PROOF_SIZE],
    pub merkle_root: [u8; 32],
    pub input_nullifier_hash: [u8; 32],
    pub output_commitment: [u8; 32],
    pub ephemeral_pub: [u8; 33],
    pub amount_sats: u64,
}

impl TransferStealthData {
    pub const SIZE: usize = PROOF_SIZE + 32 + 32 + 32 + 33 + 8;

    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut proof = [0u8; PROOF_SIZE];
        proof.copy_from_slice(&data[0..256]);

        let mut merkle_root = [0u8; 32];
        merkle_root.copy_from_slice(&data[256..288]);

        let mut input_nullifier_hash = [0u8; 32];
        input_nullifier_hash.copy_from_slice(&data[288..320]);

        let mut output_commitment = [0u8; 32];
        output_commitment.copy_from_slice(&data[320..352]);

        let mut ephemeral_pub = [0u8; 33];
        ephemeral_pub.copy_from_slice(&data[352..385]);

        let amount_sats = u64::from_le_bytes(data[385..393].try_into().unwrap());

        Ok(Self {
            proof,
            merkle_root,
            input_nullifier_hash,
            output_commitment,
            ephemeral_pub,
            amount_sats,
        })
    }
}

/// Transfer stealth accounts
pub struct TransferStealthAccounts<'a> {
    pub pool_state: &'a AccountInfo,
    pub commitment_tree: &'a AccountInfo,
    pub nullifier_record: &'a AccountInfo,
    pub stealth_announcement: &'a AccountInfo,
    pub sender: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> TransferStealthAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 6 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let pool_state = &accounts[0];
        let commitment_tree = &accounts[1];
        let nullifier_record = &accounts[2];
        let stealth_announcement = &accounts[3];
        let sender = &accounts[4];
        let system_program = &accounts[5];

        // Validate sender is signer
        if !sender.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            pool_state,
            commitment_tree,
            nullifier_record,
            stealth_announcement,
            sender,
            system_program,
        })
    }
}

/// Create PDA account via CPI to system program
fn create_pda_account<'a>(
    payer: &'a AccountInfo,
    pda_account: &'a AccountInfo,
    _system_program: &'a AccountInfo,
    program_id: &Pubkey,
    lamports: u64,
    space: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let create_account = pinocchio_system::instructions::CreateAccount {
        from: payer,
        to: pda_account,
        lamports,
        space,
        owner: program_id,
    };

    let seeds: Vec<Seed> = signer_seeds.iter().map(|s| Seed::from(*s)).collect();
    let signer = Signer::from(&seeds[..]);

    create_account.invoke_signed(&[signer])
}

/// Process transfer stealth instruction
///
/// Enables private transfer of existing zkBTC to recipient's stealth address.
///
/// Accounts:
/// 0. pool_state (writable) - Pool state account
/// 1. commitment_tree (writable) - Commitment tree for new leaf
/// 2. nullifier_record (writable) - PDA to mark input as spent
/// 3. stealth_announcement (writable) - PDA for recipient scanning
/// 4. sender (signer) - Transaction fee payer
/// 5. system_program - System program for PDA creation
pub fn process_transfer_stealth(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = TransferStealthAccounts::from_accounts(accounts)?;
    let ix_data = TransferStealthData::from_bytes(data)?;

    // SECURITY: Validate account owners BEFORE deserializing any data
    validate_program_owner(accounts.pool_state, program_id)?;
    validate_program_owner(accounts.commitment_tree, program_id)?;
    // Note: nullifier_record and stealth_announcement may not exist yet (will be created)

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.pool_state)?;
    validate_account_writable(accounts.commitment_tree)?;
    validate_account_writable(accounts.nullifier_record)?;
    validate_account_writable(accounts.stealth_announcement)?;

    // Load and validate pool state
    {
        let pool_data = accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }
    }

    // Verify merkle root is valid in commitment tree
    {
        let tree_data = accounts.commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;

        if !tree.is_valid_root(&ix_data.merkle_root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    // Verify nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, &ix_data.input_nullifier_hash];
    let (expected_nullifier_pda, nullifier_bump) = find_program_address(nullifier_seeds, program_id);
    if accounts.nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if nullifier already spent
    {
        let nullifier_data = accounts.nullifier_record.try_borrow_data()?;
        if nullifier_data.len() >= 1 && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::NullifierAlreadyUsed.into());
        }
    }

    // Verify stealth announcement PDA
    let stealth_seeds: &[&[u8]] = &[StealthAnnouncement::SEED, &ix_data.ephemeral_pub];
    let (expected_stealth_pda, stealth_bump) = find_program_address(stealth_seeds, program_id);
    if accounts.stealth_announcement.key() != &expected_stealth_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if stealth announcement already exists
    {
        let ann_data_len = accounts.stealth_announcement.data_len();
        if ann_data_len > 0 {
            let ann_data = accounts.stealth_announcement.try_borrow_data()?;
            if ann_data[0] == STEALTH_ANNOUNCEMENT_DISCRIMINATOR {
                return Err(ProgramError::AccountAlreadyInitialized);
            }
        }
    }

    // Verify Groth16 proof (proves knowledge of input note)
    // Public inputs: [root, input_nullifier_hash, output_commitment]
    let groth16_proof = Groth16Proof::from_bytes(&ix_data.proof);
    let vk = get_test_verification_key(3); // 3 public inputs

    if !verify_transfer_proof(
        &vk,
        &groth16_proof,
        &ix_data.merkle_root,
        &ix_data.input_nullifier_hash,
        &ix_data.output_commitment,
    ) {
        return Err(ZVaultError::ZkVerificationFailed.into());
    }

    let clock = Clock::get()?;
    let rent = Rent::get()?;

    // Create nullifier record PDA
    {
        let lamports = rent.minimum_balance(NullifierRecord::LEN);
        let bump_bytes = [nullifier_bump];
        let signer_seeds: &[&[u8]] = &[
            NullifierRecord::SEED,
            &ix_data.input_nullifier_hash,
            &bump_bytes,
        ];

        create_pda_account(
            accounts.sender,
            accounts.nullifier_record,
            accounts.system_program,
            program_id,
            lamports,
            NullifierRecord::LEN as u64,
            signer_seeds,
        )?;
    }

    // Initialize nullifier record
    {
        let mut nullifier_data = accounts.nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(&ix_data.input_nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.spent_by.copy_from_slice(accounts.sender.key().as_ref());
        nullifier.set_operation_type(NullifierOperationType::PrivateTransfer);
    }

    // Create stealth announcement PDA
    {
        let lamports = rent.minimum_balance(StealthAnnouncement::SIZE);
        let bump_bytes = [stealth_bump];
        let signer_seeds: &[&[u8]] = &[
            StealthAnnouncement::SEED,
            &ix_data.ephemeral_pub,
            &bump_bytes,
        ];

        create_pda_account(
            accounts.sender,
            accounts.stealth_announcement,
            accounts.system_program,
            program_id,
            lamports,
            StealthAnnouncement::SIZE as u64,
            signer_seeds,
        )?;
    }

    // Initialize stealth announcement
    let leaf_index: u64;
    {
        let mut ann_data = accounts.stealth_announcement.try_borrow_mut_data()?;
        let announcement = StealthAnnouncement::init(&mut ann_data)?;

        announcement.bump = stealth_bump;
        announcement.ephemeral_pub = ix_data.ephemeral_pub;
        announcement.set_amount_sats(ix_data.amount_sats);
        announcement.commitment = ix_data.output_commitment;
        announcement.set_created_at(clock.unix_timestamp);

        // Get the leaf index from commitment tree
        let tree_data = accounts.commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;
        leaf_index = tree.next_index();
        announcement.set_leaf_index(leaf_index);
    }

    // Update commitment tree with new commitment
    {
        let mut tree_data = accounts.commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        // Check capacity
        if tree.next_index() >= (1u64 << 20) {
            return Err(ZVaultError::TreeFull.into());
        }

        // Update root with new commitment
        tree.update_root(ix_data.output_commitment);
        let next = tree.next_index();
        tree.set_next_index(next + 1);
    }

    // Update pool statistics
    {
        let mut pool_data = accounts.pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        // Increment transfer count (reuse split_count for now, or add transfer_count)
        let transfer_count = pool.split_count();
        pool.set_split_count(transfer_count.saturating_add(1));
        pool.set_last_update(clock.unix_timestamp);
    }

    Ok(())
}
