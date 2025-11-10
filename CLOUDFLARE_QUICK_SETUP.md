# Cloudflare Tunnel Quick Setup Guide

> **⚠️ Note**: This is a quick setup guide for local development with Cloudflare Tunnel.  
> **For production deployment with automatic git push updates, see**: [`CLOUDFLARE_DEPLOYMENT_GUIDE.md`](./CLOUDFLARE_DEPLOYMENT_GUIDE.md)

## Prerequisites
- Cloudflare account (you already have: parthchandak.info)
- Domain: `parthchandak.info` (already in Cloudflare)

## Quick Setup (5 minutes)

### Step 1: Install cloudflared
```bash
brew install cloudflare/cloudflare/cloudflared
```

### Step 2: Login to Cloudflare
```bash
cloudflared tunnel login
```
This opens your browser - authorize the access.

### Step 3: Create Tunnel
```bash
cloudflared tunnel create alpaca-trading
```

### Step 4: Create DNS Records
```bash
# Frontend subdomain
cloudflared tunnel route dns alpaca-trading alpaca-trading.parthchandak.info

# Backend API subdomain  
cloudflared tunnel route dns alpaca-trading api-alpaca-trading.parthchandak.info
```

### Step 5: Create Config File
```bash
mkdir -p ~/.cloudflared

# Get your tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | grep alpaca-trading | awk '{print $1}')

# Create config
cat > ~/.cloudflared/config.yml << EOF
tunnel: alpaca-trading
credentials-file: /Users/$(whoami)/.cloudflared/${TUNNEL_ID}.json

ingress:
  # Frontend (Next.js)
  - hostname: alpaca-trading.parthchandak.info
    service: http://localhost:3000
  
  # Backend API (Flask)
  - hostname: api-alpaca-trading.parthchandak.info
    service: http://localhost:8080
  
  # Catch-all (404)
  - service: http_status:404
EOF
```

### Step 6: Test Tunnel
```bash
cloudflared tunnel run alpaca-trading
```

You should see:
```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at:                                         |
|  https://alpaca-trading.parthchandak.info                                                  |
+--------------------------------------------------------------------------------------------+
```

### Step 7: Add to PM2 (Auto-start)
Your `config/ecosystem.config.js` already has the Cloudflare Tunnel config! Just start PM2:

```bash
pm2 start config/ecosystem.config.js
pm2 save
```

The tunnel will start automatically with your app.

## Update Frontend Environment

Add to your `.env` file:
```bash
NEXT_PUBLIC_API_HOST=api-alpaca-trading.parthchandak.info
NEXT_PUBLIC_API_PORT=443
```

## Access Your App

- **Frontend**: `https://alpaca-trading.parthchandak.info`
- **Backend API**: `https://api-alpaca-trading.parthchandak.info/api/status`

## Troubleshooting

**Check tunnel status:**
```bash
cloudflared tunnel list
cloudflared tunnel info alpaca-trading
```

**View logs:**
```bash
pm2 logs cloudflare-tunnel
```

**Test locally first:**
```bash
curl http://localhost:3000  # Frontend
curl http://localhost:8080/api/status  # Backend
```

## That's It!

Your app will be accessible from anywhere in the world with:
- ✅ HTTPS automatically (free SSL)
- ✅ DDoS protection
- ✅ No port forwarding needed
- ✅ Runs automatically on boot (via PM2)

**All FREE with your Cloudflare account!** 🚀

---

**For Production Deployment with Git Push Automation**: See [`CLOUDFLARE_DEPLOYMENT_GUIDE.md`](./CLOUDFLARE_DEPLOYMENT_GUIDE.md)

