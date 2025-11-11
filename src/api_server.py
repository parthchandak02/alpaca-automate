"""
Flask API server to expose GTT order data to the web UI
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import logging
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from functools import wraps
import jwt
import bcrypt
from .gtt_monitor import GTTOrderManager, SymbolLadder, SequentialOrder
from alpaca.trading.requests import GetOrdersRequest
from alpaca.data.requests import StockBarsRequest, CryptoBarsRequest
from alpaca.data.timeframe import TimeFrame
try:
    from alpaca.trading.enums import QueryOrderStatus
except ImportError:
    # Fallback if QueryOrderStatus doesn't exist - will use default
    QueryOrderStatus = None
import os
from dotenv import load_dotenv

load_dotenv()

# Configure logging for API server
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, supports_credentials=True)  # Enable CORS with credentials for cookies

# Authentication configuration
JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', os.urandom(32).hex())  # Generate if not set
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_DAYS = 30

# Password from environment (plain text)
# For better security, use APP_PASSWORD_HASH with bcrypt instead
UI_PASSWORD = os.getenv('UI_PASSWORD', '')
APP_PASSWORD_HASH = os.getenv('APP_PASSWORD_HASH', '')  # Keep for backward compatibility

# Use plain text password if UI_PASSWORD is set, otherwise use bcrypt hash
USE_PLAIN_TEXT_PASSWORD = bool(UI_PASSWORD)

# In-memory session store (device/IP tracking)
# In production, consider using Redis or a database
active_sessions: Dict[str, Dict] = {}  # token -> {ip, user_agent, expires_at}

# Global manager instance (will be initialized by the monitor)
manager: GTTOrderManager = None

# Global trading mode (paper vs live) - set when manager is initialized
trading_mode: bool = True  # Default to paper for safety

# Global loading status for progress tracking
loading_status = {
    "is_loading": False,
    "current_step": "",
    "progress": 0,
    "total": 0,
    "current_symbol": "",
    "loaded_symbols": [],
    "message": "",
    "has_loaded_once": False  # Track if we've completed initial load
}

def set_manager(mgr: GTTOrderManager):
    """Set the global manager instance"""
    global manager, trading_mode
    manager = mgr
    # Extract paper trading mode from the manager
    trading_mode = getattr(mgr.trading_client, 'is_paper', True)  # Default to paper

def set_loading_status(is_loading: bool, step: str = "", progress: int = 0, total: int = 0, symbol: str = "", message: str = "", clear_symbols: bool = False, force_show: bool = False):
    """Update loading status for progress tracking
    
    Args:
        is_loading: Whether loading is in progress
        step: Current step name
        progress: Current progress count
        total: Total steps/items
        symbol: Current symbol being processed
        message: Status message
        clear_symbols: Clear loaded_symbols array
        force_show: Force showing loading even if has_loaded_once is True (for CSV reloads, etc.)
    """
    global loading_status
    # If forcing show (e.g., CSV reload), temporarily allow loading status
    if force_show and is_loading:
        loading_status["is_loading"] = True
    elif not force_show:
        # Only set is_loading if not forcing (normal behavior)
        loading_status["is_loading"] = is_loading
    
    loading_status["current_step"] = step
    loading_status["progress"] = progress
    loading_status["total"] = total
    loading_status["current_symbol"] = symbol
    loading_status["message"] = message
    # Clear loaded_symbols if starting a new load
    if clear_symbols:
        loading_status["loaded_symbols"] = []
    # Only append symbol if we're actively loading and symbol is provided
    if loading_status["is_loading"] and symbol and symbol not in loading_status["loaded_symbols"]:
        loading_status["loaded_symbols"].append(symbol)

def clear_loading_status():
    """Clear loading status"""
    global loading_status
    loading_status["is_loading"] = False
    loading_status["current_step"] = ""
    loading_status["progress"] = 0
    loading_status["total"] = 0
    loading_status["current_symbol"] = ""
    loading_status["loaded_symbols"] = []
    loading_status["message"] = ""


def get_client_info() -> Dict[str, str]:
    """Get client IP and user agent for session tracking"""
    ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if ip and ',' in ip:
        ip = ip.split(',')[0].strip()
    user_agent = request.headers.get('User-Agent', 'Unknown')
    return {"ip": ip, "user_agent": user_agent}


def generate_token(client_info: Dict[str, str]) -> str:
    """Generate JWT token with 30-day expiration"""
    expires_at = datetime.utcnow() + timedelta(days=JWT_EXPIRATION_DAYS)
    payload = {
        'exp': expires_at,
        'iat': datetime.utcnow(),
        'ip': client_info['ip'],
        'user_agent': client_info['user_agent']
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    
    # JWT encode returns bytes in some versions, convert to string
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    
    # Store session info
    active_sessions[token] = {
        'ip': client_info['ip'],
        'user_agent': client_info['user_agent'],
        'expires_at': expires_at.isoformat()
    }
    
    return token


def verify_token(token: str) -> Optional[Dict]:
    """Verify JWT token and return payload if valid"""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        
        # Check if session exists and matches client info
        if token in active_sessions:
            session = active_sessions[token]
            client_info = get_client_info()
            # Optional: Verify IP matches (can be relaxed if user moves networks)
            # if session['ip'] != client_info['ip']:
            #     logger.warning(f"IP mismatch for token: {session['ip']} vs {client_info['ip']}")
            #     return None
        
        return payload
    except jwt.ExpiredSignatureError:
        # Clean up expired session
        if token in active_sessions:
            del active_sessions[token]
        return None
    except jwt.InvalidTokenError:
        return None


def require_auth(f):
    """Decorator to require authentication for API endpoints"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Allow status endpoint without auth (needed for initial loading)
        if request.path == '/api/status':
            return f(*args, **kwargs)
        
        # Get token from Authorization header or cookie
        token = None
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        elif request.cookies.get('auth_token'):
            token = request.cookies.get('auth_token')
        
        if not token:
            return jsonify({"error": "Authentication required"}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({"error": "Invalid or expired token"}), 401
        
        return f(*args, **kwargs)
    return decorated_function


@app.route('/api/auth/login', methods=['POST'])
def login():
    """Login endpoint - validates password and returns JWT token"""
    # Check if password is configured
    if USE_PLAIN_TEXT_PASSWORD:
        if not UI_PASSWORD:
            logger.error("UI_PASSWORD not configured in .env")
            return jsonify({"error": "Authentication not configured"}), 500
    else:
        if not APP_PASSWORD_HASH:
            logger.error("APP_PASSWORD_HASH not configured in .env")
            return jsonify({"error": "Authentication not configured"}), 500
    
    try:
        data = request.get_json() or {}
        password = data.get('password', '')
        
        if not password:
            return jsonify({"error": "Password required"}), 400
        
        # Verify password - plain text or bcrypt hash
        if USE_PLAIN_TEXT_PASSWORD:
            # Simple string comparison for plain text password
            if password != UI_PASSWORD:
                logger.warning(f"Failed login attempt from {request.remote_addr}")
                return jsonify({"error": "Invalid password"}), 401
        else:
            # Bcrypt hash verification
            if not bcrypt.checkpw(password.encode('utf-8'), APP_PASSWORD_HASH.encode('utf-8')):
                logger.warning(f"Failed login attempt from {request.remote_addr}")
                return jsonify({"error": "Invalid password"}), 401
        
        # Generate token
        client_info = get_client_info()
        token = generate_token(client_info)
        
        logger.info(f"Successful login from {client_info['ip']}")
        
        response = jsonify({
            "success": True,
            "message": "Authentication successful",
            "expires_in_days": JWT_EXPIRATION_DAYS
        })
        
        # Set httpOnly cookie (more secure than localStorage)
        response.set_cookie(
            'auth_token',
            token,
            max_age=JWT_EXPIRATION_DAYS * 24 * 60 * 60,
            httponly=True,
            secure=os.getenv('NODE_ENV') == 'production',  # HTTPS only in production
            samesite='Lax'
        )
        
        return response
    except Exception as e:
        logger.error(f"Error in login: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/auth/logout', methods=['POST'])
@require_auth
def logout():
    """Logout endpoint - invalidates token"""
    try:
        token = None
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        elif request.cookies.get('auth_token'):
            token = request.cookies.get('auth_token')
        
        if token and token in active_sessions:
            del active_sessions[token]
        
        response = jsonify({"success": True, "message": "Logged out successfully"})
        response.set_cookie('auth_token', '', expires=0)
        return response
    except Exception as e:
        logger.error(f"Error in logout: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/auth/verify', methods=['GET'])
def verify_auth():
    """Verify if current token is valid"""
    token = None
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
    elif request.cookies.get('auth_token'):
        token = request.cookies.get('auth_token')
    
    if not token:
        return jsonify({"authenticated": False}), 401
    
    payload = verify_token(token)
    if not payload:
        return jsonify({"authenticated": False}), 401
    
    return jsonify({
        "authenticated": True,
        "expires_at": payload.get('exp')
    })


@app.route('/api/status', methods=['GET'])
def get_status():
    """Get current loading status and progress"""
    global loading_status
    return jsonify(loading_status)


@app.route('/api/orders', methods=['GET'])
@require_auth
def get_orders():
    """Get all orders (both active and GTT)"""
    logger.info("GET /api/orders - Request received")
    if not manager:
        logger.error("Manager not initialized")
        # Set loading status to indicate manager is initializing
        set_loading_status(True, "Initializing", 0, 0, "", "Manager is initializing, please wait...")
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        # Only show loading status if this is a significant operation (initial load or first request)
        # For regular refreshes (every 5 seconds), don't show loading to avoid flickering
        is_initial_load = not loading_status.get("has_loaded_once", False)
        
        if is_initial_load:
            # Set initial loading status BEFORE processing starts (only for first load)
            set_loading_status(True, "Fetching orders from Alpaca", 0, 4, "", "Connecting to Alpaca API...", clear_symbols=True)
        
        # Get active orders from Alpaca
        active_orders = []
        alpaca_orders_list = []
        try:
            if is_initial_load:
                set_loading_status(True, "Fetching orders from Alpaca", 1, 4, "", "Requesting orders from Alpaca...")
            # Use GetOrdersRequest for proper API usage
            if QueryOrderStatus:
                orders_request = GetOrdersRequest(status=QueryOrderStatus.ALL, limit=100)
            else:
                # Fallback: create request without status enum
                orders_request = GetOrdersRequest(limit=100)
            alpaca_orders_list = manager.trading_client.get_orders(orders_request)
            
            if is_initial_load:
                set_loading_status(True, "Processing Alpaca orders", 2, 4, "", f"Processing {len(alpaca_orders_list)} orders from Alpaca...")
            for order in alpaca_orders_list:
                # Get timestamps from Alpaca order object
                created_at = order.created_at.isoformat() if hasattr(order.created_at, 'isoformat') else str(order.created_at)
                updated_at = order.updated_at.isoformat() if hasattr(order.updated_at, 'isoformat') else str(order.updated_at) if hasattr(order, 'updated_at') else None
                filled_at = order.filled_at.isoformat() if hasattr(order, 'filled_at') and order.filled_at and hasattr(order.filled_at, 'isoformat') else (str(order.filled_at) if hasattr(order, 'filled_at') and order.filled_at else None)
                canceled_at = order.canceled_at.isoformat() if hasattr(order, 'canceled_at') and order.canceled_at and hasattr(order.canceled_at, 'isoformat') else (str(order.canceled_at) if hasattr(order, 'canceled_at') and order.canceled_at else None)
                
                active_orders.append({
                    "id": order.id,
                    "symbol": order.symbol,
                    "side": order.side.value if hasattr(order.side, 'value') else str(order.side),
                    "quantity": float(order.qty) if order.qty else 0,
                    "limit_price": float(order.limit_price) if order.limit_price else None,
                    "status": order.status.value if hasattr(order.status, 'value') else str(order.status),
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "filled_at": filled_at,
                    "canceled_at": canceled_at,
                    "filled_qty": float(order.filled_qty) if order.filled_qty else 0,
                })
            logger.info(f"Fetched {len(active_orders)} active orders from Alpaca")
        except Exception as e:
            logger.error(f"Error fetching active orders: {e}", exc_info=True)
        
        # Get GTT orders from ladders
        if is_initial_load:
            set_loading_status(True, "Processing GTT orders", 3, 4, "", f"Processing GTT orders for {len(manager.ladders)} symbols...")
        gtt_orders = []
        total_symbols = len(manager.ladders)
        processed = 0
        
        for symbol, ladder in manager.ladders.items():
            processed += 1
            if is_initial_load:
                set_loading_status(True, "Processing GTT orders", 3, 4, symbol, f"Processing {symbol} ({processed}/{total_symbols})...")
            
            # Get all Alpaca orders for this symbol to sync statuses
            # Handle symbol normalization: COMP-STOCK -> COMP, BTC -> BTC/USD, etc.
            symbol_alpaca_orders = {}
            try:
                for order in alpaca_orders_list:
                    order_symbol = order.symbol
                    # Normalize order symbol (remove /USD for crypto, handle -STOCK suffix)
                    normalized_order_symbol = order_symbol.replace('/USD', '') if '/USD' in order_symbol else order_symbol
                    
                    # Check if this order matches our symbol
                    # Handle cases where we renamed symbols (e.g., COMP-STOCK -> COMP in Alpaca)
                    symbol_matches = (
                        order_symbol == symbol or  # Exact match
                        normalized_order_symbol == symbol or  # Normalized match
                        symbol.endswith('-STOCK') and normalized_order_symbol == symbol.replace('-STOCK', '')  # COMP-STOCK matches COMP
                    )
                    
                    if symbol_matches:
                        symbol_alpaca_orders[order.id] = order.status.value if hasattr(order.status, 'value') else str(order.status)
            except Exception as e:
                logger.debug(f"Error processing Alpaca orders for {symbol}: {e}")
            
            for idx, order in enumerate(ladder.orders):
                # Determine status: use Alpaca status if order is placed, otherwise use internal status
                display_status = order.status
                if order.order_id and order.order_id in symbol_alpaca_orders:
                    # Use Alpaca's official status for placed orders
                    display_status = symbol_alpaca_orders[order.order_id]
                elif order.status == "placed" and order.order_id:
                    # Order was placed but not found in current Alpaca orders - might be filled/cancelled
                    # Try to get status from Alpaca
                    try:
                        alpaca_order = manager.trading_client.get_order_by_id(order.order_id)
                        display_status = alpaca_order.status.value if hasattr(alpaca_order.status, 'value') else str(alpaca_order.status)
                    except Exception:
                        # Order might not exist anymore, keep as "placed" for now
                        pass
                
                # Get reinstated flag from database
                db_orders = manager.db.get_gtt_orders_by_symbol(symbol)
                reinstated = False
                if idx < len(db_orders):
                    reinstated = db_orders[idx].reinstated
                
                gtt_orders.append({
                    "symbol": symbol,
                    "company": ladder.company,
                    "order_index": idx + 1,
                    "total_orders": len(ladder.orders),
                    "amount": order.amount,
                    "price": order.price,
                    "status": display_status,  # Use synced Alpaca status
                    "order_id": order.order_id,
                    "current_order_index": ladder.current_order_index,
                    "is_current": idx == ladder.current_order_index,
                    "is_available_on_alpaca": ladder.is_available_on_alpaca,
                    "asset_type": ladder.asset_type,  # 'stock' or 'crypto'
                    "reinstated": reinstated,  # Whether this order has been reinstated before
                })
        
        # Clear loading status when done - use clear_loading_status to fully reset
        if is_initial_load:
            # Mark that we've loaded once, then clear status
            loading_status["has_loaded_once"] = True
            clear_loading_status()
        else:
            # For subsequent loads, just ensure is_loading is false (don't show progress bar)
            loading_status["is_loading"] = False
        
        logger.info(f"Returning {len(active_orders)} active orders and {len(gtt_orders)} GTT orders")
        return jsonify({
            "active_orders": active_orders,
            "gtt_orders": gtt_orders,
        })
    except Exception as e:
        logger.error(f"Error in get_orders: {e}", exc_info=True)
        set_loading_status(False, "Error", 0, 0, "", f"Error: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/prices', methods=['GET'])
@require_auth
def get_prices():
    """Get current prices for all symbols"""
    logger.debug("GET /api/prices - Request received")
    if not manager:
        logger.error("Manager not initialized")
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        symbols = list(manager.ladders.keys())
        prices = manager.get_current_prices()
        market_status = manager.get_market_status()
        logger.debug(f"Returning prices for {len(prices)} symbols, market open: {market_status.get('is_open')}")
        return jsonify({
            "prices": prices,
            "market_status": market_status
        })
    except Exception as e:
        logger.error(f"Error in get_prices: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/force-fill-order', methods=['POST'])
@require_auth
def force_fill_order():
    """Force fill a specific order by index - bypasses sequential logic.
    
    Allows force filling any pending order, not just the current one.
    If order is pending, places it first, then marks as filled.
    """
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        data = request.get_json()
        symbol = data.get('symbol', '').upper()
        order_index = data.get('order_index')  # 0-based index
        
        if not symbol:
            return jsonify({"error": "Symbol required"}), 400
        
        if order_index is None:
            return jsonify({"error": "order_index required"}), 400
        
        if symbol not in manager.ladders:
            return jsonify({"error": f"Symbol {symbol} not found"}), 404
        
        ladder = manager.ladders[symbol]
        
        # Check if this was the current order BEFORE we modify anything
        was_current_order = order_index == ladder.current_order_index
        
        # Validate order index
        if order_index < 0 or order_index >= len(ladder.orders):
            return jsonify({"error": f"Invalid order_index. Must be between 0 and {len(ladder.orders) - 1}"}), 400
        
        target_order = ladder.orders[order_index]
        
        # Check if order is already filled
        if target_order.status == "filled":
            return jsonify({
                "error": f"Order {order_index + 1} is already filled",
                "status": target_order.status
            }), 400
        
        # If order is pending and hasn't been placed yet, place it first
        if target_order.status == "pending" and not target_order.order_id:
            try:
                # Check account buying power
                account = manager.trading_client.get_account()
                buying_power = float(account.buying_power)
                order_value = target_order.price * target_order.amount
                
                if order_value > buying_power:
                    return jsonify({
                        "error": f"Insufficient buying power. Required: ${order_value:.2f}, Available: ${buying_power:.2f}"
                    }), 400
                
                # Place limit order first
                from alpaca.trading.requests import LimitOrderRequest
                from alpaca.trading.enums import OrderSide, TimeInForce
                
                # Format symbol correctly for order placement
                # For crypto, Alpaca requires symbol/USD format (e.g., BTC/USD)
                order_symbol = symbol
                if ladder.asset_type == 'crypto' and not symbol.endswith('/USD'):
                    order_symbol = f"{symbol}/USD"
                
                order_request = LimitOrderRequest(
                    symbol=order_symbol,
                    qty=target_order.amount,
                    side=OrderSide.BUY,
                    limit_price=target_order.price,
                    time_in_force=TimeInForce.GTC  # Good Till Cancelled - order stays active until filled or manually cancelled
                )
                
                placed_order = manager.trading_client.submit_order(order_data=order_request)
                target_order.order_id = placed_order.id
                target_order.status = "placed"
                
                # Update database
                manager.db.update_order_status(symbol, order_index, "placed", placed_order.id)
                manager._invalidate_ladders_cache()
                
                logger.info(f"FORCE-PLACED: {symbol} Order {order_index + 1} - "
                          f"Limit: ${target_order.price:.2f}, Order ID: {placed_order.id}")
            except Exception as e:
                logger.error(f"Error placing order: {e}", exc_info=True)
                return jsonify({"error": f"Failed to place order: {str(e)}"}), 500
        
        # Check if order has been placed (has order_id)
        if not target_order.order_id:
            return jsonify({
                "error": f"Order {order_index + 1} has not been placed yet (no order_id)",
                "status": target_order.status
            }), 400
        
        # Simulate fill: mark as filled
        target_order.status = "filled"
        
        # Update database
        from datetime import datetime
        filled_at = datetime.utcnow().isoformat()
        manager.db.update_order_status(symbol, order_index, "filled", target_order.order_id, filled_at)
        
        # Link completed order
        try:
            db_orders = manager.db.get_gtt_orders_by_symbol(symbol)
            if order_index < len(db_orders):
                gtt_order_id = db_orders[order_index].id
                manager.db.link_completed_order(gtt_order_id, target_order.order_id, symbol, filled_at=filled_at)
        except Exception as e:
            logger.debug(f"Could not link completed order: {e}")
        
        manager._invalidate_ladders_cache()
        
        logger.info(f"FORCE-FILLED: {symbol} Order {order_index + 1} marked as filled")
        
        # Update current_order_index to point to the first unfilled order
        # IMPORTANT: Start from index 0 to ensure we check ALL orders, not just from current position
        # This prevents skipping orders that should remain as PLACED
        ladder.current_order_index = 0
        while ladder.current_order_index < len(ladder.orders):
            current = ladder.orders[ladder.current_order_index]
            # If current order is filled or already placed (has order_id), advance to next
            if current.status == "filled" or (current.order_id and current.status not in ["pending"]):
                # Only advance if we're not already at the end
                if ladder.current_order_index < len(ladder.orders) - 1:
                    ladder.advance_to_next_order()
                else:
                    # Last order is filled/placed - mark as completed
                    ladder.advance_to_next_order()
                    break
            else:
                # Found first unfilled/unplaced order - this is now the current order
                break
        
        # Update database with new current_order_index
        manager.db.update_current_order_index(symbol, ladder.current_order_index)
        manager._invalidate_ladders_cache()
        
        # Only auto-place the next order if we force-filled the CURRENT order (sequential behavior)
        # If we force-filled a future order, don't auto-place anything
        if was_current_order:
            next_order = ladder.get_current_order()
            if next_order and next_order.status == "pending" and not next_order.order_id:
                try:
                    account = manager.trading_client.get_account()
                    buying_power = float(account.buying_power)
                    order_value = next_order.price * next_order.amount
                    
                    if order_value <= buying_power:
                        from alpaca.trading.requests import LimitOrderRequest
                        from alpaca.trading.enums import OrderSide, TimeInForce
                        
                        # Format symbol correctly for order placement
                        # For crypto, Alpaca requires symbol/USD format (e.g., BTC/USD)
                        order_symbol = symbol
                        if ladder.asset_type == 'crypto' and not symbol.endswith('/USD'):
                            order_symbol = f"{symbol}/USD"
                        
                        order_request = LimitOrderRequest(
                            symbol=order_symbol,
                            qty=next_order.amount,
                            side=OrderSide.BUY,
                            limit_price=next_order.price,
                            time_in_force=TimeInForce.GTC  # Good Till Cancelled - order stays active until filled or manually cancelled
                        )
                        
                        placed_order = manager.trading_client.submit_order(order_data=order_request)
                        next_order.order_id = placed_order.id
                        next_order.status = "placed"
                        
                        # Update database
                        manager.db.update_order_status(symbol, ladder.current_order_index, "placed", placed_order.id)
                        manager._invalidate_ladders_cache()
                        
                        logger.info(f"AUTO-PLACED: {symbol} Order {ladder.current_order_index + 1} - "
                                  f"Limit: ${next_order.price:.2f}, Order ID: {placed_order.id}")
                except Exception as e:
                    logger.warning(f"Could not auto-place next order: {e}")
        
        return jsonify({
            "success": True,
            "message": f"Order {order_index + 1} for {symbol} force filled",
            "order_index": order_index + 1,
            "was_current": was_current_order,
            "new_current_index": ladder.current_order_index
        })
    except Exception as e:
        logger.error(f"Error in force_fill_order: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/simulate-fill', methods=['POST'])
@require_auth
def simulate_fill():
    """Force place order(s) for a symbol - places current order and advances to next.
    
    Currently places the current order only, but designed for future multi-order placement.
    If order is pending, places it first. Then marks it as filled and auto-places the next order.
    """
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        data = request.get_json()
        symbol = data.get('symbol', '').upper()
        
        if not symbol:
            return jsonify({"error": "Symbol required"}), 400
        
        if symbol not in manager.ladders:
            return jsonify({"error": f"Symbol {symbol} not found"}), 404
        
        ladder = manager.ladders[symbol]
        current_order = ladder.get_current_order()
        
        if not current_order:
            return jsonify({"error": "No current order"}), 404
        
        # If order is pending and hasn't been placed yet, place it first
        if current_order.status == "pending" and not current_order.order_id:
            try:
                # Check account buying power
                account = manager.trading_client.get_account()
                buying_power = float(account.buying_power)
                order_value = current_order.price * current_order.amount
                
                if order_value > buying_power:
                    return jsonify({
                        "error": f"Insufficient buying power. Required: ${order_value:.2f}, Available: ${buying_power:.2f}"
                    }), 400
                
                # Place limit order first
                from alpaca.trading.requests import LimitOrderRequest
                from alpaca.trading.enums import OrderSide, TimeInForce
                
                # Format symbol correctly for order placement
                # For crypto, Alpaca requires symbol/USD format (e.g., BTC/USD)
                order_symbol = symbol
                if ladder.asset_type == 'crypto' and not symbol.endswith('/USD'):
                    order_symbol = f"{symbol}/USD"
                
                order_request = LimitOrderRequest(
                    symbol=order_symbol,
                    qty=current_order.amount,
                    side=OrderSide.BUY,
                    limit_price=current_order.price,
                    time_in_force=TimeInForce.GTC  # Good Till Cancelled - order stays active until filled or manually cancelled
                )
                
                placed_order = manager.trading_client.submit_order(order_data=order_request)
                current_order.order_id = placed_order.id
                current_order.status = "placed"
                
                # Update database
                manager.db.update_order_status(symbol, ladder.current_order_index, "placed", placed_order.id)
                manager._invalidate_ladders_cache()
                
                logger.info(f"AUTO-PLACED: {symbol} Order {ladder.current_order_index + 1} - "
                          f"Limit: ${current_order.price:.2f}, Order ID: {placed_order.id}")
            except Exception as e:
                logger.error(f"Error placing order: {e}", exc_info=True)
                return jsonify({"error": f"Failed to place order: {str(e)}"}), 500
        
        # Check if order is already filled
        if current_order.status == "filled":
            return jsonify({
                "error": "Order is already filled",
                "status": current_order.status
            }), 400
        
        if not current_order.order_id:
            return jsonify({
                "error": "Order has not been placed yet (no order_id)",
                "status": current_order.status
            }), 400
        
        # Simulate fill: mark as filled
        current_order.status = "filled"
        
        # Update database
        from datetime import datetime
        filled_at = datetime.utcnow().isoformat()
        old_index = ladder.current_order_index
        manager.db.update_order_status(symbol, old_index, "filled", current_order.order_id, filled_at)
        
        # Link completed order
        try:
            db_orders = manager.db.get_gtt_orders_by_symbol(symbol)
            if old_index < len(db_orders):
                gtt_order_id = db_orders[old_index].id
                manager.db.link_completed_order(gtt_order_id, current_order.order_id, symbol, filled_at=filled_at)
        except Exception as e:
            logger.debug(f"Could not link completed order: {e}")
        
        logger.info(f"SIMULATED FILL: {symbol} Order {ladder.current_order_index + 1} marked as filled")
        
        # Advance to next order
        ladder.advance_to_next_order()
        
        # Update database with new current_order_index
        manager.db.update_current_order_index(symbol, ladder.current_order_index)
        manager._invalidate_ladders_cache()
        
        # Immediately place the next order (auto-place logic)
        next_order = ladder.get_current_order()
        next_order_placed = False
        if next_order and next_order.status == "pending":
            try:
                # Check account buying power
                account = manager.trading_client.get_account()
                buying_power = float(account.buying_power)
                order_value = next_order.price * next_order.amount
                
                if order_value > buying_power:
                    logger.warning(f"Insufficient buying power for {symbol}. "
                                 f"Required: ${order_value:.2f}, Available: ${buying_power:.2f}")
                    return jsonify({
                        "success": True,
                        "message": f"Order {ladder.current_order_index} for {symbol} marked as filled",
                        "next_order": ladder.current_order_index + 1 if next_order else None,
                        "next_order_placed": False,
                        "error": "Insufficient buying power for next order"
                    })
                
                # Place limit order
                from alpaca.trading.requests import LimitOrderRequest
                from alpaca.trading.enums import OrderSide, TimeInForce
                
                order_request = LimitOrderRequest(
                    symbol=symbol,
                    qty=next_order.amount,
                    side=OrderSide.BUY,
                    limit_price=next_order.price,
                    time_in_force=TimeInForce.GTC  # Good Till Cancelled - order stays active until filled or manually cancelled
                )
                
                placed_order = manager.trading_client.submit_order(order_data=order_request)
                next_order.order_id = placed_order.id
                next_order.status = "placed"
                
                # Update database
                manager.db.update_order_status(symbol, ladder.current_order_index, "placed", placed_order.id)
                manager._invalidate_ladders_cache()
                
                next_order_placed = True
                logger.info(f"AUTO-PLACED: {symbol} Order {ladder.current_order_index + 1} - "
                          f"Limit: ${next_order.price:.2f}, Order ID: {placed_order.id}")
            except Exception as e:
                logger.error(f"Error auto-placing next order: {e}", exc_info=True)
                return jsonify({
                    "success": True,
                    "message": f"Order {ladder.current_order_index} for {symbol} marked as filled",
                    "next_order": ladder.current_order_index + 1 if next_order else None,
                    "next_order_placed": False,
                    "error": str(e)
                })
        
        return jsonify({
            "success": True,
            "message": f"Order {ladder.current_order_index} for {symbol} marked as filled",
            "next_order": ladder.current_order_index + 1 if next_order else None,
            "next_order_placed": next_order_placed,
            "next_order_id": next_order.order_id if next_order_placed else None
        })
        
    except Exception as e:
        logger.error(f"Error simulating fill: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/cancel-all-orders', methods=['POST'])
@require_auth
def cancel_all_orders():
    """Cancel all active orders for testing purposes"""
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        # Get all active orders from Alpaca
        orders_request = GetOrdersRequest(limit=100)
        orders = manager.trading_client.get_orders(orders_request)
        
        cancelled_count = 0
        errors = []
        
        for order in orders:
            try:
                manager.trading_client.cancel_order_by_id(order.id)
                cancelled_count += 1
                logger.info(f"Cancelled order: {order.id} ({order.symbol})")
            except Exception as e:
                error_msg = f"Failed to cancel {order.id}: {str(e)}"
                logger.error(error_msg)
                errors.append(error_msg)
        
        # Also reset all GTT order statuses to pending and clear ladders
        reset_count = 0
        for symbol, ladder in manager.ladders.items():
            for idx, order in enumerate(ladder.orders):
                if order.status != "pending":
                    order.status = "pending"
                    order.order_id = None
                    # Update database
                    manager.db.update_order_status(symbol, idx, "pending", None)
                    reset_count += 1
            # Reset to first order
            ladder.current_order_index = 0
            manager.db.update_current_order_index(symbol, 0)
        
        # Invalidate cache
        manager._invalidate_ladders_cache()
        
        # Clear all ladders (remove GTT orders from memory)
        cleared_symbols = list(manager.ladders.keys())
        manager.ladders.clear()
        
        return jsonify({
            "success": True,
            "message": f"Cancelled {cancelled_count} order(s), reset {reset_count} GTT order(s), and cleared {len(cleared_symbols)} symbol(s) from memory",
            "cancelled_count": cancelled_count,
            "reset_count": reset_count,
            "cleared_symbols": cleared_symbols,
            "errors": errors if errors else None
        })
        
    except Exception as e:
        logger.error(f"Error cancelling orders: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/account', methods=['GET'])
@require_auth
def get_account():
    """Get account information"""
    logger.debug("GET /api/account - Request received")
    if not manager:
        logger.error("Manager not initialized")
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        account = manager.trading_client.get_account()
        logger.debug("Account info retrieved successfully")
        # Use the global trading_mode set when manager was initialized
        global trading_mode
        
        return jsonify({
            "buying_power": float(account.buying_power),
            "cash": float(account.cash),
            "portfolio_value": float(account.portfolio_value),
            "equity": float(account.equity),
            "is_paper": trading_mode,
        })
    except Exception as e:
        logger.error(f"Error in get_account: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/positions', methods=['GET'])
@require_auth
def get_positions():
    """Get all positions (stocks and crypto)"""
    logger.debug("GET /api/positions - Request received")
    if not manager:
        logger.error("Manager not initialized")
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        # Get all positions from Alpaca
        # The Alpaca Python SDK uses get_all_positions() method
        try:
            positions = manager.trading_client.get_all_positions()
        except AttributeError as e:
            logger.error(f"get_all_positions method not found: {e}")
            # Try alternative method name
            try:
                positions = manager.trading_client.get_positions()
            except AttributeError as e2:
                logger.error(f"get_positions method also not found: {e2}")
                return jsonify({"error": "Positions API method not available in Alpaca SDK"}), 500
        
        # Separate stocks and crypto positions
        stock_positions = []
        crypto_positions = []
        
        for position in positions:
            # Determine asset class
            asset_class = getattr(position, 'asset_class', None)
            if asset_class is None:
                # Fallback: check symbol format (crypto symbols often have /USD suffix)
                symbol = getattr(position, 'symbol', '')
                if '/USD' in symbol or symbol in ['BTC', 'ETH', 'SOL', 'DOGE', 'BCH', 'LTC']:
                    asset_class = 'crypto'
                else:
                    asset_class = 'us_equity'
            
            # Extract position data
            position_data = {
                "asset_id": getattr(position, 'asset_id', None),
                "symbol": getattr(position, 'symbol', ''),
                "exchange": getattr(position, 'exchange', ''),
                "asset_class": asset_class,
                "qty": float(position.qty) if position.qty else 0,
                "side": getattr(position, 'side', 'long').value if hasattr(getattr(position, 'side', 'long'), 'value') else str(getattr(position, 'side', 'long')),
                "market_value": float(position.market_value) if position.market_value else 0,
                "avg_entry_price": float(position.avg_entry_price) if position.avg_entry_price else 0,
                "cost_basis": float(position.cost_basis) if position.cost_basis else 0,
                "unrealized_pl": float(position.unrealized_pl) if position.unrealized_pl else 0,
                "unrealized_plpc": float(position.unrealized_plpc) if position.unrealized_plpc else 0,
                "current_price": float(position.current_price) if position.current_price else 0,
                "lastday_price": float(position.lastday_price) if hasattr(position, 'lastday_price') and position.lastday_price else None,
                "change_today": float(position.change_today) if hasattr(position, 'change_today') and position.change_today else None,
            }
            
            # Calculate today's P/L if we have lastday_price
            if position_data['lastday_price'] and position_data['current_price']:
                price_change = position_data['current_price'] - position_data['lastday_price']
                position_data['today_pl'] = price_change * abs(position_data['qty'])
                position_data['today_plpc'] = (price_change / position_data['lastday_price']) * 100 if position_data['lastday_price'] > 0 else 0
            else:
                position_data['today_pl'] = None
                position_data['today_plpc'] = None
            
            # Normalize symbol for crypto (remove /USD suffix for display)
            display_symbol = position_data['symbol']
            if asset_class == 'crypto' and '/USD' in display_symbol:
                display_symbol = display_symbol.replace('/USD', '')
            position_data['display_symbol'] = display_symbol
            
            # Add to appropriate list
            if asset_class == 'crypto':
                crypto_positions.append(position_data)
            else:
                stock_positions.append(position_data)
        
        logger.debug(f"Returning {len(stock_positions)} stock positions and {len(crypto_positions)} crypto positions")
        return jsonify({
            "stocks": stock_positions,
            "crypto": crypto_positions,
        })
    except Exception as e:
        logger.error(f"Error in get_positions: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/send-daily-summary', methods=['POST'])
@require_auth
def send_daily_summary():
    """Manually trigger daily summary email
    
    Optional JSON body:
    {
        "date": "2025-11-09"  # Optional: YYYY-MM-DD format, defaults to yesterday
    }
    """
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        from datetime import datetime
        
        data = request.get_json() or {}
        target_date_str = data.get('date')
        
        if target_date_str:
            try:
                target_date = datetime.strptime(target_date_str, '%Y-%m-%d')
            except ValueError:
                return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
        else:
            target_date = None  # Will default to yesterday
        
        # Send the summary
        manager.notification_manager.send_daily_summary(target_date)
        
        date_display = target_date.strftime('%Y-%m-%d') if target_date else "yesterday"
        return jsonify({
            "success": True,
            "message": f"Daily summary email sent for {date_display}",
            "date": date_display
        })
    except Exception as e:
        logger.error(f"Error sending daily summary: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/send-weekly-summary', methods=['POST'])
@require_auth
def send_weekly_summary():
    """Manually trigger weekly summary email
    
    Optional JSON body:
    {
        "week_start": "2025-11-03"  # Optional: YYYY-MM-DD format (Monday), defaults to last week's Monday
    }
    """
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        from datetime import datetime
        
        data = request.get_json() or {}
        week_start_str = data.get('week_start')
        
        if week_start_str:
            try:
                week_start = datetime.strptime(week_start_str, '%Y-%m-%d')
                week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
            except ValueError:
                return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
        else:
            week_start = None  # Will default to last week's Monday
        
        # Send the summary
        manager.notification_manager.send_weekly_summary(week_start)
        
        week_display = week_start.strftime('%Y-%m-%d') if week_start else "last week"
        return jsonify({
            "success": True,
            "message": f"Weekly summary email sent for week starting {week_display}",
            "week_start": week_display
        })
    except Exception as e:
        logger.error(f"Error sending weekly summary: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/test-email', methods=['POST'])
@require_auth
def test_email():
    """Send a test email to verify email configuration is working"""
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        from datetime import datetime
        
        manager._send_email_notification(
            title="🧪 Test Email",
            description="This is a test email to verify your email notification configuration is working correctly.",
            fields=[
                {
                    "name": "Test Details",
                    "value": f"Sent at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\nIf you received this email, your email notifications are configured correctly!",
                    "inline": False
                }
            ],
            footer_text="Alpaca Trading Bot • Test Email"
        )
        
        return jsonify({
            "success": True,
            "message": "Test email sent successfully. Check your inbox!"
        })
    except Exception as e:
        logger.error(f"Error sending test email: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/reinstate-gtt-order', methods=['POST'])
@require_auth
def reinstate_gtt_order():
    """Re-instate a GTT order that was cancelled or expired
    
    JSON body:
    {
        "symbol": "AAPL",  # Required: symbol to re-instate
        "order_index": 0   # Optional: specific order index (0-based), defaults to current order
    }
    """
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        data = request.get_json() or {}
        symbol = data.get('symbol')
        order_index = data.get('order_index')
        
        if not symbol:
            return jsonify({"error": "symbol is required"}), 400
        
        symbol = symbol.upper()
        
        if symbol not in manager.ladders:
            return jsonify({"error": f"No GTT orders found for symbol {symbol}"}), 404
        
        ladder = manager.ladders[symbol]
        
        # Determine which order to re-instate
        # Frontend sends 1-based order_index (Order #1, #2, etc.), convert to 0-based
        actual_order_index = None
        if order_index is not None:
            # Convert from 1-based (frontend) to 0-based (backend)
            actual_order_index = order_index - 1
            if actual_order_index < 0 or actual_order_index >= len(ladder.orders):
                return jsonify({"error": f"Invalid order_index. Must be between 1 and {len(ladder.orders)}"}), 400
            target_order = ladder.orders[actual_order_index]
            target_order_num = order_index  # Keep 1-based for display
        else:
            # Use current order
            target_order = ladder.get_current_order()
            if not target_order:
                return jsonify({"error": f"No current order for {symbol}. All orders may be completed."}), 400
            actual_order_index = ladder.current_order_index
            target_order_num = ladder.current_order_index + 1
        
        # Check if order has already been reinstated (one-time only)
        db_orders = manager.db.get_gtt_orders_by_symbol(symbol)
        if actual_order_index < len(db_orders):
            db_order = db_orders[actual_order_index]
            if db_order.reinstated:
                return jsonify({
                    "error": f"Order {target_order_num} for {symbol} has already been reinstated. Reinstatement is a one-time operation.",
                    "current_status": target_order.status
                }), 400
        
        # Check if order is in a state that can be re-instated
        if target_order.status not in ["cancelled", "expired", "rejected", "pending_cancel"]:
            return jsonify({
                "error": f"Order {target_order_num} for {symbol} cannot be re-instated. Current status: {target_order.status}",
                "current_status": target_order.status
            }), 400
        
        # IMPORTANT: If order already has an order_id, it was placed on Alpaca.
        # The cancelled order will remain in the cancelled orders table (fetched from Alpaca).
        # When we reinstate and place again, it will get a NEW order_id from Alpaca.
        # So we're safe to reset - the old order stays in cancelled orders, new order gets new ID.
        old_order_id = target_order.order_id  # Store for logging
        old_status = target_order.status
        
        # Reset order to pending (will get new order_id when placed)
        target_order.status = "pending"
        target_order.order_id = None  # Clear so we can place a new order with new ID
        
        # Update database with reinstated flag set to True
        manager.db.update_order_status(symbol, actual_order_index, "pending", None, reinstated=True)
        
        # If this was not the current order, we may need to adjust the current_order_index
        if actual_order_index is not None and actual_order_index < ladder.current_order_index:
            # Re-instate an earlier order - reset to that order
            manager.db.update_current_order_index(symbol, actual_order_index)
            logger.info(f"Re-instated order {target_order_num} for {symbol} and reset current_order_index to {actual_order_index}")
        else:
            logger.info(f"Re-instated order {target_order_num} for {symbol} (status: {old_status} -> pending)")
        
        # Invalidate cache so changes are reflected
        manager._invalidate_ladders_cache()
        
        # Send notification about re-instatement
        total_orders = len(ladder.orders)
        notification_fields = [
            {"name": "Symbol", "value": symbol, "inline": True},
            {"name": "Order", "value": f"{target_order_num}/{total_orders}", "inline": True},
            {"name": "Previous Status", "value": old_status, "inline": True},
            {"name": "Limit Price", "value": f"${target_order.price:.2f}", "inline": True},
            {"name": "Quantity", "value": f"{target_order.amount} shares", "inline": True},
        ]
        
        if old_order_id:
            notification_fields.append({
                "name": "Previous Order ID", 
                "value": f"`{old_order_id}` (remains in cancelled orders)", 
                "inline": False
            })
            notification_fields.append({
                "name": "Status", 
                "value": "**Pending** - Will be placed with a NEW order_id when trigger condition is met", 
                "inline": False
            })
        else:
            notification_fields.append({
                "name": "Status", 
                "value": "**Pending** - Will be placed when trigger condition is met", 
                "inline": False
            })
        
        manager._send_email_notification(
            title="🔄 GTT Order Re-instated",
            description=f"{symbol} - Order {target_order_num} of {total_orders} has been re-instated",
            fields=notification_fields,
            footer_text=f"{ladder.company} • Order {target_order_num}/{total_orders} re-instated"
        )
        
        return jsonify({
            "success": True,
            "message": f"Order {target_order_num} for {symbol} has been re-instated",
            "symbol": symbol,
            "order_index": actual_order_index,
            "order_num": target_order_num,
            "previous_status": old_status,
            "previous_order_id": old_order_id,  # Include old order_id in response
            "new_status": "pending",
            "limit_price": target_order.price,
            "quantity": target_order.amount,
            "note": "Old order remains in cancelled orders table. New order will get a new order_id when placed." if old_order_id else None
        })
    except Exception as e:
        logger.error(f"Error re-instating GTT order: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/upload-stocks-csv', methods=['POST'])
@require_auth
def upload_stocks_csv():
    """Upload and import stocks/ETFs CSV file"""
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        # Check if file was uploaded
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Validate file extension
        if not file.filename.endswith('.csv'):
            return jsonify({"error": "File must be a CSV file"}), 400
        
        # Save uploaded file temporarily
        import tempfile
        import shutil
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data_dir = os.path.join(project_root, 'data')
        os.makedirs(data_dir, exist_ok=True)
        
        # Save to data directory
        stocks_csv_path = os.path.join(data_dir, 'gtt-live-stocks-etfs.csv')
        
        # Backup existing file if it exists
        if os.path.exists(stocks_csv_path):
            backup_path = stocks_csv_path + '.backup'
            shutil.copy2(stocks_csv_path, backup_path)
        
        # Save uploaded file
        file.save(stocks_csv_path)
        
        # Load orders from CSV
        try:
            manager.load_orders_from_csv(stocks_csv_path, asset_type='stock')
        except ValueError as e:
            # Validation error - unsupported symbols
            logger.error(f"Validation error uploading stocks CSV: {e}")
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            # Other errors
            logger.error(f"Error uploading stocks CSV: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500
        
        # Invalidate cache
        manager._invalidate_ladders_cache()
        
        logger.info(f"Uploaded and imported stocks CSV: {file.filename}")
        
        return jsonify({
            "success": True,
            "message": f"Stocks CSV uploaded and imported successfully",
            "filename": file.filename
        })
    except Exception as e:
        logger.error(f"Error uploading stocks CSV: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/upload-crypto-csv', methods=['POST'])
@require_auth
def upload_crypto_csv():
    """Upload and import crypto CSV file"""
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        # Check if file was uploaded
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Validate file extension
        if not file.filename.endswith('.csv'):
            return jsonify({"error": "File must be a CSV file"}), 400
        
        # Save uploaded file temporarily
        import tempfile
        import shutil
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data_dir = os.path.join(project_root, 'data')
        os.makedirs(data_dir, exist_ok=True)
        
        # Save to data directory
        crypto_csv_path = os.path.join(data_dir, 'gtt-live-crypto.csv')
        
        # Backup existing file if it exists
        if os.path.exists(crypto_csv_path):
            backup_path = crypto_csv_path + '.backup'
            shutil.copy2(crypto_csv_path, backup_path)
        
        # Save uploaded file
        file.save(crypto_csv_path)
        
        # Load orders from CSV
        try:
            manager.load_orders_from_csv(crypto_csv_path, asset_type='crypto')
        except ValueError as e:
            # Validation error - unsupported symbols
            logger.error(f"Validation error uploading crypto CSV: {e}")
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            # Other errors
            logger.error(f"Error uploading crypto CSV: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500
        
        # Invalidate cache
        manager._invalidate_ladders_cache()
        
        logger.info(f"Uploaded and imported crypto CSV: {file.filename}")
        
        return jsonify({
            "success": True,
            "message": f"Crypto CSV uploaded and imported successfully",
            "filename": file.filename
        })
    except Exception as e:
        logger.error(f"Error uploading crypto CSV: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/download-stocks-template', methods=['GET'])
@require_auth
def download_stocks_template():
    """Download stocks/ETFs CSV template"""
    try:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        template_path = os.path.join(project_root, 'data', 'gtt-stocks-template.csv')
        
        from flask import send_file
        return send_file(
            template_path,
            mimetype='text/csv',
            as_attachment=True,
            download_name='gtt-stocks-template.csv'
        )
    except Exception as e:
        logger.error(f"Error downloading stocks template: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/download-crypto-template', methods=['GET'])
@require_auth
def download_crypto_template():
    """Download crypto CSV template"""
    try:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        template_path = os.path.join(project_root, 'data', 'gtt-crypto-template.csv')
        
        from flask import send_file
        return send_file(
            template_path,
            mimetype='text/csv',
            as_attachment=True,
            download_name='gtt-crypto-template.csv'
        )
    except Exception as e:
        logger.error(f"Error downloading crypto template: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/preview-csv', methods=['POST'])
@require_auth
def preview_csv():
    """Preview CSV file before upload - validates and returns parsed data"""
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        # Check if file was uploaded
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Validate file extension
        if not file.filename.endswith('.csv'):
            return jsonify({"error": "File must be a CSV file"}), 400
        
        # Get asset type from request
        asset_type = request.form.get('asset_type', 'stock')  # 'stock' or 'crypto'
        
        # Read and parse CSV
        import csv
        import tempfile
        import os
        
        # Save to temp file
        temp_file = tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.csv')
        file.save(temp_file.name)
        temp_file.close()
        
        preview_data = []
        errors = []
        warnings = []
        
        try:
            # Try multiple encodings
            encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']
            csv_content = None
            used_encoding = None
            
            for encoding in encodings:
                try:
                    with open(temp_file.name, 'r', encoding=encoding) as f:
                        csv_content = f.read()
                        used_encoding = encoding
                        break
                except UnicodeDecodeError:
                    continue
            
            if csv_content is None:
                errors.append("Unable to read CSV file. File encoding is not supported. Please save the file as UTF-8.")
                return jsonify({
                    "success": False,
                    "error": "File encoding error",
                    "errors": errors,
                    "preview": [],
                    "warnings": []
                }), 400
            
            # Parse CSV
            import io
            reader = csv.DictReader(io.StringIO(csv_content))
            
            # Check for required columns
            fieldnames = reader.fieldnames
            if not fieldnames:
                errors.append("CSV file appears to be empty or has no header row")
                return jsonify({
                    "success": False,
                    "error": "Invalid CSV format",
                    "errors": errors,
                    "preview": [],
                    "warnings": []
                }), 400
            
            # Normalize fieldnames (strip whitespace)
            normalized_fieldnames = [f.strip() for f in fieldnames]
            
            # Check for required columns
            has_company = 'Company' in normalized_fieldnames
            has_symbol = 'Symbol' in normalized_fieldnames or 'Account' in normalized_fieldnames
            
            if not has_company:
                errors.append("CSV file is missing required column: 'Company'")
            if not has_symbol:
                errors.append("CSV file is missing required column: 'Symbol' (or 'Account' for legacy format)")
            
            if errors:
                return jsonify({
                    "success": False,
                    "error": "Missing required columns",
                    "errors": errors,
                    "preview": [],
                    "warnings": []
                }), 400
            
            rows = list(reader)
            
            if not rows:
                errors.append("CSV file has header but no data rows")
                return jsonify({
                    "success": False,
                    "error": "Empty CSV file",
                    "errors": errors,
                    "preview": [],
                    "warnings": []
                }), 400
            
            for row_idx, row in enumerate(rows, start=2):  # Start at 2 (row 1 is header)
                try:
                    # Normalize column names by stripping whitespace
                    normalized_row = {k.strip(): v for k, v in row.items()}
                    
                    csv_company = normalized_row.get('Company', '').strip()
                    # Support both "Symbol" (new) and "Account" (legacy) for backward compatibility
                    symbol = normalized_row.get('Symbol', normalized_row.get('Account', '')).strip()
                    
                    if not symbol:
                        warnings.append(f"Row {row_idx}: Missing symbol (Symbol/Account column)")
                        continue
                    
                    # Parse orders
                    orders = []
                    for i in range(1, 9):  # 1-8
                        amt_key = f'Amt {i}'
                        price_key = f'Price {i}'
                        
                        amt_str = normalized_row.get(amt_key, '').strip()
                        price_str = normalized_row.get(price_key, '').strip()
                        
                        if not amt_str or not price_str:
                            continue
                        
                        try:
                            amount = float(amt_str)
                            # Parse price (remove $ and commas)
                            price_str_clean = price_str.replace('$', '').replace(',', '').strip()
                            price = float(price_str_clean)
                            
                            if amount <= 0:
                                errors.append(f"Row {row_idx}: Invalid amount '{amt_str}' for order {i}")
                                continue
                            if price <= 0:
                                errors.append(f"Row {row_idx}: Invalid price '{price_str}' for order {i}")
                                continue
                            
                            orders.append({
                                "order_num": i,
                                "amount": amount,
                                "price": price
                            })
                        except ValueError as e:
                            errors.append(f"Row {row_idx}: Could not parse order {i} - Amount: '{amt_str}', Price: '{price_str}'")
                            continue
                    
                    if not orders:
                        warnings.append(f"Row {row_idx}: No valid orders found for {symbol}")
                        continue
                    
                    # Check if symbol is available (optional validation)
                    is_available = None
                    try:
                        is_available = manager._is_asset_available_on_alpaca(symbol, asset_type=asset_type)
                    except Exception:
                        pass  # Skip validation if it fails, just show warning
                    
                    preview_data.append({
                        "row": row_idx,
                        "company": csv_company or symbol,
                        "symbol": symbol,
                        "orders": orders,
                        "order_count": len(orders),
                        "is_available": is_available
                    })
                    
                    if is_available is False:
                        warnings.append(f"Row {row_idx}: Symbol '{symbol}' may not be available on Alpaca")
                except Exception as row_error:
                    errors.append(f"Row {row_idx}: Error processing row - {str(row_error)}")
                    continue
        
        except csv.Error as e:
            logger.error(f"CSV parsing error: {e}", exc_info=True)
            return jsonify({
                "success": False,
                "error": "CSV parsing error",
                "errors": [f"Unable to parse CSV file: {str(e)}. Please check the file format."],
                "preview": [],
                "warnings": []
            }), 400
        except Exception as e:
            logger.error(f"Error previewing CSV: {e}", exc_info=True)
            return jsonify({
                "success": False,
                "error": "Unexpected error",
                "errors": [f"Error analyzing CSV file: {str(e)}"],
                "preview": [],
                "warnings": []
            }), 500
        finally:
            # Clean up temp file
            try:
                os.unlink(temp_file.name)
            except:
                pass
        
        return jsonify({
            "success": True,
            "preview": preview_data,
            "errors": errors,
            "warnings": warnings,
            "total_rows": len(preview_data),
            "total_orders": sum(len(item["orders"]) for item in preview_data)
        })
    except Exception as e:
        logger.error(f"Error in preview_csv: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": "Unexpected error",
            "errors": [f"Error processing CSV file: {str(e)}"],
            "preview": [],
            "warnings": []
        }), 500


@app.route('/api/edit-gtt-order', methods=['POST'])
@require_auth
def edit_gtt_order():
    """Edit a GTT order's price and/or amount"""
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        data = request.get_json()
        symbol = data.get('symbol', '').upper()
        order_index = data.get('order_index')  # 0-based index
        new_price = data.get('price')
        new_amount = data.get('amount')
        
        if not symbol:
            return jsonify({"error": "Symbol required"}), 400
        
        if order_index is None:
            return jsonify({"error": "order_index required"}), 400
        
        if new_price is None and new_amount is None:
            return jsonify({"error": "At least one of 'price' or 'amount' must be provided"}), 400
        
        if symbol not in manager.ladders:
            return jsonify({"error": f"Symbol {symbol} not found"}), 404
        
        ladder = manager.ladders[symbol]
        
        # Validate order index
        if order_index < 0 or order_index >= len(ladder.orders):
            return jsonify({"error": f"Invalid order_index. Must be between 0 and {len(ladder.orders) - 1}"}), 400
        
        target_order = ladder.orders[order_index]
        
        # Check if order can be edited (not filled)
        if target_order.status == "filled":
            return jsonify({
                "error": f"Cannot edit filled order",
                "status": target_order.status
            }), 400
        
        # Update order in memory
        if new_price is not None:
            if new_price <= 0:
                return jsonify({"error": "Price must be greater than 0"}), 400
            target_order.price = float(new_price)
        
        if new_amount is not None:
            if new_amount <= 0:
                return jsonify({"error": "Amount must be greater than 0"}), 400
            target_order.amount = float(new_amount)
        
        # Update database
        # Get current order status and order_id
        db_orders = manager.db.get_gtt_orders_by_symbol(symbol)
        if order_index < len(db_orders):
            db_order = db_orders[order_index]
            manager.db.import_gtt_order(
                symbol=symbol,
                company=ladder.company,
                order_index=order_index,
                amount=target_order.amount,
                price=target_order.price,
                is_available_on_alpaca=ladder.is_available_on_alpaca,
                status=target_order.status,
                order_id=target_order.order_id,
                asset_type=db_order.asset_type  # Preserve asset_type
            )
        
        # Invalidate cache
        manager._invalidate_ladders_cache()
        
        logger.info(f"Edited GTT order: {symbol} Order {order_index + 1} - Price: ${target_order.price:.2f}, Amount: {target_order.amount}")
        
        return jsonify({
            "success": True,
            "message": f"Order {order_index + 1} for {symbol} updated successfully",
            "symbol": symbol,
            "order_index": order_index,
            "order_num": order_index + 1,
            "price": target_order.price,
            "amount": target_order.amount,
            "status": target_order.status
        })
    except Exception as e:
        logger.error(f"Error editing GTT order: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/chart/<symbol>', methods=['GET'])
@require_auth
def get_chart_data(symbol: str):
    """Get historical bar data for a symbol
    
    Query parameters:
    - timeframe: 1D, 1W, 1M, 3M, 6M, 1Y, MAX (default: 1M)
    """
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        symbol = symbol.upper()
        timeframe_str = request.args.get('timeframe', '1M').upper()
        
        # Map timeframe strings to TimeFrame and start date
        timeframe_map = {
            '1D': (TimeFrame.Minute, timedelta(days=1)),
            '1W': (TimeFrame.Hour, timedelta(weeks=1)),
            '1M': (TimeFrame.Day, timedelta(days=30)),
            '3M': (TimeFrame.Day, timedelta(days=90)),
            '6M': (TimeFrame.Day, timedelta(days=180)),
            '1Y': (TimeFrame.Day, timedelta(days=365)),
            'MAX': (TimeFrame.Day, None),  # No limit for MAX
        }
        
        if timeframe_str not in timeframe_map:
            return jsonify({"error": f"Invalid timeframe. Must be one of: {', '.join(timeframe_map.keys())}"}), 400
        
        timeframe, delta = timeframe_map[timeframe_str]
        
        # Calculate start date
        if delta:
            start_date = datetime.now() - delta
        else:
            # For MAX, use a very old date (Alpaca's historical data goes back several years)
            start_date = datetime(2020, 1, 1)
        
        # Determine asset type from manager ladders
        asset_type = 'stock'  # Default to stock
        chart_symbol = symbol  # Symbol to use for chart API
        
        if symbol in manager.ladders:
            ladder = manager.ladders[symbol]
            asset_type = ladder.asset_type
            # For crypto, use symbol/USD format for chart API
            if asset_type == 'crypto' and not symbol.endswith('/USD'):
                chart_symbol = f"{symbol}/USD"
        
        # Create request based on asset type
        if asset_type == 'crypto':
            request_params = CryptoBarsRequest(
                symbol_or_symbols=[chart_symbol],
                timeframe=timeframe,
                start=start_date
            )
            # Fetch crypto bars
            bars = manager.crypto_data_client.get_crypto_bars(request_params)
        else:
            request_params = StockBarsRequest(
                symbol_or_symbols=[chart_symbol],
                timeframe=timeframe,
                start=start_date
            )
            # Fetch stock bars
            bars = manager.data_client.get_stock_bars(request_params)
        
        # Convert to list of dicts for JSON serialization
        bars_data = []
        if bars and hasattr(bars, 'data') and chart_symbol in bars.data:
            for bar in bars.data[chart_symbol]:
                bars_data.append({
                    "timestamp": bar.timestamp.isoformat() if hasattr(bar.timestamp, 'isoformat') else str(bar.timestamp),
                    "open": float(bar.open) if bar.open else 0,
                    "high": float(bar.high) if bar.high else 0,
                    "low": float(bar.low) if bar.low else 0,
                    "close": float(bar.close) if bar.close else 0,
                    "volume": int(bar.volume) if bar.volume else 0,
                })
        
        # Get GTT orders for this symbol
        gtt_orders_for_symbol = []
        if symbol in manager.ladders:
            ladder = manager.ladders[symbol]
            # Get Alpaca orders for this symbol to get timestamps
            symbol_alpaca_orders = {}
            try:
                # Fetch orders for this symbol from Alpaca - include ALL statuses to get filled orders
                from alpaca.trading.enums import QueryOrderStatus
                orders_request = GetOrdersRequest(status=QueryOrderStatus.ALL, limit=500)  # Get more orders to include filled ones
                alpaca_orders = manager.trading_client.get_orders(orders_request)
                for order in alpaca_orders:
                    # Normalize symbol for matching (handle crypto symbol format differences)
                    order_symbol = order.symbol
                    normalized_order_symbol = order_symbol.replace('/USD', '') if '/USD' in order_symbol else order_symbol
                    if normalized_order_symbol == symbol:
                        symbol_alpaca_orders[order.id] = {
                            'status': order.status.value if hasattr(order.status, 'value') else str(order.status),
                            'updated_at': order.updated_at.isoformat() if hasattr(order.updated_at, 'isoformat') else str(order.updated_at) if hasattr(order, 'updated_at') else None,
                            'filled_at': order.filled_at.isoformat() if hasattr(order, 'filled_at') and order.filled_at and hasattr(order.filled_at, 'isoformat') else (str(order.filled_at) if hasattr(order, 'filled_at') and order.filled_at else None),
                            'canceled_at': order.canceled_at.isoformat() if hasattr(order, 'canceled_at') and order.canceled_at and hasattr(order.canceled_at, 'isoformat') else (str(order.canceled_at) if hasattr(order, 'canceled_at') and order.canceled_at else None),
                        }
            except Exception as e:
                logger.debug(f"Error processing Alpaca orders for chart {symbol}: {e}")
            
            for idx, order in enumerate(ladder.orders):
                display_status = order.status
                order_timestamp = None
                
                # Get timestamp based on status
                if order.order_id and order.order_id in symbol_alpaca_orders:
                    alpaca_order_info = symbol_alpaca_orders[order.order_id]
                    display_status = alpaca_order_info['status']
                    # Use filled_at if filled, canceled_at if cancelled, updated_at otherwise
                    if display_status.lower() == 'filled' and alpaca_order_info.get('filled_at'):
                        order_timestamp = alpaca_order_info['filled_at']
                    elif display_status.lower() in ['cancelled', 'canceled', 'expired', 'rejected'] and alpaca_order_info.get('canceled_at'):
                        order_timestamp = alpaca_order_info['canceled_at']
                    elif alpaca_order_info.get('updated_at'):
                        order_timestamp = alpaca_order_info['updated_at']
                elif order.order_id:
                    # Try to get order from Alpaca
                    try:
                        alpaca_order = manager.trading_client.get_order_by_id(order.order_id)
                        display_status = alpaca_order.status.value if hasattr(alpaca_order.status, 'value') else str(alpaca_order.status)
                        if display_status.lower() == 'filled' and hasattr(alpaca_order, 'filled_at') and alpaca_order.filled_at:
                            order_timestamp = alpaca_order.filled_at.isoformat() if hasattr(alpaca_order.filled_at, 'isoformat') else str(alpaca_order.filled_at)
                        elif display_status.lower() in ['cancelled', 'canceled', 'expired', 'rejected'] and hasattr(alpaca_order, 'canceled_at') and alpaca_order.canceled_at:
                            order_timestamp = alpaca_order.canceled_at.isoformat() if hasattr(alpaca_order.canceled_at, 'isoformat') else str(alpaca_order.canceled_at)
                        elif hasattr(alpaca_order, 'updated_at') and alpaca_order.updated_at:
                            order_timestamp = alpaca_order.updated_at.isoformat() if hasattr(alpaca_order.updated_at, 'isoformat') else str(alpaca_order.updated_at)
                    except Exception:
                        pass
                
                # If no timestamp yet, use created_at from when order was placed (if we track it)
                # For pending orders, we don't have a timestamp yet
                if not order_timestamp and order.order_id:
                    # Use current time as fallback for placed orders without timestamp
                    order_timestamp = datetime.now().isoformat()
                
                gtt_orders_for_symbol.append({
                    "order_index": idx + 1,
                    "price": order.price,
                    "status": display_status.lower(),
                    "order_id": order.order_id,
                    "timestamp": order_timestamp,
                    "is_current": idx == ladder.current_order_index,
                })
        
        return jsonify({
            "symbol": symbol,
            "timeframe": timeframe_str,
            "bars": bars_data,
            "gtt_orders": gtt_orders_for_symbol,
            "count": len(bars_data)
        })
    except Exception as e:
        logger.error(f"Error fetching chart data for {symbol}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/sync-filled-orders', methods=['POST'])
@require_auth
def sync_filled_orders():
    """
    One-time sync: Match all filled orders from Alpaca with GTT orders and update database.
    This fixes cases where orders were filled but the database wasn't updated.
    """
    logger.info("POST /api/sync-filled-orders - Request received")
    if not manager:
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        result = manager.sync_filled_orders_from_alpaca()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error syncing filled orders: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    # This will be run separately from the monitor
    api_port = int(os.getenv('PORT_API', '8080'))
    logger.info(f"Starting Flask API server on port {api_port}")
    app.run(host='0.0.0.0', port=api_port, debug=True)

