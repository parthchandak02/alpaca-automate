#!/usr/bin/env python3
"""
Manually place an order for testing purposes.
This places the current pending order immediately (bypassing trigger check).
"""

import os
import sys
from dotenv import load_dotenv

# Add project root to path to import from src
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

load_dotenv()

from src.gtt_monitor import GTTOrderManager

def manually_place_order(manager: GTTOrderManager, symbol: str):
    """Manually place the current pending order (for testing)"""
    
    if symbol not in manager.ladders:
        print(f"❌ Symbol '{symbol}' not found in loaded orders")
        print(f"Available symbols: {list(manager.ladders.keys())}")
        return False
    
    ladder = manager.ladders[symbol]
    current_order = ladder.get_current_order()
    
    if not current_order:
        print(f"❌ No current order for {symbol}. All orders may be completed.")
        return False
    
    if current_order.status != "pending":
        print(f"⚠️  Order for {symbol} is already {current_order.status}.")
        print(f"   Order ID: {current_order.order_id or 'N/A'}")
        return False
    
    print(f"\n🧪 MANUALLY PLACING ORDER:")
    print(f"   Symbol: {symbol}")
    print(f"   Order: {ladder.current_order_index + 1}/{len(ladder.orders)}")
    print(f"   Price: ${current_order.price:.2f}")
    print(f"   Amount: {current_order.amount}")
    
    # Manually trigger order placement
    manager._place_order(ladder, current_order, symbol)
    
    if current_order.status == "placed":
        print(f"\n✅ Order placed successfully!")
        print(f"   Order ID: {current_order.order_id}")
        print(f"\n💡 Now you can:")
        print(f"   1. Fill it manually in Alpaca dashboard")
        print(f"   2. Or run: uv run python simulate_fill.py {symbol}")
        return True
    else:
        print(f"\n❌ Failed to place order. Status: {current_order.status}")
        return False


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
        # Use first symbol
        symbol = list(manager.ladders.keys())[0]
        print(f"Using first symbol: {symbol}")
    
    print(f"\n{'='*60}")
    print(f"MANUALLY PLACE ORDER")
    print(f"{'='*60}\n")
    
    success = manually_place_order(manager, symbol)
    
    if success:
        print(f"\n{'='*60}")
        print("✅ Order placed! Monitor will check fill status automatically.")
        print(f"{'='*60}\n")


if __name__ == '__main__':
    main()

