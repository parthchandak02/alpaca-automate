"""
Database module for GTT Order Management

Handles SQLite database operations for storing GTT orders and linking completed orders.
"""

import os
import sqlite3
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class GTTOrderRow:
    """Represents a GTT order row from database"""
    id: int
    symbol: str
    company: str
    order_index: int
    amount: float
    price: float
    status: str
    order_id: Optional[str]
    created_at: str
    updated_at: str
    filled_at: Optional[str]
    is_available_on_alpaca: bool
    asset_type: str
    reinstated: bool = False  # Default to False for backward compatibility
    mode: str = 'auto'  # 'auto' or 'manual'


class GTTOrderDatabase:
    """Manages SQLite database for GTT orders"""
    
    def __init__(self, db_path: Optional[str] = None):
        """
        Initialize database connection
        
        Args:
            db_path: Path to SQLite database file. If None, uses default location in data/ directory.
        """
        if db_path is None:
            # Default to data/gtt_orders.db
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            data_dir = os.path.join(project_root, 'data')
            os.makedirs(data_dir, exist_ok=True)
            db_path = os.path.join(data_dir, 'gtt_orders.db')
        
        self.db_path = db_path
        self._init_database()
        logger.info(f"Initialized database at {db_path}")
    
    def _init_database(self):
        """Create database tables if they don't exist"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # GTT Orders table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS gtt_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    company TEXT NOT NULL,
                    order_index INTEGER NOT NULL,
                    amount REAL NOT NULL,
                    price REAL NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    order_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    filled_at TEXT,
                    is_available_on_alpaca INTEGER NOT NULL DEFAULT 1,
                    asset_type TEXT NOT NULL DEFAULT 'stock',
                    UNIQUE(symbol, order_index)
                )
            """)
            
            # Completed Orders table (links Alpaca orders to GTT orders)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS completed_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    gtt_order_id INTEGER NOT NULL,
                    alpaca_order_id TEXT NOT NULL UNIQUE,
                    symbol TEXT NOT NULL,
                    filled_at TEXT,
                    canceled_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (gtt_order_id) REFERENCES gtt_orders(id)
                )
            """)
            
            # Indexes for performance
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_gtt_symbol ON gtt_orders(symbol)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_gtt_order_id ON gtt_orders(order_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_completed_alpaca_id ON completed_orders(alpaca_order_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_completed_gtt_id ON completed_orders(gtt_order_id)")
            
            # Migration: Add asset_type column if it doesn't exist
            try:
                cursor.execute("ALTER TABLE gtt_orders ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'stock'")
                logger.info("Added asset_type column to gtt_orders table")
            except sqlite3.OperationalError:
                # Column already exists, ignore
                pass
            
            # Migration: Add reinstated flag if it doesn't exist
            try:
                cursor.execute("ALTER TABLE gtt_orders ADD COLUMN reinstated INTEGER NOT NULL DEFAULT 0")
                logger.info("Added reinstated column to gtt_orders table")
            except sqlite3.OperationalError:
                # Column already exists, ignore
                pass
            
            # Migration: Add mode column if it doesn't exist
            try:
                cursor.execute("ALTER TABLE gtt_orders ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'")
                logger.info("Added mode column to gtt_orders table")
            except sqlite3.OperationalError:
                # Column already exists, ignore
                pass
            
            # Global settings table for global mode
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS global_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # Initialize global_mode_stock and global_mode_crypto if they don't exist
            cursor.execute("""
                INSERT OR IGNORE INTO global_settings (key, value, updated_at)
                VALUES ('global_mode_stock', 'auto', ?)
            """, (datetime.utcnow().isoformat(),))
            cursor.execute("""
                INSERT OR IGNORE INTO global_settings (key, value, updated_at)
                VALUES ('global_mode_crypto', 'auto', ?)
            """, (datetime.utcnow().isoformat(),))
            
            # Migrate old global_mode to global_mode_stock if it exists
            cursor.execute("SELECT value FROM global_settings WHERE key = 'global_mode'")
            old_mode = cursor.fetchone()
            if old_mode:
                cursor.execute("""
                    INSERT OR IGNORE INTO global_settings (key, value, updated_at)
                    VALUES ('global_mode_stock', ?, ?)
                """, (old_mode['value'], datetime.utcnow().isoformat()))
                cursor.execute("DELETE FROM global_settings WHERE key = 'global_mode'")
            
            # Add index for asset_type
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_gtt_asset_type ON gtt_orders(asset_type)")
            
            conn.commit()
    
    def get_connection(self) -> sqlite3.Connection:
        """Get a database connection"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # Return rows as dict-like objects
        return conn
    
    def import_gtt_order(self, symbol: str, company: str, order_index: int, amount: float, 
                        price: float, is_available_on_alpaca: bool = True, 
                        status: str = 'pending', order_id: Optional[str] = None,
                        asset_type: str = 'stock', mode: str = 'auto') -> int:
        """
        Import or update a GTT order
        
        Args:
            symbol: Stock/crypto symbol
            company: Company name/description
            order_index: Order position in sequence (0-based)
            amount: Order quantity
            price: Limit price
            is_available_on_alpaca: Whether asset is available on Alpaca
            status: Order status (pending, placed, filled, etc.)
            order_id: Alpaca order ID if placed
        
        Returns:
            Database ID of the GTT order
        """
        now = datetime.utcnow().isoformat()
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Check if order exists
            cursor.execute("""
                SELECT id FROM gtt_orders 
                WHERE symbol = ? AND order_index = ?
            """, (symbol, order_index))
            
            existing = cursor.fetchone()
            
            if existing:
                # Update existing order
                cursor.execute("""
                    UPDATE gtt_orders 
                    SET company = ?, amount = ?, price = ?, 
                        is_available_on_alpaca = ?, asset_type = ?, mode = ?, updated_at = ?
                    WHERE id = ?
                """, (company, amount, price, 1 if is_available_on_alpaca else 0, asset_type, mode, now, existing['id']))
                return existing['id']
            else:
                # Insert new order
                cursor.execute("""
                    INSERT INTO gtt_orders 
                    (symbol, company, order_index, amount, price, status, order_id, 
                     created_at, updated_at, is_available_on_alpaca, asset_type, mode)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (symbol, company, order_index, amount, price, status, order_id, 
                      now, now, 1 if is_available_on_alpaca else 0, asset_type, mode))
                return cursor.lastrowid
    
    def get_gtt_orders_by_symbol(self, symbol: str) -> List[GTTOrderRow]:
        """Get all GTT orders for a symbol, ordered by order_index"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT *, COALESCE(reinstated, 0) as reinstated, COALESCE(mode, 'auto') as mode FROM gtt_orders 
                WHERE symbol = ? 
                ORDER BY order_index ASC
            """, (symbol,))
            
            rows = cursor.fetchall()
            # Convert rows to dicts and handle missing fields
            result = []
            for row in rows:
                row_dict = dict(row)
                if 'reinstated' not in row_dict:
                    row_dict['reinstated'] = False
                if 'mode' not in row_dict:
                    row_dict['mode'] = 'auto'
                result.append(GTTOrderRow(**row_dict))
            return result
    
    def get_all_gtt_orders(self) -> List[GTTOrderRow]:
        """Get all GTT orders, grouped by symbol"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT *, COALESCE(reinstated, 0) as reinstated, COALESCE(mode, 'auto') as mode FROM gtt_orders 
                ORDER BY symbol, order_index ASC
            """)
            
            rows = cursor.fetchall()
            # Convert rows to dicts and handle missing fields
            result = []
            for row in rows:
                row_dict = dict(row)
                if 'reinstated' not in row_dict:
                    row_dict['reinstated'] = False
                if 'mode' not in row_dict:
                    row_dict['mode'] = 'auto'
                result.append(GTTOrderRow(**row_dict))
            return result
    
    def update_order_status(self, symbol: str, order_index: int, status: str, 
                           order_id: Optional[str] = None, filled_at: Optional[str] = None,
                           reinstated: Optional[bool] = None):
        """
        Update order status and optionally order_id
        
        Args:
            symbol: Stock/crypto symbol
            order_index: Order position in sequence
            status: New status
            order_id: Alpaca order ID (optional)
            filled_at: ISO timestamp when order was filled (optional)
            reinstated: Whether order has been reinstated (optional)
        """
        now = datetime.utcnow().isoformat()
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            update_fields = ["status = ?", "updated_at = ?"]
            params = [status, now]
            
            if order_id is not None:
                update_fields.append("order_id = ?")
                params.append(order_id)
            
            if filled_at is not None:
                update_fields.append("filled_at = ?")
                params.append(filled_at)
            
            if reinstated is not None:
                update_fields.append("reinstated = ?")
                params.append(1 if reinstated else 0)
            
            params.extend([symbol, order_index])
            
            cursor.execute(f"""
                UPDATE gtt_orders 
                SET {', '.join(update_fields)}
                WHERE symbol = ? AND order_index = ?
            """, params)
            
            conn.commit()
    
    def update_current_order_index(self, symbol: str, current_order_index: int):
        """Update the current_order_index for a symbol (stored as metadata)"""
        # We'll store this in a separate metadata table or as part of the symbol
        # For now, we can calculate it from order statuses, but let's add a helper table
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Create metadata table if it doesn't exist
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS symbol_metadata (
                    symbol TEXT PRIMARY KEY,
                    current_order_index INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                )
            """)
            
            now = datetime.utcnow().isoformat()
            cursor.execute("""
                INSERT OR REPLACE INTO symbol_metadata (symbol, current_order_index, updated_at)
                VALUES (?, ?, ?)
            """, (symbol, current_order_index, now))
            
            conn.commit()
    
    def get_current_order_index(self, symbol: str) -> int:
        """Get the current_order_index for a symbol"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Create metadata table if it doesn't exist
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS symbol_metadata (
                    symbol TEXT PRIMARY KEY,
                    current_order_index INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                )
            """)
            
            cursor.execute("""
                SELECT current_order_index FROM symbol_metadata WHERE symbol = ?
            """, (symbol,))
            
            row = cursor.fetchone()
            if row:
                return row['current_order_index']
            
            # If not found, calculate from order statuses
            # Find first pending order
            cursor.execute("""
                SELECT MIN(order_index) as min_index FROM gtt_orders 
                WHERE symbol = ? AND status = 'pending'
            """, (symbol,))
            
            row = cursor.fetchone()
            if row and row['min_index'] is not None:
                return row['min_index']
            
            # If no pending orders, return count of orders (all completed)
            cursor.execute("SELECT COUNT(*) as count FROM gtt_orders WHERE symbol = ?", (symbol,))
            row = cursor.fetchone()
            return row['count'] if row else 0
    
    def link_completed_order(self, gtt_order_id: int, alpaca_order_id: str, 
                           symbol: str, filled_at: Optional[str] = None,
                           canceled_at: Optional[str] = None):
        """
        Link a completed Alpaca order to a GTT order
        
        Args:
            gtt_order_id: Database ID of the GTT order
            alpaca_order_id: Alpaca order ID
            symbol: Stock/crypto symbol
            filled_at: ISO timestamp when filled (optional)
            canceled_at: ISO timestamp when canceled (optional)
        """
        now = datetime.utcnow().isoformat()
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT OR REPLACE INTO completed_orders 
                (gtt_order_id, alpaca_order_id, symbol, filled_at, canceled_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (gtt_order_id, alpaca_order_id, symbol, filled_at, canceled_at, now))
            
            conn.commit()
    
    def get_completed_order(self, alpaca_order_id: str) -> Optional[Dict]:
        """Get completed order info by Alpaca order ID"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT co.*, go.symbol, go.order_index, go.price, go.amount
                FROM completed_orders co
                JOIN gtt_orders go ON co.gtt_order_id = go.id
                WHERE co.alpaca_order_id = ?
            """, (alpaca_order_id,))
            
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def delete_symbol_orders(self, symbol: str):
        """Delete all GTT orders for a symbol (used when CSV reloads)"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Get GTT order IDs for this symbol
            cursor.execute("SELECT id FROM gtt_orders WHERE symbol = ?", (symbol,))
            gtt_ids = [row['id'] for row in cursor.fetchall()]
            
            # Delete completed orders linked to these GTT orders
            if gtt_ids:
                placeholders = ','.join('?' * len(gtt_ids))
                cursor.execute(f"""
                    DELETE FROM completed_orders 
                    WHERE gtt_order_id IN ({placeholders})
                """, gtt_ids)
            
            # Delete GTT orders
            cursor.execute("DELETE FROM gtt_orders WHERE symbol = ?", (symbol,))
            
            # Delete metadata
            cursor.execute("DELETE FROM symbol_metadata WHERE symbol = ?", (symbol,))
            
            conn.commit()
    
    def get_all_symbols(self) -> List[str]:
        """Get list of all unique symbols"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT symbol FROM gtt_orders ORDER BY symbol")
            return [row['symbol'] for row in cursor.fetchall()]
    
    def has_orders(self) -> bool:
        """Check if database has any GTT orders"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) as count FROM gtt_orders LIMIT 1")
            result = cursor.fetchone()
            return result['count'] > 0 if result else False
    
    def get_global_mode(self, asset_type: str = 'stock') -> str:
        """Get global mode setting (auto/manual) for a specific asset type"""
        key = 'global_mode_stock' if asset_type == 'stock' else 'global_mode_crypto'
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM global_settings WHERE key = ?", (key,))
            row = cursor.fetchone()
            return row['value'] if row else 'auto'
    
    def set_global_mode(self, mode: str, asset_type: str = 'stock'):
        """Set global mode setting (auto/manual) for a specific asset type"""
        if mode not in ['auto', 'manual']:
            raise ValueError("Mode must be 'auto' or 'manual'")
        if asset_type not in ['stock', 'crypto']:
            raise ValueError("Asset type must be 'stock' or 'crypto'")
        key = 'global_mode_stock' if asset_type == 'stock' else 'global_mode_crypto'
        now = datetime.utcnow().isoformat()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO global_settings (key, value, updated_at)
                VALUES (?, ?, ?)
            """, (key, mode, now))
            conn.commit()
    
    def update_gtt_order_mode(self, gtt_order_id: int, mode: str):
        """Update mode for a specific GTT order"""
        if mode not in ['auto', 'manual']:
            raise ValueError("Mode must be 'auto' or 'manual'")
        now = datetime.utcnow().isoformat()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE gtt_orders 
                SET mode = ?, updated_at = ?
                WHERE id = ?
            """, (mode, now, gtt_order_id))
            conn.commit()
    
    def get_gtt_order_by_id(self, gtt_order_id: int) -> Optional[GTTOrderRow]:
        """Get a GTT order by its database ID"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT *, COALESCE(reinstated, 0) as reinstated, COALESCE(mode, 'auto') as mode 
                FROM gtt_orders 
                WHERE id = ?
            """, (gtt_order_id,))
            row = cursor.fetchone()
            if row:
                row_dict = dict(row)
                if 'reinstated' not in row_dict:
                    row_dict['reinstated'] = False
                if 'mode' not in row_dict:
                    row_dict['mode'] = 'auto'
                return GTTOrderRow(**row_dict)
            return None
    
    def get_gtt_order_by_symbol_and_index(self, symbol: str, order_index: int) -> Optional[GTTOrderRow]:
        """Get a GTT order by symbol and order_index"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT *, COALESCE(reinstated, 0) as reinstated, COALESCE(mode, 'auto') as mode 
                FROM gtt_orders 
                WHERE symbol = ? AND order_index = ?
            """, (symbol, order_index))
            row = cursor.fetchone()
            if row:
                row_dict = dict(row)
                if 'reinstated' not in row_dict:
                    row_dict['reinstated'] = False
                if 'mode' not in row_dict:
                    row_dict['mode'] = 'auto'
                return GTTOrderRow(**row_dict)
            return None
    
    def link_gtt_to_alpaca_order(self, gtt_order_id: int, alpaca_order_id: str, 
                                 symbol: str, filled_at: Optional[str] = None,
                                 canceled_at: Optional[str] = None):
        """
        Manually link a GTT order to an Alpaca order (regardless of status)
        
        Also updates the GTT order's order_id field
        """
        now = datetime.utcnow().isoformat()
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Link in completed_orders table
            cursor.execute("""
                INSERT OR REPLACE INTO completed_orders 
                (gtt_order_id, alpaca_order_id, symbol, filled_at, canceled_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (gtt_order_id, alpaca_order_id, symbol, filled_at, canceled_at, now))
            
            # Update GTT order's order_id field
            gtt_order = self.get_gtt_order_by_id(gtt_order_id)
            if gtt_order:
                # Determine status based on filled_at/canceled_at
                if filled_at:
                    new_status = 'filled'
                elif canceled_at:
                    new_status = 'canceled'
                else:
                    new_status = gtt_order.status  # Keep existing status
                
                cursor.execute("""
                    UPDATE gtt_orders 
                    SET order_id = ?, status = ?, updated_at = ?
                    WHERE id = ?
                """, (alpaca_order_id, new_status, now, gtt_order_id))
            
            conn.commit()
    
    def get_gtt_order_by_alpaca_order_id(self, alpaca_order_id: str) -> Optional[GTTOrderRow]:
        """Get GTT order linked to an Alpaca order ID"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT go.*, COALESCE(go.reinstated, 0) as reinstated, COALESCE(go.mode, 'auto') as mode
                FROM gtt_orders go
                JOIN completed_orders co ON go.id = co.gtt_order_id
                WHERE co.alpaca_order_id = ?
            """, (alpaca_order_id,))
            row = cursor.fetchone()
            if row:
                row_dict = dict(row)
                if 'reinstated' not in row_dict:
                    row_dict['reinstated'] = False
                if 'mode' not in row_dict:
                    row_dict['mode'] = 'auto'
                return GTTOrderRow(**row_dict)
            return None
    
    def reorder_gtt_indices_by_price(self, symbol: str):
        """
        Reorder GTT order indices for a symbol based on price (high to low)
        This is called when a new GTT order is inserted or price is edited
        
        Preserves all order properties (status, order_id, mode, etc.) - only updates order_index
        Uses temporary negative indices to avoid UNIQUE constraint violations during reordering
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Get all orders for this symbol with all their properties, ordered by price DESC
            cursor.execute("""
                SELECT id, order_index, status, order_id, mode, amount, price, company,
                       is_available_on_alpaca, asset_type, reinstated, filled_at
                FROM gtt_orders 
                WHERE symbol = ?
                ORDER BY price DESC, id ASC
            """, (symbol,))
            
            orders = cursor.fetchall()
            now = datetime.utcnow().isoformat()
            
            # Step 1: Set all order_index values to temporary negative values to avoid conflicts
            for idx, order_row in enumerate(orders):
                cursor.execute("""
                    UPDATE gtt_orders 
                    SET order_index = ?, updated_at = ?
                    WHERE id = ?
                """, (-(idx + 1), now, order_row['id']))
            
            conn.commit()
            
            # Step 2: Now set them to the correct positive indices
            for idx, order_row in enumerate(orders):
                cursor.execute("""
                    UPDATE gtt_orders 
                    SET order_index = ?, updated_at = ?
                    WHERE id = ?
                """, (idx, now, order_row['id']))
            
            conn.commit()
    
    def create_manual_gtt_order(self, symbol: str, company: str, amount: float, 
                                price: float, asset_type: str = 'stock',
                                is_available_on_alpaca: bool = True) -> int:
        """
        Create a new manual GTT order and automatically reorder indices by price
        
        Returns the database ID of the created order
        """
        # Get current max index for this symbol to use as temporary index
        # We'll reorder immediately after insertion
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT MAX(order_index) as max_index FROM gtt_orders WHERE symbol = ?
            """, (symbol,))
            row = cursor.fetchone()
            temp_index = (row['max_index'] + 1) if row and row['max_index'] is not None else 0
        
        # Insert with temporary index (will be reordered immediately)
        gtt_id = self.import_gtt_order(
            symbol=symbol,
            company=company,
            order_index=temp_index,
            amount=amount,
            price=price,
            is_available_on_alpaca=is_available_on_alpaca,
            status='pending',
            order_id=None,
            asset_type=asset_type,
            mode='manual'  # Manual orders default to manual mode
        )
        
        # Reorder indices by price immediately
        self.reorder_gtt_indices_by_price(symbol)
        
        return gtt_id

