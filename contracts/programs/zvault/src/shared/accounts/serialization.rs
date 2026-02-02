//! Zero-copy serialization traits and utilities
//!
//! This module provides traits and utilities for zero-copy serialization
//! of account data, which is more efficient than copying data.
//!
//! ## Zero-Copy Pattern
//!
//! Instead of deserializing account data into a new struct:
//! ```ignore
//! let data: MyStruct = borsh::deserialize(&account.data)?; // Copies data
//! ```
//!
//! We cast the account data directly:
//! ```ignore
//! let data = MyStruct::from_bytes(&account.data)?; // Zero-copy reference
//! ```

use pinocchio::program_error::ProgramError;

/// Trait for types that can be read from raw bytes with zero-copy
///
/// Types implementing this trait must be `#[repr(C)]` with all fields
/// being byte-aligned (no padding issues).
pub trait ZeroCopy: Sized {
    /// The discriminator byte for this account type
    const DISCRIMINATOR: u8;

    /// Size of the type in bytes
    const LEN: usize;

    /// Parse from raw bytes as immutable reference
    ///
    /// # Safety
    /// The implementing type must be `#[repr(C)]` with proper alignment.
    fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError>;

    /// Parse from raw bytes as mutable reference
    ///
    /// # Safety
    /// The implementing type must be `#[repr(C)]` with proper alignment.
    fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError>;

    /// Initialize a new instance in the given buffer
    fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError>;
}

/// Helper function for zero-copy deserialization with discriminator check
///
/// # Safety
/// The type T must be `#[repr(C)]` with proper alignment.
#[inline(always)]
pub unsafe fn zero_copy_from_bytes<T: ZeroCopy>(
    data: &[u8],
    discriminator: u8,
) -> Result<&T, ProgramError> {
    if data.len() < T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[0] != discriminator {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(&*(data.as_ptr() as *const T))
}

/// Helper function for zero-copy mutable deserialization with discriminator check
///
/// # Safety
/// The type T must be `#[repr(C)]` with proper alignment.
#[inline(always)]
pub unsafe fn zero_copy_from_bytes_mut<T: ZeroCopy>(
    data: &mut [u8],
    discriminator: u8,
) -> Result<&mut T, ProgramError> {
    if data.len() < T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    if data[0] != discriminator {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(&mut *(data.as_mut_ptr() as *mut T))
}

/// Helper function to initialize a zero-copy account
///
/// # Safety
/// The type T must be `#[repr(C)]` with proper alignment.
#[inline(always)]
pub unsafe fn zero_copy_init<T: ZeroCopy>(
    data: &mut [u8],
    discriminator: u8,
) -> Result<&mut T, ProgramError> {
    if data.len() < T::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    // Zero initialize
    data[..T::LEN].fill(0);
    // Set discriminator
    data[0] = discriminator;
    Ok(&mut *(data.as_mut_ptr() as *mut T))
}

/// Read a u64 from little-endian bytes
#[inline(always)]
pub fn read_u64_le(bytes: &[u8; 8]) -> u64 {
    u64::from_le_bytes(*bytes)
}

/// Write a u64 as little-endian bytes
#[inline(always)]
pub fn write_u64_le(bytes: &mut [u8; 8], value: u64) {
    *bytes = value.to_le_bytes();
}

/// Read an i64 from little-endian bytes
#[inline(always)]
pub fn read_i64_le(bytes: &[u8; 8]) -> i64 {
    i64::from_le_bytes(*bytes)
}

/// Write an i64 as little-endian bytes
#[inline(always)]
pub fn write_i64_le(bytes: &mut [u8; 8], value: i64) {
    *bytes = value.to_le_bytes();
}

/// Read a u32 from little-endian bytes
#[inline(always)]
pub fn read_u32_le(bytes: &[u8; 4]) -> u32 {
    u32::from_le_bytes(*bytes)
}

/// Write a u32 as little-endian bytes
#[inline(always)]
pub fn write_u32_le(bytes: &mut [u8; 4], value: u32) {
    *bytes = value.to_le_bytes();
}

/// Read a u16 from little-endian bytes
#[inline(always)]
pub fn read_u16_le(bytes: &[u8; 2]) -> u16 {
    u16::from_le_bytes(*bytes)
}

/// Write a u16 as little-endian bytes
#[inline(always)]
pub fn write_u16_le(bytes: &mut [u8; 2], value: u16) {
    *bytes = value.to_le_bytes();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_u64_roundtrip() {
        let value = 0x123456789ABCDEF0u64;
        let mut bytes = [0u8; 8];
        write_u64_le(&mut bytes, value);
        assert_eq!(read_u64_le(&bytes), value);
    }

    #[test]
    fn test_i64_roundtrip() {
        let value = -0x123456789ABCDEFi64;
        let mut bytes = [0u8; 8];
        write_i64_le(&mut bytes, value);
        assert_eq!(read_i64_le(&bytes), value);
    }

    #[test]
    fn test_u32_roundtrip() {
        let value = 0x12345678u32;
        let mut bytes = [0u8; 4];
        write_u32_le(&mut bytes, value);
        assert_eq!(read_u32_le(&bytes), value);
    }

    #[test]
    fn test_u16_roundtrip() {
        let value = 0x1234u16;
        let mut bytes = [0u8; 2];
        write_u16_le(&mut bytes, value);
        assert_eq!(read_u16_le(&bytes), value);
    }
}
