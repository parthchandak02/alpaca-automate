#!/usr/bin/env python3
"""
Manual notification sender script

Usage:
    # Send daily summary for yesterday
    python scripts/send_notifications.py daily

    # Send daily summary for specific date
    python scripts/send_notifications.py daily --date 2025-11-09

    # Send weekly summary for last week
    python scripts/send_notifications.py weekly

    # Send weekly summary for specific week (Monday date)
    python scripts/send_notifications.py weekly --week-start 2025-11-03

    # Send test email
    python scripts/send_notifications.py test
"""

import sys
import os
from datetime import datetime
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv()

from src.gtt_monitor import GTTOrderManager
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.live import StockDataStream
import argparse


def get_manager():
    """Initialize and return GTTOrderManager"""
    api_key = os.getenv('ALPACA_API_KEY')
    secret_key = os.getenv('ALPACA_SECRET_KEY')
    paper = os.getenv('ALPACA_PAPER', 'true').lower() == 'true'
    
    if not api_key or not secret_key:
        print("ERROR: ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in .env file")
        sys.exit(1)
    
    trading_base_url = os.getenv('ALPACA_TRADING_API_URL')
    data_base_url = os.getenv('ALPACA_DATA_API_URL')
    
    manager = GTTOrderManager(
        api_key=api_key,
        secret_key=secret_key,
        paper=paper,
        trading_base_url=trading_base_url,
        data_base_url=data_base_url
    )
    
    return manager


def send_daily_summary(manager, date_str=None):
    """Send daily summary email"""
    if date_str:
        try:
            target_date = datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            print(f"ERROR: Invalid date format '{date_str}'. Use YYYY-MM-DD")
            sys.exit(1)
    else:
        target_date = None  # Will default to yesterday
    
    print(f"Sending daily summary email...")
    if target_date:
        print(f"  Date: {target_date.strftime('%Y-%m-%d')}")
    else:
        print(f"  Date: Yesterday (default)")
    
    try:
        manager.notification_manager.send_daily_summary(target_date)
        date_display = target_date.strftime('%Y-%m-%d') if target_date else "yesterday"
        print(f"✅ Daily summary email sent for {date_display}")
    except Exception as e:
        print(f"❌ Error sending daily summary: {e}")
        sys.exit(1)


def send_weekly_summary(manager, week_start_str=None):
    """Send weekly summary email"""
    if week_start_str:
        try:
            week_start = datetime.strptime(week_start_str, '%Y-%m-%d')
            week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
        except ValueError:
            print(f"ERROR: Invalid date format '{week_start_str}'. Use YYYY-MM-DD")
            sys.exit(1)
    else:
        week_start = None  # Will default to last week's Monday
    
    print(f"Sending weekly summary email...")
    if week_start:
        print(f"  Week starting: {week_start.strftime('%Y-%m-%d')}")
    else:
        print(f"  Week: Last week (default)")
    
    try:
        manager.notification_manager.send_weekly_summary(week_start)
        week_display = week_start.strftime('%Y-%m-%d') if week_start else "last week"
        print(f"✅ Weekly summary email sent for week starting {week_display}")
    except Exception as e:
        print(f"❌ Error sending weekly summary: {e}")
        sys.exit(1)


def send_test_email(manager):
    """Send test email"""
    print("Sending test email...")
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
        print("✅ Test email sent successfully. Check your inbox!")
    except Exception as e:
        print(f"❌ Error sending test email: {e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='Manually send email notifications')
    parser.add_argument('type', choices=['daily', 'weekly', 'test'], 
                       help='Type of notification to send')
    parser.add_argument('--date', type=str, 
                       help='Date for daily summary (YYYY-MM-DD), defaults to yesterday')
    parser.add_argument('--week-start', type=str, 
                       help='Week start date (Monday) for weekly summary (YYYY-MM-DD), defaults to last week')
    
    args = parser.parse_args()
    
    # Check email is enabled
    email_enabled = os.getenv('EMAIL_NOTIFICATIONS_ENABLED', 'false').lower() == 'true'
    if not email_enabled:
        print("⚠️  WARNING: EMAIL_NOTIFICATIONS_ENABLED is not set to 'true' in .env")
        print("   Email notifications are disabled. Enable them in .env first.")
        sys.exit(1)
    
    # Initialize manager
    print("Initializing manager...")
    manager = get_manager()
    print("✅ Manager initialized\n")
    
    # Send appropriate notification
    if args.type == 'daily':
        send_daily_summary(manager, args.date)
    elif args.type == 'weekly':
        send_weekly_summary(manager, args.week_start)
    elif args.type == 'test':
        send_test_email(manager)


if __name__ == '__main__':
    main()


