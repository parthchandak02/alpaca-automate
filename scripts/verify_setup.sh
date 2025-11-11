#!/bin/bash
# Verify all 4 deployment scenarios are working correctly

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}      DEPLOYMENT SETUP VERIFICATION${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

ALL_PASSED=true

# 1. Check Local Backend
echo -e "${BLUE}1. Local Backend (localhost:8080)${NC}"
echo "─────────────────────────────────────────"
if curl -s http://localhost:8080/api/status > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Local backend is running${NC}"
    STATUS=$(curl -s http://localhost:8080/api/status | head -c 50)
    echo "   Response: ${STATUS}..."
else
    echo -e "${RED}❌ Local backend is NOT running${NC}"
    echo "   Run: pm2 start config/ecosystem.config.js"
    ALL_PASSED=false
fi
echo ""

# 2. Check Local Frontend
echo -e "${BLUE}2. Local Frontend (localhost:3000)${NC}"
echo "─────────────────────────────────────────"
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Local frontend is running${NC}"
    echo "   URL: http://localhost:3000"
    echo "   Should connect to: http://localhost:8080"
else
    echo -e "${RED}❌ Local frontend is NOT running${NC}"
    echo "   Run: pm2 start config/ecosystem.config.js"
    ALL_PASSED=false
fi
echo ""

# 3. Check Cloudflare Tunnel Backend (if configured)
echo -e "${BLUE}3. Cloudflare Tunnel Backend${NC}"
echo "─────────────────────────────────────────"
# Check if tunnel is configured by looking for cloudflared config
if [ -f ~/.cloudflared/config.yml ]; then
    # Extract hostname from config if possible
    TUNNEL_HOSTNAME=$(grep -A 1 "hostname:" ~/.cloudflared/config.yml 2>/dev/null | grep -v "hostname:" | head -1 | tr -d ' ' || echo "")
    if [ -n "$TUNNEL_HOSTNAME" ]; then
        if curl -s "https://${TUNNEL_HOSTNAME}/api/status" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Cloudflare Tunnel backend is accessible${NC}"
            echo "   URL: https://${TUNNEL_HOSTNAME}"
            STATUS=$(curl -s "https://${TUNNEL_HOSTNAME}/api/status" | head -c 50)
            echo "   Response: ${STATUS}..."
        else
            echo -e "${RED}❌ Cloudflare Tunnel backend is NOT accessible${NC}"
            echo "   Expected URL: https://${TUNNEL_HOSTNAME}"
            echo "   Check: pm2 logs cloudflare-tunnel"
            ALL_PASSED=false
        fi
    else
        echo -e "${YELLOW}⚠️  Cloudflare Tunnel config found but hostname not detected${NC}"
        echo "   Check ~/.cloudflared/config.yml"
    fi
else
    echo -e "${YELLOW}⚠️  Cloudflare Tunnel not configured (optional)${NC}"
    echo "   Skipping production backend check"
fi
echo ""

# 4. Check Cloudflare Pages Frontend (if configured)
echo -e "${BLUE}4. Cloudflare Pages Frontend${NC}"
echo "─────────────────────────────────────────"
echo -e "${YELLOW}⚠️  Cloudflare Pages frontend check skipped (requires domain configuration)${NC}"
echo "   To check manually:"
echo "   1. Visit your Cloudflare Pages URL"
echo "   2. Verify it connects to your API backend"
echo "   3. Check Cloudflare Dashboard → Workers & Pages → Your Project → Settings → Environment Variables"
echo "      - NEXT_PUBLIC_API_HOST: api-your-domain.com"
echo "      - NEXT_PUBLIC_API_PORT: 443"
echo ""

# 5. Check PM2 Status
echo -e "${BLUE}5. PM2 Process Status${NC}"
echo "─────────────────────────────────────────"
pm2 status | grep -E "gtt-backend|gtt-frontend|cloudflare-tunnel" || true
echo ""

# 6. Check Cloudflare Tunnel Status
echo -e "${BLUE}6. Cloudflare Tunnel Status${NC}"
echo "─────────────────────────────────────────"
if command -v cloudflared &> /dev/null; then
    TUNNEL_INFO=$(cloudflared tunnel list 2>&1 | grep "alpaca-backend" || echo "")
    if [ -n "$TUNNEL_INFO" ]; then
        echo -e "${GREEN}✅ Tunnel 'alpaca-backend' exists${NC}"
        echo "$TUNNEL_INFO"
    else
        echo -e "${RED}❌ Tunnel 'alpaca-backend' not found${NC}"
        ALL_PASSED=false
    fi
else
    echo -e "${YELLOW}⚠️  cloudflared not found in PATH${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
if [ "$ALL_PASSED" = true ]; then
    echo -e "${GREEN}✅ All checks passed!${NC}"
    echo ""
    echo "Your setup supports:"
    echo "  ✅ Local frontend → Local backend (http://localhost:3000 → http://localhost:8080)"
    if [ -f ~/.cloudflared/config.yml ]; then
        TUNNEL_HOSTNAME=$(grep -A 1 "hostname:" ~/.cloudflared/config.yml 2>/dev/null | grep -v "hostname:" | head -1 | tr -d ' ' || echo "")
        if [ -n "$TUNNEL_HOSTNAME" ]; then
            echo "  ✅ Cloudflare Tunnel backend configured: https://${TUNNEL_HOSTNAME}"
        fi
    fi
    echo ""
    echo "To test local development:"
    echo "  1. Open http://localhost:3000"
    echo "  2. Frontend will auto-detect localhost and connect to http://localhost:8080"
else
    echo -e "${RED}❌ Some checks failed. Please review above.${NC}"
fi
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

