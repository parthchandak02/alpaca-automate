# Alpaca Order Manager

A powerful, open-source trading automation tool for Alpaca that implements GTT-style sequential conditional orders. Automatically places limit orders in sequence when trigger prices are met, without locking buying power until each order is triggered.

## Features

- **Sequential Order Execution**: Automatically places orders in sequence when trigger prices are met
- **Real-time Price Monitoring**: WebSocket-based price updates with automatic polling fallback
- **Web Dashboard**: Modern Next.js UI for monitoring orders, prices, positions, and account status
- **Positions Tracking**: View all stock/ETF and crypto positions with real-time P/L
- **Email Notifications**: Configurable email alerts for order status changes
- **Password Protection**: Secure authentication with JWT tokens
- **Chart Visualization**: Historical price charts for each symbol with multiple timeframes
- **CSV Management**: Upload, preview, and download CSV templates via web interface
- **Auto-reload**: CSV changes automatically reload orders (no restart needed)
- **Database Persistence**: SQLite database for order tracking and history

## Prerequisites

- Python 3.9+ (recommended: Python 3.11+)
- Node.js 18+ and npm
- PM2 (for process management)
- Alpaca API account (paper or live)
- (Optional) Cloudflare account for deployment

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/alpaca-trading.git
cd alpaca-trading
```

### 2. Install Dependencies

```bash
# Backend dependencies
pip install -r requirements.txt

# Or using uv (recommended)
uv pip install -r requirements.txt

# Frontend dependencies
cd ui && npm install && cd ..
```

### 3. Configure Environment

Create a `.env` file in the project root:

```bash
cp .env.example .env  # If .env.example exists, or create manually
```

Required environment variables:

```env
# Alpaca API (Required)
ALPACA_API_KEY=your_api_key
ALPACA_SECRET_KEY=your_secret_key
ALPACA_PAPER=true  # Set to false for live trading

# Authentication (Required - generate with scripts/setup_auth.py)
APP_PASSWORD_HASH=your_bcrypt_hash
JWT_SECRET_KEY=your_jwt_secret

# Ports (Optional)
PORT_API=8080
PORT_UI=3000
```

### 4. Setup Authentication

Generate password hash and JWT secret:

```bash
python scripts/setup_auth.py
```

This will prompt you for a password and generate both `APP_PASSWORD_HASH` and `JWT_SECRET_KEY`. Add these to your `.env` file.

### 5. Setup CSV Files

Create your order CSV files manually or download templates from the UI:

**Option 1: Download from UI (Recommended)**
1. Start the application first (see step 6 below)
2. Navigate to the web UI
3. Click "Download Template" button in the Stock/ETF GTT or Crypto GTT tab
4. Save the template files as `data/gtt-live-stocks-etfs.csv` and `data/gtt-live-crypto.csv`

**Option 2: Create manually**
Create empty CSV files with headers:
- `data/gtt-live-stocks-etfs.csv`
- `data/gtt-live-crypto.csv`

See CSV Format section below for the required format.

### 6. Start Application

```bash
# Install PM2 globally if not already installed
npm install -g pm2

# Start all services (backend, frontend, tunnel)
pm2 start config/ecosystem.config.js

# View logs
pm2 logs gtt-backend
pm2 logs gtt-frontend

# Check status
pm2 status
```

The UI will be available at `http://localhost:3000` (configurable via `PORT_UI` in `.env`).

## Configuration

### Required Environment Variables

