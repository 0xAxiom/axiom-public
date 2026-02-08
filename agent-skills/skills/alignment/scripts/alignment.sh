#!/bin/bash
#
# Alignment Pipeline Wrapper Script
# 
# Sources config and runs the Bankr-powered Clanker fee burn pipeline.
# 
# Usage:
#   ./scripts/alignment.sh --token 0x... --treasury 0x... [options]
#
# Environment:
#   BANKR_API_KEY - Required Bankr API key
#   BASE_RPC_URL  - Optional Base RPC URL (defaults to public)
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Functions
error() {
    echo -e "${RED}❌ Error: $1${NC}" >&2
    exit 1
}

info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if we're in the right directory
if [[ ! -f "$ROOT_DIR/alignment.mjs" ]]; then
    error "alignment.mjs not found. Run this script from the alignment skill directory."
fi

# Check Node.js version
if ! command -v node &> /dev/null; then
    error "Node.js not found. Please install Node.js 18+"
fi

NODE_VERSION=$(node --version | cut -d'.' -f1 | cut -d'v' -f2)
if [[ $NODE_VERSION -lt 18 ]]; then
    error "Node.js 18+ required. Found version: $(node --version)"
fi

# Source config files if they exist
CONFIG_FILES=(
    "$HOME/.axiom/wallet.env"
    "$HOME/.config/alignment/config.env"
    "$ROOT_DIR/.env"
    "$ROOT_DIR/config.env"
)

for config_file in "${CONFIG_FILES[@]}"; do
    if [[ -f "$config_file" ]]; then
        info "Sourcing config: $config_file"
        set -o allexport
        source "$config_file"
        set +o allexport
    fi
done

# Check for required environment variables
if [[ -z "${BANKR_API_KEY:-}" ]]; then
    warning "BANKR_API_KEY not found in environment"
    echo "You can:"
    echo "  1. Set it in one of these files:"
    for config_file in "${CONFIG_FILES[@]}"; do
        echo "     - $config_file"
    done
    echo "  2. Export it: export BANKR_API_KEY=your_key"
    echo "  3. Pass it via --bankr-key argument"
    echo ""
fi

# Install dependencies if needed
if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    info "Installing dependencies..."
    cd "$ROOT_DIR"
    npm install
    success "Dependencies installed"
fi

# Parse arguments to check for help
for arg in "$@"; do
    if [[ "$arg" == "-h" || "$arg" == "--help" ]]; then
        echo "Alignment Pipeline Wrapper"
        echo ""
        echo "Usage:"
        echo "  $0 --token TOKEN --treasury TREASURY [options]"
        echo ""
        echo "Required:"
        echo "  --token       Clanker token address"
        echo "  --treasury    Treasury address for USDC+BNKR"
        echo ""
        echo "Optional:"
        echo "  --bankr-key   Bankr API key (or set BANKR_API_KEY env)"
        echo "  --dry-run     Simulate without real transactions"
        echo "  --currency0   V4 pool currency0 (default: WETH)"
        echo "  --fee         V4 pool fee (default: 0x800000)"
        echo "  --tick-spacing V4 tick spacing (default: 200)"
        echo "  --hooks       V4 hooks address (default: Clanker hooks)"
        echo "  -h, --help    Show this help"
        echo ""
        echo "Environment Variables:"
        echo "  BANKR_API_KEY  Bankr API key for transaction signing"
        echo "  BASE_RPC_URL   Base network RPC URL (optional)"
        echo ""
        echo "Config Files (loaded if present):"
        for config_file in "${CONFIG_FILES[@]}"; do
            echo "  - $config_file"
        done
        exit 0
    fi
done

# Check for required arguments
TOKEN=""
TREASURY=""
for ((i=1; i<=$#; i++)); do
    case "${!i}" in
        --token)
            ((i++))
            TOKEN="${!i}"
            ;;
        --treasury)
            ((i++))
            TREASURY="${!i}"
            ;;
    esac
done

if [[ -z "$TOKEN" ]]; then
    error "Missing required argument: --token"
fi

if [[ -z "$TREASURY" ]]; then
    error "Missing required argument: --treasury"
fi

# Validate addresses
if [[ ! "$TOKEN" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    error "Invalid token address format: $TOKEN"
fi

if [[ ! "$TREASURY" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    error "Invalid treasury address format: $TREASURY"
fi

# Show configuration
info "Starting Alignment Pipeline"
echo "Token: $TOKEN"
echo "Treasury: $TREASURY"
if [[ -n "${BANKR_API_KEY:-}" ]]; then
    echo "Bankr API Key: $(echo "$BANKR_API_KEY" | cut -c1-8)..."
fi
echo ""

# Change to the script directory
cd "$ROOT_DIR"

# Run the alignment script
info "Executing alignment pipeline..."
exec node alignment.mjs "$@"