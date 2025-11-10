# Alpaca Order Manager

GTT-style sequential conditional orders for Alpaca. Automatically places limit orders in sequence when trigger prices are met, without locking buying power until each order is triggered.

## Quick Start

1. **Install dependencies**:
```bash
pip install -r requirements.txt
cd ui && npm install && cd ..
```

2. **Configure**:
```bash
cp .env.example .env
# Edit .env with your Alpaca API keys
```

3. **Setup CSV files**:
```bash
cp data/gtt-live-stocks-etfs.csv.example data/gtt-live-stocks-etfs.csv
cp data/gtt-live-crypto.csv.example data/gtt-live-crypto.csv
# Edit CSV files with your orders
```

4. **Start with PM2**:
```bash
pm2 start config/ecosystem.config.js
pm2 logs gtt-app
```

UI available at `http://localhost:3000` (configurable via `PORT_UI` in `.env`)

## Project Structure

```
alpaca-trading/
├── src/                    # Core Python code
│   ├── gtt_monitor.py     # Main monitor: loads orders, watches prices, places orders
│   ├── api_server.py      # Flask API: exposes data to web UI
│   └── templates/         # Email templates
│       └── email_template.html  # HTML email template (editable)
├── ui/                     # Next.js web interface
│   ├── app/page.tsx       # Main UI component
│   └── components/        # Reusable UI components
├── scripts/                # Utility scripts
│   ├── manual_place.py    # Manually place a specific order
│   ├── simulate_fill.py   # Test: simulate order fill
│   └── place_test_orders.py
├── config/                 # Configuration
│   ├── ecosystem.config.js # PM2 config
│   └── start.sh           # Startup script (starts Python + UI)
├── data/                   # CSV order files
│   ├── gtt-live-stocks-etfs.csv      # Your stock orders (gitignored)
│   ├── gtt-live-crypto.csv           # Your crypto orders (gitignored)
│   └── *.csv.example      # Example templates
└── logs/                   # Application logs
```

## How It Works

### High-Level Flow

1. **Load Orders**: Reads CSV files (`gtt-live-stocks-etfs.csv`, `gtt-live-crypto.csv`)
   - Each row = one symbol with up to 8 sequential orders
   - Format: `Company, Symbol, Amt1, Price1, Amt2, Price2, ...`

2. **Monitor Prices**: 
   - **WebSocket mode**: Real-time price updates (preferred)
   - **Polling mode**: Falls back if WebSocket fails (checks every 60s)

3. **Trigger Logic**:
   - First order: Waits for price ≤ trigger price
   - Subsequent orders: Auto-placed immediately after previous order fills

4. **Order Execution**:
   ```
   Price hits trigger → Place Order 1 → Wait for fill → 
   Order 1 fills → Place Order 2 → Wait for fill → ...
   ```

5. **Fill Detection**:
   - Checks order status every 5 seconds (WebSocket) or 3 minutes (Polling)
   - When order status = "filled" → advances to next order automatically

### Key Components

**`src/gtt_monitor.py`**:
- `GTTOrderManager`: Manages order ladders, price monitoring, order placement
- `SymbolLadder`: Tracks sequential orders for one symbol
- `CSVFileHandler`: Auto-reloads orders when CSV files change (watchdog)
- `main()`: Entry point - starts API server, loads CSVs, begins monitoring

**`src/api_server.py`**:
- Flask REST API endpoints:
  - `/api/orders` - All orders (GTT + active Alpaca orders)
  - `/api/prices` - Current market prices
  - `/api/account` - Account info (buying power, equity)
  - `/api/status` - Loading progress
  - `/api/force-fill-order` - Force fill any pending order (bypasses sequential logic)
  - `/api/simulate-fill` - Force place current order (testing)

**`ui/app/page.tsx`**:
- Two tabs: "Orders" (Active/Completed/Cancelled) and "GTT" (conditional orders)
- Real-time updates every 5 seconds
- Shows current prices, order status, account summary
- Force Fill button: Manually fill any pending order (useful for testing)
- Status icons: Trading mode (paper/live), sync status, market status with hover tooltips

## CSV Format

```csv
Company ,Account ,Amt 1,Price 1,Amt 2,Price 2,...,Amt 8,Price 8,Recurring Amount,Notes
iShares MSCI Taiwan ETF,EWT,1.0,$64.61,2,$58.15,3,$52.00,5,$46.00,8,$41.00,12,$36.00,18,$32.00,27,$28.00,100,
```

- `Company`: Display name
- `Account`: **Symbol** (e.g., "EWT", "ETH")
- `Amt N` / `Price N`: Order amount and trigger price
- Prices can include `$` and commas: `"$3,398.73"` or `64.61`

## Configuration

Environment variables (`.env`):
- `ALPACA_API_KEY` / `ALPACA_SECRET_KEY`: Required
- `ALPACA_PAPER=true`: Paper trading mode
- `PORT_API=8080`: Flask API port
- `PORT_UI=3000`: Next.js UI port
- `POLL_INTERVAL_SECONDS=60`: Polling interval (fallback mode)
- `DISCORD_WEBHOOK_URL`: Optional - Discord webhook for notifications
- `EMAIL_NOTIFICATIONS_ENABLED=true`: Optional - Enable email notifications
- `SMTP_SERVER=smtp.gmail.com`: Optional - SMTP server (default: Gmail)
- `SMTP_PORT=587`: Optional - SMTP port (default: 587)
- `SMTP_USERNAME=your-email@gmail.com`: Optional - Your email address
- `SMTP_PASSWORD=your-app-password`: Optional - Gmail App Password (not regular password)
- `EMAIL_TO=recipient@example.com`: Optional - Recipient email address (comma-separated for multiple recipients)

