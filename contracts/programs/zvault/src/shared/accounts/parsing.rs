//! Instruction data parsing helpers
//!
//! Utility functions to reduce boilerplate when parsing instruction data.

use pinocchio::program_error::ProgramError;

/// Read a fixed-size byte array from instruction data
#[inline]
pub fn read_bytes<const N: usize>(data: &[u8], offset: &mut usize) -> Result<[u8; N], ProgramError> {
    if data.len() < *offset + N {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut result = [0u8; N];
    result.copy_from_slice(&data[*offset..*offset + N]);
    *offset += N;
    Ok(result)
}

/// Read a 32-byte field (commitment, hash, pubkey, etc.)
#[inline]
pub fn read_bytes32(data: &[u8], offset: &mut usize) -> Result<[u8; 32], ProgramError> {
    read_bytes::<32>(data, offset)
}

/// Parse a u64 in little-endian format from instruction data
#[inline]
pub fn parse_u64_le(data: &[u8], offset: &mut usize) -> Result<u64, ProgramError> {
    if data.len() < *offset + 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let value = u64::from_le_bytes(
        data[*offset..*offset + 8]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?
    );
    *offset += 8;
    Ok(value)
}

/// Parse a u16 in little-endian format from instruction data
#[inline]
pub fn parse_u16_le(data: &[u8], offset: &mut usize) -> Result<u16, ProgramError> {
    if data.len() < *offset + 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let value = u16::from_le_bytes(
        data[*offset..*offset + 2]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?
    );
    *offset += 2;
    Ok(value)
}

/// Parse a u8 from instruction data
#[inline]
pub fn parse_u8(data: &[u8], offset: &mut usize) -> Result<u8, ProgramError> {
    if data.len() < *offset + 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let value = data[*offset];
    *offset += 1;
    Ok(value)
}

/// Ensure data has minimum length
#[inline]
pub fn ensure_min_len(data: &[u8], min_len: usize) -> Result<(), ProgramError> {
    if data.len() < min_len {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_bytes32() {
        let data = [1u8; 64];
        let mut offset = 0;

        let result = read_bytes32(&data, &mut offset).unwrap();
        assert_eq!(result, [1u8; 32]);
        assert_eq!(offset, 32);

        let result2 = read_bytes32(&data, &mut offset).unwrap();
        assert_eq!(result2, [1u8; 32]);
        assert_eq!(offset, 64);
    }

    #[test]
    fn test_parse_u64_le() {
        let mut data = [0u8; 16];
        data[0..8].copy_from_slice(&100u64.to_le_bytes());
        data[8..16].copy_from_slice(&200u64.to_le_bytes());

        let mut offset = 0;
        assert_eq!(parse_u64_le(&data, &mut offset).unwrap(), 100);
        assert_eq!(offset, 8);
        assert_eq!(parse_u64_le(&data, &mut offset).unwrap(), 200);
        assert_eq!(offset, 16);
    }

    #[test]
    fn test_insufficient_data() {
        let data = [0u8; 4];
        let mut offset = 0;

        assert!(read_bytes32(&data, &mut offset).is_err());
        assert!(parse_u64_le(&data, &mut offset).is_err());
    }
}
