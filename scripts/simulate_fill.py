#!/usr/bin/env python3
"""
Simple script to simulate an order being filled for testing purposes.
This manually marks an order as filled to test the next-order logic.
"""

import os
import sys
from dotenv import load_dotenv

# Add project root to path to import from src
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

load_dotenv()

from src.gtt_monitor import GTTOrderManager

def simulate_order_fill(manager: GTTOrderManager, symbol: str):
    """Simulate an order being filled by checking Alpaca and marking it filled"""
    
    if symbol not in manager.ladders:
        print(f"❌ Symbol '{symbol}' not found in loaded orders")
        print(f"Available symbols: {list(manager.ladders.keys())}")
        return False
    
    ladder = manager.ladders[symbol]
    current_order = ladder.get_current_order()
    
    if not current_order:
        print(f"❌ No current order for {symbol}. All orders may be completed.")
        return False
    
    if current_order.status == "pending":
        print(f"❌ Order for {symbol} is still pending (not placed yet).")
        print(f"   Current order: {ladder.current_order_index + 1}/{len(ladder.orders)}")
        print(f"   Trigger price: ${current_order.price:.2f}")
        print(f"   Status: {current_order.status}")
        print(f"\n💡 Tip: Run 'uv run python manual_place.py {symbol}' to place it first")
        return False
    
    if current_order.status == "filled":
        print(f"⚠️  Order for {symbol} is already filled.")
        return False
    
    # Check if we have an order ID - if not, try to find it from Alpaca
    if not current_order.order_id:
        print(f"⚠️  No order ID found. Checking Alpaca for active orders...")
        try:
            from alpaca.trading.requests import GetOrdersRequest
            orders = manager.trading_client.get_orders(GetOrdersRequest(limit=100))
            for order in orders:
                if order.symbol == symbol and order.status.value in ['new', 'accepted', 'pending_new', 'pending_replace', 'accepted_for_bidding', 'stopped', 'suspended', 'filled', 'canceled', 'expired', 'pending_cancel', 'pending_replace']:
                    if order.status.value == 'filled':
                        print(f"✅ Found filled order in Alpaca: {order.id}")
                        current_order.order_id = order.id
                        current_order.status = "filled"
                        ladder.advance_to_next_order()
                        print(f"✅ Advanced to next order!")
                        return True
                    elif order.limit_price == current_order.price:
                        print(f"📋 Found matching order: {order.id} (Status: {order.status.value})")
                        current_order.order_id = order.id
                        # Check if it's filled
                        if order.status.value == 'filled':
                            current_order.status = "filled"
                            ladder.advance_to_next_order()
                            print(f"✅ Order was already filled! Advanced to next order.")
                            return True
        except Exception as e:
            print(f"⚠️  Error checking Alpaca: {e}")
    
    if not current_order.order_id:
        print(f"❌ Cannot simulate fill without order ID")
        return False
    
    # Check actual order status from Alpaca first
    print(f"\n🔍 Checking order status from Alpaca...")
    actual_status = manager._check_order_status(current_order.order_id)
    
    if actual_status == "filled":
        print(f"✅ Order is already FILLED in Alpaca!")
        current_order.status = "filled"
        ladder.advance_to_next_order()
        print(f"✅ Advanced to next order: {ladder.current_order_index + 1}/{len(ladder.orders)}")
        return True
    
    # Simulate fill: mark as filled and advance
    print(f"\n🧪 SIMULATING ORDER FILL:")
    print(f"   Symbol: {symbol}")
    print(f"   Order: {ladder.current_order_index + 1}/{len(ladder.orders)}")
    print(f"   Price: ${current_order.price:.2f}")
    print(f"   Amount: {current_order.amount}")
    print(f"   Order ID: {current_order.order_id}")
    print(f"   Current Alpaca Status: {actual_status or 'unknown'}")
    
    # Mark as filled
    current_order.status = "filled"
    
    # Advance to next order
    ladder.advance_to_next_order()
    
    print(f"\n✅ Order marked as FILLED (simulated)")
    print(f"✅ Advanced to next order: {ladder.current_order_index + 1}/{len(ladder.orders)}")
    print(f"\n⚠️  Note: This is a simulation. The running monitor will detect the real status.")
    print(f"   To actually fill: Cancel this order in Alpaca dashboard or wait for natural fill.")
    
    next_order = ladder.get_current_order()
    if next_order:
        print(f"\n📋 Next order ready:")
        print(f"   Trigger price: ${next_order.price:.2f}")
        print(f"   Amount: {next_order.amount}")
        print(f"   Status: {next_order.status}")
    else:
        print(f"\n🎉 All orders completed for {symbol}!")
    
    return True


def main():
    """Main function"""
    api_key = os.getenv('ALPACA_API_KEY')
    secret_key = os.getenv('ALPACA_SECRET_KEY')
    paper = os.getenv('ALPACA_PAPER', 'true').lower() == 'true'
    
    if not api_key or not secret_key:
        print("❌ ERROR: ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env file")
        return
    
    # Initialize manager
    manager = GTTOrderManager(api_key, secret_key, paper=paper)
    
    # Load orders (use test CSV)
    use_test_csv = os.getenv('USE_TEST_CSV', 'true').lower() == 'true'
    data_dir = os.path.join(project_root, 'data')
    csv_file = os.path.join(data_dir, 'trapezoid-stocks-test.csv' if use_test_csv else 'trapezoid-stocks.csv')
    
    if os.path.exists(csv_file):
        manager.load_orders_from_csv(csv_file)
    else:
        print(f"❌ CSV file not found: {csv_file}")
        return
    
    if len(manager.ladders) == 0:
        print("❌ No orders loaded")
        return
    
    # Get symbol from command line or use first available
    if len(sys.argv) > 1:
        symbol = sys.argv[1].upper()
    else:
        # Use first symbol with a placed order
        symbol = None
        for sym, ladder in manager.ladders.items():
            current_order = ladder.get_current_order()
            if current_order and current_order.status == "placed":
                symbol = sym
                break
        
        if not symbol:
            # Just use first symbol
            symbol = list(manager.ladders.keys())[0]
            print(f"⚠️  No placed orders found. Using first symbol: {symbol}")
            print(f"   Note: You need to place an order first (wait for trigger or manually place)")
    
    print(f"\n{'='*60}")
    print(f"SIMULATE ORDER FILL")
    print(f"{'='*60}\n")
    
    success = simulate_order_fill(manager, symbol)
    
    if success:
        print(f"\n{'='*60}")
        print("✅ Simulation complete!")
        print("The monitor will detect this on its next check cycle.")
        print(f"{'='*60}\n")


if __name__ == '__main__':
    main()

