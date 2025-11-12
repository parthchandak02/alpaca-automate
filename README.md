# Alpaca Order Manager

A powerful, open-source trading automation tool for Alpaca that implements GTT-style sequential conditional orders. Automatically places limit orders in sequence when trigger prices are met, without locking buying power until each order is triggered.

## ✨ Key Features

### 🎯 GTT Order Management
- **Sequential Order Execution**: Automatically places orders in sequence when trigger prices are met
- **Auto/Manual Modes**: Individual and global mode controls for fine-grained order management
  - **Global Mode**: Set all stocks or crypto to Auto or Manual mode
  - **Individual Mode**: Override global settings per order
  - Individual modes take precedence over global settings
- **Order Linking**: Bidirectional linking between GTT orders and executed Alpaca orders
  - Link GTT orders to executed orders
  - Link executed orders back to GTT orders
  - Links persist even when orders are cancelled
- **Manual Order Creation**: Create GTT orders directly from the UI
  - Symbol autocomplete with Alpaca asset data
  - Auto-fill company/description from symbol
  - Live price updates (every 5 seconds)
  - Automatic price-based reordering (high to low)

### 📊 Real-time Monitoring
- **WebSocket Price Updates**: Real-time price monitoring with automatic polling fallback
- **Web Dashboard**: Modern Next.js UI for monitoring orders, prices, positions, and account status
- **Price Charts**: Historical price charts with multiple timeframes (1D, 1W, 1M, 3M, 6M, 1Y, MAX)
  - Interactive price highlighting (hover on Y-axis labels)
  - Visual indicators for GTT order trigger prices
  - Lazy loading for performance

### 💼 Portfolio Management
- **Positions Tracking**: View all stock/ETF and crypto positions with real-time P/L
- **Account Overview**: Real-time buying power, equity, and account status
- **Order History**: Track all GTT and executed orders with status updates

### 🔔 Notifications
- **Email Alerts**: Configurable email notifications for order status changes
- **Daily/Weekly Summaries**: Automated summary emails
- **Discord Webhooks**: Optional Discord notifications

### 🔐 Security
- **Password Protection**: Secure authentication with JWT tokens
- **Bcrypt Hashing**: Passwords stored securely
- **HttpOnly Cookies**: Prevents XSS attacks
- **Environment Variables**: All secrets stored securely

### 📁 CSV Management
- **Upload & Preview**: Upload CSV files via web interface with validation
- **Template Download**: Download CSV templates from UI
- **Auto-reload**: CSV changes automatically reload orders (no restart needed)
- **Symbol Validation**: Automatic symbol availability checking

## 🚀 Quick Start

### Prerequisites

