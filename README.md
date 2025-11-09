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
│   └── api_server.py      # Flask API: exposes data to web UI
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
  - `/api/simulate-fill` - Force place current order (testing)

**`ui/app/page.tsx`**:
- Two tabs: "Orders" (Active/Completed/Cancelled) and "GTT" (conditional orders)
- Real-time updates every 5 seconds
- Shows current prices, order status, account summary

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
