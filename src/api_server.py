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
from alpaca.data.requests import StockBarsRequest
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
            symbol_alpaca_orders = {}
            try:
                for order in alpaca_orders_list:
                    if order.symbol == symbol:
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
                
                order_request = LimitOrderRequest(
                    symbol=symbol,
                    qty=target_order.amount,
                    side=OrderSide.BUY,
                    limit_price=target_order.price,
                    time_in_force=TimeInForce.GTC  # Good Till Cancelled - order stays active until filled or manually cancelled
                )
                
                placed_order = manager.trading_client.submit_order(order_data=order_request)
                target_order.order_id = placed_order.id
                target_order.status = "placed"
                
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
                
                order_request = LimitOrderRequest(
                    symbol=symbol,
                    qty=current_order.amount,
                    side=OrderSide.BUY,
                    limit_price=current_order.price,
                    time_in_force=TimeInForce.GTC  # Good Till Cancelled - order stays active until filled or manually cancelled
                )
                
                placed_order = manager.trading_client.submit_order(order_data=order_request)
                current_order.order_id = placed_order.id
                current_order.status = "placed"
                
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
        logger.info(f"SIMULATED FILL: {symbol} Order {ladder.current_order_index + 1} marked as filled")
        
        # Advance to next order
        ladder.advance_to_next_order()
        
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
            for order in ladder.orders:
                if order.status != "pending":
                    order.status = "pending"
                    order.order_id = None
                    reset_count += 1
            # Reset to first order
            ladder.current_order_index = 0
        
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
        if order_index is not None:
            if order_index < 0 or order_index >= len(ladder.orders):
                return jsonify({"error": f"Invalid order_index. Must be between 0 and {len(ladder.orders) - 1}"}), 400
            target_order = ladder.orders[order_index]
            target_order_num = order_index + 1
        else:
            # Use current order
            target_order = ladder.get_current_order()
            if not target_order:
                return jsonify({"error": f"No current order for {symbol}. All orders may be completed."}), 400
            target_order_num = ladder.current_order_index + 1
        
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
        
        # Log if we're resetting an order that had an Alpaca order_id
        if old_order_id:
            logger.info(f"Re-instating order {target_order_num} for {symbol} that was previously placed on Alpaca "
                       f"(old Order ID: {old_order_id}). Old order remains in cancelled orders table. "
                       f"New order will get a new order_id when placed.")
        
        # If this was not the current order, we may need to adjust the current_order_index
        if order_index is not None and order_index < ladder.current_order_index:
            # Re-instate an earlier order - reset to that order
            ladder.current_order_index = order_index
            logger.info(f"Re-instated order {target_order_num} for {symbol} and reset current_order_index to {order_index}")
        else:
            logger.info(f"Re-instated order {target_order_num} for {symbol} (status: {old_status} -> pending)")
        
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
            "order_index": order_index if order_index is not None else ladder.current_order_index,
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
        
        # Create request
        request_params = StockBarsRequest(
            symbol_or_symbols=[symbol],
            timeframe=timeframe,
            start=start_date
        )
        
        # Fetch bars
        bars = manager.data_client.get_stock_bars(request_params)
        
        # Convert to list of dicts for JSON serialization
        bars_data = []
        if bars and hasattr(bars, 'data') and symbol in bars.data:
            for bar in bars.data[symbol]:
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
                    if order.symbol == symbol:
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


if __name__ == '__main__':
    # This will be run separately from the monitor
    api_port = int(os.getenv('PORT_API', '8080'))
    logger.info(f"Starting Flask API server on port {api_port}")
    app.run(host='0.0.0.0', port=api_port, debug=True)