### Email Notifications Setup (Gmail Example)

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate an App Password**:
   - Go to Google Account → Security → 2-Step Verification → App passwords
   - Create a new app password for "Mail"
   - Copy the 16-character password
3. **Add to `.env`**:
   ```bash
   EMAIL_NOTIFICATIONS_ENABLED=true
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=your-email@gmail.com
   SMTP_PASSWORD=your-16-char-app-password
   EMAIL_TO=recipient1@example.com,recipient2@example.com
   ```
   **Note**: For multiple recipients, separate email addresses with commas (no spaces needed).
4. **Restart PM2**: `pm2 restart gtt-app --update-env`

**Note**: Email notifications are sent for **all order status changes** including: placed, filled, partially filled, cancelled, expired, rejected, and more. They work alongside Discord notifications (both can be enabled simultaneously).

**Customizing Email Templates**: Edit `src/templates/email_template.html` to customize the email design. The template uses simple variable replacement (`{{title}}`, `{{description}}`, etc.) and supports HTML with inline CSS.

## PM2 Commands

```bash
pm2 start config/ecosystem.config.js    # Start
pm2 logs gtt-app                        # View logs
pm2 status                              # Check status
pm2 restart gtt-app                     # Restart
pm2 stop gtt-app                        # Stop
pm2 save && pm2 startup                 # Auto-start on boot
```

## Testing Scripts

- `scripts/manual_place.py`: Place a specific order manually
- `scripts/simulate_fill.py`: Simulate order fill (advances to next order)
- `scripts/place_test_orders.py`: Place test orders

## Notes

- Orders only lock buying power when actually placed (after trigger)
- CSV changes auto-reload (no restart needed)
- WebSocket preferred; falls back to polling automatically
- Test in paper trading mode first!
- Live CSV files are gitignored (use `.example` files as templates)

## Deployment

Deploy frontend to Cloudflare Pages and backend via Cloudflare Tunnel for automatic deployments on `git push`.

### Architecture

- **Frontend**: Cloudflare Pages (Next.js) → `your-domain.com`
- **Backend**: Cloudflare Tunnel (Flask API) → `api-your-domain.com`

### Backend Setup (Cloudflare Tunnel)

1. **Install cloudflared**:
   ```bash
   brew install cloudflare/cloudflare/cloudflared  # macOS
   # or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/
   ```

2. **Login and create tunnel**:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create your-app-backend
   cloudflared tunnel route dns your-app-backend api-your-domain.com
   ```

3. **Get tunnel ID**:
   ```bash
   cloudflared tunnel list
   # Copy the tunnel ID (e.g., abc123-def456-...)
   ```

4. **Create config file** (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: your-app-backend
   credentials-file: ~/.cloudflared/TUNNEL_ID.json
   
   ingress:
     - hostname: api-your-domain.com
       service: http://localhost:8080
     - service: http_status:404
   ```
   Replace `TUNNEL_ID` with your actual tunnel ID and `your-app-backend` with your tunnel name.

5. **Test tunnel**:
   ```bash
   cloudflared tunnel run your-app-backend
   ```
   Should see "Registered tunnel connection" messages.

6. **Add to PM2** (update `config/ecosystem.config.js` if needed):
   ```bash
   # Update tunnel name in config/ecosystem.config.js to match your tunnel name
   pm2 start config/ecosystem.config.js
   pm2 save
   ```

### Frontend Setup (Cloudflare Pages)

1. **Go to Cloudflare Dashboard**:
   - Navigate to: **Workers & Pages** → **Pages**
   - Click **Create application** → **Pages** → **Connect to Git**

2. **Connect repository**:
   - Authorize Cloudflare to access GitHub
   - Select your repository

3. **Configure build settings**:
   - **Project name**: Your choice (e.g., `my-app` or `trading-app`)
   - **Production branch**: `main`
   - **Framework preset**: `Next.js` (auto-detected)
   - **Build command**: `cd ui && npm install && npm run build`
   - **Build output directory**: `ui` (or leave empty - auto-detects)
   - **Root directory**: Leave empty

4. **Add environment variables** (before deploying):
   - Click **Environment variables**
   - Add:
     - Name: `NEXT_PUBLIC_API_HOST`
     - Value: `api-your-domain.com` (your backend URL)
     - Environment: Production
   - Add:
     - Name: `NEXT_PUBLIC_API_PORT`
     - Value: `443`
     - Environment: Production

5. **Deploy**:
   - Click **Save and Deploy**
   - First build takes 3-5 minutes
   - Watch build logs for errors

6. **Add custom domain** (after deployment succeeds):
   - Go to **Custom domains** tab
   - Click **Set up a custom domain**
   - Enter your domain (e.g., `your-domain.com`)
   - Cloudflare auto-configures DNS and SSL

### Testing

```bash
# Test backend API
curl https://api-your-domain.com/api/status

# Test frontend (visit in browser)
open https://your-domain.com
```

### Auto-Deployment

Every `git push` to `main` automatically triggers a new Cloudflare Pages deployment. Check **Deployments** tab in Cloudflare Pages dashboard to see build status.

### Troubleshooting

**Backend not accessible**:
- Check tunnel is running: `pm2 logs cloudflare-tunnel`
- Verify DNS: `dig api-your-domain.com`
- Check tunnel status: `cloudflared tunnel info your-app-backend`

**Frontend build fails**:
- Check build logs in Cloudflare Pages dashboard
- Verify environment variables are set correctly
- Ensure `ui/package.json` has build script

**Frontend can't connect to backend**:
- Verify `NEXT_PUBLIC_API_HOST` matches your backend URL
- Check CORS settings in Flask backend (already configured)
- Ensure backend tunnel is running
