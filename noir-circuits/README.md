# zVault Noir Circuits

Noir circuits for zVault privacy operations. These circuits replace the Circom/Groth16 circuits for improved developer experience and performance.

## Circuits

- **claim.nr**: Claim commitment to mint vBTC
- **transfer.nr**: 1-in-1-out commitment refresh
- **split.nr**: 1-in-2-out commitment split
- **partial_withdraw.nr**: Partial withdrawal with change
- **merkle.nr**: Merkle tree proof verification utilities

## Building

```bash
# Install Noir (if not already installed)
curl -L https://noirup.org/install | bash
noirup

# Compile circuits
cd contracts/noir-circuits
nargo compile

# Generate proofs (for testing)
nargo prove
```

## Migration Status

**V1**: Circuits created, syntax updated for Noir standard library
**Pending**: 
- Compile circuits and generate artifacts
- Integrate Noir prover into frontend SDK
- Implement Noir → Groth16 conversion for Solana verification (transitional)
- Full testing and validation

## Notes

- Circuits use `std::hash::poseidon::bn254` for hashing
- Path indices use `u1` type (bits) for efficiency
- All circuits maintain compatibility with existing Groth16 verification during transition
