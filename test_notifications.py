#!/usr/bin/env python3
"""
Test script for notification system
Tests each notification type individually
"""

import sys
import os
from datetime import datetime, timedelta
import pytz

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from dotenv import load_dotenv
load_dotenv()

from src.gtt_monitor import GTTOrderManager
from src.notifications import NotificationManager

def test_email_config():
    """Test if email is configured"""
    enabled = os.getenv('EMAIL_NOTIFICATIONS_ENABLED', 'false').lower() == 'true'
    smtp_server = os.getenv('SMTP_SERVER')
    smtp_username = os.getenv('SMTP_USERNAME')
    email_to = os.getenv('EMAIL_TO')
    
    print("=" * 60)
    print("EMAIL CONFIGURATION CHECK")
    print("=" * 60)
    print(f"Email Notifications Enabled: {enabled}")
    print(f"SMTP Server: {smtp_server}")
    print(f"SMTP Username: {smtp_username}")
    print(f"Email Recipients: {email_to}")
    print("=" * 60)
    
    if not enabled:
        print("⚠️  Email notifications are disabled. Set EMAIL_NOTIFICATIONS_ENABLED=true in .env")
        return False
    
    if not all([smtp_server, smtp_username, email_to]):
        print("⚠️  Missing email configuration. Check .env file")
        return False
    
    print("✅ Email configuration looks good!")
    return True

