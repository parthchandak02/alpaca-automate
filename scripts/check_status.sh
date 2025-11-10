#!/bin/bash
# Site Status Checker
# Checks backend, frontend, PM2 processes, and Cloudflare deployments

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
    export $(grep CLOUDFLARE_ACCOUNT_ID .env | xargs)
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           ALPACA TRADING - SITE STATUS CHECK${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Check Backend API
echo -e "${BLUE}📡 BACKEND API${NC}"
echo "─────────────────────────────────────────"
BACKEND_URL="https://api-alpaca.parthchandak.info/api/status"
if curl -s -f "$BACKEND_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend API: Working${NC}"
    echo "   URL: $BACKEND_URL"
    RESPONSE=$(curl -s "$BACKEND_URL")
    echo "   Response: $RESPONSE"
else
    echo -e "${RED}❌ Backend API: Not responding${NC}"
    echo "   URL: $BACKEND_URL"
fi
echo ""

# Check Frontend
echo -e "${BLUE}🌐 FRONTEND${NC}"
echo "─────────────────────────────────────────"
FRONTEND_URL="https://alpaca.parthchandak.info"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Frontend: Working${NC}"
    echo "   URL: $FRONTEND_URL"
    echo "   HTTP Status: $HTTP_CODE"
elif [ "$HTTP_CODE" = "404" ]; then
    echo -e "${YELLOW}⚠️  Frontend: 404 Error${NC}"
    echo "   URL: $FRONTEND_URL"
    echo "   HTTP Status: $HTTP_CODE"
    echo "   Issue: Deployment may be building or misconfigured"
else
    echo -e "${RED}❌ Frontend: Error (HTTP $HTTP_CODE)${NC}"
    echo "   URL: $FRONTEND_URL"
fi
echo ""

# Check PM2 Processes
echo -e "${BLUE}⚙️  PM2 PROCESSES${NC}"
echo "─────────────────────────────────────────"
if command -v pm2 > /dev/null 2>&1; then
    PM2_STATUS=$(pm2 jlist 2>/dev/null || echo "[]")
    if [ "$PM2_STATUS" != "[]" ]; then
        echo -e "${GREEN}✅ PM2: Running${NC}"
        pm2 list | grep -E "gtt-backend|gtt-frontend|cloudflare-tunnel" || echo "   No matching processes found"
    else
        echo -e "${RED}❌ PM2: Not running or no processes${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  PM2: Not installed${NC}"
fi
echo ""

# Check Cloudflare Deployments
echo -e "${BLUE}☁️  CLOUDFLARE DEPLOYMENTS${NC}"
echo "─────────────────────────────────────────"
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  Cloudflare API Token not set${NC}"
    echo "   Set CLOUDFLARE_API_TOKEN in .env to check deployments"
else
    if command -v wrangler > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Wrangler: Available${NC}"
        echo ""
        echo "Latest deployments:"
        wrangler pages deployment list --project-name=alpaca 2>&1 | head -8 || echo "   Error fetching deployments"
    else
        echo -e "${YELLOW}⚠️  Wrangler: Not installed${NC}"
        echo "   Install: npm install -g wrangler"
    fi
fi
echo ""

# Summary
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    SUMMARY${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

BACKEND_OK=false
FRONTEND_OK=false
PM2_OK=false

if curl -s -f "$BACKEND_URL" > /dev/null 2>&1; then
    BACKEND_OK=true
fi

if [ "$HTTP_CODE" = "200" ]; then
    FRONTEND_OK=true
fi

if [ "$PM2_STATUS" != "[]" ] && command -v pm2 > /dev/null 2>&1; then
    PM2_OK=true
fi

if [ "$BACKEND_OK" = true ] && [ "$FRONTEND_OK" = true ] && [ "$PM2_OK" = true ]; then
    echo -e "${GREEN}✅ All systems operational!${NC}"
    exit 0
elif [ "$BACKEND_OK" = true ] && [ "$PM2_OK" = true ]; then
    echo -e "${YELLOW}⚠️  Backend OK, Frontend needs attention${NC}"
    exit 1
else
    echo -e "${RED}❌ Some systems need attention${NC}"
    exit 1
fi

