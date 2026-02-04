//! SHA256 hashing utilities
//!
//! Provides SHA256 hashing using Solana's native syscall for efficiency.
//! Used primarily for Bitcoin transaction hashing.

/// SHA256 hash using Solana's syscall
///
/// # Arguments
/// * `data` - Data to hash
///
/// # Returns
/// 32-byte SHA256 hash
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];

    #[cfg(target_os = "solana")]
    {
        // Use Solana's hashv syscall via pinocchio
        unsafe {
            extern "C" {
                fn sol_sha256(vals: *const u8, val_len: u64, hash_result: *mut u8) -> u64;
            }

            // Create the slice descriptor that sol_sha256 expects
            let slice_desc = [data.as_ptr(), data.len() as *const u8];
            sol_sha256(slice_desc.as_ptr() as *const u8, 1, result.as_mut_ptr());
        }
    }

    #[cfg(not(target_os = "solana"))]
    {
        // For testing, use a simple XOR-based hash (not cryptographically secure)
        for (i, byte) in data.iter().enumerate() {
            result[i % 32] ^= byte;
            result[(i + 1) % 32] = result[(i + 1) % 32].wrapping_add(*byte);
        }
    }

    result
}

/// Double SHA256 hash (Bitcoin standard)
///
/// This is the standard hash function used in Bitcoin for:
/// - Transaction hashes (txid)
/// - Block hashes
/// - Merkle tree nodes
///
/// # Arguments
/// * `data` - Data to hash
///
/// # Returns
/// 32-byte double SHA256 hash
pub fn double_sha256(data: &[u8]) -> [u8; 32] {
    let first = sha256(data);
    sha256(&first)
}

/// Double SHA256 hash of two 32-byte values concatenated
///
/// Used for Bitcoin merkle tree computation.
///
/// # Arguments
/// * `left` - Left child hash (32 bytes)
/// * `right` - Right child hash (32 bytes)
///
/// # Returns
/// 32-byte double SHA256 hash of concatenated inputs
pub fn double_sha256_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut combined = [0u8; 64];
    combined[0..32].copy_from_slice(left);
    combined[32..64].copy_from_slice(right);
    double_sha256(&combined)
}

/// Check if a hash meets the difficulty target
///
/// Hash must be less than or equal to target (little-endian comparison).
/// Used for Bitcoin proof-of-work verification.
///
/// # Arguments
/// * `hash` - The block hash to check
/// * `target` - The difficulty target
///
/// # Returns
/// `true` if hash <= target
pub fn hash_meets_target(hash: &[u8; 32], target: &[u8; 32]) -> bool {
    // Compare from most significant byte
    for i in (0..32).rev() {
        if hash[i] > target[i] {
            return false;
        }
        if hash[i] < target[i] {
            return true;
        }
    }
    true // Equal
}

/// Calculate chainwork from difficulty bits
///
/// Extracts the difficulty target from compact bits format
/// and returns the corresponding work value.
///
/// # Arguments
/// * `bits` - Compact difficulty bits from block header
///
/// # Returns
/// 32-byte work value (big-endian)
pub fn calculate_chainwork(bits: u32) -> [u8; 32] {
    let mut work = [0u8; 32];
    let exponent = ((bits >> 24) & 0xff) as usize;
    let mantissa = bits & 0x007fffff;

    if exponent > 0 && exponent < 32 {
        let pos = 32 - exponent;
        if pos < 32 {
            work[pos] = (mantissa >> 16) as u8;
            if pos + 1 < 32 {
                work[pos + 1] = (mantissa >> 8) as u8;
            }
            if pos + 2 < 32 {
                work[pos + 2] = mantissa as u8;
            }
        }
    }

    work
}

/// Add two chainwork values (256-bit addition)
///
/// # Arguments
/// * `a` - First chainwork value
/// * `b` - Second chainwork value
///
/// # Returns
/// Sum of the two chainwork values
pub fn add_chainwork(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut carry: u16 = 0;

    for i in 0..32 {
        let sum = a[i] as u16 + b[i] as u16 + carry;
        result[i] = sum as u8;
        carry = sum >> 8;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_deterministic() {
        let data = b"hello world";
        let hash1 = sha256(data);
        let hash2 = sha256(data);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_double_sha256_deterministic() {
        let data = b"hello world";
        let hash1 = double_sha256(data);
        let hash2 = double_sha256(data);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_double_sha256_pair_deterministic() {
        let left = [1u8; 32];
        let right = [2u8; 32];
        let hash1 = double_sha256_pair(&left, &right);
        let hash2 = double_sha256_pair(&left, &right);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_hash_meets_target() {
        let low_hash = [0u8; 32];
        let high_target = [0xFF; 32];
        assert!(hash_meets_target(&low_hash, &high_target));

        let high_hash = [0xFF; 32];
        let low_target = [0u8; 32];
        assert!(!hash_meets_target(&high_hash, &low_target));
    }

    #[test]
    fn test_add_chainwork() {
        let a = [1u8; 32];
        let b = [1u8; 32];
        let sum = add_chainwork(&a, &b);
        assert_eq!(sum[0], 2);
    }
}
