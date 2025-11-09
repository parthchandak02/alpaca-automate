"use client"

import { useEffect, useState, useMemo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { DataTable, ColumnHeaderWithDropdown } from "@/components/data-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ColumnDef } from "@tanstack/react-table"
import { Wifi, WifiOff, ChevronRight, ChevronDown } from "lucide-react"

// Force Place Button Component
// Currently places the current order, but designed for future multi-order placement functionality
function ForcePlaceButton({ symbol, onExecute }: { symbol: string; onExecute: () => void }) {
  const [loading, setLoading] = useState(false)
  const apiPort = process.env.NEXT_PUBLIC_API_PORT || '8080'
  const apiBaseUrl = `http://localhost:${apiPort}`

  const handleForcePlace = async () => {
    if (!confirm(`Force place current order for ${symbol}? This will place the order and advance to the next one.`)) {
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/simulate-fill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbol }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        alert(`✅ Order placed!\n${data.message}\n${data.next_order_placed ? `✅ Next order placed (Order ${data.next_order})` : data.error ? `⚠️ ${data.error}` : ''}`)
        // Refresh the data
        onExecute()
      } else {
        alert(`❌ Error: ${data.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error force placing:', error)
      alert(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleForcePlace}
      disabled={loading}
      className="h-7 text-xs"
    >
      {loading ? "Placing..." : "Force Place"}
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
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [gttOrders, setGttOrders] = useState<GTTOrder[]>([])
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [prices, setPrices] = useState<Prices>({})
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingStep, setLoadingStep] = useState<string>("")
  const [loadingStatus, setLoadingStatus] = useState<{
    is_loading: boolean
    current_step: string
    progress: number
    total: number
    current_symbol: string
    message: string
    loaded_symbols?: string[]
  } | null>(null)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [isOnline, setIsOnline] = useState(true)

  const fetchLoadingStatus = async () => {
    try {
      const apiPort = process.env.NEXT_PUBLIC_API_PORT || '8080'
      const apiBaseUrl = `http://localhost:${apiPort}`
      const statusRes = await fetch(`${apiBaseUrl}/api/status`)
      if (statusRes.ok) {
        const statusData = await statusRes.json()
        setLoadingStatus(statusData)
        if (statusData.is_loading && statusData.message) {
          setLoadingStep(statusData.message)
        }
      }
    } catch (error) {
      // Ignore errors - status endpoint might not be available
    }
  }

  const fetchData = async () => {
    try {
      setIsOnline(true)
      
      // First check loading status
      await fetchLoadingStatus()
      
      setLoadingStep("Connecting to server...")
      const apiPort = process.env.NEXT_PUBLIC_API_PORT || '8080'
      const apiBaseUrl = `http://localhost:${apiPort}`
      
      // Poll loading status while fetching orders
      const statusInterval = setInterval(fetchLoadingStatus, 500)
      
      setLoadingStep("Fetching orders...")
      const ordersRes = await fetch(`${apiBaseUrl}/api/orders`)
      
      clearInterval(statusInterval)
      await fetchLoadingStatus() // Get final status
      
      setLoadingStep("Fetching account information...")
      const accountRes = await fetch(`${apiBaseUrl}/api/account`)
      
      setLoadingStep("Fetching market prices...")
      const pricesRes = await fetch(`${apiBaseUrl}/api/prices`)

      if (ordersRes.ok) {
        const ordersData = await ordersRes.json()
        setActiveOrders(ordersData.active_orders || [])
        setGttOrders(ordersData.gtt_orders || [])
      }

      if (accountRes.ok) {
        const accountData = await accountRes.json()
        setAccount(accountData)
      }

      if (pricesRes.ok) {
        const pricesData = await pricesRes.json()
        setPrices(pricesData.prices || {})
        setMarketStatus(pricesData.market_status || null)
      }

      // Update last sync time on successful fetch
      setLastSyncTime(new Date())
      setLoadingStep("")
      setLoadingStatus(null)
    } catch (error) {
      console.error("Error fetching data:", error)
      setIsOnline(false)
      setLoadingStep(`Error: ${error instanceof Error ? error.message : 'Connection failed'}`)
      setLoadingStatus(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000) // Refresh every 5 seconds
    return () => clearInterval(interval)
  }, [])

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
        // Show Force Place button for current order (even if pending - will place it first)
        if (order.is_current) {
          return <ForcePlaceButton symbol={order.symbol} onExecute={onRefresh} />
        }
        return <span className="text-muted-foreground text-xs">—</span>
      },
    },
  ]

  // Create a set of GTT order IDs for quick lookup (to show which orders came from GTT)
  const gttOrderIds = useMemo(() => {
    return new Set(gttOrders.filter(o => o.order_id).map(o => o.order_id))
  }, [gttOrders])

  // Group GTT orders by symbol
  const gttBySymbol: Record<string, GTTOrder[]> = useMemo(() => {
    const grouped: Record<string, GTTOrder[]> = {}
    gttOrders.forEach((order) => {
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
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleString()}
        </span>
      ),
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
              e.stopPropagation()
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
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header - Compact */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
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
              <p className="text-xs text-muted-foreground">Monitor and manage your conditional orders</p>
            </div>
          </div>
          {/* Right side - Stacked vertically for less clutter */}
          <div className="flex flex-col items-end gap-2">
            {/* Minimal Sync Status - Icon only with timestamp */}
            <div className="flex items-center gap-2">
              {isOnline ? (
                <div className="flex flex-col items-end gap-0.5">
                  <div className="relative flex items-center gap-1.5">
                    <Wifi className="h-4 w-4 text-green-500" />
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                    </span>
                    {marketStatus && marketStatus.is_open === false && (
                      <span className="text-[8px] text-yellow-500/70 ml-0.5" title="Markets closed - prices may be stale">
                        ⚠
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-muted-foreground leading-tight">
                    {formatLastSyncDetailed()}
                  </span>
                  {marketStatus && marketStatus.is_open === false && marketStatus.next_open && (
                    <span className="text-[8px] text-muted-foreground/70 leading-tight" title={`Markets reopen: ${new Date(marketStatus.next_open).toLocaleString()}`}>
                      Closed
                    </span>
                  )}
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
            {/* Account Summary - Compact */}
            {account && (
              <Card className="w-48">
                <CardHeader className="pb-1 pt-1.5 px-2.5">
                  <CardTitle className="text-[10px] font-medium">Account</CardTitle>
                </CardHeader>
                <CardContent className="py-1 px-2.5 space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Buying Power</span>
                    <span className="font-medium">{formatCurrency(account.buying_power)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Cash</span>
                    <span className="font-medium">{formatCurrency(account.cash)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Equity</span>
                    <span className="font-medium">{formatCurrency(account.equity)}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="orders" className="w-full">
          <TabsList>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="gtt">GTT</TabsTrigger>
          </TabsList>

          {/* GTT Orders Tab */}
          <TabsContent value="gtt" className="space-y-4">
            {loading ? (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-4">
                    <div className="relative">
                      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-lg font-medium text-foreground">Loading orders...</p>
                      {loadingStep && (
                        <p className="text-sm text-muted-foreground animate-pulse">{loadingStep}</p>
                      )}
                      {!isOnline && (
                        <p className="text-sm text-destructive mt-2">⚠️ Server connection failed. Please check if the monitor is running.</p>
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
                  const pendingOrders = orders.filter(o => {
                    const status = o.status.toLowerCase()
                    // Internal pending status or Alpaca statuses that mean pending
                    return (status === "pending" || status === "placed" || 
                            status === "new" || status === "accepted" || 
                            status === "pending_new" || status === "pending_replace" ||
                            status === "accepted_for_bidding" || status === "stopped" ||
                            status === "suspended" || status === "partially_filled") && !o.is_current
                  })
                  
                  const columns = createGTTColumns(currentPrice, fetchData)
                  
                  return (
                    <AccordionItem key={symbol} value={symbol} className="border-none">
                      <Card>
                        <CardHeader>
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center justify-between w-full pr-4">
                              <div className="text-left">
                                <CardTitle className="text-xl">{symbol}</CardTitle>
                                <CardDescription className="mt-1">
                                  {orders[0]?.company} • {orders.length} orders in sequence
                                  {completedOrders.length > 0 && (
                                    <span className="ml-2 text-green-400">
                                      • {completedOrders.length} completed
                                    </span>
                                  )}
                                  {pendingOrders.length > 0 && (
                                    <span className="ml-2 text-primary">
                                      • {pendingOrders.length} pending
                                    </span>
                                  )}
                                </CardDescription>
                              </div>
                              <div className="flex items-center gap-3">
                                {currentPrice && (
                                  <Badge variant="outline" className="text-sm shrink-0">
                                    Current: {formatCurrency(currentPrice)}
                                  </Badge>
                                )}
                                {(() => {
                                  const currentOrder = orders.find(o => o.is_current)
                                  if (currentOrder) {
                                    return (
                                      <Badge variant="outline" className="text-sm shrink-0">
                                        Next Limit: {formatCurrency(currentOrder.price)}
                                      </Badge>
                                    )
                                  }
                                  return null
                                })()}
                              </div>
                            </div>
                          </AccordionTrigger>
                        </CardHeader>
                        <AccordionContent>
                          <CardContent>
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Active
                  {orderCategories.active.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {orderCategories.active.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Orders currently placed and live (buying power locked)</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          {loadingStep || "Loading..."}
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
                      const symbolGTTOrders = gttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="text-sm font-semibold">GTT Orders for {symbol}</h4>
                            <Badge variant="secondary">{symbolGTTOrders.length}</Badge>
                          </div>
                          <div className="overflow-x-auto">
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
                                {symbolGTTOrders.map((gttOrder) => (
                                  <TableRow key={`${gttOrder.symbol}-${gttOrder.order_index}`}>
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
                                ))}
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Completed
                  {orderCategories.completed.length > 0 && (
                    <Badge variant="default" className="ml-2">
                      {orderCategories.completed.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Orders that have been filled (executed)</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          {loadingStep || "Loading..."}
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
                      const symbolGTTOrders = gttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="text-sm font-semibold">GTT Orders for {symbol}</h4>
                            <Badge variant="secondary">{symbolGTTOrders.length}</Badge>
                          </div>
                          <div className="overflow-x-auto">
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
                                {symbolGTTOrders.map((gttOrder) => (
                                  <TableRow key={`${gttOrder.symbol}-${gttOrder.order_index}`}>
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
                                ))}
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Cancelled
                  {orderCategories.cancelled.length > 0 && (
                    <Badge variant="destructive" className="ml-2">
                      {orderCategories.cancelled.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Orders that were cancelled or expired</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          {loadingStep || "Loading..."}
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
                      const symbolGTTOrders = gttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="text-sm font-semibold">GTT Orders for {symbol}</h4>
                            <Badge variant="secondary">{symbolGTTOrders.length}</Badge>
                          </div>
                          <div className="overflow-x-auto">
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
                                {symbolGTTOrders.map((gttOrder) => (
                                  <TableRow key={`${gttOrder.symbol}-${gttOrder.order_index}`}>
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
                                ))}
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