```env
# Alpaca API Credentials
ALPACA_API_KEY=your_api_key_here
ALPACA_SECRET_KEY=your_secret_key_here
ALPACA_PAPER=true  # true for paper trading, false for live

# Authentication (generate with scripts/setup_auth.py)
APP_PASSWORD_HASH=$2b$12$...
JWT_SECRET_KEY=your_random_secret_key

# Ports
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
SMTP_PASSWORD=your-app-password
EMAIL_TO=recipient@example.com

# Polling (fallback mode when WebSocket fails)
POLL_INTERVAL_SECONDS=60

# Discord Webhook (optional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# CSV Loading
USE_TEST_CSV=false  # Set to true to use test CSV files
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

Orders are defined in CSV files (`data/gtt-live-stocks-etfs.csv` for stocks/ETFs, `data/gtt-live-crypto.csv` for crypto):

```csv
Company,Symbol,Amt 1,Price 1,Amt 2,Price 2,Amt 3,Price 3,Amt 4,Price 4,Amt 5,Price 5,Amt 6,Price 6,Amt 7,Price 7,Amt 8,Price 8,Recurring Amount,Notes
iShares MSCI Taiwan ETF,EWT,1.0,$64.61,2,$58.15,3,$52.00,5,$46.00,8,$41.00,12,$36.00,18,$32.00,27,$28.00,100,
Bitcoin,BTC,0.1,$35000,0.2,$33000,0.3,$31000,,,,,,,,,,
```

**Column Descriptions:**
- `Company`: Display name (fetched from Alpaca if available, otherwise uses this value)
- `Symbol`: Stock/crypto symbol (e.g., "EWT", "BTC", "ETH")
- `Amt N` / `Price N`: Order amount and trigger price (up to 8 orders per symbol)
- `Recurring Amount`: (Optional) Not currently used
- `Notes`: (Optional) Additional notes

**Price Format:**
- Prices can include `$` and commas: `"$3,398.73"` or `64.61`
- Both formats are automatically parsed

**Example:**
- Order 1: Buy 1 share of EWT when price ≤ $64.61
- Order 2: Buy 2 shares of EWT when price ≤ $58.15 (placed automatically after Order 1 fills)
- And so on...

## How It Works

### Order Execution Flow

1. **Load Orders**: Reads CSV files and creates order ladders for each symbol
2. **Monitor Prices**: 
   - **WebSocket mode**: Real-time price updates (preferred, fastest)
   - **Polling mode**: Automatic fallback if WebSocket fails (checks every 60s)
3. **Trigger Logic**:
   - First order: Waits for price ≤ trigger price
   - Subsequent orders: Auto-placed immediately after previous order fills
4. **Order Placement**: When trigger is met, places limit order via Alpaca API
5. **Fill Detection**: Checks order status every 5 seconds, advances to next order when filled

### Architecture

- **Backend** (`src/gtt_monitor.py`): Core order management and monitoring logic
- **API Server** (`src/api_server.py`): Flask REST API for frontend communication
- **Frontend** (`ui/`): Next.js web interface with real-time updates
- **Database** (`src/database.py`): SQLite database for order persistence
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
- `GET /api/positions` - All positions (stocks and crypto)
- `GET /api/status` - Loading status and progress
- `GET /api/chart/<symbol>` - Historical price data
- `POST /api/auth/login` - Login with password
- `POST /api/auth/logout` - Logout and invalidate session
- `POST /api/auth/verify` - Verify authentication status
- `POST /api/force-fill-order` - Manually fill any pending order
- `POST /api/edit-gtt-order` - Edit GTT order price or amount
- `POST /api/reinstate-gtt-order` - Re-instate cancelled/expired orders
- `POST /api/upload-stocks-csv` - Upload new stocks CSV
- `POST /api/upload-crypto-csv` - Upload new crypto CSV
- `POST /api/preview-csv` - Preview CSV before uploading (validation)
- `GET /api/download-stocks-template` - Download stocks CSV template
- `GET /api/download-crypto-template` - Download crypto CSV template
- `POST /api/sync-filled-orders` - Manually sync filled orders from Alpaca

## Authentication

### Setup

1. Generate password hash and JWT secret:
   ```bash
   python scripts/setup_auth.py
   ```

2. Add generated values to `.env`:
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
- HttpOnly cookies (prevents XSS attacks)
- HTTPS-only cookies in production
- Token expiration (30 days, configurable)
- Session tracking (IP and user agent)

## Deployment

### Local Development

For local development, the application runs on:
- Backend: `http://localhost:8080`
- Frontend: `http://localhost:3000`

The frontend automatically detects `localhost` and connects to the local backend.

### Production Deployment

#### Backend (Cloudflare Tunnel)

