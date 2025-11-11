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
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from logging.handlers import RotatingFileHandler
from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from dotenv import load_dotenv
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import LimitOrderRequest, GetOrdersRequest, GetAssetsRequest
from alpaca.trading.enums import OrderSide, TimeInForce, OrderStatus, AssetClass
from alpaca.data.historical import StockHistoricalDataClient, CryptoHistoricalDataClient
from alpaca.data.requests import StockLatestQuoteRequest, CryptoLatestQuoteRequest
from alpaca.data.live import StockDataStream
from alpaca.common.exceptions import APIError
from rich.console import Console
from rich.logging import RichHandler
from rich.table import Table
from rich.panel import Panel
from rich import box
import requests
from .notifications import NotificationManager
from .database import GTTOrderDatabase

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

# Set up logging with rich handler and rotating file handler
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
log_dir = os.path.join(project_root, 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'gtt_orders.log')

# Use RotatingFileHandler to prevent log files from growing too large
# maxBytes: 2MB per file, backupCount: keep 2 rotated files (total ~6MB max) - minimal retention
file_handler = RotatingFileHandler(
    log_file,
    maxBytes=2 * 1024 * 1024,  # 2MB
    backupCount=2,  # Keep only 2 backup files (minimal)
    encoding='utf-8'
)

logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    datefmt='[%X]',
    handlers=[
        RichHandler(console=console, rich_tracebacks=True, show_path=False),
        file_handler
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
    is_available_on_alpaca: bool = True  # Whether this asset is available/tradable on Alpaca
    asset_type: str = 'stock'  # 'stock' or 'crypto'
    
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
        elif self.current_order_index == len(self.orders) - 1:
            # Only log completion once when we first reach the end
            self.current_order_index = len(self.orders)  # Mark as completed
            logger.info(f"{self.symbol}: All orders completed!")
        # If already completed (current_order_index >= len(orders)), do nothing


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
        
        # Create snapshots of CSV files before reloading
        stocks_csv = os.path.join(self.data_dir, 'gtt-live-stocks-etfs.csv')
        crypto_csv = os.path.join(self.data_dir, 'gtt-live-crypto.csv')
        
        old_snapshots = {}
        if stocks_csv and os.path.exists(stocks_csv):
            old_snapshots['gtt-live-stocks-etfs.csv'] = self.manager.notification_manager.get_csv_snapshot(stocks_csv)
        if crypto_csv and os.path.exists(crypto_csv):
            old_snapshots['gtt-live-crypto.csv'] = self.manager.notification_manager.get_csv_snapshot(crypto_csv)
        
        # Clear ladders
        self.manager.ladders.clear()
        
        # Reload from CSV files
        if stocks_csv and os.path.exists(stocks_csv):
            self.manager.load_orders_from_csv(stocks_csv, asset_type='stock')
        
        if crypto_csv and os.path.exists(crypto_csv):
            self.manager.load_orders_from_csv(crypto_csv, asset_type='crypto')
        
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
        
        # Detect CSV changes and send notifications
        if stocks_csv and os.path.exists(stocks_csv):
            new_snapshot = self.manager.notification_manager.get_csv_snapshot(stocks_csv)
            if 'gtt-live-stocks-etfs.csv' in old_snapshots:
                changes = self.manager.notification_manager.compare_csv_snapshots(
                    old_snapshots['gtt-live-stocks-etfs.csv'], 
                    new_snapshot
                )
                self.manager.notification_manager.send_csv_change_notification('gtt-live-stocks-etfs.csv', changes)
        
        if crypto_csv and os.path.exists(crypto_csv):
            new_snapshot = self.manager.notification_manager.get_csv_snapshot(crypto_csv)
            if 'gtt-live-crypto.csv' in old_snapshots:
                changes = self.manager.notification_manager.compare_csv_snapshots(
                    old_snapshots['gtt-live-crypto.csv'], 
                    new_snapshot
                )
                self.manager.notification_manager.send_csv_change_notification('gtt-live-crypto.csv', changes)
        
        total_symbols = len(self.manager.ladders)
        total_orders = sum(len(ladder.orders) for ladder in self.manager.ladders.values())
        console.print(f"[green]✓[/green] Reloaded: [cyan]{total_symbols}[/cyan] symbols, [cyan]{total_orders}[/cyan] orders\n")
        
        # Clear loading status after CSV reload completes
        try:
            from .api_server import clear_loading_status
            clear_loading_status()
        except ImportError:
            pass


class GTTOrderManager:
    """Manages GTT-style sequential conditional orders"""
    
    def __init__(self, api_key: str, secret_key: str, paper: bool = True, 
                 trading_base_url: Optional[str] = None, data_base_url: Optional[str] = None):
        """
        Initialize GTT Order Manager
        
        Args:
            api_key: Alpaca API key
            secret_key: Alpaca secret key
            paper: Whether to use paper trading (default: True)
            trading_base_url: Custom trading API base URL (optional)
            data_base_url: Custom data API base URL (optional)
        """
        # Determine trading API URL
        # Priority: 1) Custom trading_base_url param, 2) ALPACA_TRADING_API_URL env var, 3) Default based on paper mode
        if trading_base_url:
            trading_url = trading_base_url
        elif os.getenv('ALPACA_TRADING_API_URL'):
            trading_url = os.getenv('ALPACA_TRADING_API_URL')
        elif paper:
            trading_url = os.getenv('ALPACA_PAPER_API_URL', 'https://paper-api.alpaca.markets/v2')
        else:
            trading_url = os.getenv('ALPACA_LIVE_API_URL', 'https://api.alpaca.markets')
        
        # Determine data API URL
        # Priority: 1) Custom data_base_url param, 2) ALPACA_DATA_API_URL env var, 3) Default
        if data_base_url:
            data_url = data_base_url
        elif os.getenv('ALPACA_DATA_API_URL'):
            data_url = os.getenv('ALPACA_DATA_API_URL')
        else:
            data_url = 'https://data.alpaca.markets/v2'
        
        # Initialize clients
        # Note: Only TradingClient supports base_url parameter
        # StockHistoricalDataClient and StockDataStream use environment variables or default URLs
        trading_kwargs = {'api_key': api_key, 'secret_key': secret_key, 'paper': paper}
        if trading_base_url or os.getenv('ALPACA_TRADING_API_URL'):
            # Override SDK's automatic URL selection with custom URL (only for TradingClient)
            trading_kwargs['base_url'] = trading_url
        
        self.trading_client = TradingClient(**trading_kwargs)
        
        # Data clients don't support base_url parameter - they use environment variables
        # Set environment variables if custom URLs are provided
        if data_base_url or os.getenv('ALPACA_DATA_API_URL'):
            # Set environment variable for data clients to use
            os.environ['APCA_API_DATA_URL'] = data_url
        
        # Initialize data clients (they will use APCA_API_DATA_URL env var if set)
        self.data_client = StockHistoricalDataClient(api_key=api_key, secret_key=secret_key)
        self.crypto_data_client = CryptoHistoricalDataClient(api_key=api_key, secret_key=secret_key)
        self.stream = StockDataStream(api_key=api_key, secret_key=secret_key)
        
        # Initialize database
        self.db = GTTOrderDatabase()
        
        # Cache for ladders (loaded from database)
        self._ladders_cache: Dict[str, SymbolLadder] = {}
        self._ladders_cache_dirty = True  # Flag to indicate cache needs refresh
        
        # Cache for asset names from Alpaca (to avoid repeated API calls)
        self._asset_name_cache: Dict[str, str] = {}
        
        # Initialize notification manager
        self.notification_manager = NotificationManager(self)
        
        # Log which API URLs are being used
        logger.info(f"Initialized Alpaca clients - Paper: {paper}, Trading URL: {trading_url}, Data URL: {data_url}")
    
    @property
    def ladders(self) -> Dict[str, SymbolLadder]:
        """
        Get ladders from database (cached for performance)
        This property maintains backward compatibility with existing code
        """
        if self._ladders_cache_dirty or not self._ladders_cache:
            self._load_ladders_from_db()
            self._ladders_cache_dirty = False
        return self._ladders_cache
    
    def _load_ladders_from_db(self):
        """Load all ladders from database into cache"""
        self._ladders_cache = {}
        
        # Get all symbols
        symbols = self.db.get_all_symbols()
        
        for symbol in symbols:
            # Get orders for this symbol
            db_orders = self.db.get_gtt_orders_by_symbol(symbol)
            
            if not db_orders:
                continue
            
            # Convert database rows to SequentialOrder objects
            orders = []
            company = db_orders[0].company if db_orders else symbol
            is_available = db_orders[0].is_available_on_alpaca if db_orders else True
            asset_type = db_orders[0].asset_type if db_orders else 'stock'
            
            for db_order in db_orders:
                order = SequentialOrder(
                    amount=db_order.amount,
                    price=db_order.price,
                    order_id=db_order.order_id,
                    status=db_order.status
                )
                orders.append(order)
            
            # Get current_order_index from database
            current_order_index = self.db.get_current_order_index(symbol)
            
            # Create SymbolLadder
            ladder = SymbolLadder(
                symbol=symbol,
                company=company,
                orders=orders,
                current_order_index=current_order_index,
                is_available_on_alpaca=bool(is_available),
                asset_type=asset_type
            )
            
            self._ladders_cache[symbol] = ladder
    
    def _invalidate_ladders_cache(self):
        """Mark ladders cache as dirty so it will be reloaded on next access"""
        self._ladders_cache_dirty = True
    
    def _get_asset_name_from_alpaca(self, symbol: str) -> Optional[str]:
        """Fetch asset name/description from Alpaca API"""
        # Check cache first
        if symbol in self._asset_name_cache:
            return self._asset_name_cache[symbol]
        
        try:
            # Try to get asset by symbol
            asset = self.trading_client.get_asset(symbol)
            if asset and hasattr(asset, 'name') and asset.name:
                name = asset.name.strip()
                self._asset_name_cache[symbol] = name
                logger.debug(f"Fetched asset name from Alpaca: {symbol} -> {name}")
                return name
        except APIError as e:
            # Asset might not exist or API error - log but don't fail
            logger.debug(f"Could not fetch asset name from Alpaca for {symbol}: {e}")
        except Exception as e:
            # Any other error - log but don't fail
            logger.debug(f"Error fetching asset name from Alpaca for {symbol}: {e}")
        
    def _is_asset_available_on_alpaca(self, symbol: str, asset_type: str = 'stock') -> bool:
        """Check if asset is available/tradable on Alpaca"""
        # For crypto, try symbol/USD suffix first (Alpaca format: BTC/USD)
        # Also try the symbol as-is for stocks/ETFs
        if asset_type == 'crypto':
            symbols_to_try = [f"{symbol}/USD", symbol]  # Try crypto format first
        else:
            symbols_to_try = [symbol, f"{symbol}/USD"]  # Try stock format first
        
        for try_symbol in symbols_to_try:
            try:
                # Try to get asset by symbol
                asset = self.trading_client.get_asset(try_symbol)
                if asset:
                    # Check if asset is tradable
                    if hasattr(asset, 'tradable'):
                        if asset.tradable:
                            return True
                    # If tradable attribute doesn't exist, check status
                    elif hasattr(asset, 'status'):
                        if asset.status == 'active':
                            return True
                    # If we got the asset object, assume it's available
                    else:
                        return True
            except APIError as e:
                # Asset doesn't exist or API error - try next format
                logger.debug(f"Asset {try_symbol} not available on Alpaca: {e}")
                continue
            except Exception as e:
                # Any other error - try next format
                logger.debug(f"Error checking asset availability for {try_symbol}: {e}")
                continue
        
        # If neither format worked, asset is not available
        return False
    
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
    
    def load_orders_from_csv(self, csv_path: str, asset_type: str = 'stock'):
        """
        Load sequential orders from CSV file with format: Company, Account, Amt 1, Price 1, ...
        
        Args:
            csv_path: Path to CSV file
            asset_type: 'stock' or 'crypto' - determines how symbols are looked up
        
        Raises:
            ValueError: If a symbol is not supported/available on Alpaca
        """
        logger.info(f"Loading {asset_type} orders from {csv_path}")
        
        # Try to update loading status if api_server is available
        # Use force_show=True to show loading even after initial load (for CSV reloads)
        try:
            from .api_server import set_loading_status
            filename = os.path.basename(csv_path)
            set_loading_status(True, f"Loading {filename}", 0, 0, "", f"Reading CSV file: {filename}", clear_symbols=True, force_show=True)
        except ImportError:
            pass
        
        unsupported_symbols = []
        
        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            rows = list(reader)  # Read all rows first to get count
            total_rows = len(rows)
            
            for row_idx, row in enumerate(rows):
                # Handle column names with spaces
                csv_company = row.get('Company ', row.get('Company', '')).strip()
                symbol = row.get('Account ', row.get('Account', '')).strip()
                
                if not symbol:
                    logger.warning(f"Skipping row with no Account/symbol: {csv_company}")
                    continue
                
                # Validate symbol BEFORE processing
                if asset_type == 'crypto':
                    # For crypto, check if symbol is available on Alpaca
                    # Try both symbol and symbol/USD format
                    is_available = self._is_asset_available_on_alpaca(symbol, asset_type='crypto')
                    
                    if not is_available:
                        error_msg = f"Cryptocurrency '{symbol}' is not available or not tradable on Alpaca. Please verify the symbol is correct and that it's supported."
                        logger.error(error_msg)
                        unsupported_symbols.append((symbol, csv_company or symbol, error_msg))
                        continue
                    
                    company = csv_company or symbol
                    logger.debug(f"Crypto symbol {symbol}: Using CSV company name '{company}'")
                else:
                    # For stocks, check if symbol is available on Alpaca
                    is_available = self._is_asset_available_on_alpaca(symbol, asset_type='stock')
                    
                    if not is_available:
                        error_msg = f"Stock/ETF '{symbol}' is not available or not tradable on Alpaca. Please verify the symbol is correct."
                        logger.error(error_msg)
                        unsupported_symbols.append((symbol, csv_company or symbol, error_msg))
                        continue
                    
                    # For stocks, try Alpaca first
                    company = self._get_asset_name_from_alpaca(symbol) or csv_company or symbol
                
                # Double-check availability (already checked above, but ensure consistency)
                is_available = self._is_asset_available_on_alpaca(symbol, asset_type=asset_type)
                
                if not is_available:
                    if asset_type == 'crypto':
                        error_msg = f"Cryptocurrency '{symbol}' is not available for trading on Alpaca. Please verify the symbol is correct and that it's supported."
                    else:
                        error_msg = f"Stock/ETF '{symbol}' is not available or not tradable on Alpaca. Please verify the symbol is correct."
                    logger.error(error_msg)
                    unsupported_symbols.append((symbol, csv_company or symbol, error_msg))
                    continue
                
                # Update loading status
                try:
                    from .api_server import set_loading_status
                    progress = row_idx + 1
                    set_loading_status(True, f"Loading {os.path.basename(csv_path)}", progress, total_rows, symbol, f"Loading {symbol} ({company})... [{progress}/{total_rows}]", force_show=True)
                except ImportError:
                    pass
                
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
                
                # Preserve existing order statuses before deleting
                existing_orders = self.db.get_gtt_orders_by_symbol(symbol)
                existing_statuses = {}
                existing_order_ids = {}
                existing_current_index = self.db.get_current_order_index(symbol)
                
                for db_order in existing_orders:
                    if db_order.order_index < len(orders):
                        # Only preserve if order index matches and price matches (within 0.01)
                        if abs(db_order.price - orders[db_order.order_index].price) < 0.01:
                            existing_statuses[db_order.order_index] = db_order.status
                            existing_order_ids[db_order.order_index] = db_order.order_id
                
                # Delete existing orders for this symbol (CSV reload replaces all orders)
                self.db.delete_symbol_orders(symbol)
                
                # Import orders to database, preserving statuses where possible
                for idx, order in enumerate(orders):
                    # Use preserved status if available, otherwise use order's status
                    preserved_status = existing_statuses.get(idx, order.status)
                    preserved_order_id = existing_order_ids.get(idx, order.order_id)
                    
                    self.db.import_gtt_order(
                        symbol=symbol,
                        company=company,
                        order_index=idx,
                        amount=order.amount,
                        price=order.price,
                        is_available_on_alpaca=is_available,
                        status=preserved_status,
                        order_id=preserved_order_id,
                        asset_type=asset_type
                    )
                
                # Preserve current_order_index if it's still valid, otherwise reset to 0
                if existing_current_index < len(orders):
                    self.db.update_current_order_index(symbol, existing_current_index)
                else:
                    self.db.update_current_order_index(symbol, 0)
                
                logger.info(f"Loaded {symbol} ({company}): {len(orders)} sequential orders")
        
        # Raise error if any unsupported symbols were found
        if unsupported_symbols:
            error_details = []
            for symbol, company, error_msg in unsupported_symbols:
                error_details.append(f"  - {symbol} ({company}): {error_msg}")
            
            error_message = f"CSV contains unsupported symbols:\n" + "\n".join(error_details)
            logger.error(error_message)
            raise ValueError(error_message)
        
        # Invalidate cache so ladders reload from database
        self._invalidate_ladders_cache()
        
        # Load ladders to get count
        ladders = self.ladders
        total_orders = sum(len(ladder.orders) for ladder in ladders.values())
        logger.info(f"Loaded {len(ladders)} symbols with {total_orders} total orders")
        
        # Don't clear loading status here - let it persist until sync_with_alpaca_orders completes
        # This ensures frontend shows loading state during the entire initialization process
    
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
            # When first order triggers, cascade through subsequent orders if price is below their triggers
            if current_order.status == "pending" and ladder.current_order_index == 0:
                # First order: wait for trigger condition
                if current_order.should_trigger(price):
                    logger.info(f"TRIGGER: {symbol} price ${price:.2f} <= trigger ${current_order.price:.2f}")
                    # Use cascade trigger to place all eligible orders
                    self._place_order_with_cascade(ladder, symbol, price)
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
                
                # Match orders by symbol and limit price across all orders in the ladder
                for idx, order in enumerate(ladder.orders):
                    if (alpaca_order.limit_price and 
                        abs(float(alpaca_order.limit_price) - order.price) < 0.01):
                        # Found a match!
                        if order.status == "pending" and not order.order_id:
                            order.order_id = alpaca_order.id
                            # Use actual Alpaca status
                            alpaca_status = alpaca_order.status.value if hasattr(alpaca_order.status, 'value') else str(alpaca_order.status)
                            order.status = alpaca_status.lower() if alpaca_status else "placed"
                            
                            # Update database
                            self.db.update_order_status(symbol, idx, order.status, order.order_id)
                            
                            synced_count += 1
                            logger.info(f"SYNCED: {symbol} Order {idx + 1} - "
                                      f"Found order {alpaca_order.id} in Alpaca (Status: {alpaca_status})")
            
            # After syncing, update current_order_index to point to first unplaced order
            for symbol, ladder in self.ladders.items():
                self._update_current_order_index(ladder)
            
            # Invalidate cache after syncing
            self._invalidate_ladders_cache()
            
            if synced_count > 0:
                logger.info(f"Synced {synced_count} order(s) with Alpaca")
            else:
                logger.debug("No orders to sync")
                
        except Exception as e:
            logger.error(f"Error syncing with Alpaca orders: {e}", exc_info=True)
    
    def sync_filled_orders_from_alpaca(self):
        """
        One-time sync: Match all filled orders from Alpaca with GTT orders and update database.
        This fixes cases where orders were filled but the database wasn't updated.
        """
        logger.info("Starting one-time sync of filled orders from Alpaca...")
        
        try:
            from alpaca.trading.enums import QueryOrderStatus
            
            # Get ALL orders from Alpaca (including filled, cancelled, etc.)
            orders_request = GetOrdersRequest(status=QueryOrderStatus.ALL, limit=500)
            alpaca_orders = self.trading_client.get_orders(orders_request)
            
            # Create a mapping of order_id -> Alpaca order for quick lookup
            alpaca_orders_by_id = {}
            alpaca_orders_by_symbol = {}
            
            for alpaca_order in alpaca_orders:
                alpaca_orders_by_id[alpaca_order.id] = alpaca_order
                symbol = alpaca_order.symbol
                if symbol not in alpaca_orders_by_symbol:
                    alpaca_orders_by_symbol[symbol] = []
                alpaca_orders_by_symbol[symbol].append(alpaca_order)
            
            synced_count = 0
            updated_count = 0
            
            # For each symbol we're tracking, check all GTT orders
            for symbol, ladder in self.ladders.items():
                if symbol not in alpaca_orders_by_symbol:
                    continue
                
                symbol_alpaca_orders = alpaca_orders_by_symbol[symbol]
                
                # Check each GTT order
                for idx, gtt_order in enumerate(ladder.orders):
                    matched_alpaca_order = None
                    
                    # First try: Match by order_id if we have it
                    if gtt_order.order_id and gtt_order.order_id in alpaca_orders_by_id:
                        matched_alpaca_order = alpaca_orders_by_id[gtt_order.order_id]
                    else:
                        # Second try: Match by symbol + limit_price + quantity (fuzzy match)
                        for alpaca_order in symbol_alpaca_orders:
                            if (alpaca_order.limit_price and 
                                abs(float(alpaca_order.limit_price) - gtt_order.price) < 0.01 and
                                abs(float(alpaca_order.qty) - gtt_order.amount) < 0.01):
                                # Found a match by price and quantity
                                matched_alpaca_order = alpaca_order
                                break
                    
                    if matched_alpaca_order:
                        alpaca_status = matched_alpaca_order.status.value if hasattr(matched_alpaca_order.status, 'value') else str(matched_alpaca_order.status)
                        alpaca_status_lower = alpaca_status.lower()
                        
                        # Get filled_at timestamp if filled
                        filled_at = None
                        if alpaca_status_lower == "filled":
                            if hasattr(matched_alpaca_order, 'filled_at') and matched_alpaca_order.filled_at:
                                filled_at = matched_alpaca_order.filled_at.isoformat() if hasattr(matched_alpaca_order.filled_at, 'isoformat') else str(matched_alpaca_order.filled_at)
                        
                        # Update if status changed or order_id is missing
                        if (gtt_order.status.lower() != alpaca_status_lower or 
                            gtt_order.order_id != matched_alpaca_order.id):
                            
                            # Update ladder order
                            gtt_order.order_id = matched_alpaca_order.id
                            gtt_order.status = alpaca_status_lower
                            
                            # Update database
                            self.db.update_order_status(symbol, idx, alpaca_status_lower, matched_alpaca_order.id, filled_at)
                            
                            # Link completed order if filled
                            if alpaca_status_lower == "filled":
                                try:
                                    db_orders = self.db.get_gtt_orders_by_symbol(symbol)
                                    if idx < len(db_orders):
                                        gtt_order_id = db_orders[idx].id
                                        self.db.link_completed_order(
                                            gtt_order_id=gtt_order_id,
                                            alpaca_order_id=matched_alpaca_order.id,
                                            symbol=symbol,
                                            filled_at=filled_at
                                        )
                                except Exception as e:
                                    logger.debug(f"Could not link completed order: {e}")
                            
                            updated_count += 1
                            logger.info(f"SYNCED FILLED: {symbol} Order {idx + 1} - "
                                      f"Status: {gtt_order.status} → {alpaca_status_lower}, "
                                      f"Order ID: {matched_alpaca_order.id}")
                            
                            if gtt_order.status.lower() != alpaca_status_lower:
                                synced_count += 1
            
            # Update current_order_index for all symbols after syncing
            for symbol, ladder in self.ladders.items():
                self._update_current_order_index(ladder)
            
            # Invalidate cache after syncing
            self._invalidate_ladders_cache()
            
            logger.info(f"Sync complete: Updated {updated_count} order(s), "
                      f"{synced_count} status change(s) detected")
            
            return {
                "updated": updated_count,
                "status_changes": synced_count,
                "message": f"Synced {updated_count} order(s) from Alpaca"
            }
                
        except Exception as e:
            logger.error(f"Error syncing filled orders from Alpaca: {e}", exc_info=True)
            return {
                "error": str(e),
                "updated": 0,
                "status_changes": 0
            }
    
    def _update_current_order_index(self, ladder: SymbolLadder):
        """Update current_order_index to point to the first unplaced order"""
        # Start from the beginning and find the first order that is not placed/filled
        original_index = ladder.current_order_index
        
        # If already completed, don't do anything
        if ladder.current_order_index >= len(ladder.orders):
            return
        
        while ladder.current_order_index < len(ladder.orders):
            current = ladder.orders[ladder.current_order_index]
            # If current order is filled or already placed (has order_id), advance to next
            if current.status == "filled" or (current.order_id and current.status not in ["pending"]):
                # Only advance if we're not already at the end
                if ladder.current_order_index < len(ladder.orders) - 1:
                    ladder.advance_to_next_order()
                else:
                    # Last order is filled - mark as completed (advance_to_next_order will log it)
                    ladder.advance_to_next_order()
                    break
            else:
                # Found first unplaced order - this is now the current order
                break
        
        # Update database if index changed
        if ladder.current_order_index != original_index:
            self.db.update_current_order_index(ladder.symbol, ladder.current_order_index)
        
        if original_index != ladder.current_order_index and ladder.current_order_index < len(ladder.orders):
            logger.info(f"{ladder.symbol}: Updated current_order_index from {original_index} to {ladder.current_order_index} "
                      f"(Order {ladder.current_order_index + 1})")
    
    def _send_discord_notification(self, title: str, description: str, color: int = 0x0099ff, fields: List[Dict] = None, footer_text: str = None):
        """Send a Discord webhook notification with elegant formatting"""
        # Temporarily disabled - Discord notifications are off
        return
        
        webhook_url = os.getenv('DISCORD_WEBHOOK_URL')
        if not webhook_url:
            return  # Discord notifications disabled
        
        try:
            # Discord requires color as decimal integer
            # Hex colors like 0x00ff00 are already integers in Python, use directly
            color_decimal = color
            
            embed = {
                "title": title,
                "description": description,
                "color": color_decimal,
                "timestamp": datetime.utcnow().isoformat(),
                "fields": fields or [],
                "author": {
                    "name": "Alpaca Order Manager",
                    "icon_url": "https://alpaca.markets/images/meta/alpaca-logo.png"  # Alpaca logo
                },
                "footer": {
                    "text": footer_text or "Alpaca Trading Bot"
                }
            }
            
            payload = {
                "username": "Alpaca Order Manager",
                "embeds": [embed]
            }
            
            response = requests.post(webhook_url, json=payload, timeout=5)
            response.raise_for_status()
            logger.debug(f"Discord notification sent: {title}")
        except Exception as e:
            logger.warning(f"Failed to send Discord notification: {e}")
    
    def _render_email_template(self, title: str, description: str, fields: List[Dict] = None, footer_text: str = None) -> str:
        """Render HTML email template from file"""
        try:
            # Load template file (using module-level project_root)
            template_path = os.path.join(project_root, 'src', 'templates', 'email_template.html')
            with open(template_path, 'r', encoding='utf-8') as f:
                template = f.read()
            
            # Clean description (remove markdown formatting)
            clean_description = description.replace('**', '').replace('`', '')
            
            # Build fields table HTML
            fields_table = ""
            if fields:
                fields_table = '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 20px 0;">'
                for field in fields:
                    field_name = field.get('name', '').replace('💰', '').replace('📊', '').replace('🆔', '').replace('📈', '').replace('💵', '').strip()
                    field_value = field.get('value', '').replace('**', '').replace('`', '')
                    fields_table += f"""
                                <tr>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                            <tr>
                                                <td style="padding: 0; font-size: 14px; color: #666666; font-weight: 500; width: 140px;">
                                                    {field_name}:
                                                </td>
                                                <td style="padding: 0; font-size: 14px; color: #1a1a1a; font-weight: 400;">
                                                    {field_value}
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>"""
                fields_table += '</table>'
            
            # Build footer HTML
            footer_html = ""
            if footer_text:
                footer_html = f'<p style="margin: 25px 0 0 0; font-size: 13px; color: #999999; line-height: 1.5; border-top: 1px solid #f0f0f0; padding-top: 20px;">{footer_text}</p>'
            
            # Replace template variables
            html = template.replace('{{title}}', title)
            html = html.replace('{{description}}', clean_description)
            html = html.replace('{{fields_table}}', fields_table)
            html = html.replace('{{footer}}', footer_html)
            
            return html
        except FileNotFoundError:
            logger.warning(f"Email template not found at {template_path}, using fallback")
            # Fallback to simple HTML if template file not found
            return f"<html><body><h1>{title}</h1><p>{description}</p></body></html>"
        except Exception as e:
            logger.error(f"Error rendering email template: {e}")
            # Fallback to simple HTML on error
            return f"<html><body><h1>{title}</h1><p>{description}</p></body></html>"
    
    def _send_email_notification(self, title: str, description: str, fields: List[Dict] = None, footer_text: str = None):
        """Send an email notification when orders are placed or filled - professional HTML format"""
        email_enabled = os.getenv('EMAIL_NOTIFICATIONS_ENABLED', 'false').lower() == 'true'
        if not email_enabled:
            return  # Email notifications disabled
        
        smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
        smtp_port = int(os.getenv('SMTP_PORT', '587'))
        smtp_username = os.getenv('SMTP_USERNAME')
        smtp_password = os.getenv('SMTP_PASSWORD')  # For Gmail, use App Password
        email_to = os.getenv('EMAIL_TO')
        
        if not all([smtp_username, smtp_password, email_to]):
            missing = []
            if not smtp_username:
                missing.append("SMTP_USERNAME")
            if not smtp_password:
                missing.append("SMTP_PASSWORD")
            if not email_to:
                missing.append("EMAIL_TO")
            logger.warning(f"Email notification skipped: Missing email configuration ({', '.join(missing)})")
            return
        
        try:
            # Parse multiple recipients (comma-separated)
            recipients = [email.strip() for email in email_to.split(',') if email.strip()]
            if not recipients:
                logger.warning("No valid email recipients found")
                return
            
            # Build plain text version
            text_lines = [description, ""]
            if fields:
                for field in fields:
                    field_name = field.get('name', '')
                    field_value = field.get('value', '')
                    text_lines.append(f"{field_name}: {field_value}")
                text_lines.append("")
            if footer_text:
                text_lines.append(footer_text)
            text_body = "\n".join(text_lines)
            
            # Render HTML template
            html_body = self._render_email_template(title, description, fields, footer_text)
            
            # Create multipart message (HTML + plain text)
            msg = MIMEMultipart('alternative')
            msg['From'] = smtp_username
            msg['To'] = ', '.join(recipients)
            msg['Subject'] = f"Alpaca Trading: {title}"
            
            # Attach both plain text and HTML versions
            part1 = MIMEText(text_body, 'plain', 'utf-8')
            part2 = MIMEText(html_body, 'html', 'utf-8')
            msg.attach(part1)
            msg.attach(part2)
            
            # Send email to all recipients
            with smtplib.SMTP(smtp_server, smtp_port) as server:
                server.starttls()  # Enable TLS encryption
                server.login(smtp_username, smtp_password)
                server.send_message(msg, to_addrs=recipients)  # Send to all recipients
            
            logger.info(f"Email notification sent to {len(recipients)} recipient(s): {title}")
        except Exception as e:
            logger.error(f"Failed to send email notification: {e}", exc_info=True)
    
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
            # Find the order index in the ladder
            order_index = None
            for idx, o in enumerate(ladder.orders):
                if o is order:
                    order_index = idx
                    break
            
            if order_index is None:
                logger.error(f"Order not found in ladder for {symbol}")
                return
            
            order_num = order_index + 1
            total_orders = len(ladder.orders)
            
            # Check account buying power before placing order
            account = self.trading_client.get_account()
            buying_power = float(account.buying_power)
            order_value = order.price * order.amount
            
            if order_value > buying_power:
                logger.warning(f"Insufficient buying power for {symbol}. "
                             f"Required: ${order_value:.2f}, Available: ${buying_power:.2f}")
                
                # Send email notification for insufficient buying power
                self._send_email_notification(
                    title="⚠️ Insufficient Buying Power",
                    description=f"**{symbol}** - Order {order_num} could not be placed due to insufficient buying power.",
                    fields=[
                        {"name": "💰 Required", "value": f"${order_value:.2f}", "inline": True},
                        {"name": "💵 Available", "value": f"${buying_power:.2f}", "inline": True},
                        {"name": "📊 Shortfall", "value": f"${order_value - buying_power:.2f}", "inline": True},
                        {"name": "📈 Order Details", "value": f"Limit: ${order.price:.2f}, Qty: {order.amount} shares", "inline": False},
                    ],
                    footer_text=f"{ladder.company} • Order {order_num}/{total_orders} • Action Required"
                )
                
                # Send Discord notification
                self._send_discord_notification(
                    title="⚠️ Insufficient Buying Power",
                    description=f"**{symbol}** - Order {order_num} could not be placed",
                    color=0xff9900,  # Orange
                    fields=[
                        {"name": "💰 Required", "value": f"${order_value:.2f}", "inline": True},
                        {"name": "💵 Available", "value": f"${buying_power:.2f}", "inline": True},
                        {"name": "📊 Shortfall", "value": f"${order_value - buying_power:.2f}", "inline": True},
                    ],
                    footer_text=f"{ladder.company} • Order {order_num}/{total_orders}"
                )
                return
            
            # Place limit order
            order_request = LimitOrderRequest(
                symbol=symbol,
                qty=order.amount,
                side=OrderSide.BUY,
                limit_price=order.price,
                time_in_force=TimeInForce.GTC  # Good Till Cancelled - order stays active until filled or manually cancelled
            )
            
            placed_order = self.trading_client.submit_order(order_data=order_request)
            order.order_id = placed_order.id
            # Use actual Alpaca status (could be "new", "accepted", etc.)
            alpaca_status = placed_order.status.value if hasattr(placed_order.status, 'value') else str(placed_order.status)
            order.status = alpaca_status.lower() if alpaca_status else "placed"
            
            # Update database
            self.db.update_order_status(symbol, order_index, order.status, order.order_id)
            
            # Invalidate cache so changes are reflected
            self._invalidate_ladders_cache()
            
            logger.info(f"ORDER PLACED: {symbol} - Order {order_num} "
                       f"Limit: ${order.price:.2f}, "
                       f"Qty: {order.amount}, Order ID: {placed_order.id}")
            
            console.print(f"[bold green]✓ ORDER PLACED[/bold green]: {symbol} - Order {order_num} "
                         f"Limit: [cyan]${order.price:.2f}[/cyan], "
                         f"Qty: [yellow]{order.amount}[/yellow], "
                         f"Order ID: [dim]{placed_order.id}[/dim]")
            
            # Send Discord notification for order placed
            self._send_discord_notification(
                title="✅ Order Placed",
                description=f"**{symbol}** - Order {order_num} of {total_orders} has been placed",
                color=0x00ff00,  # Green (will be converted to decimal)
                fields=[
                    {"name": "💰 Limit Price", "value": f"${order.price:.2f}", "inline": True},
                    {"name": "📊 Quantity", "value": f"{order.amount} shares", "inline": True},
                    {"name": "🆔 Order ID", "value": f"`{placed_order.id[:8]}...`", "inline": False},
                    {"name": "📈 Status", "value": "**Placed** - Waiting for execution", "inline": False},
                ],
                footer_text=f"{ladder.company} • Order {order_num}/{total_orders}"
            )
            
            # Send email notification for order placed
            self._send_email_notification(
                title="✅ Order Placed",
                description=f"{symbol} - Order {order_num} of {total_orders} has been placed",
                fields=[
                    {"name": "Limit Price", "value": f"${order.price:.2f}"},
                    {"name": "Quantity", "value": f"{order.amount} shares"},
                    {"name": "Order ID", "value": placed_order.id[:8] + "..."},
                    {"name": "Status", "value": "Placed - Waiting for execution"},
                ],
                footer_text=f"{ladder.company} • Order {order_num}/{total_orders}"
            )
            
            # Record activity for daily/weekly summaries
            self.notification_manager.record_order_activity(
                symbol=symbol,
                company=ladder.company,
                order_num=order_num,
                action='placed',
                price=order.price,
                amount=order.amount,
                order_id=placed_order.id
            )
            
        except APIError as e:
            logger.error(f"Error placing order for {symbol}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error placing order for {symbol}: {e}")
    
    def _place_order_with_cascade(self, ladder: SymbolLadder, symbol: str, current_price: float):
        """
        Place orders with cascade trigger logic.
        When Order #1 triggers, check if price is below Order #2, #3, etc. and place all eligible orders.
        This maximizes execution speed when price drops below multiple trigger levels.
        """
        total_orders = len(ladder.orders)
        placed_count = 0
        
        # Start from current_order_index (should be 0 for first trigger)
        start_index = ladder.current_order_index
        
        # Place orders sequentially, checking each one
        for idx in range(start_index, total_orders):
            order = ladder.orders[idx]
            
            # Skip if order is already placed or filled
            if order.status != "pending":
                # If order is already placed/filled, advance index and continue
                if idx == ladder.current_order_index:
                    ladder.advance_to_next_order()
                continue
            
            # Check if this order should trigger
            # For Order #1: must meet trigger condition (already checked)
            # For Order #2+: if price is below trigger, place immediately
            if idx == start_index:
                # First order: already verified it should trigger, place it
                logger.info(f"CASCADE TRIGGER: {symbol} - Placing Order {idx + 1} at ${order.price:.2f} (price ${current_price:.2f} <= trigger)")
                self._place_order(ladder, order, symbol)
                placed_count += 1
                
                # Advance to next order for cascade check
                if idx < total_orders - 1:
                    ladder.advance_to_next_order()
            else:
                # Subsequent orders: check if price is below their trigger
                if order.should_trigger(current_price):
                    logger.info(f"CASCADE TRIGGER: {symbol} - Price ${current_price:.2f} <= Order {idx + 1} trigger ${order.price:.2f}, placing immediately")
                    self._place_order(ladder, order, symbol)
                    placed_count += 1
                    
                    # Advance to next order for cascade check
                    if idx < total_orders - 1:
                        ladder.advance_to_next_order()
                else:
                    # Price is not below this order's trigger, stop cascading
                    logger.debug(f"CASCADE STOP: {symbol} - Order {idx + 1} trigger ${order.price:.2f} not met (price ${current_price:.2f}), stopping cascade")
                    break
        
        if placed_count > 1:
            logger.info(f"CASCADE COMPLETE: {symbol} - Placed {placed_count} orders in cascade (price ${current_price:.2f} was below {placed_count} trigger levels)")
        elif placed_count == 1:
            logger.info(f"CASCADE COMPLETE: {symbol} - Placed 1 order (only Order #1 trigger was met)")
    
    def _notify_order_status_change(self, symbol: str, ladder: SymbolLadder, order: SequentialOrder, 
                                     old_status: str, new_status: str, order_num: int, total_orders: int):
        """Send notifications for any order status change"""
        status_messages = {
            "filled": {
                "title": "🎯 Order Filled",
                "description": f"{symbol} - Order {order_num} of {total_orders} has been **executed**",
                "color": 0xff9900,  # Orange
                "email_title": "🎯 Order Filled",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} has been executed"
            },
            "partially_filled": {
                "title": "📊 Order Partially Filled",
                "description": f"{symbol} - Order {order_num} of {total_orders} is **partially executed**",
                "color": 0xffaa00,  # Yellow-orange
                "email_title": "📊 Order Partially Filled",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} is partially executed"
            },
            "cancelled": {
                "title": "❌ Order Cancelled",
                "description": f"{symbol} - Order {order_num} of {total_orders} has been **cancelled**",
                "color": 0xff0000,  # Red
                "email_title": "❌ Order Cancelled",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} has been cancelled"
            },
            "expired": {
                "title": "⏰ Order Expired",
                "description": f"{symbol} - Order {order_num} of {total_orders} has **expired**",
                "color": 0xff6600,  # Orange-red
                "email_title": "⏰ Order Expired",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} has expired"
            },
            "rejected": {
                "title": "🚫 Order Rejected",
                "description": f"{symbol} - Order {order_num} of {total_orders} was **rejected**",
                "color": 0xcc0000,  # Dark red
                "email_title": "🚫 Order Rejected",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} was rejected"
            },
            "pending_cancel": {
                "title": "⏳ Order Pending Cancel",
                "description": f"{symbol} - Order {order_num} of {total_orders} is **pending cancellation**",
                "color": 0xffaa00,  # Yellow
                "email_title": "⏳ Order Pending Cancel",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} is pending cancellation"
            },
            "pending_replace": {
                "title": "🔄 Order Pending Replace",
                "description": f"{symbol} - Order {order_num} of {total_orders} is **pending replacement**",
                "color": 0x0099ff,  # Blue
                "email_title": "🔄 Order Pending Replace",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} is pending replacement"
            },
            "replaced": {
                "title": "🔄 Order Replaced",
                "description": f"{symbol} - Order {order_num} of {total_orders} has been **replaced**",
                "color": 0x0099ff,  # Blue
                "email_title": "🔄 Order Replaced",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} has been replaced"
            }
        }
        
        # Get notification details for this status
        msg_info = status_messages.get(new_status.lower())
        if not msg_info:
            # Generic status change notification
            msg_info = {
                "title": f"📝 Order Status Changed",
                "description": f"{symbol} - Order {order_num} of {total_orders} status changed: {old_status} → {new_status}",
                "color": 0x666666,  # Gray
                "email_title": f"📝 Order Status Changed",
                "email_desc": f"{symbol} - Order {order_num} of {total_orders} status changed: {old_status} → {new_status}"
            }
        
        # Common fields for all notifications
        fields = [
            {"name": "💰 Limit Price", "value": f"${order.price:.2f}", "inline": True},
            {"name": "📊 Quantity", "value": f"{order.amount} shares", "inline": True},
            {"name": "🆔 Order ID", "value": f"`{order.order_id[:8]}...`" if order.order_id else "N/A", "inline": False},
            {"name": "📈 Status", "value": f"**{old_status}** → **{new_status}**", "inline": False},
        ]
        
        # Add total value for filled/partially filled orders
        if new_status.lower() in ["filled", "partially_filled"]:
            fields.insert(2, {"name": "💵 Total Value", "value": f"${order.price * order.amount:.2f}", "inline": True})
        
        # Send Discord notification
        self._send_discord_notification(
            title=msg_info["title"],
            description=msg_info["description"],
            color=msg_info["color"],
            fields=fields,
            footer_text=f"{ladder.company} • Order {order_num}/{total_orders}"
        )
        
        # Send email notification
        email_fields = [
            {"name": "Limit Price", "value": f"${order.price:.2f}"},
            {"name": "Quantity", "value": f"{order.amount} shares"},
            {"name": "Order ID", "value": order.order_id[:8] + "..." if order.order_id else "N/A"},
            {"name": "Status Change", "value": f"{old_status} → {new_status}"},
        ]
        
        if new_status.lower() in ["filled", "partially_filled"]:
            email_fields.insert(2, {"name": "Total Value", "value": f"${order.price * order.amount:.2f}"})
        
        self._send_email_notification(
            title=msg_info["email_title"],
            description=msg_info["email_desc"],
            fields=email_fields,
            footer_text=f"{ladder.company} • Order {order_num}/{total_orders}"
        )
        
        # Record activity for daily/weekly summaries
        self.notification_manager.record_order_activity(
            symbol=symbol,
            company=ladder.company,
            order_num=order_num,
            action=new_status.lower(),
            price=order.price,
            amount=order.amount,
            order_id=order.order_id or "",
            details={'old_status': old_status, 'new_status': new_status}
        )
    
    def _monitor_order_fills(self):
        """Monitor all orders and notify on any status changes"""
        for symbol, ladder in self.ladders.items():
            # Check all orders in the ladder, not just current
            for idx, order in enumerate(ladder.orders):
                if not order.order_id:
                    continue
                
                # Get current status from Alpaca
                alpaca_status = self._check_order_status(order.order_id)
                if not alpaca_status:
                    continue
                
                # Normalize status (Alpaca uses different casing)
                alpaca_status = alpaca_status.lower()
                old_status = order.status.lower()
                
                # Skip if status hasn't changed
                if alpaca_status == old_status:
                    continue
                
                # Status has changed - update and notify
                order_num = idx + 1
                total_orders = len(ladder.orders)
                
                logger.info(f"ORDER STATUS CHANGE: {symbol} - Order {order_num}: {old_status} → {alpaca_status}")
                
                # Update order status
                order.status = alpaca_status
                
                # Update database
                filled_at = None
                if alpaca_status == "filled":
                    # Get filled_at timestamp from Alpaca order if available
                    try:
                        alpaca_order = self.trading_client.get_order_by_id(order.order_id)
                        if hasattr(alpaca_order, 'filled_at') and alpaca_order.filled_at:
                            filled_at = alpaca_order.filled_at.isoformat() if hasattr(alpaca_order.filled_at, 'isoformat') else str(alpaca_order.filled_at)
                    except Exception as e:
                        logger.debug(f"Could not get filled_at for order {order.order_id}: {e}")
                
                self.db.update_order_status(symbol, idx, alpaca_status, order.order_id, filled_at)
                
                # Link completed order if filled or cancelled
                if alpaca_status in ["filled", "cancelled", "expired", "rejected"]:
                    try:
                        # Get GTT order database ID
                        db_orders = self.db.get_gtt_orders_by_symbol(symbol)
                        if idx < len(db_orders):
                            gtt_order_id = db_orders[idx].id
                            canceled_at = None
                            if alpaca_status in ["cancelled", "expired", "rejected"]:
                                try:
                                    alpaca_order = self.trading_client.get_order_by_id(order.order_id)
                                    if hasattr(alpaca_order, 'canceled_at') and alpaca_order.canceled_at:
                                        canceled_at = alpaca_order.canceled_at.isoformat() if hasattr(alpaca_order.canceled_at, 'isoformat') else str(alpaca_order.canceled_at)
                                except Exception:
                                    pass
                            
                            self.db.link_completed_order(
                                gtt_order_id=gtt_order_id,
                                alpaca_order_id=order.order_id,
                                symbol=symbol,
                                filled_at=filled_at,
                                canceled_at=canceled_at
                            )
                    except Exception as e:
                        logger.debug(f"Could not link completed order {order.order_id}: {e}")
                
                # Invalidate cache so changes are reflected
                self._invalidate_ladders_cache()
                
                # Send notifications for status change
                self._notify_order_status_change(
                    symbol, ladder, order, old_status, alpaca_status, order_num, total_orders
                )
                
                # Handle specific status changes
                if alpaca_status == "filled":
                    # Advance to next order if this was the current order
                    if idx == ladder.current_order_index:
                        ladder.advance_to_next_order()
                        
                        # Immediately place the next order (don't wait for trigger)
                        next_order = ladder.get_current_order()
                        if next_order and next_order.status == "pending":
                            next_order_num = ladder.current_order_index + 1
                            logger.info(f"AUTO-PLACE: {symbol} - Immediately placing Order {next_order_num} "
                                      f"at limit price ${next_order.price:.2f}")
                            
                            # Send Discord notification for next order coming up
                            self._send_discord_notification(
                                title="⏭️ Next Order Queued",
                                description=f"**{symbol}** - Order {next_order_num} of {total_orders} will be placed immediately",
                                color=0x0099ff,  # Blue
                                fields=[
                                    {"name": "💰 Next Limit Price", "value": f"${next_order.price:.2f}", "inline": True},
                                    {"name": "📊 Next Quantity", "value": f"{next_order.amount} shares", "inline": True},
                                    {"name": "💵 Estimated Value", "value": f"${next_order.price * next_order.amount:.2f}", "inline": True},
                                    {"name": "⚡ Status", "value": "**Queued** - Will place automatically", "inline": False},
                                ],
                                footer_text=f"{ladder.company} • Order {next_order_num}/{total_orders} ready"
                            )
                            
                            # Send email notification for next order
                            self._send_email_notification(
                                title="⏭️ Next Order Queued",
                                description=f"{symbol} - Order {next_order_num} of {total_orders} will be placed immediately",
                                fields=[
                                    {"name": "Next Limit Price", "value": f"${next_order.price:.2f}"},
                                    {"name": "Next Quantity", "value": f"{next_order.amount} shares"},
                                    {"name": "Estimated Value", "value": f"${next_order.price * next_order.amount:.2f}"},
                                    {"name": "Status", "value": "Queued - Will place automatically"},
                                ],
                                footer_text=f"{ladder.company} • Order {next_order_num}/{total_orders} ready"
                            )
                            
                            self._place_order(ladder, next_order, symbol)
                
                elif alpaca_status in ["cancelled", "expired", "rejected"]:
                    # Log detailed information about why order expired/cancelled
                    if alpaca_status == "expired":
                        logger.warning(f"ORDER EXPIRED: {symbol} - Order {order_num} (ID: {order.order_id}) expired. "
                                     f"This typically happens when a DAY order wasn't filled by market close. "
                                     f"Limit price: ${order.price:.2f}, Amount: {order.amount}")
                    elif alpaca_status == "rejected":
                        logger.warning(f"ORDER REJECTED: {symbol} - Order {order_num} (ID: {order.order_id}) was rejected. "
                                     f"Limit price: ${order.price:.2f}, Amount: {order.amount}")
                    else:
                        logger.warning(f"ORDER CANCELLED: {symbol} - Order {order_num} (ID: {order.order_id}) was cancelled. "
                                     f"Limit price: ${order.price:.2f}, Amount: {order.amount}")
                    
                    # Reset order to pending so it can be retried (if it's the current order)
                    if idx == ladder.current_order_index:
                        logger.info(f"Resetting {symbol} - Order {order_num} to pending. "
                                  f"It will be re-placed when trigger condition is met again.")
                        order.status = "pending"
                        order.order_id = None  # Clear order ID so we can place a new one
                        
                        # Update database
                        self.db.update_order_status(symbol, idx, "pending", None)
                        self._invalidate_ladders_cache()
                    else:
                        # For non-current orders, log but don't auto-reset (user can manually re-instate)
                        logger.info(f"Order {order_num} for {symbol} expired/cancelled but is not the current order. "
                                  f"Use re-instate API to manually reset if needed.")
    
    def start_monitoring(self):
        """Start WebSocket monitoring for all symbols with smart batching to handle symbol limits"""
        all_symbols = list(self.ladders.keys())
        
        if not all_symbols:
            logger.warning("No orders loaded. Nothing to monitor.")
            return
        
        # Alpaca WebSocket limit: ~3500 symbols per connection
        # Use a conservative limit to avoid hitting the cap
        MAX_SYMBOLS_PER_CONNECTION = 3000
        
        # Prioritize symbols: those with pending orders (current_order_index == 0) first
        # Then symbols with placed orders, then others
        prioritized_symbols = []
        secondary_symbols = []
        
        for symbol in all_symbols:
            ladder = self.ladders[symbol]
            current_order = ladder.get_current_order()
            if current_order and current_order.status == "pending":
                prioritized_symbols.append(symbol)
            elif any(order.order_id for order in ladder.orders):
                secondary_symbols.append(symbol)
            else:
                secondary_symbols.append(symbol)
        
        # Combine prioritized and secondary, up to the limit
        symbols_to_stream = (prioritized_symbols + secondary_symbols)[:MAX_SYMBOLS_PER_CONNECTION]
        symbols_to_poll = all_symbols[MAX_SYMBOLS_PER_CONNECTION:]
        
        logger.info(f"Starting WebSocket monitoring for {len(symbols_to_stream)}/{len(all_symbols)} symbols")
        if symbols_to_poll:
            logger.info(f"Using polling mode for {len(symbols_to_poll)} additional symbols (exceeds WebSocket limit)")
            logger.debug(f"Polling symbols: {symbols_to_poll[:10]}{'...' if len(symbols_to_poll) > 10 else ''}")
        
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
        
        # Subscribe to quotes for symbols within limit with async handler
        websocket_success = False
        if symbols_to_stream:
            try:
                # Register the async handler for quotes
                self.stream.subscribe_quotes(self._handle_quote, *symbols_to_stream)
                logger.info(f"WebSocket subscribed to {len(symbols_to_stream)} symbols. Attempting to connect...")
                websocket_success = True
            except Exception as e:
                error_msg = str(e).lower()
                if '405' in error_msg or 'limit' in error_msg or 'exceeded' in error_msg:
                    logger.warning(f"Symbol limit exceeded (405) - too many symbols. Using polling mode for all symbols.")
                    logger.info(f"Alpaca WebSocket limit is ~3500 symbols. You have {len(all_symbols)} symbols.")
                    websocket_success = False
                else:
                    logger.error(f"Error subscribing to WebSocket: {e}")
                    websocket_success = False
            
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
                    error_msg = str(e).lower()
                    if '405' in error_msg or ('limit' in error_msg and 'exceeded' in error_msg):
                        logger.warning(f"Symbol limit exceeded (405) during WebSocket run: {e}")
                        logger.info("This can happen if:")
                        logger.info("  1. Too many symbols subscribed (>3500)")
                        logger.info("  2. Previous connection not properly closed")
                        logger.info("  3. Multiple connections from same API key")
                        logger.info("Falling back to polling mode for all symbols.")
                    elif '406' in error_msg or 'connection limit' in error_msg:
                        logger.warning(f"Connection limit exceeded (406): {e}")
                        logger.info("Only one WebSocket connection allowed per API key.")
                        logger.info("Falling back to polling mode.")
                    else:
                        logger.error(f"WebSocket error: {e}")
                        logger.info("Falling back to polling mode.")
                    websocket_failed.set()
                    stream_running.clear()
            
            if websocket_success:
                stream_thread = threading.Thread(target=run_stream, daemon=True)
                stream_thread.start()
                
                # Wait for stream to start or fail
                time.sleep(3)
                
                # Check if WebSocket failed immediately (SSL error or limit)
                if websocket_failed.is_set():
                    logger.warning("WebSocket connection failed. Using polling mode for all symbols.")
                    self.check_triggers_polling()
                    return
                
                # Main monitoring loop: check order fills periodically
                max_iterations = 12  # Check for 1 minute max (12 * 5 seconds)
                iteration = 0
                while stream_running.is_set() and iteration < max_iterations:
                    time.sleep(5)  # Check order fills every 5 seconds
                    self._monitor_order_fills()
                    # Also check triggers periodically in case WebSocket isn't receiving quotes
                    self._check_triggers_from_prices()
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
                        # Also check triggers periodically in case WebSocket isn't receiving quotes
                        self._check_triggers_from_prices()
            else:
                # WebSocket subscription failed - use polling for all symbols
                logger.info("WebSocket subscription failed. Using polling mode for all symbols.")
                self.check_triggers_polling()
                return
        
        # If we have symbols to poll (beyond WebSocket limit), start polling for them
        if symbols_to_poll:
            logger.info(f"Starting polling mode for {len(symbols_to_poll)} symbols beyond WebSocket limit")
            # Store symbols to poll separately - they'll be handled in check_triggers_polling
            # For now, they're already included in self.ladders, so polling will handle them
            # But we could optimize by only polling these specific symbols
    
    def get_current_prices(self) -> Dict[str, float]:
        """Get current prices for all symbols (fallback if WebSocket fails)"""
        prices = {}
        symbols = list(self.ladders.keys())
        
        if not symbols:
            return prices
        
        # Separate stocks and crypto symbols
        stock_symbols = []
        crypto_symbols = []
        crypto_symbol_map = {}  # Maps BTC/USD -> BTC for lookup
        
        for symbol in symbols:
            ladder = self.ladders.get(symbol)
            if ladder and ladder.asset_type == 'crypto':
                # Convert crypto symbol to Alpaca format (BTC -> BTC/USD)
                crypto_symbol = f"{symbol}/USD"
                crypto_symbols.append(crypto_symbol)
                crypto_symbol_map[crypto_symbol] = symbol
            else:
                stock_symbols.append(symbol)
        
        # Fetch stock prices
        if stock_symbols:
            try:
                request = StockLatestQuoteRequest(symbol_or_symbols=stock_symbols)
                quotes = self.data_client.get_stock_latest_quote(request)
                
                for symbol, quote in quotes.items():
                    # Use ask_price if available (more current), otherwise bid_price
                    if quote.ask_price and quote.bid_price:
                        # Use mid price for better accuracy
                        mid_price = (float(quote.ask_price) + float(quote.bid_price)) / 2
                        prices[symbol] = mid_price
                    elif quote.ask_price:
                        prices[symbol] = float(quote.ask_price)
                    elif quote.bid_price:
                        prices[symbol] = float(quote.bid_price)
            except Exception as e:
                logger.error(f"Error fetching stock prices: {e}")
        
        # Fetch crypto prices using CryptoHistoricalDataClient
        if crypto_symbols:
            try:
                # Use CryptoLatestQuoteRequest for crypto symbols
                request = CryptoLatestQuoteRequest(symbol_or_symbols=crypto_symbols)
                quotes = self.crypto_data_client.get_crypto_latest_quote(request)
                
                for crypto_symbol_alpaca, quote in quotes.items():
                    base_symbol = crypto_symbol_map.get(crypto_symbol_alpaca)
                    if base_symbol:
                        if quote.ask_price and quote.bid_price:
                            # Use mid price for better accuracy
                            mid_price = (float(quote.ask_price) + float(quote.bid_price)) / 2
                            prices[base_symbol] = mid_price
                        elif quote.ask_price:
                            prices[base_symbol] = float(quote.ask_price)
                        elif quote.bid_price:
                            prices[base_symbol] = float(quote.bid_price)
            except Exception as e:
                logger.error(f"Error fetching crypto prices: {e}")
                # Fallback: try individual symbol lookups
                for crypto_symbol_alpaca in crypto_symbols:
                    base_symbol = crypto_symbol_map[crypto_symbol_alpaca]
                    try:
                        request = CryptoLatestQuoteRequest(symbol_or_symbols=[crypto_symbol_alpaca])
                        quotes = self.crypto_data_client.get_crypto_latest_quote(request)
                        if crypto_symbol_alpaca in quotes:
                            quote = quotes[crypto_symbol_alpaca]
                            if quote.ask_price and quote.bid_price:
                                mid_price = (float(quote.ask_price) + float(quote.bid_price)) / 2
                                prices[base_symbol] = mid_price
                            elif quote.ask_price:
                                prices[base_symbol] = float(quote.ask_price)
                            elif quote.bid_price:
                                prices[base_symbol] = float(quote.bid_price)
                    except Exception as e:
                        logger.debug(f"Could not get price for {crypto_symbol_alpaca}: {e}")
        
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
    
    def _check_triggers_from_prices(self):
        """Check triggers using current prices (fallback when WebSocket isn't receiving quotes)"""
        try:
            prices = self.get_current_prices()
            if not prices:
                return
            
            triggered_count = 0
            for symbol, price in prices.items():
                if symbol not in self.ladders:
                    continue
                
                ladder = self.ladders[symbol]
                current_order = ladder.get_current_order()
                
                if not current_order:
                    continue
                
                # Only first order waits for trigger condition
                # When first order triggers, cascade through subsequent orders if price is below their triggers
                if current_order.status == "pending" and ladder.current_order_index == 0:
                    if current_order.should_trigger(price):
                        triggered_count += 1
                        logger.info(f"TRIGGER (fallback): {symbol} price ${price:.2f} <= trigger ${current_order.price:.2f}")
                        # Use cascade trigger to place all eligible orders
                        self._place_order_with_cascade(ladder, symbol, price)
                elif current_order.status == "pending" and ladder.current_order_index > 0:
                    # Subsequent orders: auto-place immediately
                    triggered_count += 1
                    logger.info(f"AUTO-PLACE (fallback): {symbol} - Order {ladder.current_order_index + 1}")
                    self._place_order(ladder, current_order, symbol)
            
            if triggered_count > 0:
                logger.debug(f"Checked triggers: {triggered_count} orders triggered")
        except Exception as e:
            logger.error(f"Error checking triggers from prices: {e}", exc_info=True)
    
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
                    # When first order triggers, cascade through subsequent orders if price is below their triggers
                    if current_order.status == "pending" and ladder.current_order_index == 0:
                        if current_order.should_trigger(price):
                            triggered_count += 1
                            console.print(f"[bold green]✓ TRIGGER[/bold green]: {symbol} price [cyan]${price:.2f}[/cyan] <= trigger [yellow]${current_order.price:.2f}[/yellow]")
                            # Use cascade trigger to place all eligible orders
                            self._place_order_with_cascade(ladder, symbol, price)
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
    
    # Get API URLs from environment (with defaults)
    trading_base_url = os.getenv('ALPACA_TRADING_API_URL')
    data_base_url = os.getenv('ALPACA_DATA_API_URL')
    
    if not api_key or not secret_key:
        console.print("[bold red]ERROR:[/bold red] ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env file")
        return
    
    # Initialize GTT manager with custom URLs if provided
    manager = GTTOrderManager(
        api_key=api_key, 
        secret_key=secret_key, 
        paper=paper,
        trading_base_url=trading_base_url,
        data_base_url=data_base_url
    )
    
    # Start API server in a separate thread
    import threading
    from .api_server import app, set_manager
    
    set_manager(manager)
    
    # Set trading mode explicitly in api_server
    try:
        from . import api_server
        api_server.trading_mode = paper
    except ImportError:
        pass
    
    def run_api_server():
        # Railway provides PORT, but we prefer PORT_API for consistency
        # Fallback to PORT if PORT_API not set (for Railway compatibility)
        api_port = int(os.getenv('PORT_API') or os.getenv('PORT', '8080'))
        app.run(host='0.0.0.0', port=api_port, debug=False, use_reloader=False)
    
    api_thread = threading.Thread(target=run_api_server, daemon=True)
    api_thread.start()
    api_port = int(os.getenv('PORT_API', '8080'))
    console.print(f"[green]✓[/green] API server started on [cyan]http://localhost:{api_port}[/cyan]")
    
    # Load orders from CSV files in data/ directory (only if database is empty)
    # Use gtt-live-stocks-etfs.csv and gtt-live-crypto.csv
    # If database already has orders, skip CSV loading for faster startup
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(project_root, 'data')
    
    # Check if database already has orders
    db_has_orders = manager.db.has_orders()
    
    if db_has_orders:
        console.print(f"[cyan]ℹ[/cyan] Database already has orders. Skipping CSV loading for faster startup.")
        console.print(f"[cyan]ℹ[/cyan] To reload from CSV, use the upload feature in the UI or modify CSV files (auto-reload enabled).")
    else:
        # Database is empty - load from CSV files (first-time setup)
        stocks_csv = os.path.join(data_dir, 'gtt-live-stocks-etfs.csv')
        crypto_csv = os.path.join(data_dir, 'gtt-live-crypto.csv')
        
        if stocks_csv and os.path.exists(stocks_csv):
            try:
                from .api_server import set_loading_status
                set_loading_status(True, "Loading stocks/ETFs", 0, 0, "", f"Loading from {os.path.basename(stocks_csv)}...", clear_symbols=True, force_show=True)
            except ImportError:
                pass
            manager.load_orders_from_csv(stocks_csv, asset_type='stock')
            console.print(f"[green]✓[/green] Loaded stocks/ETFs from [cyan]{os.path.basename(stocks_csv)}[/cyan]")
        elif stocks_csv:
            console.print(f"[yellow]⚠[/yellow] CSV file not found: {stocks_csv}")
        
        if crypto_csv and os.path.exists(crypto_csv):
            try:
                from .api_server import set_loading_status
                set_loading_status(True, "Loading crypto", 0, 0, "", f"Loading from {os.path.basename(crypto_csv)}...", clear_symbols=True, force_show=True)
            except ImportError:
                pass
            console.print(f"[cyan]ℹ[/cyan] Loading crypto orders from [cyan]{os.path.basename(crypto_csv)}[/cyan]")
            manager.load_orders_from_csv(crypto_csv, asset_type='crypto')
            console.print(f"[green]✓[/green] Loaded crypto from [cyan]{os.path.basename(crypto_csv)}[/cyan]")
        elif crypto_csv:
            console.print(f"[yellow]⚠[/yellow] CSV file not found: {crypto_csv}")
    
    # Sync with existing Alpaca orders (in case orders were placed outside the monitor)
    try:
        from .api_server import set_loading_status, clear_loading_status
        set_loading_status(True, "Syncing with Alpaca", 0, 0, "", "Syncing orders with Alpaca...")
    except ImportError:
        pass
    manager.sync_with_alpaca_orders()
    
    # Clear loading status after all initialization is complete
    try:
        from .api_server import clear_loading_status
        clear_loading_status()
    except ImportError:
        pass
    
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
    
    # Set up scheduled jobs for daily and weekly summaries
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        import pytz
        
        scheduler = BackgroundScheduler(timezone=pytz.timezone('America/New_York'))
        
        # Daily summary at 4:00 PM EST (end of trading day)
        # misfire_grace_time: If job is missed, allow it to run up to 1 hour late
        scheduler.add_job(
            manager.notification_manager.send_daily_summary,
            trigger=CronTrigger(hour=16, minute=0, timezone=pytz.timezone('America/New_York')),
            id='daily_summary',
            name='Daily Trading Summary',
            replace_existing=True,
            misfire_grace_time=3600  # 1 hour grace period for missed jobs
        )
        
        # Weekly summary on Friday at 4:00 PM EST (end of trading week)
        scheduler.add_job(
            manager.notification_manager.send_weekly_summary,
            trigger=CronTrigger(day_of_week='fri', hour=16, minute=0, timezone=pytz.timezone('America/New_York')),
            id='weekly_summary',
            name='Weekly Trading Summary',
            replace_existing=True,
            misfire_grace_time=3600  # 1 hour grace period for missed jobs
        )
        
        scheduler.start()
        logger.info("Scheduled jobs started: Daily summary (4:00 PM EST), Weekly summary (Friday 4:00 PM EST)")
        console.print("[green]✓[/green] Scheduled notifications: Daily (4:00 PM EST), Weekly (Friday 4:00 PM EST)")
    except Exception as e:
        logger.warning(f"Failed to start scheduled jobs: {e}")
        console.print(f"[yellow]⚠[/yellow] Scheduled jobs not started: {e}")
    
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
