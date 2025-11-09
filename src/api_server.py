"""
Flask API server to expose GTT order data to the web UI
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import logging
from typing import Dict, List
from gtt_monitor import GTTOrderManager, SymbolLadder, SequentialOrder
from alpaca.trading.requests import GetOrdersRequest
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
CORS(app)  # Enable CORS for Next.js frontend

# Global manager instance (will be initialized by the monitor)
manager: GTTOrderManager = None


def set_manager(mgr: GTTOrderManager):
    """Set the global manager instance"""
    global manager
    manager = mgr


@app.route('/api/status', methods=['GET'])
def get_status():
    """Get current loading status and progress"""
    global loading_status
    return jsonify(loading_status)


@app.route('/api/orders', methods=['GET'])
def get_orders():
    """Get all orders (both active and GTT)"""
    logger.info("GET /api/orders - Request received")
    if not manager:
        logger.error("Manager not initialized")
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        set_loading_status(True, "Fetching orders from Alpaca", 0, 0, "", "Connecting to Alpaca API...")
        
        # Get active orders from Alpaca
        active_orders = []
        alpaca_orders_list = []
        try:
            set_loading_status(True, "Fetching orders from Alpaca", 1, 3, "", "Requesting orders from Alpaca...")
            # Use GetOrdersRequest for proper API usage
            if QueryOrderStatus:
                orders_request = GetOrdersRequest(status=QueryOrderStatus.ALL, limit=100)
            else:
                # Fallback: create request without status enum
                orders_request = GetOrdersRequest(limit=100)
            alpaca_orders_list = manager.trading_client.get_orders(orders_request)
            
            set_loading_status(True, "Processing Alpaca orders", 2, 3, "", f"Processing {len(alpaca_orders_list)} orders from Alpaca...")
            for order in alpaca_orders_list:
                active_orders.append({
                    "id": order.id,
                    "symbol": order.symbol,
                    "side": order.side.value if hasattr(order.side, 'value') else str(order.side),
                    "quantity": float(order.qty) if order.qty else 0,
                    "limit_price": float(order.limit_price) if order.limit_price else None,
                    "status": order.status.value if hasattr(order.status, 'value') else str(order.status),
                    "created_at": order.created_at.isoformat() if hasattr(order.created_at, 'isoformat') else str(order.created_at),
                    "filled_qty": float(order.filled_qty) if order.filled_qty else 0,
                })
            logger.info(f"Fetched {len(active_orders)} active orders from Alpaca")
        except Exception as e:
            logger.error(f"Error fetching active orders: {e}", exc_info=True)
        
        # Get GTT orders from ladders
        set_loading_status(True, "Processing GTT orders", 3, 4, "", f"Processing GTT orders for {len(manager.ladders)} symbols...")
        gtt_orders = []
        total_symbols = len(manager.ladders)
        processed = 0
        
        for symbol, ladder in manager.ladders.items():
            processed += 1
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
                })
        
        set_loading_status(False, "Complete", 4, 4, "", f"Loaded {len(gtt_orders)} GTT orders and {len(active_orders)} active orders")
        
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


@app.route('/api/simulate-fill', methods=['POST'])
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
                    time_in_force=TimeInForce.DAY
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
                    time_in_force=TimeInForce.DAY
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
def get_account():
    """Get account information"""
    logger.debug("GET /api/account - Request received")
    if not manager:
        logger.error("Manager not initialized")
        return jsonify({"error": "Manager not initialized"}), 503
    
    try:
        account = manager.trading_client.get_account()
        logger.debug("Account info retrieved successfully")
        return jsonify({
            "buying_power": float(account.buying_power),
            "cash": float(account.cash),
            "portfolio_value": float(account.portfolio_value),
            "equity": float(account.equity),
        })
    except Exception as e:
        logger.error(f"Error in get_account: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    # This will be run separately from the monitor
    api_port = int(os.getenv('PORT_API', '8080'))
    logger.info(f"Starting Flask API server on port {api_port}")
    app.run(host='0.0.0.0', port=api_port, debug=True)