- Python 3.9+ (recommended: Python 3.11+)
- Node.js 18+ and npm
- PM2 (for process management)
- Alpaca API account ([Get one here](https://alpaca.markets/))

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/alpaca-trading.git
   cd alpaca-trading
   ```

2. **Install dependencies**
   ```bash
   # Backend dependencies
   pip install -r requirements.txt
   # Or using uv (recommended)
   uv pip install -r requirements.txt
   
   # Frontend dependencies
   cd ui && npm install && cd ..
   ```

3. **Configure environment**
   
   Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```
   
   Required variables:
   ```env
   # Alpaca API (Required)
   ALPACA_API_KEY=your_api_key
   ALPACA_SECRET_KEY=your_secret_key
   ALPACA_PAPER=true  # Set to false for live trading
   
   # Authentication (Required)
   APP_PASSWORD_HASH=your_bcrypt_hash  # Generate with scripts/setup_auth.py
   JWT_SECRET_KEY=your_jwt_secret
   ```

4. **Setup authentication**
   ```bash
   python scripts/setup_auth.py
   ```
   This generates `APP_PASSWORD_HASH` and `JWT_SECRET_KEY`. Add them to your `.env` file.

5. **Start the application**
   ```bash
   # Install PM2 globally if needed
   npm install -g pm2
   
   # Start all services
   pm2 start config/ecosystem.config.js
   
   # View logs
   pm2 logs
   ```

6. **Access the UI**
   
   Open `http://localhost:3000` in your browser and log in with your password.

## 📖 Usage Guide

### Creating GTT Orders

#### Method 1: CSV Upload (Bulk)
1. Click "Download Template" in the Stocks/ETF GTT or Crypto GTT tab
2. Fill in your orders (see CSV Format below)
3. Click "Upload Stocks CSV" or "Upload Crypto CSV"
4. Preview and confirm

#### Method 2: Manual Creation (Individual)
1. Click "Add GTT Order" in the Stocks/ETF GTT or Crypto GTT tab
2. Enter symbol (autocomplete available)
3. Company/description auto-fills from symbol
4. Enter amount and price (or click refresh for live price)
5. Submit - order is automatically sorted by price

### Managing Order Modes

#### Global Mode
- Use the Auto/Manual toggle switch in the action button row
- Separate controls for stocks and crypto
- Affects all orders unless overridden individually

#### Individual Mode
- Click the mode badge in the "Mode" column
- Toggles between Auto and Manual
- Individual settings override global mode

**Mode Behavior:**
- **Auto Mode**: Orders are placed automatically when trigger price is met
- **Manual Mode**: Orders must be placed manually (use "Force Fill" button)

### Linking Orders

#### Link GTT Order to Executed Order
1. Find the GTT order in the GTT table
2. Click "Link" button (shown when order_id is null)
3. Select the executed order from the modal
4. Orders are now linked

#### Link Executed Order to GTT Order
1. Find the executed order in the Orders table
2. Click "Link to GTT" button
3. Select the GTT order from the modal
4. Orders are now linked

**Note**: Links persist even if orders are cancelled.

### Editing Orders

- **Edit Price/Amount**: Click the edit icon next to any order
- **Force Fill**: Click "Force Fill" to manually execute a pending order
- **Re-instate**: Re-activate cancelled or expired orders

## 📋 CSV Format

Orders are defined in CSV files:
- `data/gtt-live-stocks-etfs.csv` for stocks/ETFs
- `data/gtt-live-crypto.csv` for crypto

**Format:**
```csv
Company,Symbol,Amt 1,Price 1,Amt 2,Price 2,Amt 3,Price 3,Amt 4,Price 4,Amt 5,Price 5,Amt 6,Price 6,Amt 7,Price 7,Amt 8,Price 8,Recurring Amount,Notes
iShares MSCI Taiwan ETF,EWT,1.0,$64.61,2,$58.15,3,$52.00,5,$46.00,8,$41.00,12,$36.00,18,$32.00,27,$28.00,100,
Bitcoin,BTC,0.1,$35000,0.2,$33000,0.3,$31000,,,,,,,,,,
```

**Column Descriptions:**
- `Company`: Display name (auto-fetched from Alpaca if available)
- `Symbol`: Stock/crypto symbol (e.g., "EWT", "BTC", "ETH")
- `Amt N` / `Price N`: Order amount and trigger price (up to 8 orders per symbol)
- `Recurring Amount`: (Optional) Not currently used
- `Notes`: (Optional) Additional notes

**Price Format:**
- Prices can include `$` and commas: `"$3,398.73"` or `64.61`
- Both formats are automatically parsed

**Example Flow:**
- Order 1: Buy 1 share of EWT when price ≤ $64.61
- Order 2: Buy 2 shares of EWT when price ≤ $58.15 (placed automatically after Order 1 fills)
- Order 3: Buy 3 shares of EWT when price ≤ $52.00 (placed automatically after Order 2 fills)
- And so on...

## 🔧 Configuration

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

# Discord Webhook (optional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Polling (fallback mode when WebSocket fails)
POLL_INTERVAL_SECONDS=60
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

## 🏗️ Architecture

### Components

- **Backend** (`src/gtt_monitor.py`): Core order management and monitoring logic
- **API Server** (`src/api_server.py`): Flask REST API for frontend communication
- **Frontend** (`ui/`): Next.js web interface with real-time updates
- **Database** (`src/database.py`): SQLite database for order persistence
- **Authentication**: Password-based JWT authentication with httpOnly cookies

### Order Execution Flow

1. **Load Orders**: Reads CSV files and creates order ladders for each symbol
2. **Monitor Prices**: 
   - **WebSocket mode**: Real-time price updates (preferred, fastest)
   - **Polling mode**: Automatic fallback if WebSocket fails (checks every 60s)
3. **Trigger Logic**:
   - First order: Waits for price ≤ trigger price (respects mode settings)
   - Subsequent orders: Auto-placed immediately after previous order fills (if in Auto mode)
4. **Order Placement**: When trigger is met, places limit order via Alpaca API
5. **Fill Detection**: Checks order status every 5 seconds, advances to next order when filled

### Mode Logic

- **Global Mode**: Applies to all orders of a specific asset type (stocks or crypto)
- **Individual Mode**: Overrides global mode for specific orders
- **Effective Mode**: Individual mode takes precedence over global mode
- **Auto Mode**: Orders placed automatically when trigger conditions are met
- **Manual Mode**: Orders require manual placement (via "Force Fill" button)

## 📡 API Endpoints

### Authentication
- `POST /api/auth/login` - Login with password
- `POST /api/auth/logout` - Logout and invalidate session
- `POST /api/auth/verify` - Verify authentication status

### Orders & Data
- `GET /api/orders` - All orders (GTT + active Alpaca orders)
- `GET /api/prices` - Current market prices
- `GET /api/account` - Account info (buying power, equity)
- `GET /api/positions` - All positions (stocks and crypto)
- `GET /api/status` - Loading status and progress
- `GET /api/chart/<symbol>` - Historical price data

### GTT Order Management
- `POST /api/toggle-global-mode` - Toggle global Auto/Manual mode (stocks or crypto)
- `POST /api/toggle-gtt-mode` - Toggle individual GTT order mode
- `POST /api/create-gtt-order` - Create manual GTT order
- `POST /api/edit-gtt-order` - Edit GTT order price or amount
- `POST /api/reinstate-gtt-order` - Re-instate cancelled/expired orders
- `POST /api/force-fill-order` - Manually fill any pending order

### Order Linking
- `POST /api/link-gtt-to-order` - Link GTT order to executed Alpaca order
- `POST /api/link-order-to-gtt` - Link executed order to GTT order
- `GET /api/available-orders-for-linking` - Get orders available for linking

### Asset Information
- `GET /api/available-symbols` - Get available symbols (filtered by asset type)
- `GET /api/asset-info/<symbol>` - Get asset name/company info

### CSV Management
- `POST /api/upload-stocks-csv` - Upload new stocks CSV
- `POST /api/upload-crypto-csv` - Upload new crypto CSV
- `POST /api/preview-csv` - Preview CSV before uploading (validation)
- `GET /api/download-stocks-template` - Download stocks CSV template
- `GET /api/download-crypto-template` - Download crypto CSV template
- `POST /api/sync-filled-orders` - Manually sync filled orders from Alpaca

## 🚢 Deployment

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

**Note**: The frontend automatically detects production domains and connects to the API subdomain.

### Verification

Use the included verification script:
```bash
./scripts/verify_setup.sh
```

## 🛠️ PM2 Commands

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

## 📁 Project Structure

```
alpaca-trading/
├── src/                          # Core Python code
│   ├── gtt_monitor.py           # Main monitor: loads orders, watches prices, places orders
│   ├── api_server.py            # Flask API: exposes data to web UI
│   ├── database.py              # SQLite database operations
│   ├── notifications.py         # Email notification manager
│   └── templates/
│       └── email_template.html  # Email template
├── ui/                           # Next.js web interface
│   ├── app/
│   │   ├── page.tsx             # Main orders UI component
│   │   ├── login/
│   │   │   └── page.tsx         # Login page
│   │   ├── positions/
│   │   │   └── page.tsx         # Positions page
│   │   └── layout.tsx           # Root layout
│   ├── components/              # Reusable UI components
│   │   ├── data-table.tsx       # Order data table
│   │   ├── stock-chart.tsx      # Price chart component
│   │   ├── linking-modal.tsx    # Order linking modal
│   │   ├── manual-gtt-form.tsx  # Manual GTT order form
│   │   └── ui/                  # Shadcn UI components
│   └── lib/
│       ├── gtt-api.ts           # API helper functions
│       └── utils.ts             # Utility functions
├── scripts/                      # Utility scripts
│   ├── setup_auth.py           # Generate password hash and JWT secret
│   ├── send_notifications.py   # Manual notification triggers
│   ├── clear_gtt_database.py   # Clear all GTT orders
│   └── verify_setup.sh         # Deployment verification script
├── config/                       # Configuration
│   └── ecosystem.config.js      # PM2 configuration
├── data/                         # CSV order files (gitignored)
│   ├── gtt-stocks-template.csv   # Template for stocks/ETFs
│   └── gtt-crypto-template.csv   # Template for crypto
└── logs/                         # Application logs (gitignored)
```

## 🔍 Troubleshooting

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
- Verify order mode (Auto vs Manual)
- Review logs for error messages: `pm2 logs gtt-backend`
- Verify CSV format is correct

### WebSocket connection issues
- System automatically falls back to polling mode
- Check network connectivity
- Verify Alpaca API credentials are correct
- Review logs for WebSocket errors

## 🔐 Security Notes

- **Never commit `.env` file** to version control
- Use strong passwords for authentication
- Enable HTTPS in production
- Keep API keys secure
- Test in paper trading mode first!
- Review and understand the code before using with real money
- All credentials stored in environment variables (never hardcoded)
- Password hashing with bcrypt
- JWT tokens in httpOnly cookies

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

See LICENSE file for details.

## ⚠️ Disclaimer

This software is provided "as is" without warranty of any kind. Trading involves risk. Always test thoroughly in paper trading mode before using with real money. The authors are not responsible for any financial losses incurred from using this software.

## 📝 Changelog

### Latest Updates

**GTT Order Management Enhancements:**
- Added individual and global Auto/Manual modes for GTT orders
- Implemented bidirectional order linking (GTT ↔ Executed orders)
- Added manual GTT order creation with symbol autocomplete
- Added live price updates and auto-fill company info
- Implemented price-based automatic reordering
- Removed all emojis for professional appearance
- Added Shadcn Switch component for mode toggles
- Improved chart hover interaction (only on price labels)
- Added 8 new API endpoints for GTT management
- Updated database schema with mode and linking support

## 📞 Support

- **Issues**: Report bugs or request features via GitHub Issues
- **Documentation**: Check this README and inline code comments
- **Alpaca API**: Refer to [Alpaca API Documentation](https://alpaca.markets/docs/)

## 📝 Notes

- Orders only lock buying power when actually placed (after trigger)
- CSV changes auto-reload (no restart needed)
- WebSocket preferred; falls back to polling automatically
- Test in paper trading mode first!
- Live CSV files are gitignored (download templates from the UI)
- Database file (`data/gtt_orders.db`) is gitignored for privacy
- Individual order modes take precedence over global mode settings
- Order links persist even when orders are cancelled
- Manual orders automatically reorder by price (high to low)
