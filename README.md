# Alpaca Order Manager

GTT-style sequential conditional orders for Alpaca. Automatically places limit orders in sequence when trigger prices are met, without locking buying power until each order is triggered.

## Features

- **Sequential Order Execution**: Automatically places orders in sequence when trigger prices are met
- **Real-time Price Monitoring**: WebSocket-based price updates with polling fallback
- **Web Dashboard**: Next.js UI for monitoring orders, prices, and account status
- **Email Notifications**: Configurable email alerts for order status changes
- **Password Protection**: Secure authentication with JWT tokens
- **Chart Visualization**: Historical price charts for each symbol
- **Auto-reload**: CSV changes automatically reload orders (no restart needed)

## Quick Start

### 1. Install Dependencies

```bash
# Backend dependencies
pip install -r requirements.txt

# Frontend dependencies
cd ui && npm install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration (see Configuration section)
```

### 3. Setup CSV Files

```bash
cp data/gtt-live-stocks-etfs.csv.example data/gtt-live-stocks-etfs.csv
cp data/gtt-live-crypto.csv.example data/gtt-live-crypto.csv
# Edit CSV files with your orders
```

### 4. Setup Authentication

Generate a password hash:

```bash
python scripts/setup_auth.py
# Follow prompts to set your password
# Add generated hash to .env file
```

### 5. Start Application

```bash
pm2 start config/ecosystem.config.js
pm2 logs gtt-backend  # View backend logs
```

UI available at `http://localhost:3000` (configurable via `PORT_UI` in `.env`)

## Configuration

### Required Environment Variables

Create a `.env` file with the following:

```env
# Alpaca API (Required)
ALPACA_API_KEY=your_api_key
ALPACA_SECRET_KEY=your_secret_key
ALPACA_PAPER=true  # Set to false for live trading

# Authentication (Required)
APP_PASSWORD_HASH=your_bcrypt_hash  # Generate with scripts/setup_auth.py
JWT_SECRET_KEY=your_jwt_secret      # Generate with scripts/setup_auth.py

# Ports (Optional)
PORT_API=8080
PORT_UI=3000
```

### Optional Configuration

```env
# Email Notifications
EMAIL_NOTIFICATIONS_ENABLED=true
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password  # Gmail App Password, not regular password
EMAIL_TO=recipient@example.com  # Comma-separated for multiple recipients

# Polling (Fallback mode)
POLL_INTERVAL_SECONDS=60

# Discord Webhook (Optional)
DISCORD_WEBHOOK_URL=your_webhook_url
```

### Email Setup (Gmail Example)

1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account → Security → 2-Step Verification → App passwords
   - Create a new app password for "Mail"
   - Copy the 16-character password
3. Add to `.env`:
   ```env
   EMAIL_NOTIFICATIONS_ENABLED=true
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=your-email@gmail.com
   SMTP_PASSWORD=your-16-char-app-password
   EMAIL_TO=recipient@example.com
   ```

## CSV Format

Orders are defined in CSV files (`data/gtt-live-stocks-etfs.csv`, `data/gtt-live-crypto.csv`):

```csv
Company,Account,Amt 1,Price 1,Amt 2,Price 2,...,Amt 8,Price 8,Recurring Amount,Notes
iShares MSCI Taiwan ETF,EWT,1.0,$64.61,2,$58.15,3,$52.00,5,$46.00,8,$41.00,12,$36.00,18,$32.00,27,$28.00,100,
```

- `Company`: Display name (fetched from Alpaca if available)
- `Account`: Symbol (e.g., "EWT", "ETH")
- `Amt N` / `Price N`: Order amount and trigger price (up to 8 orders)
- Prices can include `$` and commas: `"$3,398.73"` or `64.61`

## How It Works

### Order Execution Flow

1. **Load Orders**: Reads CSV files and creates order ladders for each symbol
2. **Monitor Prices**: 
   - **WebSocket mode**: Real-time price updates (preferred)
   - **Polling mode**: Falls back if WebSocket fails (checks every 60s)
3. **Trigger Logic**:
   - First order: Waits for price ≤ trigger price
   - Subsequent orders: Auto-placed immediately after previous order fills
4. **Order Placement**: When trigger is met, places limit order via Alpaca API
5. **Fill Detection**: Checks order status every 5 seconds, advances to next order when filled

### Architecture

- **Backend** (`src/gtt_monitor.py`): Core order management and monitoring
- **API Server** (`src/api_server.py`): Flask REST API for frontend
- **Frontend** (`ui/`): Next.js web interface with real-time updates
- **Authentication**: Password-based JWT authentication with httpOnly cookies

### Key Components

**GTTOrderManager**:
- Manages order ladders per symbol
- Monitors prices via WebSocket/polling
- Places orders when triggers are met
- Tracks order fills and advances sequence

**API Endpoints**:
- `GET /api/orders` - All orders (GTT + active Alpaca orders)
- `GET /api/prices` - Current market prices
- `GET /api/account` - Account info (buying power, equity)
- `GET /api/chart/<symbol>` - Historical price data
- `POST /api/auth/login` - Login with password
- `POST /api/force-fill-order` - Manually fill any pending order

## Authentication

### Setup

1. Generate password hash:
   ```bash
   python scripts/setup_auth.py
   ```

