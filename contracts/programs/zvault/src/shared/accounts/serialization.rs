//! Serialization utilities for zero-copy account data
//!
//! Provides byte-level read/write utilities for working with account data.

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
