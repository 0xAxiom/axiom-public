#!/bin/bash
# Example usage of Clanker burn pipeline

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔥 Clanker Burn Pipeline Examples${NC}\n"

# Check environment
if [ -z "$NET_PRIVATE_KEY" ]; then
  echo "❌ NET_PRIVATE_KEY not set"
  echo "   Run: export NET_PRIVATE_KEY=0x..."
  exit 1
fi

# Example 1: Dry run (safe test)
echo -e "${GREEN}Example 1: Dry Run (Simulation)${NC}"
echo "This will simulate the entire pipeline without sending any transactions."
echo ""
echo "Command:"
echo "  node burn.mjs \\"
echo "    --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \\"
echo "    --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \\"
echo "    --dry-run"
echo ""
read -p "Press Enter to run dry-run test..."

node burn.mjs \
  --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
  --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08 \
  --dry-run

echo ""
echo -e "${YELLOW}─────────────────────────────────────────${NC}\n"

# Example 2: Live execution (commented out for safety)
echo -e "${GREEN}Example 2: Live Execution${NC}"
echo "This would execute the real burn pipeline."
echo ""
echo "Command:"
echo "  node burn.mjs \\"
echo "    --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \\"
echo "    --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08"
echo ""
echo "⚠️  Uncomment to execute live (remove the '#' below)"
echo ""

# Uncomment to run live:
# node burn.mjs \
#   --token 0xf3ce5ddaab6c133f9875a4a46c55cf0b58111b07 \
#   --treasury 0x19fe674a83e98c44ad4c2172e006c542b8e8fe08

echo ""
echo -e "${YELLOW}─────────────────────────────────────────${NC}\n"

# Example 3: Custom pool parameters
echo -e "${GREEN}Example 3: Custom Pool Parameters${NC}"
echo "For tokens with non-standard V4 pool setups."
echo ""
echo "Command:"
echo "  node burn.mjs \\"
echo "    --token 0xYourTokenAddress \\"
echo "    --treasury 0xYourTreasuryAddress \\"
echo "    --currency0 0x4200000000000000000000000000000000000006 \\"
echo "    --fee 0x800000 \\"
echo "    --tick-spacing 200 \\"
echo "    --hooks 0xCustomHooksAddress \\"
echo "    --dry-run"
echo ""

echo -e "${GREEN}✅ Examples complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Always run with --dry-run first"
echo "  2. Review the output carefully"
echo "  3. Remove --dry-run to execute live"
echo "  4. Save the JSON report for records"
