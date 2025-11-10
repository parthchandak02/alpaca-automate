# Next Steps - Deployment Checklist

## ✅ Completed
- [x] Cleaned up duplicate files
- [x] Installed cloudflared
- [x] Updated README with deployment info
- [x] Verified deployment approach is correct

## 🔧 Step 1: Complete Cloudflare Tunnel Setup (Backend)

**You need to do this manually:**

1. **Complete Tunnel Login** (if browser didn't open):
   ```bash
   cloudflared tunnel login
   ```
   - This opens a browser to authorize Cloudflare access
   - Click "Authorize" when prompted

2. **Create Tunnel**:
   ```bash
   cloudflared tunnel create alpaca-backend
   ```

3. **Create DNS Record**:
   ```bash
   cloudflared tunnel route dns alpaca-backend api-alpaca.parthchandak.info
   ```

4. **Get Tunnel ID**:
   ```bash
   cloudflared tunnel list
   ```
   Copy the tunnel ID (looks like: `abc123-def456-...`)

5. **Create Config File**:
   ```bash
   mkdir -p ~/.cloudflared
   ```
   Then create/edit `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: alpaca-backend
   credentials-file: /Users/parthchandak/.cloudflared/TUNNEL_ID.json
   
   ingress:
     - hostname: api-alpaca.parthchandak.info
       service: http://localhost:8080
     - service: http_status:404
   ```
   **Replace `TUNNEL_ID` with the actual ID from step 4**

6. **Test Tunnel**:
   ```bash
   cloudflared tunnel run alpaca-backend
   ```
   Should see: "Connection established"

7. **Add to PM2** (already configured, just restart):
   ```bash
   pm2 restart cloudflare-tunnel
   ```
   Or if not running:
   ```bash
   pm2 start config/ecosystem.config.js
   ```

## 🌐 Step 2: Set Up Cloudflare Pages (Frontend)

**Go to Cloudflare Dashboard:**

1. **Navigate**: https://dash.cloudflare.com → **Workers & Pages** → **Pages**

2. **Create Project**:
   - Click **Create application** → **Pages** → **Connect to Git**
   - Authorize GitHub access
   - Select repository: `parthchandak02/alpaca-automate`

3. **Configure Build Settings**:
   - **Project name**: `alpaca`
   - **Production branch**: `main`
   - **Framework preset**: `Next.js` (auto-detected)
   - **Build command**: `cd ui && npm install && npm run build`
   - **Build output directory**: `ui` (or leave empty - auto-detects)
   - **Root directory**: Leave empty

4. **Add Environment Variables** (before deploying):
   - Click **Environment variables** section
   - Add:
     - Name: `NEXT_PUBLIC_API_HOST`
     - Value: `api-alpaca.parthchandak.info`
     - Environment: Production
   - Add:
     - Name: `NEXT_PUBLIC_API_PORT`
     - Value: `443`
     - Environment: Production

5. **Deploy**: Click **Save and Deploy**
   - First build takes 3-5 minutes
   - Watch build logs for any errors

6. **Add Custom Domain** (after first deployment succeeds):
   - Go to **Custom domains** tab
   - Click **Set up a custom domain**
   - Enter: `alpaca.parthchandak.info`
   - Cloudflare auto-configures DNS and SSL

## ✅ Step 3: Test Everything

1. **Test Backend API**:
   ```bash
   curl https://api-alpaca.parthchandak.info/api/status
   ```
   Should return JSON with status

2. **Test Frontend**:
   - Visit: `https://alpaca.parthchandak.info`
   - Should load your Next.js app
   - Check browser console for API connection

3. **Check PM2 Status**:
   ```bash
   pm2 status
   pm2 logs cloudflare-tunnel --lines 20
   ```

## 🚀 Step 4: Verify Auto-Deployment

1. **Make a small change** (e.g., update README)
2. **Commit and push**:
   ```bash
   git add .
   git commit -m "Test deployment"
   git push origin main
   ```
3. **Check Cloudflare Pages**:
   - Go to your project → **Deployments**
   - Should see new deployment starting automatically
   - Wait 2-5 minutes for completion

## 📝 Quick Commands Reference

```bash
# Check tunnel status
cloudflared tunnel list
cloudflared tunnel info alpaca-backend

# View PM2 logs
pm2 logs cloudflare-tunnel
pm2 logs gtt-backend

# Restart services
pm2 restart all

# Test backend
curl https://api-alpaca.parthchandak.info/api/status
```

---

**Need help?** Check the README.md deployment section for details.

