"use client"

import { useEffect, useState, useMemo } from "react"
import useSWR, { mutate } from "swr"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { DataTable, ColumnHeaderWithDropdown } from "@/components/data-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ColumnDef } from "@tanstack/react-table"
import { Wifi, WifiOff, ChevronRight, ChevronDown, X, Check, TestTube, ChartCandlestick, RefreshCw, Activity, TriangleAlert, CheckCircle2, Clock } from "lucide-react"

// Reusable Icon Tooltip Component
interface IconTooltipProps {
  icon: React.ReactNode
  title: string
  content: React.ReactNode
  isVisible: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function IconTooltip({ icon, title, content, isVisible, onMouseEnter, onMouseLeave }: IconTooltipProps) {
  return (
    <div 
      className="relative"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {icon}
      {isVisible && (
        <div className="absolute right-0 top-6 z-50 bg-popover border border-border rounded-md shadow-lg p-2 min-w-[200px]">
          <p className="text-xs font-semibold text-foreground mb-1">{title}</p>
          <div className="text-xs text-muted-foreground space-y-0">
            {content}
          </div>
        </div>
      )}
    </div>
  )
}

// Force Fill Button Component with Two-Step Confirmation
// Shows for ALL pending orders (not just current)
// First click: Shows checkbox + X button
// Checkbox click: Confirms and executes force fill
// X click: Cancels
function ForceFillButton({ 
  symbol, 
  orderIndex, 
  onExecute,
  isConfirming,
  onShowConfirm,
  onHideConfirm
}: { 
  symbol: string
  orderIndex: number
  onExecute: () => void
  isConfirming: boolean
  onShowConfirm: () => void
  onHideConfirm: () => void
}) {
  const [loading, setLoading] = useState(false)
  const apiPort = process.env.NEXT_PUBLIC_API_PORT || '8080'
  const apiHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const apiBaseUrl = `http://${apiHost}:${apiPort}`

  const handleForceFill = async (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent event from bubbling up to table row
    setLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/force-fill-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbol, order_index: orderIndex }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        // Small delay to show success state before refreshing
        setTimeout(() => {
          onExecute()
          onHideConfirm()
        }, 300)
      } else {
        alert(`❌ Error: ${data.error || 'Unknown error'}`)
        onHideConfirm()
        setLoading(false)
      }
    } catch (error) {
      console.error('Error force filling:', error)
      alert(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      onHideConfirm()
      setLoading(false)
    }
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent event from bubbling up to table row
    onHideConfirm()
  }

  const handleShowConfirm = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent event from bubbling up to table row
    onShowConfirm()
  }

  // If showing confirmation UI
  if (isConfirming) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={handleForceFill}
          disabled={loading}
          className="h-6 w-6 flex items-center justify-center rounded border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors disabled:opacity-50"
          title="Confirm force fill"
        >
          {loading ? (
            <div className="h-3 w-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          ) : (
            <Check className="h-3 w-3 text-primary" />
          )}
        </button>
        <button
          onClick={handleCancel}
          disabled={loading}
          className="h-6 w-6 flex items-center justify-center rounded border border-muted hover:bg-muted transition-colors disabled:opacity-50"
          title="Cancel"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    )
  }

  // Default button state
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleShowConfirm}
      disabled={loading}
      className="h-7 text-xs"
    >
      Force Fill
    </Button>
  )
}

interface ActiveOrder {
  id: string
  symbol: string
  side: string
  quantity: number
  limit_price: number | null
  status: string
  created_at: string
  filled_qty: number
}

interface GTTOrder {
  symbol: string
  company: string
  order_index: number
  total_orders: number
  amount: number
  price: number
  status: string
  order_id: string | null
  current_order_index: number
  is_current: boolean
}

interface AccountInfo {
  buying_power: number
  cash: number
  portfolio_value: number
  equity: number
  is_paper?: boolean
}

interface Prices {
  [symbol: string]: number
}

interface MarketStatus {
  is_open: boolean | null
  next_open: string | null
  next_close: string | null
}

