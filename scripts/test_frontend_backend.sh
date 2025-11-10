#!/bin/bash
# Frontend-Backend Connection Test
# Tests if frontend can reach backend API endpoints

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load .env if exists
if [ -f .env ]; then
    export $(grep CLOUDFLARE_API_TOKEN .env | xargs)
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}      FRONTEND-BACKEND CONNECTION TEST${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Expected API endpoints (from frontend code)
API_HOST="api-alpaca.parthchandak.info"
API_PORT="443"
API_BASE="https://${API_HOST}"

ENDPOINTS=(
    "/api/status"
    "/api/account"
    "/api/orders"
    "/api/prices"
)

echo -e "${BLUE}📡 Testing Backend API Endpoints${NC}"
echo "─────────────────────────────────────────"
echo "API Base URL: $API_BASE"
echo ""

ALL_PASSED=true

for endpoint in "${ENDPOINTS[@]}"; do
    URL="${API_BASE}${endpoint}"
    echo -n "Testing ${endpoint}... "
    
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ OK${NC} (HTTP $HTTP_CODE)"
        # Show sample response
        RESPONSE=$(curl -s "$URL" 2>/dev/null | head -c 100)
        echo "   Response: ${RESPONSE}..."
    elif [ "$HTTP_CODE" = "000" ]; then
        echo -e "${RED}❌ FAILED${NC} (Connection error)"
        ALL_PASSED=false
    else
        echo -e "${YELLOW}⚠️  HTTP $HTTP_CODE${NC}"
        ALL_PASSED=false
    fi
done

echo ""
echo -e "${BLUE}🌐 Frontend Configuration Check${NC}"
echo "─────────────────────────────────────────"

# Check Cloudflare Pages env vars
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  Cannot check Cloudflare env vars (API token not set)${NC}"
else
    echo "Checking Cloudflare Pages environment variables..."
    ENV_VARS=$(curl -s "https://api.cloudflare.com/client/v4/accounts/0e94c4d1c494e783d4d386498de3652d/pages/projects/alpaca/deployment_configs/production" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 2>/dev/null | python3 -m json.tool 2>/dev/null | grep -A 20 "env_vars" || echo "")
    
    if echo "$ENV_VARS" | grep -q "NEXT_PUBLIC_API_HOST"; then
        API_HOST_VALUE=$(echo "$ENV_VARS" | grep -A 2 "NEXT_PUBLIC_API_HOST" | grep "value" | cut -d'"' -f4)
        echo -e "${GREEN}✅ NEXT_PUBLIC_API_HOST: $API_HOST_VALUE${NC}"
    else
        echo -e "${RED}❌ NEXT_PUBLIC_API_HOST: Not set${NC}"
        ALL_PASSED=false
    fi
    
    if echo "$ENV_VARS" | grep -q "NEXT_PUBLIC_API_PORT"; then
        API_PORT_VALUE=$(echo "$ENV_VARS" | grep -A 2 "NEXT_PUBLIC_API_PORT" | grep "value" | cut -d'"' -f4)
        echo -e "${GREEN}✅ NEXT_PUBLIC_API_PORT: $API_PORT_VALUE${NC}"
    else
        echo -e "${RED}❌ NEXT_PUBLIC_API_PORT: Not set${NC}"
        ALL_PASSED=false
    fi
fi

echo ""
echo -e "${BLUE}🔍 Browser Console Check${NC}"
echo "─────────────────────────────────────────"
echo "To verify frontend-backend connection in browser:"
echo ""
echo "1. Open: https://alpaca.parthchandak.info"
echo "2. Open Developer Tools (F12)"
echo "3. Go to Network tab"
echo "4. Look for requests to:"
echo "   - https://api-alpaca.parthchandak.info/api/status"
echo "   - https://api-alpaca.parthchandak.info/api/account"
echo "   - https://api-alpaca.parthchandak.info/api/orders"
echo "   - https://api-alpaca.parthchandak.info/api/prices"
echo ""
echo "5. Check Console tab for any CORS or connection errors"
echo ""

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    SUMMARY${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

if [ "$ALL_PASSED" = true ]; then
    echo -e "${GREEN}✅ All API endpoints accessible!${NC}"
    echo -e "${GREEN}✅ Frontend should be able to connect to backend${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  Some endpoints may have issues${NC}"
    echo -e "${YELLOW}⚠️  Check Cloudflare Pages environment variables${NC}"
    exit 1
fi

