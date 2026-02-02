//! Bitcoin address utilities
//!
//! Provides utilities for parsing and validating Bitcoin addresses,
//! particularly Bech32m (Taproot) addresses used for deposits.

use pinocchio::program_error::ProgramError;

use crate::shared::error::ZVaultError;
use crate::shared::constants::MAX_BTC_ADDRESS_LEN;

/// Bitcoin address type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressType {
    /// Legacy P2PKH (starts with 1 or m/n)
    P2PKH,
    /// Legacy P2SH (starts with 3 or 2)
    P2SH,
    /// Native SegWit P2WPKH (starts with bc1q or tb1q)
    P2WPKH,
    /// Native SegWit P2WSH (starts with bc1q)
    P2WSH,
    /// Taproot P2TR (starts with bc1p or tb1p)
    P2TR,
    /// Unknown address type
    Unknown,
}

/// Parsed Bitcoin address
pub struct ParsedAddress {
    /// The address type
    pub address_type: AddressType,
    /// Whether this is a testnet address
    pub is_testnet: bool,
    /// The witness program version (for SegWit/Taproot)
    pub witness_version: Option<u8>,
    /// Raw address bytes (limited length)
    pub raw_bytes: [u8; MAX_BTC_ADDRESS_LEN],
    /// Length of the raw bytes
    pub raw_len: usize,
}

impl ParsedAddress {
    /// Parse a Bitcoin address string
    pub fn parse(address: &str) -> Result<Self, ProgramError> {
        let bytes = address.as_bytes();
        if bytes.len() > MAX_BTC_ADDRESS_LEN {
            return Err(ZVaultError::InvalidBtcAddress.into());
        }

        let mut raw_bytes = [0u8; MAX_BTC_ADDRESS_LEN];
        raw_bytes[..bytes.len()].copy_from_slice(bytes);

        let (address_type, is_testnet, witness_version) = detect_address_type(address)?;

        Ok(Self {
            address_type,
            is_testnet,
            witness_version,
            raw_bytes,
            raw_len: bytes.len(),
        })
    }

    /// Check if this is a Taproot address (required for zVault deposits)
    pub fn is_taproot(&self) -> bool {
        self.address_type == AddressType::P2TR
    }

    /// Get the address as a string slice
    pub fn as_str(&self) -> &str {
        // Safe because we validated the input was valid UTF-8
        core::str::from_utf8(&self.raw_bytes[..self.raw_len]).unwrap_or("")
    }
}

/// Detect the type of a Bitcoin address
fn detect_address_type(address: &str) -> Result<(AddressType, bool, Option<u8>), ProgramError> {
    if address.is_empty() {
        return Err(ZVaultError::InvalidBtcAddress.into());
    }

    // Check for Bech32/Bech32m addresses
    let lower = address.to_lowercase();

    // Mainnet Taproot (bc1p)
    if lower.starts_with("bc1p") {
        return Ok((AddressType::P2TR, false, Some(1)));
    }

    // Testnet Taproot (tb1p)
    if lower.starts_with("tb1p") {
        return Ok((AddressType::P2TR, true, Some(1)));
    }

    // Mainnet SegWit v0 (bc1q)
    if lower.starts_with("bc1q") {
        // Distinguish P2WPKH (20-byte program) vs P2WSH (32-byte program)
        // P2WPKH: bc1q + 38 chars = 42 total
        // P2WSH: bc1q + 58 chars = 62 total
        let addr_type = if address.len() <= 45 {
            AddressType::P2WPKH
        } else {
            AddressType::P2WSH
        };
        return Ok((addr_type, false, Some(0)));
    }

    // Testnet SegWit v0 (tb1q)
    if lower.starts_with("tb1q") {
        let addr_type = if address.len() <= 45 {
            AddressType::P2WPKH
        } else {
            AddressType::P2WSH
        };
        return Ok((addr_type, true, Some(0)));
    }

    // Legacy addresses
    if let Some(first_char) = address.chars().next() {
        match first_char {
            '1' => return Ok((AddressType::P2PKH, false, None)),
            '3' => return Ok((AddressType::P2SH, false, None)),
            'm' | 'n' => return Ok((AddressType::P2PKH, true, None)),
            '2' => return Ok((AddressType::P2SH, true, None)),
            _ => {}
        }
    }

    Ok((AddressType::Unknown, false, None))
}

/// Validate that an address is suitable for zVault deposits
///
/// zVault requires Taproot addresses for deposits due to the
/// commitment scheme used for privacy.
pub fn validate_deposit_address(address: &str) -> Result<ParsedAddress, ProgramError> {
    let parsed = ParsedAddress::parse(address)?;

    if !parsed.is_taproot() {
        return Err(ZVaultError::InvalidBtcAddress.into());
    }

    Ok(parsed)
}

/// Validate that an address is valid for redemptions
///
/// Redemptions can use any valid Bitcoin address type.
pub fn validate_redemption_address(address: &str) -> Result<ParsedAddress, ProgramError> {
    let parsed = ParsedAddress::parse(address)?;

    if parsed.address_type == AddressType::Unknown {
        return Err(ZVaultError::InvalidBtcAddress.into());
    }

    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_taproot_address_detection() {
        // Mainnet Taproot
        let mainnet = ParsedAddress::parse("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0").unwrap();
        assert!(mainnet.is_taproot());
        assert!(!mainnet.is_testnet);
        assert_eq!(mainnet.witness_version, Some(1));

        // Testnet Taproot
        let testnet = ParsedAddress::parse("tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c").unwrap();
        assert!(testnet.is_taproot());
        assert!(testnet.is_testnet);
    }

    #[test]
    fn test_segwit_address_detection() {
        // Mainnet P2WPKH
        let p2wpkh = ParsedAddress::parse("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4").unwrap();
        assert_eq!(p2wpkh.address_type, AddressType::P2WPKH);
        assert!(!p2wpkh.is_testnet);
    }

    #[test]
    fn test_legacy_address_detection() {
        // Mainnet P2PKH
        let p2pkh = ParsedAddress::parse("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").unwrap();
        assert_eq!(p2pkh.address_type, AddressType::P2PKH);
        assert!(!p2pkh.is_testnet);

        // Mainnet P2SH
        let p2sh = ParsedAddress::parse("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy").unwrap();
        assert_eq!(p2sh.address_type, AddressType::P2SH);
    }

    #[test]
    fn test_validate_deposit_address() {
        // Taproot should succeed
        assert!(validate_deposit_address("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0").is_ok());

        // Non-Taproot should fail
        assert!(validate_deposit_address("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4").is_err());
        assert!(validate_deposit_address("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").is_err());
    }

    #[test]
    fn test_validate_redemption_address() {
        // All valid types should succeed
        assert!(validate_redemption_address("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0").is_ok());
        assert!(validate_redemption_address("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4").is_ok());
        assert!(validate_redemption_address("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").is_ok());

        // Invalid should fail
        assert!(validate_redemption_address("").is_err());
    }
}