1. Install cloudflared:
   ```bash
   brew install cloudflare/cloudflare/cloudflared  # macOS
   # or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
   ```

2. Login and create tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create alpaca-backend
   cloudflared tunnel route dns alpaca-backend api-your-domain.com
   ```

3. Create config (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: alpaca-backend
   credentials-file: ~/.cloudflared/TUNNEL_ID.json
   
   ingress:
     - hostname: api-your-domain.com
       service: http://localhost:8080
     - service: http_status:404
   ```

4. Start with PM2:
   ```bash
   pm2 start config/ecosystem.config.js
   pm2 save
   ```

#### Frontend (Cloudflare Pages)

1. Go to Cloudflare Dashboard → Workers & Pages → Pages → Create application
2. Connect your GitHub repository
3. Configure build:
   - Framework preset: `Next.js`
   - Build command: `cd ui && npm install && npm run build`
   - Root directory: Leave empty
   - Output directory: `ui/out`
4. Add environment variables:
   - `NEXT_PUBLIC_API_HOST`: `api-your-domain.com`
   - `NEXT_PUBLIC_API_PORT`: `443`
5. Deploy and add custom domain

**Note**: The frontend automatically detects production domains and connects to the API subdomain. Environment variables are optional but recommended.

### Auto-Deployment

Every `git push` to `main` automatically triggers a new Cloudflare Pages deployment.

### Verification

Use the included verification script to check your deployment:

```bash
./scripts/verify_setup.sh
```

This checks:
- Local backend accessibility
- Local frontend accessibility
- Cloudflare Tunnel backend accessibility
- Cloudflare Pages frontend accessibility
- PM2 process status
- Cloudflare Tunnel status

## Usage

### Starting the Application

```bash
# Start all services
pm2 start config/ecosystem.config.js

# View logs
pm2 logs gtt-backend
pm2 logs gtt-frontend
pm2 logs cloudflare-tunnel

# Check status
pm2 status
```

### Managing Orders

1. **Add Orders**: Edit CSV files (`data/gtt-live-stocks-etfs.csv` or `data/gtt-live-crypto.csv`)
2. **Upload via UI**: Use the "Upload Stocks CSV" or "Upload Crypto CSV" buttons in the web interface
3. **Edit Orders**: Click the edit icon next to any order in the GTT view
4. **Force Fill**: Click "Force Fill" button to manually execute a pending order
5. **Re-instate**: Re-activate cancelled or expired orders

### Monitoring

- **Web Dashboard**: Access at `http://localhost:3000` (or your production URL)
- **Logs**: View with `pm2 logs` or check `logs/` directory
- **Email Notifications**: Configure SMTP settings for email alerts

## PM2 Commands

```bash
pm2 start config/ecosystem.config.js    # Start all services
pm2 stop config/ecosystem.config.js      # Stop all services
pm2 restart config/ecosystem.config.js   # Restart all services

pm2 logs gtt-backend                      # View backend logs
pm2 logs gtt-frontend                    # View frontend logs
pm2 logs cloudflare-tunnel               # View tunnel logs

pm2 status                                # Check status
pm2 restart gtt-backend                   # Restart backend only
pm2 restart gtt-frontend                 # Restart frontend only

pm2 save && pm2 startup                   # Auto-start on boot
```

## Project Structure

```
alpaca-trading/
├── src/                          # Core Python code
│   ├── gtt_monitor.py           # Main monitor: loads orders, watches prices, places orders
│   ├── api_server.py            # Flask API: exposes data to web UI
│   ├── database.py              # SQLite database operations
│   └── notifications.py        # Email notification manager
├── ui/                           # Next.js web interface
│   ├── app/
│   │   ├── page.tsx             # Main orders UI component
│   │   ├── login/
│   │   │   └── page.tsx         # Login page
│   │   ├── positions/
│   │   │   └── page.tsx         # Positions page
│   │   └── layout.tsx           # Root layout
│   └── components/              # Reusable UI components
│       ├── data-table.tsx       # Order data table
│       └── stock-chart.tsx      # Price chart component
├── scripts/                      # Utility scripts
│   ├── setup_auth.py           # Generate password hash and JWT secret
│   ├── send_notifications.py   # Manual notification triggers
│   └── verify_setup.sh         # Deployment verification script
├── config/                       # Configuration
│   └── ecosystem.config.js      # PM2 configuration
├── data/                         # CSV order files (gitignored)
│   ├── gtt-stocks-template.csv   # Template for stocks/ETFs (downloadable from UI)
│   └── gtt-crypto-template.csv   # Template for crypto (downloadable from UI)
└── logs/                         # Application logs (gitignored)
```

