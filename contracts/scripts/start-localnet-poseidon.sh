#!/bin/bash
# Start localnet with Poseidon syscall support (devnet-like environment)
#
# This script starts solana-test-validator with devnet features enabled,
# which includes the Poseidon syscall required for ZK proof verification.
#
# Usage:
#   ./scripts/start-localnet-poseidon.sh
#   ./scripts/start-localnet-poseidon.sh --reset  # Reset ledger

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"
LEDGER_DIR="$CONTRACTS_DIR/.localnet-ledger"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  zVault Localnet with Poseidon      ${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Check for reset flag
RESET_FLAG=""
if [[ "$1" == "--reset" ]]; then
    RESET_FLAG="--reset"
    echo -e "${YELLOW}Resetting ledger...${NC}"
    rm -rf "$LEDGER_DIR"
fi

# Check if validator is already running
if pgrep -x "solana-test-validator" > /dev/null; then
    echo -e "${YELLOW}Warning: solana-test-validator is already running${NC}"
    echo "Kill it with: pkill solana-test-validator"
    echo ""
    read -p "Kill existing validator and continue? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        pkill solana-test-validator || true
        sleep 2
    else
        exit 1
    fi
fi

echo -e "${GREEN}Starting solana-test-validator with devnet features...${NC}"
echo ""
echo "This enables:"
echo "  - Poseidon syscall (sol_poseidon)"
echo "  - All devnet feature flags"
echo ""
echo -e "${YELLOW}Note: First start may take a moment to clone features from devnet${NC}"
echo ""

# Start validator with devnet features
# --clone-feature-set: Clone all feature flags from devnet (includes Poseidon)
# --ledger: Custom ledger directory
# --rpc-port: Default RPC port
# --faucet-port: Faucet for airdrops
solana-test-validator \
    --clone-feature-set \
    --url devnet \
    --ledger "$LEDGER_DIR" \
    --rpc-port 8899 \
    --faucet-port 9900 \
    $RESET_FLAG \
    2>&1 | while read line; do
        echo "$line"
        # Detect when validator is ready
        if [[ "$line" == *"JSON RPC URL"* ]]; then
            echo ""
            echo -e "${GREEN}======================================${NC}"
            echo -e "${GREEN}  Validator Ready!                   ${NC}"
            echo -e "${GREEN}======================================${NC}"
            echo ""
            echo "RPC URL: http://127.0.0.1:8899"
            echo "Faucet:  http://127.0.0.1:9900"
            echo ""
            echo "Next steps:"
            echo "  1. Build programs: cargo build-sbf"
            echo "  2. Deploy: bun run deploy:localnet-poseidon"
            echo ""
        fi
    done
