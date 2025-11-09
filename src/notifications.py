"""
Comprehensive notification system for Alpaca Trading Bot

Handles:
- Daily summary emails (9:30 AM EST)
- Weekly summary emails
- CSV change notifications with diff
- Order activity tracking for summaries
"""

import os
import csv
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict
import pytz

logger = logging.getLogger(__name__)

# Track order activity for daily/weekly summaries
@dataclass
class OrderActivity:
    """Track order activity for summaries"""
    symbol: str
    company: str
    order_num: int
    action: str  # 'placed', 'filled', 'cancelled', etc.
    timestamp: datetime
    price: float = 0.0
    amount: int = 0
    order_id: str = ""
    details: Dict = field(default_factory=dict)

class NotificationManager:
    """Manages all notifications including scheduled summaries"""
    
    def __init__(self, manager):
        self.manager = manager
        self.order_activity: List[OrderActivity] = []
        self.csv_snapshots: Dict[str, Dict] = {}  # filename -> snapshot of orders
        
    def record_order_activity(self, symbol: str, company: str, order_num: int, 
                             action: str, price: float = 0.0, amount: int = 0, 
                             order_id: str = "", details: Dict = None):
        """Record order activity for daily/weekly summaries"""
        activity = OrderActivity(
            symbol=symbol,
            company=company,
            order_num=order_num,
            action=action,
            timestamp=datetime.now(),
            price=price,
            amount=amount,
            order_id=order_id,
            details=details or {}
        )
        self.order_activity.append(activity)
        logger.debug(f"Recorded activity: {symbol} Order {order_num} - {action}")
        
        # Keep only last 30 days of activity to prevent memory bloat
        cutoff_date = datetime.now() - timedelta(days=30)
        self.order_activity = [a for a in self.order_activity if a.timestamp > cutoff_date]
    
    def get_csv_snapshot(self, csv_path: str) -> Dict:
        """Create a snapshot of current CSV orders for comparison"""
        snapshot = {}
        if not os.path.exists(csv_path):
            return snapshot
            
        try:
            with open(csv_path, 'r') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    symbol = row.get('Symbol', '').upper().strip()
                    if not symbol:
                        continue
                    
                    # Extract all orders for this symbol
                    orders = []
                    i = 1
                    while True:
                        amt_key = f'Amt {i}'
                        price_key = f'Price {i}'
                        if amt_key not in row or price_key not in row:
                            break
                        amt = row[amt_key].strip()
                        price = row[price_key].strip()
                        if amt and price:
                            orders.append({
                                'amount': amt,
                                'price': price,
                                'order_num': i
                            })
                        i += 1
                    
                    if orders:
                        snapshot[symbol] = {
                            'company': row.get('Company', ''),
                            'orders': orders
                        }
        except Exception as e:
            logger.error(f"Error creating CSV snapshot: {e}")
        
        return snapshot
    
    def compare_csv_snapshots(self, old_snapshot: Dict, new_snapshot: Dict) -> Dict:
        """Compare two CSV snapshots and return changes"""
        changes = {
            'added': [],      # New symbols
            'removed': [],    # Removed symbols
            'modified': [],  # Modified orders
            'added_orders': [],  # Orders added to existing symbols
            'removed_orders': []  # Orders removed from existing symbols
        }
        
        old_symbols = set(old_snapshot.keys())
        new_symbols = set(new_snapshot.keys())
        
        # Find added symbols
        for symbol in new_symbols - old_symbols:
            changes['added'].append({
                'symbol': symbol,
                'company': new_snapshot[symbol].get('company', ''),
                'orders': new_snapshot[symbol].get('orders', [])
            })
        
        # Find removed symbols
        for symbol in old_symbols - new_symbols:
            changes['removed'].append({
                'symbol': symbol,
                'company': old_snapshot[symbol].get('company', ''),
                'orders': old_snapshot[symbol].get('orders', [])
            })
        
        # Find modified symbols
        for symbol in old_symbols & new_symbols:
            old_orders = old_snapshot[symbol].get('orders', [])
            new_orders = new_snapshot[symbol].get('orders', [])
            
            # Compare orders
            if old_orders != new_orders:
                # Check for added/removed orders
                old_order_nums = {o['order_num'] for o in old_orders}
                new_order_nums = {o['order_num'] for o in new_orders}
                
                added_nums = new_order_nums - old_order_nums
                removed_nums = old_order_nums - new_order_nums
                
                # Check for modified orders (same order_num, different price/amount)
                modified_orders = []
                for old_order in old_orders:
                    if old_order['order_num'] in new_order_nums:
                        new_order = next(o for o in new_orders if o['order_num'] == old_order['order_num'])
                        if old_order != new_order:
                            modified_orders.append({
                                'order_num': old_order['order_num'],
                                'old': old_order,
                                'new': new_order
                            })
                
                if added_nums or removed_nums or modified_orders:
                    changes['modified'].append({
                        'symbol': symbol,
                        'company': new_snapshot[symbol].get('company', ''),
                        'added_orders': [o for o in new_orders if o['order_num'] in added_nums],
                        'removed_orders': [o for o in old_orders if o['order_num'] in removed_nums],
                        'modified_orders': modified_orders
                    })
        
        return changes
    
    def send_csv_change_notification(self, filename: str, changes: Dict):
        """Send email notification for CSV changes"""
        if not any([changes['added'], changes['removed'], changes['modified']]):
            return  # No changes
        
        # Build description
        description_parts = []
        if changes['added']:
            description_parts.append(f"**{len(changes['added'])} symbol(s) added**")
        if changes['removed']:
            description_parts.append(f"**{len(changes['removed'])} symbol(s) removed**")
        if changes['modified']:
            description_parts.append(f"**{len(changes['modified'])} symbol(s) modified**")
        
        description = f"GTT orders in **{filename}** have been updated. " + ", ".join(description_parts) + "."
        
        # Build fields with detailed changes
        fields = []
        
        # Added symbols
        if changes['added']:
            for item in changes['added']:
                orders_summary = ", ".join([f"Order {o['order_num']}: {o['amount']} @ ${o['price']}" 
                                           for o in item['orders']])
                fields.append({
                    "name": f"➕ Added: {item['symbol']} ({item['company']})",
                    "value": orders_summary,
                    "inline": False
                })
        
        # Removed symbols
        if changes['removed']:
            for item in changes['removed']:
                orders_summary = ", ".join([f"Order {o['order_num']}: {o['amount']} @ ${o['price']}" 
                                           for o in item['orders']])
                fields.append({
                    "name": f"➖ Removed: {item['symbol']} ({item['company']})",
                    "value": orders_summary,
                    "inline": False
                })
        
        # Modified symbols
        if changes['modified']:
            for item in changes['modified']:
                mod_details = []
                if item['added_orders']:
                    added_orders_str = ', '.join([f'Order {o["order_num"]}' for o in item['added_orders']])
                    mod_details.append(f"Added: {added_orders_str}")
                if item['removed_orders']:
                    removed_orders_str = ', '.join([f'Order {o["order_num"]}' for o in item['removed_orders']])
                    mod_details.append(f"Removed: {removed_orders_str}")
                if item['modified_orders']:
                    for mod in item['modified_orders']:
                        old_str = f"{mod['old']['amount']} @ ${mod['old']['price']}"
                        new_str = f"{mod['new']['amount']} @ ${mod['new']['price']}"
                        mod_details.append(f"Order {mod['order_num']}: {old_str} → {new_str}")
                
                fields.append({
                    "name": f"✏️ Modified: {item['symbol']} ({item['company']})",
                    "value": "; ".join(mod_details),
                    "inline": False
                })
        
        # Send notification
        self.manager._send_email_notification(
            title="📝 GTT Orders Updated",
            description=description,
            fields=fields,
            footer_text=f"File: {filename} • {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        
        logger.info(f"CSV change notification sent for {filename}")
    
    def get_daily_summary(self, target_date: datetime) -> Dict:
        """Get summary of orders placed and executed for a specific date"""
        # Filter activities for the target date
        start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        
        day_activities = [
            a for a in self.order_activity
            if start_of_day <= a.timestamp < end_of_day
        ]
        
        # Group by action type
        summary = {
            'date': target_date.strftime('%Y-%m-%d'),
            'placed': [],
            'filled': [],
            'cancelled': [],
            'other': []
        }
        
        for activity in day_activities:
            if activity.action == 'placed':
                summary['placed'].append(activity)
            elif activity.action == 'filled':
                summary['filled'].append(activity)
            elif activity.action in ['cancelled', 'rejected', 'expired']:
                summary['cancelled'].append(activity)
            else:
                summary['other'].append(activity)
        
        return summary
    
    def get_weekly_summary(self, week_start: datetime) -> Dict:
        """Get weekly summary of all trading activity"""
        week_end = week_start + timedelta(days=7)
        
        week_activities = [
            a for a in self.order_activity
            if week_start <= a.timestamp < week_end
        ]
        
        # Group by day
        daily_summaries = {}
        for activity in week_activities:
            day_key = activity.timestamp.strftime('%Y-%m-%d')
            if day_key not in daily_summaries:
                daily_summaries[day_key] = {
                    'placed': 0,
                    'filled': 0,
                    'cancelled': 0,
                    'total_value_placed': 0.0,
                    'total_value_filled': 0.0
                }
            
            day_sum = daily_summaries[day_key]
            if activity.action == 'placed':
                day_sum['placed'] += 1
                day_sum['total_value_placed'] += activity.price * activity.amount
            elif activity.action == 'filled':
                day_sum['filled'] += 1
                day_sum['total_value_filled'] += activity.price * activity.amount
            elif activity.action in ['cancelled', 'rejected', 'expired']:
                day_sum['cancelled'] += 1
        
        return {
            'week_start': week_start.strftime('%Y-%m-%d'),
            'week_end': (week_end - timedelta(days=1)).strftime('%Y-%m-%d'),
            'daily_summaries': daily_summaries,
            'total_placed': sum(s['placed'] for s in daily_summaries.values()),
            'total_filled': sum(s['filled'] for s in daily_summaries.values()),
            'total_cancelled': sum(s['cancelled'] for s in daily_summaries.values()),
            'total_value_placed': sum(s['total_value_placed'] for s in daily_summaries.values()),
            'total_value_filled': sum(s['total_value_filled'] for s in daily_summaries.values())
        }
    
    def send_daily_summary(self, target_date: Optional[datetime] = None):
        """Send daily summary email"""
        if target_date is None:
            # Get yesterday's date
            target_date = datetime.now() - timedelta(days=1)
        
        summary = self.get_daily_summary(target_date)
        
        # Build email
        fields = []
        
        if summary['placed']:
            placed_details = []
            for activity in summary['placed']:
                placed_details.append(
                    f"{activity.symbol} Order {activity.order_num}: "
                    f"{activity.amount} @ ${activity.price:.2f}"
                )
            fields.append({
                "name": f"📤 Orders Placed ({len(summary['placed'])})",
                "value": "\n".join(placed_details),
                "inline": False
            })
        
        if summary['filled']:
            filled_details = []
            for activity in summary['filled']:
                filled_details.append(
                    f"{activity.symbol} Order {activity.order_num}: "
                    f"{activity.amount} @ ${activity.price:.2f}"
                )
            fields.append({
                "name": f"✅ Orders Filled ({len(summary['filled'])})",
                "value": "\n".join(filled_details),
                "inline": False
            })
        
        if summary['cancelled']:
            cancelled_details = []
            for activity in summary['cancelled']:
                cancelled_details.append(
                    f"{activity.symbol} Order {activity.order_num}: {activity.action}"
                )
            fields.append({
                "name": f"❌ Orders Cancelled/Rejected ({len(summary['cancelled'])})",
                "value": "\n".join(cancelled_details),
                "inline": False
            })
        
        if not fields:
            # No activity yesterday
            description = f"No orders were placed or executed on {summary['date']}."
            fields = [{
                "name": "Status",
                "value": "No trading activity",
                "inline": False
            }]
        else:
            description = f"Daily trading summary for {summary['date']}."
        
        self.manager._send_email_notification(
            title=f"📊 Daily Trading Summary - {summary['date']}",
            description=description,
            fields=fields,
            footer_text=f"Alpaca Trading Bot • {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        
        logger.info(f"Daily summary sent for {summary['date']}")
    
    def send_weekly_summary(self, week_start: Optional[datetime] = None):
        """Send weekly summary email"""
        if week_start is None:
            # Get last Monday
            today = datetime.now()
            days_since_monday = (today.weekday()) % 7
            week_start = today - timedelta(days=days_since_monday + 7)  # Last week's Monday
            week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
        
        summary = self.get_weekly_summary(week_start)
        
        # Build email
        fields = []
        
        # Overall stats
        fields.append({
            "name": "📈 Weekly Overview",
            "value": f"Orders Placed: {summary['total_placed']}\n"
                    f"Orders Filled: {summary['total_filled']}\n"
                    f"Orders Cancelled: {summary['total_cancelled']}\n"
                    f"Total Value Placed: ${summary['total_value_placed']:,.2f}\n"
                    f"Total Value Filled: ${summary['total_value_filled']:,.2f}",
            "inline": False
        })
        
        # Daily breakdown
        if summary['daily_summaries']:
            daily_breakdown = []
            for day, day_sum in sorted(summary['daily_summaries'].items()):
                daily_breakdown.append(
                    f"{day}: {day_sum['placed']} placed, {day_sum['filled']} filled, "
                    f"${day_sum['total_value_filled']:,.2f} executed"
                )
            fields.append({
                "name": "📅 Daily Breakdown",
                "value": "\n".join(daily_breakdown),
                "inline": False
            })
        
        description = f"Weekly trading summary from {summary['week_start']} to {summary['week_end']}."
        
        self.manager._send_email_notification(
            title=f"📊 Weekly Trading Summary - {summary['week_start']} to {summary['week_end']}",
            description=description,
            fields=fields,
            footer_text=f"Alpaca Trading Bot • {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        
        logger.info(f"Weekly summary sent for week starting {summary['week_start']}")