## Features

### Real-time Updates
- WebSocket connection for live price updates
- Automatic fallback to polling if WebSocket fails
- Frontend updates every 5 seconds
- Price status indicators (live/stale/closed)

### Order Management
- Sequential order execution (one at a time)
- Automatic fill detection and advancement
- Manual force-fill option for testing
- Re-instate cancelled/expired orders
- Edit order prices and amounts via UI
- CSV upload via web interface with preview and validation

### Positions View
- View all stock/ETF and crypto positions
- Real-time P/L tracking (today and total)
- Market value and cost basis display
- Direct links to Alpaca trading interface
- Separate tabs for stocks/ETFs and crypto

### Charts
- Historical price charts (1D, 1W, 1M, 3M, 6M, 1Y, MAX)
- Lazy loading (only loads when accordion is expanded)
- Real-time updates for 1D timeframe
- Visual indicators for GTT order trigger prices
- Interactive price highlighting and navigation

### CSV Management
- Download CSV templates from UI
- CSV preview before upload with validation
- Symbol availability checking
- Error and warning reporting
- Support for both stocks/ETFs and crypto

### Notifications
- Email notifications for all order status changes
- Daily and weekly summary emails
- Configurable SMTP settings
- Discord webhook support (optional)

## Security Notes

- **Never commit `.env` file** to version control
- Use strong passwords for authentication
- Enable HTTPS in production
- Keep API keys secure
- Test in paper trading mode first!
- Review and understand the code before using with real money

## Troubleshooting

### Backend not starting
- Check logs: `pm2 logs gtt-backend`
- Verify dependencies: `pip install -r requirements.txt`
- Check `.env` file exists and has required variables
- Verify Python version: `python --version` (should be 3.9+)

### Frontend can't connect to backend
- Verify backend is running: `pm2 status`
- Check backend URL: `curl http://localhost:8080/api/status`
- For production: Verify `NEXT_PUBLIC_API_HOST` matches backend URL
- Check CORS settings in `api_server.py`

### Authentication issues
- Ensure `APP_PASSWORD_HASH` is set in `.env`
- Restart backend after adding password hash: `pm2 restart gtt-backend`
- Clear browser cookies if token is invalid
- Check JWT_SECRET_KEY is set

### Orders not executing
- Check market is open (orders only execute during market hours for stocks)
- Verify trigger prices are reasonable (below current price for buy orders)
- Check Alpaca account has sufficient buying power
- Review logs for error messages: `pm2 logs gtt-backend`
- Verify CSV format is correct

### WebSocket connection issues
- System automatically falls back to polling mode
- Check network connectivity
- Verify Alpaca API credentials are correct
- Review logs for WebSocket errors

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

See LICENSE file for details.

## Disclaimer

This software is provided "as is" without warranty of any kind. Trading involves risk. Always test thoroughly in paper trading mode before using with real money. The authors are not responsible for any financial losses incurred from using this software.

## Support

- **Issues**: Report bugs or request features via GitHub Issues
- **Documentation**: Check this README and inline code comments
- **Alpaca API**: Refer to [Alpaca API Documentation](https://alpaca.markets/docs/)

## Notes

- Orders only lock buying power when actually placed (after trigger)
- CSV changes auto-reload (no restart needed)
- WebSocket preferred; falls back to polling automatically
- Test in paper trading mode first!
- Live CSV files are gitignored (download templates from the UI)
- Database file (`data/gtt_orders.db`) is gitignored for privacy
