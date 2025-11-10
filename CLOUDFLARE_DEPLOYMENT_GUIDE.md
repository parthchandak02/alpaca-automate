# Complete Cloudflare Deployment Guide

**Deploy your Alpaca Trading app to `alpaca.parthchandak.info` with automatic updates on `git push`**

This guide covers deploying both the Next.js frontend and Python Flask backend, with continuous deployment enabled.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Part 1: Deploy Frontend to Cloudflare Pages](#part-1-deploy-frontend-to-cloudflare-pages)
4. [Part 2: Deploy Backend (Choose One Option)](#part-2-deploy-backend-choose-one-option)
5. [Part 3: Configure Custom Domain Path](#part-3-configure-custom-domain-path)
6. [Part 4: Set Up Continuous Deployment](#part-4-set-up-continuous-deployment)
7. [Part 5: Environment Variables](#part-5-environment-variables)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

Your application consists of:
- **Frontend**: Next.js app (deployed to Cloudflare Pages)
- **Backend**: Python Flask API (needs continuous running server)

**Deployment Strategy:**
- Frontend → Cloudflare Pages (automatic deployment on git push)
- Backend → Cloudflare Tunnel on a server OR separate hosting service
- Custom domain: `alpaca.parthchandak.info` (frontend) and `api-alpaca.parthchandak.info` (backend)

---

## Prerequisites

✅ **Already Completed:**
- Cloudflare account with `parthchandak.info` domain
- Domain is active in Cloudflare

**What You Need:**
- GitHub repository (create one if you don't have it)
- A server/VPS for backend (or use Railway/Render for free tier)
- Cloudflare API token (for advanced automation)

---

## Part 1: Deploy Frontend to Cloudflare Pages

### Step 1: Prepare Your Repository

1. **Initialize Git** (if not already done):
```bash
cd /Users/parthchandak/Documents/alpaca-trading
git init
git add .
git commit -m "Initial commit"
```

2. **GitHub Repository**:
   - ✅ Already exists: `parthchandak02/alpaca-automate`
   - Repository is already connected

3. **Commit and Push Changes**:
```bash
git add .
git commit -m "Add Cloudflare deployment guide and configuration"
git push origin main
```

### Step 2: Configure Next.js for Production

1. **Update `ui/next.config.ts`** to support Cloudflare Pages:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // Add output configuration for static export (optional, for better performance)
  // output: 'export', // Uncomment if you want fully static export
  // trailingSlash: true, // Required if using static export
};

export default nextConfig;
```

2. **Update `ui/package.json`** to add build script (if missing):

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  }
}
```

### Step 3: Connect Repository to Cloudflare Pages

1. **Log in to Cloudflare Dashboard**:
   - Go to [dash.cloudflare.com](https://dash.cloudflare.com)
   - Navigate to **Workers & Pages** → **Pages**

2. **Create New Project**:
   - Click **Create application** → **Pages** → **Connect to Git**
   - Authorize Cloudflare to access your GitHub account
   - Select your `alpaca-automate` repository

3. **Configure Build Settings**:
   - **Project name**: `alpaca` (or your preferred name)
   - **Production branch**: `main`
   - **Framework preset**: `Next.js` (Cloudflare will auto-detect)
   - **Build command**: `cd ui && npm install && npm run build`
   - **Build output directory**: `ui/.next` (Cloudflare Pages handles Next.js automatically)
   - **Root directory**: Leave empty (or set to `/` if needed)

   **Note**: Cloudflare Pages supports Next.js natively, so you can also use:
   - **Build command**: `cd ui && npm install && npm run build`
   - **Build output directory**: `ui` (Cloudflare will detect Next.js automatically)

4. **Environment Variables** (we'll add these in Part 5):
   - Click **Save and Deploy** for now
   - We'll add environment variables after first deployment

5. **Deploy**:
   - Click **Save and Deploy**
   - Wait for build to complete (usually 2-5 minutes)
   - You'll get a URL like: `https://alpaca-trading.pages.dev`

---

## Part 2: Deploy Backend (Choose One Option)

You have **two options** for the backend:

### Option A: Cloudflare Tunnel (Recommended for Existing Setup)

**Best for**: You already have a server/VPS running, or want to keep using your current setup.

#### Setup Steps:

1. **Install cloudflared** (if not already installed):
```bash
brew install cloudflare/cloudflare/cloudflared
```

2. **Login to Cloudflare**:
```bash
cloudflared tunnel login
```

3. **Create Tunnel** (if not already created):
```bash
cloudflared tunnel create alpaca-trading-backend
```

4. **Create DNS Record for Backend API**:
```bash
cloudflared tunnel route dns alpaca-trading-backend api-alpaca-trading.parthchandak.info
```

5. **Configure Tunnel Config** (`~/.cloudflared/config.yml`):
```yaml
tunnel: alpaca-trading-backend
credentials-file: /Users/$(whoami)/.cloudflared/TUNNEL_ID.json

ingress:
  # Backend API (Flask)
  - hostname: api-alpaca.parthchandak.info
    service: http://localhost:8080
  
  # Catch-all (404)
  - service: http_status:404
```

6. **Run Tunnel** (or add to PM2):
```bash
cloudflared tunnel run alpaca-trading-backend
```

**Or add to PM2** (already configured in `config/ecosystem.config.js`):
```bash
pm2 start config/ecosystem.config.js
pm2 save
```

---

### Option B: Separate Hosting Service (Railway/Render)

**Best for**: You want a fully managed backend without maintaining a server.

#### Using Railway (Recommended - Free Tier Available):

1. **Sign up**: Go to [railway.app](https://railway.app)

2. **Create New Project**:
   - Click **New Project** → **Deploy from GitHub repo**
   - Select your `alpaca-automate` repository

3. **Configure Service**:
   - **Root Directory**: `/` (project root)
   - **Build Command**: `pip install -r requirements.txt` (or `uv sync` if using uv)
   - **Start Command**: `uv run python -m src.gtt_monitor` (or `python -m src.gtt_monitor`)
   - **Port**: `8080` (set in Railway environment variables)

4. **Set Environment Variables** (see Part 5)

5. **Get Public URL**:
   - Railway will provide a URL like: `https://your-app.up.railway.app`
   - Use this as your backend API URL

#### Using Render (Alternative):

1. **Sign up**: Go to [render.com](https://render.com)

2. **Create Web Service**:
   - Connect GitHub repository
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python -m src.gtt_monitor`
   - **Port**: `8080`

3. **Set Environment Variables** (see Part 5)

4. **Get Public URL**: `https://your-app.onrender.com`

---

## Part 3: Configure Custom Domain Path

### Option 1: Deploy to Subdirectory Path (`/alpaca-trading`)

**For Cloudflare Pages**, you have two approaches:

#### Approach A: Use Base Path Configuration (Recommended)

1. **Update `ui/next.config.ts`**:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  basePath: '/alpaca-trading', // Add this
  assetPrefix: '/alpaca-trading', // Add this for assets
};

export default nextConfig;
```

2. **Update `ui/package.json`** build script:
```json
{
  "scripts": {
    "build": "next build",
    "start": "next start"
  }
}
```

3. **Redeploy**: Push changes and Cloudflare Pages will rebuild automatically

#### Approach B: Use Cloudflare Workers for Path Routing

This requires a Cloudflare Worker to route `/alpaca-trading/*` to your Pages site. More complex but gives more control.

### Option 2: Deploy to Subdomain (`alpaca-trading.parthchandak.info`)

**Simpler approach** - deploy directly to a subdomain:

1. **In Cloudflare Pages**:
   - Go to your project → **Custom domains**
   - Click **Set up a custom domain**
   - Enter: `alpaca-trading.parthchandak.info`

2. **Cloudflare will automatically**:
   - Create DNS records
   - Set up SSL certificate
   - Route traffic to your Pages site

3. **No code changes needed** - this is the easiest option!

**Recommendation**: Use **Option 2 (subdomain)** for simplicity, or **Option 1 Approach A** if you specifically need the `/alpaca-trading` path.

---

## Part 4: Set Up Continuous Deployment

### Automatic Deployment is Already Enabled!

Once you connect your GitHub repository to Cloudflare Pages, **every push to `main` branch automatically triggers a new deployment**.

### How It Works:

1. **Push to GitHub**:
```bash
git add .
git commit -m "Update feature"
git push origin main
```

2. **Cloudflare Pages automatically**:
   - Detects the push
   - Runs build command
   - Deploys new version
   - Updates your site (usually within 2-5 minutes)

### View Deployment Status:

- Go to Cloudflare Pages dashboard
- Click on your project
- See **Deployments** tab for build logs and status

### Preview Deployments:

- **Pull Requests**: Cloudflare creates preview URLs for PRs automatically
- **Other Branches**: Deployments from other branches create preview deployments

### Manual Deployment (if needed):

- Go to Cloudflare Pages → Your Project → **Deployments**
- Click **Retry deployment** or **Create deployment**

---

## Part 5: Environment Variables

### Frontend Environment Variables (Cloudflare Pages)

1. **Go to Cloudflare Pages Dashboard**:
   - Your Project → **Settings** → **Environment variables**

2. **Add Variables**:
   - **Name**: `NEXT_PUBLIC_API_HOST`
   - **Value**: `api-alpaca.parthchandak.info` (or your backend URL)
   - **Environment**: Production, Preview, or Both

   - **Name**: `NEXT_PUBLIC_API_PORT`
   - **Value**: `443` (for HTTPS) or `80` (for HTTP)
   - **Environment**: Production, Preview, or Both

3. **Save**: Changes take effect on next deployment

### Backend Environment Variables

#### If Using Cloudflare Tunnel (Option A):

Set in your `.env` file on your server:
```bash
ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_secret_here
ALPACA_PAPER=true
PORT_API=8080
PORT_UI=3000
# ... other variables
```

#### If Using Railway/Render (Option B):

1. **Railway**:
   - Project → Your Service → **Variables** tab
   - Add each environment variable

2. **Render**:
   - Service → **Environment** tab
   - Add each environment variable

**Required Variables**:
```
ALPACA_API_KEY=your_key
ALPACA_SECRET_KEY=your_secret
ALPACA_PAPER=true
PORT_API=8080
```

**Optional Variables**:
```
DISCORD_WEBHOOK_URL=your_webhook_url
EMAIL_NOTIFICATIONS_ENABLED=false
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email
SMTP_PASSWORD=your_app_password
EMAIL_TO=recipient@example.com
```

---

## Part 6: Update Frontend to Use Production API

The frontend code already supports production configuration via environment variables. Make sure:

1. **`NEXT_PUBLIC_API_HOST`** is set to your backend URL
2. **`NEXT_PUBLIC_API_PORT`** is set to `443` (HTTPS) or `80` (HTTP)

The frontend will automatically:
- Use `https://api-alpaca-trading.parthchandak.info` in production
- Use `http://localhost:8080` in local development

---

## Troubleshooting

### Frontend Issues

**Problem**: Build fails in Cloudflare Pages
- **Solution**: Check build logs in Cloudflare dashboard
- Common issues:
  - Missing dependencies → Add to `package.json`
  - Build command incorrect → Verify in Pages settings
  - TypeScript errors → Fix before pushing

**Problem**: Frontend can't connect to backend
- **Solution**: 
  - Verify `NEXT_PUBLIC_API_HOST` is set correctly
  - Check CORS settings in Flask backend
  - Verify backend is running and accessible

**Problem**: Assets not loading (404 errors)
- **Solution**: 
  - If using `basePath`, ensure `assetPrefix` matches
  - Check Cloudflare Pages build output directory

### Backend Issues

**Problem**: Cloudflare Tunnel not connecting
- **Solution**:
  ```bash
  cloudflared tunnel list  # Verify tunnel exists
  cloudflared tunnel info alpaca-trading-backend  # Check status
  cloudflared tunnel run alpaca-trading-backend  # Test manually
  ```

**Problem**: Backend API returns CORS errors
- **Solution**: Flask CORS is already configured in `src/api_server.py`
  - Verify `CORS(app)` is enabled
  - Check that frontend URL is allowed

**Problem**: Environment variables not working
- **Solution**:
  - Verify variables are set in Cloudflare Pages (for frontend)
  - Verify variables are set in Railway/Render (for backend)
  - Restart services after adding variables

### Domain/DNS Issues

**Problem**: Custom domain not working
- **Solution**:
  - Check DNS records in Cloudflare dashboard
  - Verify SSL certificate is active (should be automatic)
  - Wait up to 24 hours for DNS propagation

**Problem**: `/alpaca-trading` path returns 404
- **Solution**:
  - Verify `basePath` is set in `next.config.ts`
  - Rebuild and redeploy
  - Check Cloudflare Pages routing rules

---

## Quick Reference

### Deployment URLs

- **Frontend**: `https://alpaca.parthchandak.info`
- **Backend API**: `https://api-alpaca.parthchandak.info`

### Git Workflow

```bash
# Make changes
git add .
git commit -m "Your commit message"
git push origin main

# Cloudflare Pages automatically deploys (2-5 minutes)
```

### Useful Commands

```bash
# Check Cloudflare Tunnel status
cloudflared tunnel list
cloudflared tunnel info alpaca-trading-backend

# View PM2 logs (if using Tunnel)
pm2 logs gtt-backend
pm2 logs cloudflare-tunnel

# Test backend API
curl https://api-alpaca.parthchandak.info/api/status

# Test frontend
curl https://alpaca.parthchandak.info
```

---

## Summary

✅ **Frontend**: Deployed to Cloudflare Pages with automatic deployment  
✅ **Backend**: Running via Cloudflare Tunnel or Railway/Render  
✅ **Custom Domain**: Configured at `alpaca.parthchandak.info`  
✅ **Continuous Deployment**: Enabled - every `git push` updates the site  

**Next Steps**:
1. Complete Part 1 (Frontend deployment)
2. Complete Part 2 (Backend deployment - choose your option)
3. Complete Part 3 (Custom domain configuration)
4. Set environment variables (Part 5)
5. Test your deployment!

**Need Help?**
- Cloudflare Pages Docs: https://developers.cloudflare.com/pages/
- Cloudflare Tunnel Docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
- Railway Docs: https://docs.railway.app/

---

**Last Updated**: January 2025

---

## Quick Start Checklist

Use this checklist to ensure you've completed all steps:

### Frontend Deployment
- [ ] Repository pushed to GitHub
- [ ] Cloudflare Pages project created
- [ ] Build settings configured (`cd ui && npm install && npm run build`)
- [ ] First deployment successful
- [ ] Environment variables set (`NEXT_PUBLIC_API_HOST`, `NEXT_PUBLIC_API_PORT`)

### Backend Deployment
- [ ] Choose deployment option (Tunnel or Railway/Render)
- [ ] Backend running and accessible
- [ ] Backend URL confirmed (test with `/api/status` endpoint)
- [ ] Environment variables set on backend

### Domain Configuration
- [ ] Custom domain added in Cloudflare Pages
- [ ] DNS records verified
- [ ] SSL certificate active (automatic)
- [ ] Test frontend URL works
- [ ] Test backend API URL works

### Testing
- [ ] Frontend loads correctly
- [ ] Frontend can connect to backend API
- [ ] API endpoints respond correctly
- [ ] No CORS errors in browser console
- [ ] All features working as expected

### Continuous Deployment
- [ ] Test push to GitHub triggers deployment
- [ ] Deployment completes successfully
- [ ] Changes appear on live site

---

## Alternative: Simplified Setup (Subdomain Approach)

If you want the **simplest setup**, use a subdomain instead of a path:

1. **Deploy frontend to**: `alpaca.parthchandak.info`
2. **Deploy backend to**: `api-alpaca.parthchandak.info`
3. **No code changes needed** - just configure domains in Cloudflare

This avoids the complexity of `basePath` configuration and is recommended for most users.

