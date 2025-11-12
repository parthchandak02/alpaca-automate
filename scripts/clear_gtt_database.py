#!/usr/bin/env python3
"""
Clear all GTT orders from the database
This script deletes all orders from gtt_orders and completed_orders tables.
"""

import sys
import os

# Add parent directory to path to import src modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.database import GTTOrderDatabase
import sqlite3

def clear_all_gtt_orders():
    """Delete all GTT orders from the database"""
    db = GTTOrderDatabase()
    
    print("Clearing all GTT orders from database...")
    print(f"Database path: {db.db_path}")
    
    with db.get_connection() as conn:
        cursor = conn.cursor()
        
        # Get count before deletion
        cursor.execute("SELECT COUNT(*) FROM gtt_orders")
        gtt_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM completed_orders")
        completed_count = cursor.fetchone()[0]
        
        print(f"Found {gtt_count} GTT orders and {completed_count} completed order links")
        
        if gtt_count == 0 and completed_count == 0:
            print("Database is already empty. Nothing to delete.")
            return
        
        # Delete all completed orders first (due to foreign key constraint)
        cursor.execute("DELETE FROM completed_orders")
        print(f"Deleted {completed_count} completed order links")
        
        # Delete all GTT orders
        cursor.execute("DELETE FROM gtt_orders")
        print(f"Deleted {gtt_count} GTT orders")
        
        # Delete all symbol metadata
        cursor.execute("DELETE FROM symbol_metadata")
        print("Deleted all symbol metadata")
        
        conn.commit()
        
        # Verify deletion
        cursor.execute("SELECT COUNT(*) FROM gtt_orders")
        remaining_gtt = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM completed_orders")
        remaining_completed = cursor.fetchone()[0]
        
        if remaining_gtt == 0 and remaining_completed == 0:
            print("\n✓ Successfully cleared all GTT orders from database!")
            print("You can now upload fresh CSV files with 2 stocks and 2 crypto.")
        else:
            print(f"\n⚠ Warning: {remaining_gtt} GTT orders and {remaining_completed} completed orders still remain")

if __name__ == "__main__":
    try:
        clear_all_gtt_orders()
    except Exception as e:
        print(f"Error clearing database: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)




