#!/usr/bin/env python3
"""
Place test orders for EWT with limit prices above current market price ($64.61)
This creates 4-5 test orders that can execute normally
"""

import os
import sys
from dotenv import load_dotenv

# Add project root to path to import from src
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

load_dotenv()

from src.gtt_monitor import GTTOrderManager
from alpaca.trading.requests import LimitOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from rich.console import Console

console = Console()

def place_test_orders_ewt():
    """Place test orders for EWT above current price"""
    api_key = os.getenv('ALPACA_API_KEY')
    secret_key = os.getenv('ALPACA_SECRET_KEY')
    paper = os.getenv('ALPACA_PAPER', 'true').lower() == 'true'
    
    if not api_key or not secret_key:
        console.print("❌ ERROR: ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env file")
        return
    
    # Initialize manager
    manager = GTTOrderManager(api_key, secret_key, paper=paper)
    
    # Test orders: prices above $64.61 (current market price)
    # We'll place at $65, $66, $67, $68, $69
    test_orders = [
        {"amount": 1, "price": 65.00},
        {"amount": 2, "price": 66.00},
        {"amount": 3, "price": 67.00},
        {"amount": 5, "price": 68.00},
        {"amount": 8, "price": 69.00},
    ]
    
    symbol = "EWT"
    current_price = 64.61
    
    console.print(f"\n{'='*60}")
    console.print(f"PLACING TEST ORDERS FOR {symbol}")
    console.print(f"{'='*60}\n")
    console.print(f"Current Market Price: [yellow]${current_price:.2f}[/yellow]")
    console.print(f"Placing {len(test_orders)} limit orders ABOVE current price:\n")
    
    placed_orders = []
    errors = []
    
    for i, order_data in enumerate(test_orders, 1):
        try:
            console.print(f"[{i}/{len(test_orders)}] Placing Order #{i}: "
                         f"[cyan]{order_data['amount']}[/cyan] shares @ "
                         f"[yellow]${order_data['price']:.2f}[/yellow]")
            
            order_request = LimitOrderRequest(
                symbol=symbol,
                qty=order_data['amount'],
                side=OrderSide.BUY,
                limit_price=order_data['price'],
                time_in_force=TimeInForce.GTC  # Good Till Cancelled - order stays active until filled or manually cancelled
            )
            
            placed_order = manager.trading_client.submit_order(order_data=order_request)
            placed_orders.append({
                "order_id": placed_order.id,
                "amount": order_data['amount'],
                "price": order_data['price'],
            })
            
            console.print(f"  ✅ Placed! Order ID: [dim]{placed_order.id}[/dim]\n")
            
        except Exception as e:
            error_msg = f"Failed to place Order #{i}: {e}"
            console.print(f"  ❌ {error_msg}\n")
            errors.append(error_msg)
    
    console.print(f"{'='*60}")
    console.print(f"SUMMARY")
    console.print(f"{'='*60}")
    console.print(f"✅ Successfully placed: [green]{len(placed_orders)}[/green] orders")
    if errors:
        console.print(f"❌ Errors: [red]{len(errors)}[/red]")
        for error in errors:
            console.print(f"   - {error}")
    
    console.print(f"\n💡 These orders are ABOVE current price (${current_price:.2f})")
    console.print(f"   They will execute when price rises to their limit prices.")
    console.print(f"{'='*60}\n")
    
    return len(placed_orders) > 0


if __name__ == '__main__':
    place_test_orders_ewt()

