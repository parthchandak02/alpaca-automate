"""
GTT-Style Sequential Conditional Order System for Alpaca

Emulates Zerodha/Eureka GTT orders with sequential execution:
- Monitors prices via WebSocket (real-time)
- Places orders sequentially: Amt 1 at Price 1, then Amt 2 at Price 2, etc.
- Only places next order after previous one is COMPLETED/FILLED
- Buying power locked only when order is placed (not when trigger is set)
"""

import os
import csv
import re
import time
import asyncio
import ssl
import logging
from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from dotenv import load_dotenv
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import LimitOrderRequest, GetOrdersRequest
from alpaca.trading.enums import OrderSide, TimeInForce, OrderStatus
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockLatestQuoteRequest
from alpaca.data.live import StockDataStream
from alpaca.common.exceptions import APIError
from rich.console import Console
from rich.logging import RichHandler
from rich.table import Table
from rich.panel import Panel
from rich import box

# Load environment variables
load_dotenv()

# Configure SSL certificates (best practice: use certifi if available)
# This must be done before any SSL connections are made
try:
    import certifi
    # Set SSL certificate file for Python's SSL module
    os.environ['SSL_CERT_FILE'] = certifi.where()
    os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()
except ImportError:
    # certifi not available - will use system certificates
    pass
except Exception:
    # Ignore errors during certifi setup
    pass

# Configure rich console and logging
console = Console()

# Set up logging with rich handler
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
log_dir = os.path.join(project_root, 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'gtt_orders.log')

logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    datefmt='[%X]',
    handlers=[
        RichHandler(console=console, rich_tracebacks=True, show_path=False),
        logging.FileHandler(log_file, encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# Log certifi status if available
try:
    import certifi
    logger.debug(f"SSL certificates configured from certifi: {certifi.where()}")
except ImportError:
    logger.debug("certifi not available - SSL will use system certificates")


@dataclass
class SequentialOrder:
    """Represents one order in a sequential ladder"""
    amount: float
    price: float
    order_id: Optional[str] = None
    status: str = "pending"  # pending, placed, filled, cancelled
    
    def should_trigger(self, current_price: float) -> bool:
        """Check if order should trigger based on current price"""
        # For buy orders: trigger when price drops to or below price
        return current_price <= self.price


@dataclass
class SymbolLadder:
    """Represents a sequential ladder of orders for one symbol"""
    symbol: str
    company: str
    orders: List[SequentialOrder] = field(default_factory=list)
    current_order_index: int = 0  # Which order in the sequence we're on
    
    def get_current_order(self) -> Optional[SequentialOrder]:
        """Get the current order we're waiting to trigger"""
        if self.current_order_index < len(self.orders):
            return self.orders[self.current_order_index]
        return None
    
    def advance_to_next_order(self):
        """Move to the next order in sequence"""
        if self.current_order_index < len(self.orders) - 1:
            self.current_order_index += 1
            logger.info(f"{self.symbol}: Advanced to order {self.current_order_index + 1}/{len(self.orders)}")
        else:
            logger.info(f"{self.symbol}: All orders completed!")


class CSVFileHandler(FileSystemEventHandler):
    """Watchdog handler for CSV file changes"""
    
    def __init__(self, manager: 'GTTOrderManager', data_dir: str):
        self.manager = manager
        self.data_dir = data_dir
        self.last_modified = {}
        super().__init__()
    
    def on_modified(self, event):
        """Called when a file is modified"""
        if event.is_directory:
            return
        
        # Only watch CSV files
        if not event.src_path.endswith('.csv'):
            return
        
        # Only watch our live CSV files
        filename = os.path.basename(event.src_path)
        if filename not in ['gtt-live-stocks-etfs.csv', 'gtt-live-crypto.csv']:
            return
        
        # Debounce: ignore if modified within last 2 seconds
        current_time = time.time()
        if event.src_path in self.last_modified:
            if current_time - self.last_modified[event.src_path] < 2:
                return
        
        self.last_modified[event.src_path] = current_time
        
        # Reload orders
        console.print(f"\n[bold yellow]📝 CSV file changed:[/bold yellow] {filename}")
        console.print("[cyan]Reloading orders...[/cyan]\n")
        logger.info(f"CSV file changed: {event.src_path}, reloading orders")
        
        try:
            self._reload_orders()
        except Exception as e:
            logger.error(f"Error reloading orders: {e}", exc_info=True)
            console.print(f"[bold red]Error reloading orders:[/bold red] {e}\n")
    
    def _reload_orders(self):
        """Reload orders from CSV files"""
        # Clear existing ladders (but preserve order statuses if possible)
        # We'll merge new orders with existing statuses
        existing_statuses = {}
        for symbol, ladder in self.manager.ladders.items():
            existing_statuses[symbol] = {
                'current_order_index': ladder.current_order_index,
                'order_statuses': {i: order.status for i, order in enumerate(ladder.orders) if order.order_id}
            }
        
        # Clear ladders
        self.manager.ladders.clear()
        
        # Reload from CSV files
        stocks_csv = os.path.join(self.data_dir, 'gtt-live-stocks-etfs.csv')
        crypto_csv = os.path.join(self.data_dir, 'gtt-live-crypto.csv')
        
        if stocks_csv and os.path.exists(stocks_csv):
            self.manager.load_orders_from_csv(stocks_csv)
        
        if crypto_csv and os.path.exists(crypto_csv):
            self.manager.load_orders_from_csv(crypto_csv)
        
        # Restore order statuses where possible (matching by symbol and order index)
        for symbol, status_data in existing_statuses.items():
            if symbol in self.manager.ladders:
                ladder = self.manager.ladders[symbol]
                # Restore current_order_index
                if status_data['current_order_index'] < len(ladder.orders):
                    ladder.current_order_index = status_data['current_order_index']
                
                # Restore order statuses
                for i, status in status_data['order_statuses'].items():
                    if i < len(ladder.orders):
                        ladder.orders[i].status = status
        
        # Sync with Alpaca to get latest order IDs
        self.manager.sync_with_alpaca_orders()
        
        total_symbols = len(self.manager.ladders)
        total_orders = sum(len(ladder.orders) for ladder in self.manager.ladders.values())
        console.print(f"[green]✓[/green] Reloaded: [cyan]{total_symbols}[/cyan] symbols, [cyan]{total_orders}[/cyan] orders\n")


class GTTOrderManager:
    """Manages GTT-style sequential conditional orders"""
    
    def __init__(self, api_key: str, secret_key: str, paper: bool = True):
        self.trading_client = TradingClient(api_key, secret_key, paper=paper)
        self.data_client = StockHistoricalDataClient(api_key, secret_key)
        self.stream = StockDataStream(api_key, secret_key)
        
        self.ladders: Dict[str, SymbolLadder] = {}  # symbol -> ladder
    
    def _parse_price(self, price_str: str) -> Optional[float]:
        """Parse price string, handling $ and commas"""
        if not price_str or price_str.strip() == '':
            return None
        # Remove $ and commas
        cleaned = price_str.replace('$', '').replace(',', '').strip()
        try:
            return float(cleaned)
        except ValueError:
            return None
    
    def load_orders_from_csv(self, csv_path: str):
        """Load sequential orders from CSV file with format: Company, Account, Amt 1, Price 1, ..."""
        logger.info(f"Loading orders from {csv_path}")
        
        # Try to update loading status if api_server is available
        try:
            from api_server import set_loading_status
            filename = os.path.basename(csv_path)
            set_loading_status(True, f"Loading {filename}", 0, 0, "", f"Reading CSV file: {filename}")
        except ImportError:
            pass
        
        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            rows = list(reader)  # Read all rows first to get count
            total_rows = len(rows)
            
            for row_idx, row in enumerate(rows):
                # Handle column names with spaces
                company = row.get('Company ', row.get('Company', '')).strip()
                symbol = row.get('Account ', row.get('Account', '')).strip()
                
                # Update loading status
                try:
                    from api_server import set_loading_status
                    progress = row_idx + 1
                    set_loading_status(True, f"Loading {os.path.basename(csv_path)}", progress, total_rows, symbol, f"Loading {symbol} ({company})... [{progress}/{total_rows}]")
                except ImportError:
                    pass
                
                if not symbol:
                    logger.warning(f"Skipping row with no Account/symbol: {company}")
                    continue
                
                # Parse all Amt/Price pairs (up to 8)
                # Handle column names with/without trailing spaces
                orders = []
                for i in range(1, 9):  # 1-8
                    amt_key = f'Amt {i}'
                    price_key = f'Price {i}'
                    
                    # Try with space, then without
                    amt_str = row.get(amt_key, row.get(amt_key.strip(), '')).strip()
                    price_str = row.get(price_key, row.get(price_key.strip(), '')).strip()
                    
                    if not amt_str or not price_str:
                        continue
                    
                    try:
                        amount = float(amt_str)
                        price = self._parse_price(price_str)
                        
                        if price is None:
                            logger.warning(f"{symbol}: Could not parse price '{price_str}' for order {i}")
                            continue
                        
                        orders.append(SequentialOrder(amount=amount, price=price))
                        logger.debug(f"{symbol}: Order {i} - Amount: {amount}, Price: ${price:.2f}")
                    except ValueError as e:
                        logger.warning(f"{symbol}: Error parsing order {i}: {e}")
                        continue
                
                if not orders:
                    logger.warning(f"{symbol}: No valid orders found, skipping")
                    continue
                
                # Create ladder for this symbol
                ladder = SymbolLadder(symbol=symbol, company=company, orders=orders)
                self.ladders[symbol] = ladder
                
                logger.info(f"Loaded {symbol} ({company}): {len(orders)} sequential orders")
        
        total_orders = sum(len(ladder.orders) for ladder in self.ladders.values())
        logger.info(f"Loaded {len(self.ladders)} symbols with {total_orders} total orders")
        
        # Clear loading status when done
        try:
            from api_server import clear_loading_status
            clear_loading_status()
        except ImportError:
            pass
    
    async def _handle_quote(self, quote):
        """Handle incoming quote data from WebSocket (async handler)"""
        try:
            symbol = quote.symbol
            # Use bid price, or ask price as fallback
            if hasattr(quote, 'bid_price') and quote.bid_price:
                price = float(quote.bid_price)
            elif hasattr(quote, 'ask_price') and quote.ask_price:
                price = float(quote.ask_price)
            elif hasattr(quote, 'bid') and quote.bid:
                price = float(quote.bid)
            elif hasattr(quote, 'ask') and quote.ask:
                price = float(quote.ask)
            else:
                return
            
            # Check if we have a ladder for this symbol
            if symbol not in self.ladders:
                return
            
            ladder = self.ladders[symbol]
            current_order = ladder.get_current_order()
            
            if not current_order:
                return  # All orders completed for this symbol
            
            # Only check trigger for the very first order in the sequence
            # After that, orders are auto-placed when previous order fills
            if current_order.status == "pending" and ladder.current_order_index == 0:
                # First order: wait for trigger condition
                if current_order.should_trigger(price):
                    logger.info(f"TRIGGER: {symbol} price ${price:.2f} <= trigger ${current_order.price:.2f}")
                    self._place_order(ladder, current_order, symbol)
            elif current_order.status == "pending" and ladder.current_order_index > 0:
                # Subsequent orders: should have been auto-placed, but if not, place them now
                # (This handles edge cases where auto-place might have failed)
                logger.info(f"AUTO-PLACE: {symbol} - Order {ladder.current_order_index + 1} "
                          f"(was pending, placing now)")
                self._place_order(ladder, current_order, symbol)
            
        except Exception as e:
            logger.error(f"Error handling quote: {e}")
    
    def sync_with_alpaca_orders(self):
        """Sync manager state with actual orders in Alpaca"""
        logger.info("Syncing manager state with Alpaca orders...")
        
        try:
            # Get all active orders from Alpaca
            orders_request = GetOrdersRequest(limit=100)
            alpaca_orders = self.trading_client.get_orders(orders_request)
            
            synced_count = 0
            for alpaca_order in alpaca_orders:
                symbol = alpaca_order.symbol
                
                # Check if we have a ladder for this symbol
                if symbol not in self.ladders:
                    continue
                
                ladder = self.ladders[symbol]
                current_order = ladder.get_current_order()
                
                if not current_order:
                    continue
                
                # Match by symbol and limit price
                if (alpaca_order.limit_price and 
                    abs(float(alpaca_order.limit_price) - current_order.price) < 0.01):
                    # Found a match!
                    if current_order.status == "pending" and not current_order.order_id:
                        current_order.order_id = alpaca_order.id
                        current_order.status = "placed"
                        synced_count += 1
                        logger.info(f"SYNCED: {symbol} Order {ladder.current_order_index + 1} - "
                                  f"Found order {alpaca_order.id} in Alpaca (Status: {alpaca_order.status.value})")
            
            if synced_count > 0:
                logger.info(f"Synced {synced_count} order(s) with Alpaca")
            else:
                logger.debug("No orders to sync")
                
        except Exception as e:
            logger.error(f"Error syncing with Alpaca orders: {e}", exc_info=True)
    
    def _check_order_status(self, order_id: str) -> Optional[str]:
        """Check status of an order"""
        try:
            order = self.trading_client.get_order_by_id(order_id)
            return order.status.value if order.status else None
        except Exception as e:
            logger.error(f"Error checking order status for {order_id}: {e}")
            return None
    
    def _place_order(self, ladder: SymbolLadder, order: SequentialOrder, symbol: str):
        """Place order when trigger condition is met"""
        if order.status != "pending":
            return  # Already placed
        
        try:
            # Check account buying power before placing order
            account = self.trading_client.get_account()
            buying_power = float(account.buying_power)
            order_value = order.price * order.amount
            
            if order_value > buying_power:
                logger.warning(f"Insufficient buying power for {symbol}. "
                             f"Required: ${order_value:.2f}, Available: ${buying_power:.2f}")
                return
            
            # Place limit order
            order_request = LimitOrderRequest(
                symbol=symbol,
                qty=order.amount,
                side=OrderSide.BUY,
                limit_price=order.price,
                time_in_force=TimeInForce.DAY
            )
            
            placed_order = self.trading_client.submit_order(order_data=order_request)
            order.order_id = placed_order.id
            order.status = "placed"
            
            logger.info(f"ORDER PLACED: {symbol} - Limit: ${order.price:.2f}, "
                       f"Qty: {order.amount}, Order ID: {placed_order.id}")
            
            console.print(f"[bold green]✓ ORDER PLACED[/bold green]: [cyan]{symbol}[/cyan] - "
                         f"Limit: [yellow]${order.price:.2f}[/yellow], "
                         f"Qty: [cyan]{order.amount}[/cyan], "
                         f"Order ID: [dim]{placed_order.id}[/dim]")
            
        except APIError as e:
            logger.error(f"Error placing order for {symbol}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error placing order for {symbol}: {e}")
    
    def _monitor_order_fills(self):
        """Monitor placed orders and check if they're filled"""
        for symbol, ladder in self.ladders.items():
            current_order = ladder.get_current_order()
            
            if not current_order:
                continue
            
            # Only check status for placed orders
            if current_order.status != "placed":
                continue
            
            if not current_order.order_id:
                continue
            
            # Check order status
            status = self._check_order_status(current_order.order_id)
            
            if status == "filled":
                if current_order.status != "filled":
                    current_order.status = "filled"
                    logger.info(f"ORDER FILLED: {symbol} - Order {ladder.current_order_index + 1} completed!")
                    
                    # Advance to next order
                    ladder.advance_to_next_order()
                    
                    # Immediately place the next order (don't wait for trigger)
                    next_order = ladder.get_current_order()
                    if next_order and next_order.status == "pending":
                        logger.info(f"AUTO-PLACE: {symbol} - Immediately placing Order {ladder.current_order_index + 1} "
                                  f"at limit price ${next_order.price:.2f}")
                        self._place_order(ladder, next_order, symbol)
            elif status == "cancelled" or status == "expired":
                # Reset order to pending so it can be retried
                logger.warning(f"ORDER {status.upper()}: {symbol} - Order {ladder.current_order_index + 1}. "
                             f"Will retry when trigger condition is met again.")
                current_order.status = "pending"
                current_order.order_id = None  # Clear order ID so we can place a new one
    
    def start_monitoring(self):
        """Start WebSocket monitoring for all symbols"""
        symbols = list(self.ladders.keys())
        
        if not symbols:
            logger.warning("No orders loaded. Nothing to monitor.")
            return
        
        logger.info(f"Starting WebSocket monitoring for {len(symbols)} symbols: {symbols}")
        
        # Test SSL connection first to avoid infinite retry loops
        # Best practice: Try to use certifi certificates if available
        try:
            import certifi
            import socket as socket_module
            # Use certifi certificates for SSL context
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            logger.debug(f"Using certifi certificates from: {certifi.where()}")
        except ImportError:
            # certifi not available, use default context
            logger.debug("certifi not available, using default SSL context")
            ssl_context = ssl.create_default_context()
        except Exception as e:
            logger.warning(f"Could not load certifi certificates: {e}. Using default SSL context.")
            ssl_context = ssl.create_default_context()
        
        # Test SSL connection before attempting WebSocket
        try:
            import socket as socket_module
            test_socket = socket_module.create_connection(('stream.data.alpaca.markets', 443), timeout=5)
            test_ssl_socket = ssl_context.wrap_socket(test_socket, server_hostname='stream.data.alpaca.markets')
            test_ssl_socket.close()
            test_socket.close()
            logger.info("SSL connection test successful - proceeding with WebSocket")
        except ssl.SSLError as e:
            logger.error(f"SSL Certificate error detected during test: {e}")
            logger.warning("This is a common macOS issue. Skipping WebSocket and using polling mode.")
            logger.info("=" * 60)
            logger.info("To fix SSL certificates on macOS:")
            logger.info("1. Run: /Applications/Python\\ 3.11/Install\\ Certificates.command")
            logger.info("2. Or install certifi: pip install --upgrade certifi")
            logger.info("3. Or set: export SSL_CERT_FILE=$(python -c 'import certifi; print(certifi.where())')")
            logger.info("=" * 60)
            self.check_triggers_polling()
            return
        except Exception as e:
            logger.warning(f"Could not test SSL connection: {e}. Will attempt WebSocket anyway.")
        
        # Subscribe to quotes for all symbols with async handler
        try:
            # Register the async handler for quotes
            self.stream.subscribe_quotes(self._handle_quote, *symbols)
            
            logger.info("WebSocket subscribed. Attempting to connect...")
            
            # Run WebSocket stream in a separate thread with asyncio
            import threading
            stream_running = threading.Event()
            websocket_failed = threading.Event()
            
            def run_stream():
                try:
                    stream_running.set()
                    # Run the async stream
                    asyncio.run(self.stream.run())
                except ssl.SSLError as e:
                    logger.error(f"SSL Certificate error: {e}")
                    logger.warning("This is a common macOS issue. Falling back to polling mode.")
                    websocket_failed.set()
                    stream_running.clear()
                except Exception as e:
                    logger.error(f"WebSocket error: {e}")
                    websocket_failed.set()
                    stream_running.clear()
            
            stream_thread = threading.Thread(target=run_stream, daemon=True)
            stream_thread.start()
            
            # Wait for stream to start or fail
            time.sleep(3)
            
            # Check if WebSocket failed immediately (SSL error)
            if websocket_failed.is_set():
                logger.warning("WebSocket connection failed. Using polling mode.")
                self.check_triggers_polling()
                return
            
            # Main monitoring loop: check order fills periodically
            max_iterations = 12  # Check for 1 minute max (12 * 5 seconds)
            iteration = 0
            while stream_running.is_set() and iteration < max_iterations:
                time.sleep(5)  # Check order fills every 5 seconds
                self._monitor_order_fills()
                iteration += 1
            
            # Check if WebSocket failed during monitoring
            if websocket_failed.is_set() or not stream_running.is_set():
                logger.warning("WebSocket stopped. Falling back to polling mode.")
                self.check_triggers_polling()
            else:
                # If we reach here, WebSocket is still running
                logger.info("WebSocket running successfully. Continuing monitoring...")
                while stream_running.is_set():
                    time.sleep(5)
                    self._monitor_order_fills()
                
        except KeyboardInterrupt:
            logger.info("Monitoring stopped by user")
        except Exception as e:
            logger.error(f"Error in WebSocket setup: {e}")
            logger.warning("Falling back to polling mode.")
            self.check_triggers_polling()
    
    def get_current_prices(self) -> Dict[str, float]:
        """Get current prices for all symbols (fallback if WebSocket fails)"""
        prices = {}
        symbols = list(self.ladders.keys())
        
        if not symbols:
            return prices
        
        try:
            request = StockLatestQuoteRequest(symbol_or_symbols=symbols)
            quotes = self.data_client.get_stock_latest_quote(request)
            
            for symbol, quote in quotes.items():
                # Use ask_price if available (more current), otherwise bid_price
                # For crypto, use mid price if available
                if quote.ask_price and quote.bid_price:
                    # Use mid price for better accuracy
                    mid_price = (float(quote.ask_price) + float(quote.bid_price)) / 2
                    prices[symbol] = mid_price
                elif quote.ask_price:
                    prices[symbol] = float(quote.ask_price)
                elif quote.bid_price:
                    prices[symbol] = float(quote.bid_price)
            
        except Exception as e:
            logger.error(f"Error fetching current prices: {e}")
        
        return prices
    
    def get_market_status(self) -> Dict[str, any]:
        """Get current market status (open/closed)"""
        try:
            clock = self.trading_client.get_clock()
            return {
                "is_open": clock.is_open,
                "next_open": clock.next_open.isoformat() if clock.next_open else None,
                "next_close": clock.next_close.isoformat() if clock.next_close else None,
            }
        except Exception as e:
            logger.error(f"Error fetching market status: {e}")
            return {
                "is_open": None,
                "next_open": None,
                "next_close": None,
            }
    
    def check_triggers_polling(self):
        """Fallback: Poll prices and check triggers (if WebSocket unavailable)"""
        # Configurable polling interval (default: 60 seconds to reduce API calls)
        poll_interval = int(os.getenv('POLL_INTERVAL_SECONDS', '60'))
        
        console.print(Panel(
            f"[bold yellow]Using polling mode (fallback)[/bold yellow]\n"
            f"Polling interval: [cyan]{poll_interval}[/cyan] seconds\n"
            f"This reduces API calls and prevents rate limiting.",
            title="GTT Monitor",
            border_style="yellow"
        ))
        
        iteration = 0
        while True:
            try:
                iteration += 1
                console.print(f"\n[dim]Polling iteration #{iteration} - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}[/dim]")
                
                # Get current prices
                prices = self.get_current_prices()
                
                if not prices:
                    logger.warning("No prices retrieved, skipping this iteration")
                    time.sleep(poll_interval)
                    continue
                
                # Check triggers for each symbol (only first order waits for trigger)
                triggered_count = 0
                for symbol, price in prices.items():
                    if symbol not in self.ladders:
                        continue
                    
                    ladder = self.ladders[symbol]
                    current_order = ladder.get_current_order()
                    
                    if not current_order:
                        continue
                    
                    # Only first order waits for trigger condition
                    # Subsequent orders are auto-placed when previous order fills
                    if current_order.status == "pending" and ladder.current_order_index == 0:
                        if current_order.should_trigger(price):
                            triggered_count += 1
                            console.print(f"[bold green]✓ TRIGGER[/bold green]: {symbol} price [cyan]${price:.2f}[/cyan] <= trigger [yellow]${current_order.price:.2f}[/yellow]")
                            self._place_order(ladder, current_order, symbol)
                    elif current_order.status == "pending" and ladder.current_order_index > 0:
                        # Subsequent orders: auto-place immediately (shouldn't happen often, but handles edge cases)
                        triggered_count += 1
                        console.print(f"[bold yellow]AUTO-PLACE[/bold yellow]: {symbol} - Order {ladder.current_order_index + 1} "
                                    f"at limit price [yellow]${current_order.price:.2f}[/yellow]")
                        self._place_order(ladder, current_order, symbol)
                
                if triggered_count == 0:
                    console.print(f"[dim]No triggers this iteration. Monitoring {len(prices)} symbols...[/dim]")
                
                # Monitor order fills (less frequently - every 3rd iteration)
                if iteration % 3 == 0:
                    self._monitor_order_fills()
                
                # Poll at configured interval
                time.sleep(poll_interval)
                
            except KeyboardInterrupt:
                console.print("\n[bold yellow]Polling stopped by user[/bold yellow]")
                break
            except Exception as e:
                logger.error(f"Error in polling loop: {e}", exc_info=True)
                time.sleep(min(poll_interval, 30))  # Wait shorter time on error


def main():
    """Main entry point"""
    # Get API keys from environment
    api_key = os.getenv('ALPACA_API_KEY')
    secret_key = os.getenv('ALPACA_SECRET_KEY')
    paper = os.getenv('ALPACA_PAPER', 'true').lower() == 'true'
    
    if not api_key or not secret_key:
        console.print("[bold red]ERROR:[/bold red] ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env file")
        return
    
    # Initialize GTT manager
    manager = GTTOrderManager(api_key, secret_key, paper=paper)
    
    # Start API server in a separate thread
    import threading
    from api_server import app, set_manager
    
    set_manager(manager)
    
    def run_api_server():
        api_port = int(os.getenv('PORT_API', '8080'))
        app.run(host='0.0.0.0', port=api_port, debug=False, use_reloader=False)
    
    api_thread = threading.Thread(target=run_api_server, daemon=True)
    api_thread.start()
    api_port = int(os.getenv('PORT_API', '8080'))
    console.print(f"[green]✓[/green] API server started on [cyan]http://localhost:{api_port}[/cyan]")
    
    # Load orders from CSV files in data/ directory
    # Use gtt-live-stocks-etfs.csv and gtt-live-crypto.csv
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_root, 'data')
    
    stocks_csv = os.path.join(data_dir, 'gtt-live-stocks-etfs.csv')
    crypto_csv = os.path.join(data_dir, 'gtt-live-crypto.csv')
    
    if stocks_csv and os.path.exists(stocks_csv):
        try:
            from api_server import set_loading_status
            set_loading_status(True, "Loading stocks/ETFs", 0, 0, "", f"Loading from {os.path.basename(stocks_csv)}...")
        except ImportError:
            pass
        manager.load_orders_from_csv(stocks_csv)
        console.print(f"[green]✓[/green] Loaded stocks/ETFs from [cyan]{os.path.basename(stocks_csv)}[/cyan]")
    elif stocks_csv:
        console.print(f"[yellow]⚠[/yellow] CSV file not found: {stocks_csv}")
    
    if crypto_csv and os.path.exists(crypto_csv):
        try:
            from api_server import set_loading_status
            set_loading_status(True, "Loading crypto", 0, 0, "", f"Loading from {os.path.basename(crypto_csv)}...")
        except ImportError:
            pass
        console.print(f"[cyan]ℹ[/cyan] Loading crypto orders from [cyan]{os.path.basename(crypto_csv)}[/cyan]")
        manager.load_orders_from_csv(crypto_csv)
        console.print(f"[green]✓[/green] Loaded crypto from [cyan]{os.path.basename(crypto_csv)}[/cyan]")
    elif crypto_csv:
        console.print(f"[yellow]⚠[/yellow] CSV file not found: {crypto_csv}")
    
    # Sync with existing Alpaca orders (in case orders were placed outside the monitor)
    try:
        from api_server import set_loading_status
        set_loading_status(True, "Syncing with Alpaca", 0, 0, "", "Syncing orders with Alpaca...")
    except ImportError:
        pass
    manager.sync_with_alpaca_orders()
    
    # Display summary
    total_symbols = len(manager.ladders)
    total_orders = sum(len(ladder.orders) for ladder in manager.ladders.values())
    
    summary_table = Table(title="GTT Sequential Order Monitor", box=box.ROUNDED)
    summary_table.add_column("Setting", style="cyan")
    summary_table.add_column("Value", style="green")
    
    summary_table.add_row("Mode", "PAPER" if paper else "LIVE")
    summary_table.add_row("Total Symbols", str(total_symbols))
    summary_table.add_row("Total Orders", str(total_orders))
    summary_table.add_row("Polling Interval", f"{os.getenv('POLL_INTERVAL_SECONDS', '60')} seconds")
    summary_table.add_row("API Port", str(api_port))
    
    console.print("\n")
    console.print(summary_table)
    console.print("\n")
    
    if total_symbols == 0:
        console.print("[bold red]ERROR:[/bold red] No orders loaded. Please check CSV files.")
        return
    
    # Start CSV file watcher (watchdog)
    csv_handler = CSVFileHandler(manager, data_dir)
    observer = Observer()
    observer.schedule(csv_handler, data_dir, recursive=False)
    observer.start()
    console.print(f"[green]✓[/green] CSV file watcher started on [cyan]{data_dir}[/cyan]")
    console.print(f"[cyan]ℹ[/cyan] Watching: [yellow]gtt-live-stocks-etfs.csv[/yellow] and [yellow]gtt-live-crypto.csv[/yellow]")
    logger.info(f"CSV file watcher started on {data_dir}")
    
    # Start monitoring
    try:
        # Try WebSocket first
        manager.start_monitoring()
    except Exception as e:
        logger.error(f"Error starting monitor: {e}", exc_info=True)
        console.print(f"[bold red]Error starting monitor:[/bold red] {e}")
        manager.check_triggers_polling()
    finally:
        # Stop observer on exit
        observer.stop()
        observer.join()


if __name__ == '__main__':
    main()