def test_notification_1_order_placed(manager):
    """Test 1: Order placed notification"""
    print("\n" + "=" * 60)
    print("TEST 1: Order Placed Notification")
    print("=" * 60)
    
    try:
        manager._send_email_notification(
            title="🧪 TEST: Order Placed",
            description="This is a test notification for order placement.",
            fields=[
                {"name": "Symbol", "value": "TEST", "inline": True},
                {"name": "Order Number", "value": "1", "inline": True},
                {"name": "Price", "value": "$100.00", "inline": True},
                {"name": "Quantity", "value": "10 shares", "inline": True},
                {"name": "Status", "value": "Placed", "inline": False}
            ],
            footer_text="Test Notification • " + datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        )
        print("✅ Order placed notification sent successfully!")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def test_notification_2_order_filled(manager):
    """Test 2: Order filled notification"""
    print("\n" + "=" * 60)
    print("TEST 2: Order Filled Notification")
    print("=" * 60)
    
    try:
        manager._send_email_notification(
            title="🧪 TEST: Order Filled",
            description="This is a test notification for order execution.",
            fields=[
                {"name": "Symbol", "value": "TEST", "inline": True},
                {"name": "Order Number", "value": "1", "inline": True},
                {"name": "Fill Price", "value": "$100.50", "inline": True},
                {"name": "Quantity", "value": "10 shares", "inline": True},
                {"name": "Total Value", "value": "$1,005.00", "inline": False}
            ],
            footer_text="Test Notification • " + datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        )
        print("✅ Order filled notification sent successfully!")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def test_notification_3_order_cancelled(manager):
    """Test 3: Order cancelled notification"""
    print("\n" + "=" * 60)
    print("TEST 3: Order Cancelled Notification")
    print("=" * 60)
    
    try:
        manager._send_email_notification(
            title="🧪 TEST: Order Cancelled",
            description="This is a test notification for order cancellation.",
            fields=[
                {"name": "Symbol", "value": "TEST", "inline": True},
                {"name": "Order Number", "value": "2", "inline": True},
                {"name": "Reason", "value": "Cancelled", "inline": True},
                {"name": "Status", "value": "Order was cancelled", "inline": False}
            ],
            footer_text="Test Notification • " + datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        )
        print("✅ Order cancelled notification sent successfully!")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def test_notification_4_insufficient_buying_power(manager):
    """Test 4: Insufficient buying power notification"""
    print("\n" + "=" * 60)
    print("TEST 4: Insufficient Buying Power Notification")
    print("=" * 60)
    
    try:
        manager._send_email_notification(
            title="🧪 TEST: Insufficient Buying Power",
            description="This is a test notification for insufficient buying power.",
            fields=[
                {"name": "Symbol", "value": "TEST", "inline": True},
                {"name": "Required", "value": "$5,000.00", "inline": True},
                {"name": "Available", "value": "$2,500.00", "inline": True},
                {"name": "Shortfall", "value": "$2,500.00", "inline": False},
                {"name": "Action", "value": "Order not placed. Please add funds.", "inline": False}
            ],
            footer_text="Test Notification • " + datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        )
        print("✅ Insufficient buying power notification sent successfully!")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def test_notification_5_csv_change(manager):
    """Test 5: CSV change notification"""
    print("\n" + "=" * 60)
    print("TEST 5: CSV Change Notification")
    print("=" * 60)
    
    try:
        changes = {
            'added': [{
                'symbol': 'TEST',
                'company': 'Test Company',
                'orders': [{'order_num': 1, 'amount': '10', 'price': '100.00'}]
            }],
            'removed': [],
            'modified': [{
                'symbol': 'AAPL',
                'company': 'Apple Inc.',
                'added_orders': [],
                'removed_orders': [],
                'modified_orders': [{
                    'order_num': 2,
                    'old': {'order_num': 2, 'amount': '5', 'price': '150.00'},
                    'new': {'order_num': 2, 'amount': '10', 'price': '150.00'}
                }]
            }]
        }
        
        manager.notification_manager.send_csv_change_notification('test-gtt-orders.csv', changes)
        print("✅ CSV change notification sent successfully!")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_notification_6_daily_summary(manager):
    """Test 6: Daily summary notification"""
    print("\n" + "=" * 60)
    print("TEST 6: Daily Summary Notification")
    print("=" * 60)
    
    try:
        # Add some test activity
        yesterday = datetime.now() - timedelta(days=1)
        manager.notification_manager.record_order_activity(
            symbol='TEST',
            company='Test Company',
            order_num=1,
            action='placed',
            price=100.00,
            amount=10,
            order_id='test-123'
        )
        manager.notification_manager.record_order_activity(
            symbol='TEST',
            company='Test Company',
            order_num=1,
            action='filled',
            price=100.50,
            amount=10,
            order_id='test-123'
        )
        
        # Send summary for yesterday
        manager.notification_manager.send_daily_summary(yesterday)
        print("✅ Daily summary notification sent successfully!")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_notification_7_weekly_summary(manager):
    """Test 7: Weekly summary notification"""
    print("\n" + "=" * 60)
    print("TEST 7: Weekly Summary Notification")
    print("=" * 60)
    
    try:
        # Add some test activity for the week
        week_start = datetime.now() - timedelta(days=7)
        for i in range(3):
            day = week_start + timedelta(days=i)
            manager.notification_manager.record_order_activity(
                symbol=f'TEST{i}',
                company=f'Test Company {i}',
                order_num=1,
                action='placed',
                price=100.00 + i,
                amount=10,
                order_id=f'test-{i}',
                details={'timestamp': day}
            )
        
        # Send weekly summary
        manager.notification_manager.send_weekly_summary(week_start)
        print("✅ Weekly summary notification sent successfully!")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run all notification tests"""
    print("\n" + "=" * 60)
    print("NOTIFICATION SYSTEM TEST SUITE")
    print("=" * 60)
    
    # Check email config
    if not test_email_config():
        print("\n⚠️  Cannot proceed without email configuration. Please configure .env file.")
        return
    
    # Initialize manager (we don't need real API keys for testing notifications)
    api_key = os.getenv('ALPACA_API_KEY', 'test-key')
    secret_key = os.getenv('ALPACA_SECRET_KEY', 'test-secret')
    paper = True
    
    try:
        manager = GTTOrderManager(api_key, secret_key, paper=paper)
        
        results = []
        
        # Test each notification type
        results.append(("Order Placed", test_notification_1_order_placed(manager)))
        results.append(("Order Filled", test_notification_2_order_filled(manager)))
        results.append(("Order Cancelled", test_notification_3_order_cancelled(manager)))
        results.append(("Insufficient Buying Power", test_notification_4_insufficient_buying_power(manager)))
        results.append(("CSV Change", test_notification_5_csv_change(manager)))
        results.append(("Daily Summary", test_notification_6_daily_summary(manager)))
        results.append(("Weekly Summary", test_notification_7_weekly_summary(manager)))
        
        # Print summary
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        for name, success in results:
            status = "✅ PASS" if success else "❌ FAIL"
            print(f"{status}: {name}")
        
        total = len(results)
        passed = sum(1 for _, success in results if success)
        print(f"\nTotal: {total} | Passed: {passed} | Failed: {total - passed}")
        print("=" * 60)
        
        if passed == total:
            print("\n🎉 All notification tests passed!")
        else:
            print(f"\n⚠️  {total - passed} test(s) failed. Check errors above.")
            
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()