2. Add to `.env`:
   ```env
   APP_PASSWORD_HASH=<generated_hash>
   JWT_SECRET_KEY=<generated_secret>
   ```

3. Restart backend:
   ```bash
   pm2 restart gtt-backend
   ```

### How It Works

- Password stored as bcrypt hash in `.env` (never plain text)
- Frontend login page at `/login`
- JWT tokens stored in httpOnly cookies (30-day expiration)
- All API endpoints protected except `/api/auth/login` and `/api/status`
- Frontend middleware redirects unauthenticated users to login

### Security Features

- Bcrypt password hashing
- HttpOnly cookies (prevents XSS)
- HTTPS-only cookies in production
- Token expiration (30 days, configurable)
- Session tracking (IP and user agent)

## Deployment

### Backend (Cloudflare Tunnel)

1. Install cloudflared:
   ```bash
   brew install cloudflare/cloudflare/cloudflared  # macOS
   ```

2. Login and create tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create your-app-backend
   cloudflared tunnel route dns your-app-backend api-your-domain.com
   ```

3. Create config (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: your-app-backend
   credentials-file: ~/.cloudflared/TUNNEL_ID.json
   
   ingress:
     - hostname: api-your-domain.com
       service: http://localhost:8080
     - service: http_status:404
   ```

4. Add to PM2 (update `config/ecosystem.config.js`):
   ```bash
   pm2 start config/ecosystem.config.js
   pm2 save
   ```

### Frontend (Cloudflare Pages)

1. Go to Cloudflare Dashboard → Workers & Pages → Pages → Create application
2. Connect your GitHub repository
3. Configure build:
   - Framework preset: `Next.js`
   - Build command: `cd ui && npm install && npm run build`
   - Root directory: Leave empty
4. Add environment variables:
   - `NEXT_PUBLIC_API_HOST`: `api-your-domain.com`
   - `NEXT_PUBLIC_API_PORT`: `443`
5. Deploy and add custom domain

### Auto-Deployment

Every `git push` to `main` automatically triggers a new Cloudflare Pages deployment.

## PM2 Commands

```bash
pm2 start config/ecosystem.config.js    # Start
pm2 logs gtt-backend                     # View backend logs
pm2 logs gtt-frontend                    # View frontend logs
pm2 status                              # Check status
pm2 restart gtt-backend                 # Restart backend
pm2 restart gtt-frontend                # Restart frontend
pm2 stop gtt-backend                    # Stop backend
pm2 save && pm2 startup                 # Auto-start on boot
```

## Project Structure

```
alpaca-trading/
├── src/                    # Core Python code
│   ├── gtt_monitor.py     # Main monitor: loads orders, watches prices, places orders
│   ├── api_server.py      # Flask API: exposes data to web UI
│   └── notifications.py   # Email notification manager
├── ui/                     # Next.js web interface
│   ├── app/
│   │   ├── page.tsx       # Main UI component
│   │   └── login/         # Login page
│   └── components/         # Reusable UI components
├── scripts/                # Utility scripts
│   ├── setup_auth.py      # Generate password hash
│   └── send_notifications.py  # Manual notification triggers
├── config/                 # Configuration
│   └── ecosystem.config.js # PM2 config
├── data/                   # CSV order files (gitignored)
│   ├── gtt-live-stocks-etfs.csv
│   └── gtt-live-crypto.csv
└── logs/                   # Application logs
```

## Features

### Real-time Updates
- WebSocket connection for live price updates
- Automatic fallback to polling if WebSocket fails
- Frontend updates every 5 seconds

### Order Management
- Sequential order execution (one at a time)
- Automatic fill detection and advancement
- Manual force-fill option for testing
- Re-instate cancelled/expired orders

### Charts
- Historical price charts (1D, 1W, 1M, 3M, 6M, 1Y, MAX)
- Lazy loading (only loads when accordion is expanded)
- Real-time updates for 1D timeframe

### Notifications
- Email notifications for all order status changes
- Daily and weekly summary emails
- Configurable SMTP settings

## Security Notes

- **Never commit `.env` file** to version control
- Use strong passwords for authentication
- Enable HTTPS in production
- Keep API keys secure
- Test in paper trading mode first!

## Troubleshooting

### Backend not starting
- Check logs: `pm2 logs gtt-backend`
- Verify dependencies: `pip install -r requirements.txt`
- Check `.env` file exists and has required variables

### Frontend can't connect to backend
- Verify `NEXT_PUBLIC_API_HOST` matches backend URL
- Check backend is running: `pm2 status`
- Verify CORS settings in `api_server.py`

### Authentication issues
- Ensure `APP_PASSWORD_HASH` is set in `.env`
- Restart backend after adding password hash
- Clear browser cookies if token is invalid

### Orders not executing
- Check market is open (orders only execute during market hours)
- Verify trigger prices are reasonable
- Check Alpaca account has sufficient buying power
- Review logs for error messages

## Notes

- Orders only lock buying power when actually placed (after trigger)
- CSV changes auto-reload (no restart needed)
- WebSocket preferred; falls back to polling automatically
- Test in paper trading mode first!
- Live CSV files are gitignored (use `.example` files as templates)

## License

See LICENSE file for details.
