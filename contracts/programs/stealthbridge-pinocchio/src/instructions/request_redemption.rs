//! Request redemption instruction - burns sbBTC, queues BTC withdrawal

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{PoolState, RedemptionRequest, RedemptionStatus, REDEMPTION_REQUEST_DISCRIMINATOR};
use crate::utils::{validate_program_owner, validate_token_2022_owner, validate_token_program_key};

/// Request redemption instruction data
pub struct RequestRedemptionData {
    pub amount_sats: u64,
    pub btc_address: [u8; 62], // Max bech32 length
    pub btc_address_len: u8,
    pub request_nonce: u64,
}

impl RequestRedemptionData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        // amount (8) + btc_address_len (1) + btc_address (variable) + request_nonce (8)
        if data.len() < 17 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let amount_sats = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let btc_address_len = data[8];

        if btc_address_len as usize > 62 {
            return Err(ZVaultError::InvalidBtcAddress.into());
        }

        let addr_end = 9 + btc_address_len as usize;
        if data.len() < addr_end + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut btc_address = [0u8; 62];
        btc_address[..btc_address_len as usize].copy_from_slice(&data[9..addr_end]);

        let request_nonce = u64::from_le_bytes(data[addr_end..addr_end + 8].try_into().unwrap());

        Ok(Self {
            amount_sats,
            btc_address,
            btc_address_len,
            request_nonce,
        })
    }
}

/// Request redemption accounts
pub struct RequestRedemptionAccounts<'a> {
    pub pool_state: &'a AccountInfo,
    pub redemption_request: &'a AccountInfo,
    pub sbbtc_mint: &'a AccountInfo,
    pub user_token_account: &'a AccountInfo,
    pub user: &'a AccountInfo,
    pub token_program: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> RequestRedemptionAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 7 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let pool_state = &accounts[0];
        let redemption_request = &accounts[1];
        let sbbtc_mint = &accounts[2];
        let user_token_account = &accounts[3];
        let user = &accounts[4];
        let token_program = &accounts[5];
        let system_program = &accounts[6];

        // Validate user is signer
        if !user.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            pool_state,
            redemption_request,
            sbbtc_mint,
            user_token_account,
            user,
            token_program,
            system_program,
        })
    }
}

/// Process redemption request
pub fn process_request_redemption(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = RequestRedemptionAccounts::from_accounts(accounts)?;
    let ix_data = RequestRedemptionData::from_bytes(data)?;

    // SECURITY: Validate account owners BEFORE deserializing any data
    validate_program_owner(accounts.pool_state, program_id)?;
    // Note: redemption_request may not exist yet (will be created), skip owner check
    validate_token_2022_owner(accounts.sbbtc_mint)?;
    validate_token_2022_owner(accounts.user_token_account)?;
    validate_token_program_key(accounts.token_program)?;

    // Load and validate pool state
    let (min_deposit, pending_redemptions) = {
        let pool_data = accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }

        (pool.min_deposit(), pool.pending_redemptions())
    };

    // Validate amount
    if ix_data.amount_sats == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }
    if ix_data.amount_sats < min_deposit {
        return Err(ZVaultError::AmountTooSmall.into());
    }

    // Validate BTC address
    if ix_data.btc_address_len == 0 {
        return Err(ZVaultError::InvalidBtcAddress.into());
    }

    // Verify redemption request PDA
    let nonce_bytes = ix_data.request_nonce.to_le_bytes();
    let redemption_seeds: &[&[u8]] = &[
        RedemptionRequest::SEED,
        accounts.user.key().as_ref(),
        &nonce_bytes,
    ];
    let (expected_redemption_pda, _) = find_program_address(redemption_seeds, program_id);
    if accounts.redemption_request.key() != &expected_redemption_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if redemption already exists
    {
        let redemption_data = accounts.redemption_request.try_borrow_data()?;
        if redemption_data.len() >= 1 && redemption_data[0] == REDEMPTION_REQUEST_DISCRIMINATOR {
            return Err(ZVaultError::AlreadyInitialized.into());
        }
    }

    // Burn sbBTC from user
    crate::utils::burn_sbbtc(
        accounts.token_program,
        accounts.sbbtc_mint,
        accounts.user_token_account,
        accounts.user,
        ix_data.amount_sats,
    )?;

    // Get clock for timestamp
    let clock = Clock::get()?;

    // Create redemption request
    {
        let mut redemption_data = accounts.redemption_request.try_borrow_mut_data()?;
        let redemption = RedemptionRequest::init(&mut redemption_data)?;

        redemption.set_request_id(ix_data.request_nonce);
        redemption.requester.copy_from_slice(accounts.user.key().as_ref());
        redemption.set_amount_sats(ix_data.amount_sats);
        redemption.set_btc_address(&ix_data.btc_address[..ix_data.btc_address_len as usize])?;
        redemption.set_status(RedemptionStatus::Pending);
        redemption.set_created_at(clock.unix_timestamp);
    }

    // Update pool state
    {
        let mut pool_data = accounts.pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.add_burned(ix_data.amount_sats)?;
        pool.set_pending_redemptions(pending_redemptions.saturating_add(1));
        pool.set_last_update(clock.unix_timestamp);
    }

    Ok(())
}