export default function OrdersPage() {
  // Get API base URL
  const apiPort = process.env.NEXT_PUBLIC_API_PORT || '8080'
  const apiHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const apiBaseUrl = `http://${apiHost}:${apiPort}`
  
  // SWR hooks for data fetching - automatic polling, no full page refresh
  const { data: ordersData, error: ordersError, isLoading: ordersLoading } = useSWR(
    `${apiBaseUrl}/api/orders`,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  
  const { data: accountData, error: accountError, isLoading: accountLoading } = useSWR(
    `${apiBaseUrl}/api/account`,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  
  const { data: pricesData, error: pricesError, isLoading: pricesLoading } = useSWR(
    `${apiBaseUrl}/api/prices`,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  
  const { data: loadingStatusData, isLoading: statusLoading } = useSWR(
    `${apiBaseUrl}/api/status`,
    { refreshInterval: 500, revalidateOnFocus: false } // Poll status more frequently
  )
  
  // Extract data from SWR responses
  const activeOrders = ordersData?.active_orders || []
  const gttOrders = ordersData?.gtt_orders || []
  const account = accountData || null
  const prices = pricesData?.prices || {}
  const marketStatus = pricesData?.market_status || null
  const loadingStatus = loadingStatusData || null
  
  // Refresh function for manual refresh (used by buttons)
  const refreshData = () => {
    mutate(`${apiBaseUrl}/api/orders`)
    mutate(`${apiBaseUrl}/api/account`)
    mutate(`${apiBaseUrl}/api/prices`)
  }
  
  // Determine loading state - show loading if initial load OR backend is processing
  const isLoading = (ordersLoading && activeOrders.length === 0) || loadingStatus?.is_loading
  const isInitialLoad = ordersLoading && activeOrders.length === 0 && !ordersData
  
  // Determine online status from SWR errors
  const isOnline = !ordersError && !accountError && !pricesError
  
  // Track last sync time
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  
  // Update last sync time when data changes
  useEffect(() => {
    if (ordersData || accountData || pricesData) {
      setLastSyncTime(new Date())
    }
  }, [ordersData, accountData, pricesData])
  
  // Track which buttons are showing confirmation UI (persists across re-renders)
  const [confirmingButtons, setConfirmingButtons] = useState<Set<string>>(new Set())
  
  // Tooltip state for status icons
  const [tooltipState, setTooltipState] = useState<{
    tradingMode: boolean
    sync: boolean
    warning: boolean
  }>({ tradingMode: false, sync: false, warning: false })
  
  const addConfirmingButton = (key: string) => {
    setConfirmingButtons(prev => new Set(prev).add(key))
  }
  
  const removeConfirmingButton = (key: string) => {
    setConfirmingButtons(prev => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }
  
  const isConfirming = (key: string) => confirmingButtons.has(key)

  // Update sync time display every second for real-time feel
  const [currentTime, setCurrentTime] = useState(new Date())
  
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Format last sync time
  const formatLastSync = () => {
    if (!lastSyncTime) return "Never"
    const diff = Math.floor((currentTime.getTime() - lastSyncTime.getTime()) / 1000)
    
    if (diff < 5) return "Just now"
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return lastSyncTime.toLocaleTimeString()
  }

  // Format last sync time for display (more detailed)
  const formatLastSyncDetailed = () => {
    if (!lastSyncTime) return "Never synced"
    const diff = Math.floor((currentTime.getTime() - lastSyncTime.getTime()) / 1000)
    
    if (diff < 5) return "Just now"
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) {
      const minutes = Math.floor(diff / 60)
      const seconds = diff % 60
      return `${minutes}m ${seconds}s ago`
    }
    const hours = Math.floor(diff / 3600)
    const minutes = Math.floor((diff % 3600) / 60)
    return `${hours}h ${minutes}m ago`
  }

  // Format date/time in a human-readable way
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    // Relative time for recent dates
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return `${diffDays}d ago`
    
    // For older dates, show a cleaner absolute format
    const month = date.toLocaleDateString('en-US', { month: 'short' })
    const day = date.getDate()
    const year = date.getFullYear()
    const isCurrentYear = year === now.getFullYear()
    const time = date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
    
    if (isCurrentYear) {
      return `${month} ${day}, ${time}`
    } else {
      return `${month} ${day}, ${year} ${time}`
    }
  }

  // Get full date/time for tooltip
  const getFullDateTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  // Format market open/close time in a readable way using Intl APIs
  const formatMarketTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    
    // Normalize to midnight for day comparison
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const marketDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Format date components
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      weekday: 'short'
    })
    const dateParts = dateFormatter.formatToParts(date)
    const month = dateParts.find(p => p.type === 'month')?.value || ''
    const day = dateParts.find(p => p.type === 'day')?.value || ''
    const weekday = dateParts.find(p => p.type === 'weekday')?.value || ''
    
    // Format time with timezone
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    })
    const timeParts = timeFormatter.formatToParts(date)
    const hour = timeParts.find(p => p.type === 'hour')?.value || ''
    const minute = timeParts.find(p => p.type === 'minute')?.value || ''
    const dayPeriod = timeParts.find(p => p.type === 'dayPeriod')?.value || ''
    const timeZone = timeParts.find(p => p.type === 'timeZoneName')?.value || ''
    
    const time = `${hour}:${minute} ${dayPeriod} ${timeZone}`
    
    // Check if it's today
    const isToday = marketDay.getTime() === today.getTime()
    // Check if it's tomorrow (and tomorrow is a weekday)
    const isTomorrow = marketDay.getTime() === tomorrow.getTime()
    const tomorrowDayOfWeek = tomorrow.getDay()
    const isTomorrowWeekday = tomorrowDayOfWeek >= 1 && tomorrowDayOfWeek <= 5
    
    // Build the formatted string
    if (isToday) {
      return `Today, ${month} ${day} (${weekday}), ${time}`
    } else if (isTomorrow && isTomorrowWeekday) {
      return `Tomorrow, ${month} ${day} (${weekday}), ${time}`
    } else {
      // For future dates, show full date with weekday
      return `${weekday}, ${month} ${day}, ${time}`
    }
  }

  const getStatusBadge = (status: string, isCurrent?: boolean) => {
    const statusLower = status.toLowerCase()
    
    // Filled orders: green (Alpaca's official terminal status - order is fully executed and complete)
    if (statusLower === "filled") {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">FILLED</Badge>
    }
    
    // Partially filled orders: yellow-green (order is partially executed, still waiting for more fills)
    if (statusLower === "partially_filled") {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">PARTIALLY FILLED</Badge>
    }
    
    // Current order that's placed (live, buying power locked): yellow
    // Alpaca statuses: new, accepted = order is live
    if (isCurrent && (statusLower === "new" || statusLower === "accepted" || statusLower === "placed")) {
      return <Badge className="bg-primary/20 text-primary border-primary/30">PLACED</Badge>
    }
    
    // Current order that's partially filled: yellow-green
    if (isCurrent && statusLower === "partially_filled") {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">PARTIALLY FILLED</Badge>
    }
    
    // Current order that's still pending (not yet placed): yellow
    if (isCurrent && statusLower === "pending") {
      return <Badge className="bg-primary/20 text-primary border-primary/30">PENDING</Badge>
    }
    
    // Orders that are live (placed in Alpaca, buying power locked)
    // Alpaca statuses: new, accepted, pending_new, pending_replace, accepted_for_bidding, stopped, suspended
    if (statusLower === "new" || statusLower === "accepted" || 
        statusLower === "pending_new" || statusLower === "pending_replace" || 
        statusLower === "accepted_for_bidding" || statusLower === "stopped" || 
        statusLower === "suspended" || statusLower === "placed") {
      return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border">PLACED</Badge>
    }
    
    // Pending orders (not yet placed): grayish white
    if (statusLower === "pending") {
      return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border">PENDING</Badge>
    }
    
    // Other statuses (cancelled, expired, etc.): display as-is
    return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border">{status.toUpperCase()}</Badge>
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value)
  }

  // Column definitions for GTT Orders (used inside accordion)
  const createGTTColumns = (currentPrice: number | undefined, onRefresh: () => void): ColumnDef<GTTOrder>[] => [
    {
      accessorKey: "order_index",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Order #" filterType="number" />,
      cell: ({ row }) => {
        const order = row.original
        return (
          <div className="flex items-center gap-2">
            {order.order_index}
            {order.is_current && (
              <Badge variant="secondary" className="text-xs bg-primary/20 text-primary border-primary/30">
                Current
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "amount",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Amount" filterType="number" />,
    },
    {
      accessorKey: "price",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Trigger Price" filterType="number" />,
      cell: ({ row }) => (
        <span className="font-medium">{formatCurrency(row.original.price)}</span>
      ),
    },
    {
      id: "current_price",
      header: "Current Price",
      cell: ({ row }) => {
        const order = row.original
        const priceMet = currentPrice && currentPrice <= order.price
        return currentPrice ? (
          <span
            className={
              priceMet ? "text-yellow-400 font-medium" : "text-muted-foreground"
            }
          >
            {formatCurrency(currentPrice)}
            {priceMet && " ✓"}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Status" />,
      cell: ({ row }) => getStatusBadge(row.original.status, row.original.is_current),
    },
    {
      accessorKey: "order_id",
      header: "Order ID",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-yellow-400">
          {row.original.order_id ? `${row.original.order_id.slice(0, 8)}...` : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const order = row.original
        // Show Force Fill button for ALL pending orders (not just current)
        const statusLower = order.status.toLowerCase()
        const isPending = statusLower === "pending" && !order.order_id
        
        if (isPending) {
          const buttonKey = `${order.symbol}-${order.order_index}`
          return (
            <ForceFillButton 
              symbol={order.symbol} 
              orderIndex={order.order_index - 1} 
              onExecute={onRefresh}
              isConfirming={isConfirming(buttonKey)}
              onShowConfirm={() => addConfirmingButton(buttonKey)}
              onHideConfirm={() => removeConfirmingButton(buttonKey)}
            />
          )
        }
        return <span className="text-muted-foreground text-xs">—</span>
      },
    },
  ]

  // Create a set of GTT order IDs for quick lookup (to show which orders came from GTT)
  const gttOrderIds = useMemo(() => {
    return new Set(gttOrders.filter((o: GTTOrder) => o.order_id).map((o: GTTOrder) => o.order_id))
  }, [gttOrders])

  // Group GTT orders by symbol
  const gttBySymbol: Record<string, GTTOrder[]> = useMemo(() => {
    const grouped: Record<string, GTTOrder[]> = {}
    gttOrders.forEach((order: GTTOrder) => {
      if (!grouped[order.symbol]) {
        grouped[order.symbol] = []
      }
      grouped[order.symbol].push(order)
    })
    return grouped
  }, [gttOrders])

  // Column definitions for Active Orders
  const activeOrderColumns: ColumnDef<ActiveOrder>[] = [
    {
      accessorKey: "symbol",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Symbol" filterType="text" />,
      cell: ({ row }) => {
        const order = row.original
        const isGTTOrder = gttOrderIds.has(order.id)
        return (
          <div className="flex items-center gap-2">
            <span className="font-medium">{order.symbol}</span>
            {isGTTOrder && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
                GTT
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "side",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Side" />,
      cell: ({ row }) => (
        <Badge variant={row.original.side === "buy" ? "default" : "destructive"}>
          {row.original.side.toUpperCase()}
        </Badge>
      ),
    },
    {
      accessorKey: "quantity",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Quantity" filterType="number" />,
    },
    {
      accessorKey: "limit_price",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Limit Price" filterType="number" />,
      cell: ({ row }) =>
        row.original.limit_price ? formatCurrency(row.original.limit_price) : "Market",
    },
    {
      id: "filled",
      header: "Filled",
      cell: ({ row }) => (
        <span>
          {row.original.filled_qty} / {row.original.quantity}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Status" />,
      cell: ({ row }) => getStatusBadge(row.original.status),
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Created" />,
      cell: ({ row }) => {
        const dateStr = row.original.created_at
        return (
          <span 
            className="text-sm text-foreground font-medium"
            title={getFullDateTime(dateStr)}
          >
            {formatDateTime(dateStr)}
          </span>
        )
      },
    },
    {
      id: "gtt",
      header: "GTT",
      cell: ({ row }) => {
        const symbol = row.original.symbol
        const symbolGTTOrders = gttBySymbol[symbol] || []
        const canExpand = symbolGTTOrders.length > 0
        
        if (!canExpand) {
          return <span className="text-muted-foreground text-xs">—</span>
        }
        
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation() // Prevent row click from triggering
              row.toggleExpanded()
            }}
          >
            {row.getIsExpanded() ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        )
      },
    },
  ]

  // Categorize orders by status
  const categorizeOrders = (orders: ActiveOrder[]) => {
    // Active = orders that are placed and live (buying power locked) but not yet fully executed
    const activeStatuses = ['new', 'accepted', 'pending_new', 'pending_replace', 'accepted_for_bidding', 'stopped', 'suspended', 'partially_filled']
    // Completed = orders that are fully executed (filled is the terminal status)
    const completedStatuses = ['filled']
    // Cancelled = orders that were cancelled, expired, or rejected
    const cancelledStatuses = ['canceled', 'cancelled', 'expired', 'pending_cancel', 'replaced', 'rejected']
    
    return {
      active: orders.filter(order => activeStatuses.includes(order.status.toLowerCase())),
      completed: orders.filter(order => completedStatuses.includes(order.status.toLowerCase())),
      cancelled: orders.filter(order => cancelledStatuses.includes(order.status.toLowerCase())),
    }
  }

  const orderCategories = useMemo(() => categorizeOrders(activeOrders), [activeOrders])

  return (
    <div className="min-h-screen bg-background p-2 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header - Responsive Layout */}
        <div className="flex flex-col gap-3">
          {/* Top row: Title and Status */}
          <div className="flex items-start justify-between gap-4">
            {/* Left: Logo and Title */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Logo - Smaller */}
              <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-card border border-primary/30 flex-shrink-0 flex items-center justify-center">
                <img
                  src="/alpaca-logo.png"
                  alt="Alpaca Logo"
                  className="w-full h-full object-cover scale-150"
                  style={{ imageRendering: 'crisp-edges' }}
                />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  Alpaca Order Manager
                </h1>
                <p className="text-xs text-muted-foreground hidden sm:block">Monitor and manage your conditional orders</p>
              </div>
            </div>
            
            {/* Right: Compact Status Bar - Top Right Corner */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {isOnline ? (
                <div className="flex flex-col items-end gap-1.5">
                  {/* Top row: Icons and loading indicator */}
                  <div className="flex items-center gap-2">
                    {/* Paper Trading vs Live Trading Icon */}
                    {account && (
                      <IconTooltip
                        icon={
                          account.is_paper ? (
                            <TestTube className="h-4 w-4 text-yellow-500 cursor-help" />
                          ) : (
                            <ChartCandlestick className="h-4 w-4 text-red-500 cursor-help" />
                          )
                        }
                        title="Trading Mode"
                        content={
                          account.is_paper ? (
                            <>🧪 <strong>Paper Trading</strong> - Simulated trading with virtual funds</>
                          ) : (
                            <>⚡ <strong>Live Trading</strong> - Real money transactions</>
                          )
                        }
                        isVisible={tooltipState.tradingMode}
                        onMouseEnter={() => setTooltipState(prev => ({ ...prev, tradingMode: true }))}
                        onMouseLeave={() => setTooltipState(prev => ({ ...prev, tradingMode: false }))}
                      />
                    )}
                    
                    {/* Sync Status Icon */}
                    <IconTooltip
                      icon={
                        loadingStatus?.is_loading ? (
                          <RefreshCw className="h-4 w-4 text-primary animate-spin cursor-help" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-500 cursor-help" />
                        )
                      }
                      title="Sync Status"
                      content={
                        <>
                          <span>
                            {loadingStatus?.is_loading 
                              ? `Syncing: ${loadingStatus.message || "Loading orders..."}`
                              : "Data is synchronized"}
                          </span>
                          <span className="block mt-1">
                            Last sync: {formatLastSyncDetailed()}
                          </span>
                        </>
                      }
                      isVisible={tooltipState.sync}
                      onMouseEnter={() => setTooltipState(prev => ({ ...prev, sync: true }))}
                      onMouseLeave={() => setTooltipState(prev => ({ ...prev, sync: false }))}
                    />
                    
                    {/* Market Status Warning */}
                    {marketStatus && marketStatus.is_open === false && (
                      <IconTooltip
                        icon={<Clock className="h-4 w-4 text-yellow-500/70 cursor-help" />}
                        title="Market Status"
                        content={
                          <>
                            <span>Markets are currently closed. Prices may be stale.</span>
                            {marketStatus.next_open && (
                              <span className="block mt-1 font-medium text-foreground">
                                Opens: <span className="text-primary">{formatMarketTime(marketStatus.next_open)}</span>
                              </span>
                            )}
                          </>
                        }
                        isVisible={tooltipState.warning}
                        onMouseEnter={() => setTooltipState(prev => ({ ...prev, warning: true }))}
                        onMouseLeave={() => setTooltipState(prev => ({ ...prev, warning: false }))}
                      />
                    )}
                  </div>
                  
                  {/* Loading Progress Bar - Compact and Smooth */}
                  {loadingStatus?.is_loading && (
                    <div className="flex items-center gap-2 w-48">
                      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-500 ease-out"
                          style={{ 
                            width: loadingStatus.total > 0 
                              ? `${Math.min(100, (loadingStatus.progress / loadingStatus.total) * 100)}%` 
                              : '50%'
                          }}
                        />
                      </div>
                      {loadingStatus.total > 0 && (
                        <span className="text-[9px] text-muted-foreground tabular-nums">
                          {loadingStatus.progress}/{loadingStatus.total}
                        </span>
                      )}
                    </div>
                  )}
                  
                  {/* Bottom row: Last sync time */}
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-[9px] text-muted-foreground leading-tight">
                      {formatLastSyncDetailed()}
                    </span>
                    {marketStatus && marketStatus.is_open === false && (
                      <span className="text-[8px] text-muted-foreground/70 leading-tight">
                        Closed
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-0.5">
                  <WifiOff className="h-4 w-4 text-red-500" />
                  <span className="text-[9px] text-red-500/70 leading-tight">
                    Offline
                  </span>
                </div>
              )}
            </div>
          </div>
          
          {/* Bottom row: Account Summary - After Status */}
          {account && (
            <Card className="w-full">
              <CardContent className="py-2 px-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium">Buying Power</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(account.buying_power)}</span>
                  </div>
                  <div className="hidden sm:block h-4 w-px bg-border"></div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium">Cash</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(account.cash)}</span>
                  </div>
                  <div className="hidden sm:block h-4 w-px bg-border"></div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium">Equity</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(account.equity)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="orders" className="w-full">
          <TabsList>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="gtt">GTT</TabsTrigger>
          </TabsList>

          {/* GTT Orders Tab */}
          <TabsContent value="gtt" className="space-y-4">
            {/* Show loading screen if initial load AND no data exists yet */}
            {isLoading && gttOrders.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-4">
                    <div className="relative">
                      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-lg font-medium text-foreground">Loading orders...</p>
                      {loadingStatus?.is_loading && loadingStatus.message && (
                        <p className="text-sm text-muted-foreground animate-pulse">{loadingStatus.message}</p>
                      )}
                      {loadingStatus && loadingStatus.is_loading && loadingStatus.current_symbol && (
                        <p className="text-xs text-primary font-medium">
                          Processing: {loadingStatus.current_symbol}
                        </p>
                      )}
                      {loadingStatus && loadingStatus.total > 0 && (
                        <div className="flex items-center gap-2 justify-center mt-2">
                          <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary transition-all duration-300"
                              style={{ width: `${(loadingStatus.progress / loadingStatus.total) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {loadingStatus.progress}/{loadingStatus.total}
                          </span>
                        </div>
                      )}
                      {!isOnline && (
                        <p className="text-sm text-destructive mt-2 flex items-center gap-2">
                          <TriangleAlert className="h-4 w-4" />
                          Server connection failed. Please check if the monitor is running.
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : Object.keys(gttBySymbol).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No GTT orders found. Load orders from CSV files.
                </CardContent>
              </Card>
            ) : (
              <Accordion type="single" collapsible className="w-full space-y-4">
                {Object.entries(gttBySymbol).map(([symbol, orders]) => {
                  const currentPrice = prices[symbol]
                  
                  // Count orders by status - use Alpaca official statuses
                  const completedOrders = orders.filter(o => {
                    const status = o.status.toLowerCase()
                    return status === "filled"
                  })
                  const placedOrders = orders.filter(o => {
                    const status = o.status.toLowerCase()
                    // Orders that are placed (have order_id) but not filled
                    return o.order_id && status !== "filled"
                  })
                  const pendingOrders = orders.filter(o => {
                    const status = o.status.toLowerCase()
                    // Orders that are truly pending (no order_id and status is pending)
                    return !o.order_id && status === "pending"
                  })
                  
                  // Calculate totals
                  const totalOrders = orders.length
                  const placedCount = placedOrders.length + completedOrders.length // Include filled orders in "placed"
                  const remainingCount = pendingOrders.length
                  
                  const columns = createGTTColumns(currentPrice, refreshData)
                  
                  return (
                    <AccordionItem key={symbol} value={symbol} className="border-none">
                      <Card>
                        <CardHeader className="p-3 sm:p-6">
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between w-full pr-4 gap-3 sm:gap-0">
                              {/* Left side: Name and description */}
                              <div className="text-left flex-1 min-w-0">
                                <CardTitle className="text-xl">{symbol}</CardTitle>
                                <CardDescription className="mt-1">
                                  {orders[0]?.company}
                                </CardDescription>
                              </div>
                              
                              {/* Right side: Four cards in a responsive grid */}
                              <div className="flex flex-col sm:flex-row gap-2 ml-2 sm:ml-4 flex-shrink-0">
                                {/* Top row: Current Price and Next Limit */}
                                <div className="flex flex-wrap items-center gap-2">
                                  {currentPrice && (
                                    <Badge variant="outline" className="text-xs shrink-0 px-2 py-1">
                                      Current: {formatCurrency(currentPrice)}
                                    </Badge>
                                  )}
                                  {(() => {
                                    const currentOrder = orders.find(o => o.is_current)
                                    if (currentOrder) {
                                      return (
                                        <Badge variant="outline" className="text-xs shrink-0 px-2 py-1">
                                          Next Limit: {formatCurrency(currentOrder.price)}
                                        </Badge>
                                      )
                                    }
                                    return null
                                  })()}
                                </div>
                                
                                {/* Bottom row: Placed count and Remaining count */}
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="text-xs shrink-0 px-2 py-1 bg-primary/10 text-primary border-primary/30">
                                    {placedCount} of {totalOrders} placed
                                  </Badge>
                                  <Badge variant="outline" className="text-xs shrink-0 px-2 py-1 bg-muted/50 text-muted-foreground">
                                    {remainingCount} remaining
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>
                        </CardHeader>
                        <AccordionContent>
                          <CardContent className="p-3 sm:p-6">
                            <DataTable
                              columns={columns}
                              data={orders}
                            />
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            )}
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders" className="space-y-6">
            {/* Active Orders Section */}
            <Card>
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  Active
                  {orderCategories.active.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {orderCategories.active.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">Orders currently placed and live (buying power locked)</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                {/* Show loading screen if:
                    1. Initial load AND no data exists yet, OR
                    2. Backend is still loading (from /api/status) - show even if we have some orders */}
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          {loadingStatus?.message || "Loading orders..."}
                        </p>
                        {loadingStatus && loadingStatus.is_loading && (
                          <div className="space-y-1">
                            {loadingStatus.current_symbol && (
                              <p className="text-xs text-primary font-medium">
                                Processing: {loadingStatus.current_symbol}
                              </p>
                            )}
                            {loadingStatus.total > 0 && (
                              <div className="flex items-center gap-2 justify-center">
                                <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{ width: `${(loadingStatus.progress / loadingStatus.total) * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {loadingStatus.progress}/{loadingStatus.total}
                                </span>
                              </div>
                            )}
                            {loadingStatus.loaded_symbols && loadingStatus.loaded_symbols.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Loaded: {loadingStatus.loaded_symbols.slice(-5).join(", ")}
                                {loadingStatus.loaded_symbols.length > 5 && ` ... (+${loadingStatus.loaded_symbols.length - 5} more)`}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : orderCategories.active.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No active orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={orderCategories.active}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (gttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id // The Alpaca order ID
                      const symbolGTTOrders = gttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
                      // Find the matching GTT order by order_id
                      const matchingGTTOrder = symbolGTTOrders.find(gtt => gtt.order_id === orderId)
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="text-sm font-semibold">GTT Orders for {symbol}</h4>
                            <Badge variant="secondary">{symbolGTTOrders.length}</Badge>
                          </div>
                          <div className="overflow-x-auto -mx-4 px-4">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-16">Order</TableHead>
                                  <TableHead>Amount</TableHead>
                                  <TableHead>Price</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead>Order ID</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {symbolGTTOrders.map((gttOrder) => {
                                  // Highlight if this GTT order matches the clicked order
                                  const isMatchingOrder = matchingGTTOrder && gttOrder.order_id === matchingGTTOrder.order_id
                                  
                                  return (
                                    <TableRow 
                                      key={`${gttOrder.symbol}-${gttOrder.order_index}`}
                                      className={isMatchingOrder ? "bg-primary/20 hover:bg-primary/25" : ""}
                                    >
                                      <TableCell className="font-medium">
                                        #{gttOrder.order_index}
                                        {gttOrder.is_current && (
                                          <Badge variant="outline" className="ml-2 text-xs">
                                            Current
                                          </Badge>
                                        )}
                                      </TableCell>
                                      <TableCell>{gttOrder.amount}</TableCell>
                                      <TableCell>{formatCurrency(gttOrder.price)}</TableCell>
                                      <TableCell>
                                        {getStatusBadge(gttOrder.status, gttOrder.is_current)}
                                      </TableCell>
                                      <TableCell className="font-mono text-xs text-muted-foreground">
                                        {gttOrder.order_id ? `${gttOrder.order_id.slice(0, 8)}...` : "—"}
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )
                    }}
                  />
                )}
              </CardContent>
            </Card>

            {/* Completed Orders Section */}
            <Card>
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  Completed
                  {orderCategories.completed.length > 0 && (
                    <Badge variant="default" className="ml-2">
                      {orderCategories.completed.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">Orders that have been filled (executed)</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                {/* Show loading screen if:
                    1. Initial load AND no data exists yet, OR
                    2. Backend is still loading (from /api/status) - show even if we have some orders */}
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          {loadingStatus?.message || "Loading orders..."}
                        </p>
                        {loadingStatus && loadingStatus.is_loading && (
                          <div className="space-y-1">
                            {loadingStatus.current_symbol && (
                              <p className="text-xs text-primary font-medium">
                                Processing: {loadingStatus.current_symbol}
                              </p>
                            )}
                            {loadingStatus.total > 0 && (
                              <div className="flex items-center gap-2 justify-center">
                                <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{ width: `${(loadingStatus.progress / loadingStatus.total) * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {loadingStatus.progress}/{loadingStatus.total}
                                </span>
                              </div>
                            )}
                            {loadingStatus.loaded_symbols && loadingStatus.loaded_symbols.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Loaded: {loadingStatus.loaded_symbols.slice(-5).join(", ")}
                                {loadingStatus.loaded_symbols.length > 5 && ` ... (+${loadingStatus.loaded_symbols.length - 5} more)`}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : orderCategories.completed.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No completed orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={orderCategories.completed}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (gttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id // The Alpaca order ID
                      const symbolGTTOrders = gttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
                      // Find the matching GTT order by order_id
                      const matchingGTTOrder = symbolGTTOrders.find(gtt => gtt.order_id === orderId)
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="text-sm font-semibold">GTT Orders for {symbol}</h4>
                            <Badge variant="secondary">{symbolGTTOrders.length}</Badge>
                          </div>
                          <div className="overflow-x-auto -mx-4 px-4">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-16">Order</TableHead>
                                  <TableHead>Amount</TableHead>
                                  <TableHead>Price</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead>Order ID</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {symbolGTTOrders.map((gttOrder) => {
                                  // Highlight if this GTT order matches the clicked order
                                  const isMatchingOrder = matchingGTTOrder && gttOrder.order_id === matchingGTTOrder.order_id
                                  
                                  return (
                                    <TableRow 
                                      key={`${gttOrder.symbol}-${gttOrder.order_index}`}
                                      className={isMatchingOrder ? "bg-primary/20 hover:bg-primary/25" : ""}
                                    >
                                      <TableCell className="font-medium">
                                        #{gttOrder.order_index}
                                        {gttOrder.is_current && (
                                          <Badge variant="outline" className="ml-2 text-xs">
                                            Current
                                          </Badge>
                                        )}
                                      </TableCell>
                                      <TableCell>{gttOrder.amount}</TableCell>
                                      <TableCell>{formatCurrency(gttOrder.price)}</TableCell>
                                      <TableCell>
                                        {getStatusBadge(gttOrder.status, gttOrder.is_current)}
                                      </TableCell>
                                      <TableCell className="font-mono text-xs text-muted-foreground">
                                        {gttOrder.order_id ? `${gttOrder.order_id.slice(0, 8)}...` : "—"}
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )
                    }}
                  />
                )}
              </CardContent>
            </Card>

            {/* Cancelled Orders Section */}
            <Card>
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  Cancelled
                  {orderCategories.cancelled.length > 0 && (
                    <Badge variant="destructive" className="ml-2">
                      {orderCategories.cancelled.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">Orders that were cancelled or expired</CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                {/* Show loading screen if:
                    1. Initial load AND no data exists yet, OR
                    2. Backend is still loading (from /api/status) - show even if we have some orders */}
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          {loadingStatus?.message || "Loading orders..."}
                        </p>
                        {loadingStatus && loadingStatus.is_loading && (
                          <div className="space-y-1">
                            {loadingStatus.current_symbol && (
                              <p className="text-xs text-primary font-medium">
                                Processing: {loadingStatus.current_symbol}
                              </p>
                            )}
                            {loadingStatus.total > 0 && (
                              <div className="flex items-center gap-2 justify-center">
                                <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{ width: `${(loadingStatus.progress / loadingStatus.total) * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {loadingStatus.progress}/{loadingStatus.total}
                                </span>
                              </div>
                            )}
                            {loadingStatus.loaded_symbols && loadingStatus.loaded_symbols.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Loaded: {loadingStatus.loaded_symbols.slice(-5).join(", ")}
                                {loadingStatus.loaded_symbols.length > 5 && ` ... (+${loadingStatus.loaded_symbols.length - 5} more)`}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : orderCategories.cancelled.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No cancelled orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={orderCategories.cancelled}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (gttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id // The Alpaca order ID
                      const symbolGTTOrders = gttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
                      // Find the matching GTT order by order_id
                      const matchingGTTOrder = symbolGTTOrders.find(gtt => gtt.order_id === orderId)
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="text-sm font-semibold">GTT Orders for {symbol}</h4>
                            <Badge variant="secondary">{symbolGTTOrders.length}</Badge>
                          </div>
                          <div className="overflow-x-auto -mx-4 px-4">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-16">Order</TableHead>
                                  <TableHead>Amount</TableHead>
                                  <TableHead>Price</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead>Order ID</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {symbolGTTOrders.map((gttOrder) => {
                                  // Highlight if this GTT order matches the clicked order
                                  const isMatchingOrder = matchingGTTOrder && gttOrder.order_id === matchingGTTOrder.order_id
                                  
                                  return (
                                    <TableRow 
                                      key={`${gttOrder.symbol}-${gttOrder.order_index}`}
                                      className={isMatchingOrder ? "bg-primary/20 hover:bg-primary/25" : ""}
                                    >
                                      <TableCell className="font-medium">
                                        #{gttOrder.order_index}
                                        {gttOrder.is_current && (
                                          <Badge variant="outline" className="ml-2 text-xs">
                                            Current
                                          </Badge>
                                        )}
                                      </TableCell>
                                      <TableCell>{gttOrder.amount}</TableCell>
                                      <TableCell>{formatCurrency(gttOrder.price)}</TableCell>
                                      <TableCell>
                                        {getStatusBadge(gttOrder.status, gttOrder.is_current)}
                                      </TableCell>
                                      <TableCell className="font-mono text-xs text-muted-foreground">
                                        {gttOrder.order_id ? `${gttOrder.order_id.slice(0, 8)}...` : "—"}
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )
                    }}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
