"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import useSWR, { mutate } from "swr"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { DataTable, ColumnHeaderWithDropdown } from "@/components/data-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { StockChart } from "@/components/stock-chart"
import { ColumnDef } from "@tanstack/react-table"
import { Wifi, WifiOff, ChevronRight, ChevronDown, X, Check, TestTube, ChartCandlestick, RefreshCw, Activity, TriangleAlert, CheckCircle2, Clock, Circle, CircleDot, AlertCircle, Search, RotateCcw, Edit2, Save, Upload, TrendingUp, TrendingDown, Wallet, Sparkles, ExternalLink, Download, FileText, AlertTriangle, LogOut } from "lucide-react"

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
  // Use NEXT_PUBLIC_API_HOST if set (for production), otherwise detect from window (for local dev)
  let apiHost = process.env.NEXT_PUBLIC_API_HOST
  if (!apiHost && typeof window !== 'undefined') {
    // If on production domain (not localhost), use api- subdomain
    const hostname = window.location.hostname
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      // Extract base domain and prepend 'api-'
      // e.g., alpaca.parthchandak.info -> api-alpaca.parthchandak.info
      apiHost = `api-${hostname}`
    } else {
      apiHost = 'localhost'
    }
  } else if (!apiHost) {
    apiHost = 'localhost'
  }
  // Use https in production if API host is provided, otherwise http for local dev
  const protocol = (apiHost && apiHost !== 'localhost') ? 'https' : 'http'
  // Don't append port for standard HTTPS (443) or HTTP (80)
  const portSuffix = (apiPort === '443' || apiPort === '80') ? '' : `:${apiPort}`
  const apiBaseUrl = `${protocol}://${apiHost}${portSuffix}`

  const handleForceFill = async (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent event from bubbling up to table row
    setLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/force-fill-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
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
  is_available_on_alpaca?: boolean
  asset_type?: string  // 'stock' or 'crypto'
  reinstated?: boolean  // Whether this order has been reinstated before
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

interface Position {
  asset_id: string | null
  symbol: string
  display_symbol: string
  exchange: string
  asset_class: string
  qty: number
  side: string
  market_value: number
  avg_entry_price: number
  cost_basis: number
  unrealized_pl: number
  unrealized_plpc: number
  current_price: number
  lastday_price: number | null
  change_today: number | null
  today_pl: number | null
  today_plpc: number | null
}

export default function OrdersPage() {
  const router = useRouter()
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  
  // Get API base URL (needed for auth check and data fetching)
  const apiPort = process.env.NEXT_PUBLIC_API_PORT || '8080'
  // Use NEXT_PUBLIC_API_HOST if set (for production), otherwise detect from window (for local dev)
  let apiHost = process.env.NEXT_PUBLIC_API_HOST
  if (!apiHost && typeof window !== 'undefined') {
    // If on production domain (not localhost), use api- subdomain
    const hostname = window.location.hostname
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      // Extract base domain and prepend 'api-'
      // e.g., alpaca.parthchandak.info -> api-alpaca.parthchandak.info
      apiHost = `api-${hostname}`
    } else {
      apiHost = 'localhost'
    }
  } else if (!apiHost) {
    apiHost = 'localhost'
  }
  // Use https in production if API host is provided, otherwise http for local dev
  const protocol = (apiHost && apiHost !== 'localhost') ? 'https' : 'http'
  // Don't append port for standard HTTPS (443) or HTTP (80)
  const portSuffix = (apiPort === '443' || apiPort === '80') ? '' : `:${apiPort}`
  const apiBaseUrl = `${protocol}://${apiHost}${portSuffix}`
  
  // Logout handler
  const handleLogout = async () => {
    try {
      await fetch(`${apiBaseUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch (err) {
      console.error('Logout error:', err)
    }
    // Always redirect to login, even if logout API call fails
    window.location.href = '/login'
  }

  // Check authentication on mount - protect page client-side
  useEffect(() => {
    let timeoutId: NodeJS.Timeout
    let isMounted = true
    let retryCount = 0
    let authResolved = false // Track if auth check has completed
    const maxRetries = 2 // Reduced retries to fail faster
    const maxTotalTime = 15000 // Maximum 15 seconds total before giving up
    
    // Set a hard timeout to prevent infinite loading
    const hardTimeout = setTimeout(() => {
      if (isMounted && !authResolved) {
        console.error('Auth check exceeded maximum time, redirecting to login')
        authResolved = true
        setIsAuthenticated(false)
        router.push('/login')
      }
    }, maxTotalTime)
    
    const checkAuth = async () => {
      try {
        // Add timeout to prevent hanging
        const controller = new AbortController()
        timeoutId = setTimeout(() => controller.abort(), 5000) // Reduced to 5 seconds per request
        
        const response = await fetch(`${apiBaseUrl}/api/auth/verify`, {
          credentials: 'include',
          signal: controller.signal,
        })
        
        clearTimeout(timeoutId)
        
        if (!isMounted) return
        
        if (response.ok) {
          const data = await response.json()
          if (data.authenticated) {
            authResolved = true
            clearTimeout(hardTimeout)
            setIsAuthenticated(true)
            return
          }
        }
        
        // If we get here, not authenticated
        // Only retry on 401 if we haven't exceeded max retries
        if (response.status === 401 && retryCount < maxRetries) {
          retryCount++
          console.log(`Auth check failed, retrying (${retryCount}/${maxRetries})...`)
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount))
          if (isMounted) {
            checkAuth()
            return
          }
        }
      } catch (err) {
        clearTimeout(timeoutId)
        if (!isMounted) return
        
        // Log error for debugging
        console.error('Auth check failed:', err)
        
        // If it's a network error (not abort), check if we should retry
        const isNetworkError = err instanceof TypeError || 
                              (err instanceof Error && err.name !== 'AbortError')
        
        if (isNetworkError && retryCount < maxRetries) {
          retryCount++
          console.log(`Network error, retrying (${retryCount}/${maxRetries})...`)
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount))
          if (isMounted) {
            checkAuth()
            return
          }
        } else if (err instanceof Error && err.name === 'AbortError' && retryCount < maxRetries) {
          // Timeout error - retry
          retryCount++
          console.log(`Request timeout, retrying (${retryCount}/${maxRetries})...`)
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount))
          if (isMounted) {
            checkAuth()
            return
          }
        }
      }
      
      if (!isMounted) return
      
      // Not authenticated or max retries exceeded - redirect to login
      if (!authResolved) {
        authResolved = true
        clearTimeout(hardTimeout)
        setIsAuthenticated(false)
        router.push('/login')
      }
    }
    
    checkAuth()
    
    return () => {
      isMounted = false
      clearTimeout(hardTimeout)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [router, apiBaseUrl])
  
  // SWR hooks for data fetching - automatic polling, no full page refresh
  // Disable fetching if not authenticated (will be enabled after auth check)
  const fetcher = async (url: string) => {
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        // If response is not OK, try to parse error message
        let errorData
        try {
          errorData = await res.json()
        } catch {
          errorData = { error: `HTTP ${res.status}: ${res.statusText}` }
        }
        throw new Error(errorData.error || `HTTP ${res.status}`)
      }
      return res.json()
    } catch (error) {
      // Log error for debugging
      console.error(`API fetch error for ${url}:`, error)
      // Re-throw so SWR can handle it
      throw error
    }
  }
  
  const { data: ordersData, error: ordersError, isLoading: ordersLoading } = useSWR(
    isAuthenticated === true ? `${apiBaseUrl}/api/orders` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  
  const { data: accountData, error: accountError, isLoading: accountLoading } = useSWR(
    isAuthenticated === true ? `${apiBaseUrl}/api/account` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  
  const { data: pricesData, error: pricesError, isLoading: pricesLoading } = useSWR(
    isAuthenticated === true ? `${apiBaseUrl}/api/prices` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  
  const { data: loadingStatusData, isLoading: statusLoading } = useSWR(
    isAuthenticated === true ? `${apiBaseUrl}/api/status` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: false } // Poll status more frequently
  )
  
  const { data: positionsData, error: positionsError, isLoading: positionsLoading } = useSWR(
    isAuthenticated === true ? `${apiBaseUrl}/api/positions` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: false }
  )
  
  // Extract data from SWR responses
  const activeOrders = ordersData?.active_orders || []
  const gttOrders = ordersData?.gtt_orders || []
  const account = accountData || null
  const prices = pricesData?.prices || {}
  const marketStatus = pricesData?.market_status || null
  const loadingStatus = loadingStatusData || null
  const stockPositions = positionsData?.stocks || []
  const cryptoPositions = positionsData?.crypto || []
  
  // Helper function to get Alpaca order URL
  const getAlpacaOrderUrl = (orderId: string): string => {
    if (!orderId) return '#'
    // Alpaca order page format: https://app.alpaca.markets/dashboard/order/{order_id}
    return `https://app.alpaca.markets/dashboard/order/${orderId}`
  }
  
  // Reusable Order ID component with link to Alpaca
  const OrderIdLink = ({ orderId, className = "font-mono text-xs text-muted-foreground" }: { orderId: string | null, className?: string }) => {
    if (!orderId) {
      return <span className={className}>—</span>
    }
    
    const alpacaUrl = getAlpacaOrderUrl(orderId)
    
    return (
      <a
        href={alpacaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${className} hover:text-primary hover:underline inline-flex items-center gap-1 transition-colors cursor-pointer group`}
        title={`View order ${orderId} on Alpaca`}
        onClick={(e) => e.stopPropagation()} // Prevent row click when clicking order ID
      >
        <span>{orderId.slice(0, 8)}...</span>
        <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" />
      </a>
    )
  }
  
  // Refresh function for manual refresh (used by buttons)
  const refreshData = () => {
    if (isAuthenticated === true) {
      mutate(`${apiBaseUrl}/api/orders`)
      mutate(`${apiBaseUrl}/api/account`)
      mutate(`${apiBaseUrl}/api/prices`)
    }
  }
  
  // Determine loading state - show loading if initial load OR backend is processing
  const isLoading = (ordersLoading && activeOrders.length === 0) || loadingStatus?.is_loading
  const isInitialLoad = ordersLoading && activeOrders.length === 0 && !ordersData
  
  // Determine online status from SWR errors
  const isOnline = !ordersError && !accountError && !pricesError
  
  // Track last price update time per symbol
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Record<string, number>>({})
  
  // Update last price update time when prices change
  useEffect(() => {
    if (prices && Object.keys(prices).length > 0) {
      const now = Date.now()
      const updates: Record<string, number> = {}
      Object.keys(prices).forEach(symbol => {
        updates[symbol] = now
      })
      setLastPriceUpdate(prev => ({ ...prev, ...updates }))
    }
  }, [prices])

  // Price status indicator component
  type PriceStatus = 'live' | 'closed' | 'stale'
  
  function getPriceStatus(symbol: string, marketStatus: MarketStatus | null): PriceStatus {
    if (!marketStatus || marketStatus.is_open === null) {
      return 'stale' // Can't determine status
    }
    
    if (!marketStatus.is_open) {
      return 'closed' // Market is closed
    }
    
    // Market is open - check if price is stale
    const lastUpdate = lastPriceUpdate[symbol]
    if (!lastUpdate) {
      return 'stale' // No price data yet
    }
    
    const secondsSinceUpdate = (Date.now() - lastUpdate) / 1000
    const STALE_THRESHOLD = 15 // Consider stale if no update for 15 seconds
    
    if (secondsSinceUpdate > STALE_THRESHOLD) {
      return 'stale' // Price is stale
    }
    
    return 'live' // Live price
  }
  
  function PriceStatusIndicator({ symbol, marketStatus }: { symbol: string, marketStatus: MarketStatus | null }) {
    const status = getPriceStatus(symbol, marketStatus)
    const [showTooltip, setShowTooltip] = useState(false)
    const [currentTime, setCurrentTime] = useState(Date.now())
    const lastUpdate = lastPriceUpdate[symbol]
    
    // Update current time every second for real-time tooltip
    useEffect(() => {
      const interval = setInterval(() => {
        setCurrentTime(Date.now())
      }, 1000)
      return () => clearInterval(interval)
    }, [])
    
    const secondsSinceUpdate = lastUpdate ? Math.floor((currentTime - lastUpdate) / 1000) : null
    
    let icon: React.ReactNode
    let tooltipTitle: string
    let tooltipContent: React.ReactNode
    
    if (status === 'live') {
      icon = (
        <Circle 
          className="h-2.5 w-2.5 text-yellow-400 fill-yellow-400 animate-pulse" 
          style={{ animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
        />
      )
      tooltipTitle = "Live Price"
      tooltipContent = (
        <div>
          <p>Price is updating in real-time</p>
          {secondsSinceUpdate !== null && (
            <p className="mt-1 text-xs">Last update: {secondsSinceUpdate}s ago</p>
          )}
        </div>
      )
    } else if (status === 'closed') {
      icon = <CircleDot className="h-2.5 w-2.5 text-gray-400 fill-gray-400" />
      tooltipTitle = "Market Closed"
      tooltipContent = (
        <div>
          <p>Markets are currently closed</p>
          {marketStatus?.next_open && (
            <p className="mt-1 text-xs">Opens: {formatMarketTime(marketStatus.next_open)}</p>
          )}
        </div>
      )
    } else {
      icon = <AlertCircle className="h-2.5 w-2.5 text-orange-400 fill-orange-400" />
      tooltipTitle = "Price Stale"
      tooltipContent = (
        <div>
          <p>No price update received</p>
          {secondsSinceUpdate !== null ? (
            <p className="mt-1 text-xs">Last update: {secondsSinceUpdate}s ago</p>
          ) : (
            <p className="mt-1 text-xs">No price data available</p>
          )}
        </div>
      )
    }
    
    return (
      <div 
        className="relative inline-flex items-center ml-1 cursor-help"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {icon}
        {showTooltip && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-[100] bg-popover border border-border rounded-md shadow-lg p-2 min-w-[200px]">
            <p className="text-xs font-semibold text-foreground mb-1">{tooltipTitle}</p>
            <div className="text-xs text-muted-foreground">
              {tooltipContent}
            </div>
            {/* Arrow pointing down */}
            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-popover"></div>
          </div>
        )}
      </div>
    )
  }
  
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
  
  // State for editing GTT orders
  const [editingOrder, setEditingOrder] = useState<{symbol: string, orderIndex: number, field: 'price' | 'amount'} | null>(null)
  const [editValue, setEditValue] = useState<string>("")
  
  // State for CSV uploads
  const [uploadingStocks, setUploadingStocks] = useState(false)
  const [uploadingCrypto, setUploadingCrypto] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)
  
  // State for CSV preview
  const [csvPreview, setCsvPreview] = useState<{
    show: boolean
    type: 'stocks' | 'crypto'
    file: File | null
    previewData: any
    errors: string[]
    warnings: string[]
  } | null>(null)
  
  // Search/filter state for GTT orders
  const [gttSearchQuery, setGttSearchQuery] = useState<string>("")
  const [expandedAccordion, setExpandedAccordion] = useState<string | null>(null) // Track which accordion is open for lazy loading
  const [highlightedPrices, setHighlightedPrices] = useState<Record<string, number | null>>({}) // Track highlighted prices per symbol
  
  // Tooltip state for status icons
  const [tooltipState, setTooltipState] = useState<{
    tradingMode: boolean
    sync: boolean
    warning: boolean
    logout: boolean
  }>({ tradingMode: false, sync: false, warning: false, logout: false })
  
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

  // Handle editing GTT orders
  const handleStartEdit = (symbol: string, orderIndex: number, field: 'price' | 'amount', currentValue: number) => {
    setEditingOrder({ symbol, orderIndex, field })
    setEditValue(currentValue.toString())
  }

  const handleCancelEdit = () => {
    setEditingOrder(null)
    setEditValue("")
  }

  const handleSaveEdit = async () => {
    if (!editingOrder || !editValue) return
    
    const numValue = parseFloat(editValue)
    if (isNaN(numValue) || numValue <= 0) {
      setUploadMessage({ type: 'error', text: 'Invalid value. Must be a positive number.' })
      setTimeout(() => setUploadMessage(null), 3000)
      return
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/edit-gtt-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          symbol: editingOrder.symbol,
          order_index: editingOrder.orderIndex,
          [editingOrder.field]: numValue,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update order')
      }

      // Refresh data
      refreshData()
      setEditingOrder(null)
      setEditValue("")
      setUploadMessage({ type: 'success', text: 'Order updated successfully' })
      setTimeout(() => setUploadMessage(null), 3000)
    } catch (error: any) {
      setUploadMessage({ type: 'error', text: error.message || 'Failed to update order' })
      setTimeout(() => setUploadMessage(null), 3000)
    }
  }

  // Download CSV template
  const handleDownloadTemplate = async (type: 'stocks' | 'crypto') => {
    try {
      const endpoint = type === 'stocks' ? '/api/download-stocks-template' : '/api/download-crypto-template'
      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to download template')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = type === 'stocks' ? 'gtt-stocks-template.csv' : 'gtt-crypto-template.csv'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error: any) {
      setUploadMessage({ type: 'error', text: error.message || 'Failed to download template' })
      setTimeout(() => setUploadMessage(null), 5000)
    }
  }

  // Preview CSV before upload
  const handleCsvPreview = async (file: File, type: 'stocks' | 'crypto') => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('asset_type', type === 'stocks' ? 'stock' : 'crypto')

    try {
      const response = await fetch(`${apiBaseUrl}/api/preview-csv`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to preview CSV')
      }

      const result = await response.json()
      setCsvPreview({
        show: true,
        type,
        file,
        previewData: result.preview || [],
        errors: result.errors || [],
        warnings: result.warnings || [],
      })
    } catch (error: any) {
      setUploadMessage({ type: 'error', text: error.message || 'Failed to preview CSV' })
      setTimeout(() => setUploadMessage(null), 5000)
    }
  }

  // Handle CSV uploads (after preview confirmation)
  const handleCsvUpload = async (file: File, type: 'stocks' | 'crypto') => {
    const formData = new FormData()
    formData.append('file', file)

    if (type === 'stocks') {
      setUploadingStocks(true)
    } else {
      setUploadingCrypto(true)
    }
    setUploadMessage(null)
    setCsvPreview(null) // Close preview modal

    try {
      const endpoint = type === 'stocks' ? '/api/upload-stocks-csv' : '/api/upload-crypto-csv'
      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload CSV')
      }

      const result = await response.json()
      setUploadMessage({ type: 'success', text: result.message || 'CSV uploaded successfully' })
      setTimeout(() => setUploadMessage(null), 5000)
      
      // Refresh data after upload
      setTimeout(() => {
        refreshData()
      }, 1000)
    } catch (error: any) {
      setUploadMessage({ type: 'error', text: error.message || 'Failed to upload CSV' })
      setTimeout(() => setUploadMessage(null), 5000)
    } finally {
      if (type === 'stocks') {
        setUploadingStocks(false)
      } else {
        setUploadingCrypto(false)
      }
    }
  }

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

  // Get tooltip text for order status
  const getStatusTooltip = (status: string, isCurrent?: boolean): string => {
    const statusLower = status.toLowerCase()
    
    // Status explanations
    const statusTooltips: Record<string, string> = {
      "filled": "Order fully executed - All shares have been purchased/sold successfully",
      "partially_filled": "Order partially executed - Some shares filled, waiting for remaining shares",
      "pending": isCurrent 
        ? "GTT order waiting for trigger price - Not yet placed on Alpaca, will place when price condition is met"
        : "Order not yet placed - Waiting to be submitted to Alpaca",
      "placed": "Order placed on Alpaca - Live order, buying power locked, waiting to fill",
      "new": "Order submitted and accepted - Live on Alpaca, buying power locked",
      "accepted": "Order accepted by Alpaca - Live order, buying power locked",
      "pending_new": "Order submission pending - Alpaca is processing the order",
      "pending_replace": "Order modification pending - Alpaca is processing the change",
      "accepted_for_bidding": "Order accepted for bidding - Live order waiting to fill",
      "stopped": "Order stopped - Temporarily halted by Alpaca",
      "suspended": "Order suspended - Temporarily paused by Alpaca",
      "expired": "Order expired - DAY order wasn't filled by market close (4:00 PM ET). Order automatically cancelled",
      "rejected": "Order rejected - Alpaca rejected the order (insufficient funds, invalid parameters, market closed, etc.)",
      "cancelled": "Order cancelled - Manually cancelled or cancelled by system",
      "canceled": "Order cancelled - Manually cancelled or cancelled by system",
      "pending_cancel": "Cancellation pending - Request to cancel sent, waiting for confirmation",
    }
    
    return statusTooltips[statusLower] || `Order status: ${status}`
  }

  const getStatusBadge = (status: string, isCurrent?: boolean) => {
    const statusLower = status.toLowerCase()
    const tooltip = getStatusTooltip(status, isCurrent)
    
    // Filled orders: green (Alpaca's official terminal status - order is fully executed and complete)
    if (statusLower === "filled") {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 cursor-help" title={tooltip}>FILLED</Badge>
    }
    
    // Partially filled orders: yellow-green (order is partially executed, still waiting for more fills)
    if (statusLower === "partially_filled") {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 cursor-help" title={tooltip}>PARTIALLY FILLED</Badge>
    }
    
    // Current order that's placed (live, buying power locked): yellow
    // Alpaca statuses: new, accepted = order is live
    if (isCurrent && (statusLower === "new" || statusLower === "accepted" || statusLower === "placed")) {
      return <Badge className="bg-primary/20 text-primary border-primary/30 cursor-help" title={tooltip}>PLACED</Badge>
    }
    
    // Current order that's partially filled: yellow-green
    if (isCurrent && statusLower === "partially_filled") {
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 cursor-help" title={tooltip}>PARTIALLY FILLED</Badge>
    }
    
    // Current order that's still pending (not yet placed): yellow
    if (isCurrent && statusLower === "pending") {
      return <Badge className="bg-primary/20 text-primary border-primary/30 cursor-help" title={tooltip}>PENDING</Badge>
    }
    
    // Orders that are live (placed in Alpaca, buying power locked)
    // Alpaca statuses: new, accepted, pending_new, pending_replace, accepted_for_bidding, stopped, suspended
    if (statusLower === "new" || statusLower === "accepted" || 
        statusLower === "pending_new" || statusLower === "pending_replace" || 
        statusLower === "accepted_for_bidding" || statusLower === "stopped" || 
        statusLower === "suspended" || statusLower === "placed") {
      return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border cursor-help" title={tooltip}>PLACED</Badge>
    }
    
    // Pending orders (not yet placed): grayish white
    if (statusLower === "pending") {
      return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border cursor-help" title={tooltip}>PENDING</Badge>
    }
    
    // Expired orders: red/orange
    if (statusLower === "expired") {
      return <Badge variant="outline" className="bg-orange-500/20 text-orange-400 border-orange-500/30 cursor-help" title={tooltip}>EXPIRED</Badge>
    }
    
    // Rejected orders: red
    if (statusLower === "rejected") {
      return <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30 cursor-help" title={tooltip}>REJECTED</Badge>
    }
    
    // Cancelled orders: gray
    if (statusLower === "cancelled" || statusLower === "canceled") {
      return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border cursor-help" title={tooltip}>CANCELLED</Badge>
    }
    
    // Pending cancel: yellow
    if (statusLower === "pending_cancel") {
      return <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 cursor-help" title={tooltip}>PENDING CANCEL</Badge>
    }
    
    // Other statuses: display as-is with tooltip
    return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border cursor-help" title={tooltip}>{status.toUpperCase()}</Badge>
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value)
  }

  const formatPositionCurrency = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-"
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  const formatPositionPercent = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-"
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  const formatPositionNumber = (value: number | null | undefined, decimals: number = 2): string => {
    if (value === null || value === undefined) return "-"
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  }

  // Helper function to get Alpaca trading URL for positions
  const getAlpacaTradingUrl = (position: Position): string => {
    if (position.asset_class === 'crypto') {
      // For crypto, use symbol/USD format (e.g., SOL/USD, BTC/USD)
      // The symbol might already have /USD or we need to add it
      const symbol = position.symbol.includes('/USD') ? position.symbol : `${position.display_symbol}/USD`
      return `https://app.alpaca.markets/trade/${symbol}`
    } else {
      // For stocks, use symbol with asset_class parameter
      return `https://app.alpaca.markets/trade/${position.display_symbol}?asset_class=stocks`
    }
  }

  // Column definitions for Positions
  const positionsColumns: ColumnDef<Position>[] = useMemo(() => [
    {
      accessorKey: "display_symbol",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Asset" />,
      filterFn: (row, id, value) => {
        const symbol = row.getValue(id) as string
        return symbol.toLowerCase().includes(value.toLowerCase())
      },
      cell: ({ row }) => {
        const position = row.original
        const tradingUrl = getAlpacaTradingUrl(position)
        return (
          <div className="flex items-center gap-2">
            <a
              href={tradingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline hover:text-primary transition-colors inline-flex items-center gap-1"
              onClick={(e) => e.stopPropagation()} // Prevent row click when clicking link
            >
              <span>{position.display_symbol}</span>
              <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" />
            </a>
            {position.asset_class === 'crypto' && (
              <Badge variant="outline" className="text-xs bg-muted/50 text-muted-foreground">
                CRYPTO
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "current_price",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Price" filterType="number" />,
      filterFn: (row, id, value) => {
        const price = row.getValue(id) as number
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return price.toString().includes(value) || Math.abs(price - numValue) < 0.01
      },
      cell: ({ row }) => {
        return <span className="tabular-nums">{formatPositionCurrency(row.getValue("current_price"))}</span>
      },
    },
    {
      accessorKey: "qty",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Qty" filterType="number" />,
      filterFn: (row, id, value) => {
        const qty = Math.abs(row.getValue(id) as number)
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return qty.toString().includes(value) || Math.abs(qty - numValue) < 0.0001
      },
      cell: ({ row }) => {
        const qty = row.getValue("qty") as number
        return <span className="tabular-nums">{formatPositionNumber(Math.abs(qty), 8)}</span>
      },
    },
    {
      accessorKey: "side",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Side" />,
      filterFn: (row, id, value) => {
        const side = row.getValue(id) as string
        return side.toLowerCase().includes(value.toLowerCase())
      },
      cell: ({ row }) => {
        const side = row.getValue("side") as string
        return (
          <Badge variant={side === 'long' ? 'default' : 'secondary'} className="text-xs">
            {side.charAt(0).toUpperCase() + side.slice(1)}
          </Badge>
        )
      },
    },
    {
      accessorKey: "market_value",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Market Value" filterType="number" />,
      filterFn: (row, id, value) => {
        const marketValue = row.getValue(id) as number
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return marketValue.toString().includes(value) || Math.abs(marketValue - numValue) < 0.01
      },
      cell: ({ row }) => {
        return <span className="tabular-nums">{formatPositionCurrency(row.getValue("market_value"))}</span>
      },
    },
    {
      accessorKey: "avg_entry_price",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Avg Entry" filterType="number" />,
      filterFn: (row, id, value) => {
        const avgEntry = row.getValue(id) as number
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return avgEntry.toString().includes(value) || Math.abs(avgEntry - numValue) < 0.01
      },
      cell: ({ row }) => {
        return <span className="tabular-nums">{formatPositionCurrency(row.getValue("avg_entry_price"))}</span>
      },
    },
    {
      accessorKey: "cost_basis",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Cost Basis" filterType="number" />,
      filterFn: (row, id, value) => {
        const costBasis = row.getValue(id) as number
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return costBasis.toString().includes(value) || Math.abs(costBasis - numValue) < 0.01
      },
      cell: ({ row }) => {
        return <span className="tabular-nums">{formatPositionCurrency(row.getValue("cost_basis"))}</span>
      },
    },
    {
      id: "today_plpc",
      accessorFn: (row) => row.today_plpc ?? null,
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Today's P/L (%)" filterType="number" />,
      filterFn: (row, id, value) => {
        const todayPlpc = row.original.today_plpc
        if (todayPlpc === null || todayPlpc === undefined) return value === "" || value === "-"
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return todayPlpc.toString().includes(value) || Math.abs(todayPlpc - numValue) < 0.01
      },
      cell: ({ row }) => {
        const todayPlpc = row.original.today_plpc
        if (todayPlpc === null || todayPlpc === undefined) {
          return <span className="text-muted-foreground">-</span>
        }
        const isPositive = todayPlpc >= 0
        return (
          <span className={`tabular-nums flex items-center gap-1 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {formatPositionPercent(todayPlpc)}
          </span>
        )
      },
    },
    {
      id: "today_pl",
      accessorFn: (row) => row.today_pl ?? null,
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Today's P/L ($)" filterType="number" />,
      filterFn: (row, id, value) => {
        const todayPl = row.original.today_pl
        if (todayPl === null || todayPl === undefined) return value === "" || value === "-"
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return todayPl.toString().includes(value) || Math.abs(todayPl - numValue) < 0.01
      },
      cell: ({ row }) => {
        const todayPl = row.original.today_pl
        if (todayPl === null || todayPl === undefined) {
          return <span className="text-muted-foreground">-</span>
        }
        const isPositive = todayPl >= 0
        return (
          <span className={`tabular-nums ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {formatPositionCurrency(todayPl)}
          </span>
        )
      },
    },
    {
      accessorKey: "unrealized_plpc",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Total P/L (%)" filterType="number" />,
      filterFn: (row, id, value) => {
        const plpc = row.getValue(id) as number
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return plpc.toString().includes(value) || Math.abs(plpc - numValue) < 0.01
      },
      cell: ({ row }) => {
        const plpc = row.getValue("unrealized_plpc") as number
        const isPositive = plpc >= 0
        return (
          <span className={`tabular-nums flex items-center gap-1 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {formatPositionPercent(plpc)}
          </span>
        )
      },
    },
    {
      accessorKey: "unrealized_pl",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Total P/L ($)" filterType="number" />,
      filterFn: (row, id, value) => {
        const pl = row.getValue(id) as number
        if (!value) return true
        const numValue = parseFloat(value)
        if (isNaN(numValue)) return true
        return pl.toString().includes(value) || Math.abs(pl - numValue) < 0.01
      },
      cell: ({ row }) => {
        const pl = row.getValue("unrealized_pl") as number
        const isPositive = pl >= 0
        return (
          <span className={`tabular-nums ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {formatPositionCurrency(pl)}
          </span>
        )
      },
    },
  ], [])

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
      accessorKey: "symbol",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Symbol" filterType="text" />,
      cell: ({ row }) => {
        const order = row.original
        return (
          <div className="flex items-center gap-2">
            {order.symbol}
          </div>
        )
      },
    },
    {
      accessorKey: "company",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Description" />,
      cell: ({ row }) => {
        const order = row.original
        return (
          <div className="flex items-center gap-2">
            {order.company || '-'}
          </div>
        )
      },
    },
    {
      accessorKey: "amount",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Amount" filterType="number" />,
      cell: ({ row }) => {
        const order = row.original
        const isEditing = editingOrder?.symbol === order.symbol && 
                         editingOrder?.orderIndex === order.order_index - 1 && 
                         editingOrder?.field === 'amount'
        const canEdit = order.status.toLowerCase() !== 'filled'
        
        if (isEditing) {
          return (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="h-7 w-20 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit()
                  if (e.key === 'Escape') handleCancelEdit()
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={handleSaveEdit}
              >
                <Save className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={handleCancelEdit}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )
        }
        
        return (
          <div className="flex items-center gap-1 group">
            <span>{order.amount}</span>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleStartEdit(order.symbol, order.order_index - 1, 'amount', order.amount)}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "price",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Trigger Price" filterType="number" />,
      cell: ({ row }) => {
        const order = row.original
        const isEditing = editingOrder?.symbol === order.symbol && 
                         editingOrder?.orderIndex === order.order_index - 1 && 
                         editingOrder?.field === 'price'
        const canEdit = order.status.toLowerCase() !== 'filled'
        
        if (isEditing) {
          return (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="0.01"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="h-7 w-24 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit()
                  if (e.key === 'Escape') handleCancelEdit()
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={handleSaveEdit}
              >
                <Save className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={handleCancelEdit}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )
        }
        
        const isHighlighted = highlightedPrices[order.symbol] === order.price
        
        return (
          <div 
            className={`flex items-center gap-1 group transition-colors cursor-pointer ${
              isHighlighted ? 'bg-primary/20 rounded px-1 py-0.5' : ''
            }`}
            data-order-price={`${order.symbol}-${order.price.toFixed(2)}`}
            onMouseEnter={() => {
              setHighlightedPrices(prev => ({ ...prev, [order.symbol]: order.price }))
            }}
            onMouseLeave={() => {
              setHighlightedPrices(prev => ({ ...prev, [order.symbol]: null }))
            }}
            onClick={() => {
              // Scroll to chart line - find the chart container and scroll to it
              const chartContainer = document.querySelector(`[data-chart-symbol="${order.symbol}"]`)
              if (chartContainer) {
                chartContainer.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }}
          >
            <span className={`font-medium ${isHighlighted ? 'font-semibold' : ''}`}>{formatCurrency(order.price)}</span>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  handleStartEdit(order.symbol, order.order_index - 1, 'price', order.price)
                }}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
            )}
          </div>
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
        <OrderIdLink orderId={row.original.order_id} className="font-mono text-xs text-yellow-400" />
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

  // Create a mapping of symbols to asset_type from GTT orders
  const symbolAssetTypeMap = useMemo(() => {
    const map: Record<string, string> = {}
    gttOrders.forEach((order: GTTOrder) => {
      if (order.asset_type) {
        map[order.symbol] = order.asset_type
      }
    })
    return map
  }, [gttOrders])

  // Separate active orders by asset type (infer from GTT orders)
  const stocksActiveOrders = useMemo(() => {
    return activeOrders.filter((order: ActiveOrder) => {
      const assetType = symbolAssetTypeMap[order.symbol]
      return assetType === 'stock' || !assetType // Default to stock if unknown
    })
  }, [activeOrders, symbolAssetTypeMap])

  const cryptoActiveOrders = useMemo(() => {
    return activeOrders.filter((order: ActiveOrder) => {
      const assetType = symbolAssetTypeMap[order.symbol]
      return assetType === 'crypto'
    })
  }, [activeOrders, symbolAssetTypeMap])

  // Separate GTT orders by asset type
  const stocksGttOrders = useMemo(() => {
    return gttOrders.filter((order: GTTOrder) => order.asset_type === 'stock' || !order.asset_type)
  }, [gttOrders])

  const cryptoGttOrders = useMemo(() => {
    return gttOrders.filter((order: GTTOrder) => order.asset_type === 'crypto')
  }, [gttOrders])

  // Group stocks GTT orders by symbol
  const stocksGttBySymbol: Record<string, GTTOrder[]> = useMemo(() => {
    const grouped: Record<string, GTTOrder[]> = {}
    stocksGttOrders.forEach((order: GTTOrder) => {
      if (!grouped[order.symbol]) {
        grouped[order.symbol] = []
      }
      grouped[order.symbol].push(order)
    })
    return grouped
  }, [stocksGttOrders])

  // Group crypto GTT orders by symbol
  const cryptoGttBySymbol: Record<string, GTTOrder[]> = useMemo(() => {
    const grouped: Record<string, GTTOrder[]> = {}
    cryptoGttOrders.forEach((order: GTTOrder) => {
      if (!grouped[order.symbol]) {
        grouped[order.symbol] = []
      }
      grouped[order.symbol].push(order)
    })
    return grouped
  }, [cryptoGttOrders])

  // Filter GTT orders by search query (for stocks)
  const filteredStocksGttBySymbol: Record<string, GTTOrder[]> = useMemo(() => {
    if (!gttSearchQuery.trim()) {
      return stocksGttBySymbol
    }
    
    const query = gttSearchQuery.toLowerCase().trim()
    const filtered: Record<string, GTTOrder[]> = {}
    
    Object.entries(stocksGttBySymbol).forEach(([symbol, orders]) => {
      const firstOrder = orders[0]
      const matchesSymbol = symbol.toLowerCase().includes(query)
      const matchesCompany = firstOrder?.company?.toLowerCase().includes(query)
      
      if (matchesSymbol || matchesCompany) {
        filtered[symbol] = orders
      }
    })
    
    return filtered
  }, [stocksGttBySymbol, gttSearchQuery])

  // Filter GTT orders by search query (for crypto)
  const filteredCryptoGttBySymbol: Record<string, GTTOrder[]> = useMemo(() => {
    if (!gttSearchQuery.trim()) {
      return cryptoGttBySymbol
    }
    
    const query = gttSearchQuery.toLowerCase().trim()
    const filtered: Record<string, GTTOrder[]> = {}
    
    Object.entries(cryptoGttBySymbol).forEach(([symbol, orders]) => {
      const firstOrder = orders[0]
      const matchesSymbol = symbol.toLowerCase().includes(query)
      const matchesCompany = firstOrder?.company?.toLowerCase().includes(query)
      
      if (matchesSymbol || matchesCompany) {
        filtered[symbol] = orders
      }
    })
    
    return filtered
  }, [cryptoGttBySymbol, gttSearchQuery])

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
      id: "current_price",
      header: ({ column }) => <ColumnHeaderWithDropdown column={column} title="Current Price" filterType="number" />,
      cell: ({ row }) => {
        const symbol = row.original.symbol
        const currentPrice = prices[symbol]
        if (currentPrice) {
          return (
            <span className="font-medium text-foreground">
              {formatCurrency(currentPrice)}
            </span>
          )
        }
        return <span className="text-muted-foreground text-xs">—</span>
      },
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
      accessorKey: "id",
      header: "Order ID",
      cell: ({ row }) => {
        const orderId = row.original.id
        return <OrderIdLink orderId={orderId} className="font-mono text-xs text-muted-foreground" />
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
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const order = row.original
        const symbol = order.symbol
        const symbolGTTOrders = gttBySymbol[symbol] || []
        
        // Check if this is a cancelled/expired order that can be reinstated
        const isCancelledStatus = ["expired", "cancelled", "rejected", "pending_cancel", "canceled"].includes(order.status.toLowerCase())
        
        if (!isCancelledStatus || symbolGTTOrders.length === 0) {
          return <span className="text-muted-foreground text-xs">—</span>
        }
        
        // Find the matching GTT order by order_id (if order was placed)
        let matchingGTTOrder = symbolGTTOrders.find(gtt => gtt.order_id === order.id)
        
        // If no match by order_id, find the first cancelled/expired GTT order for this symbol
        // This handles cases where order was cancelled/expired before being placed
        if (!matchingGTTOrder) {
          const cancelledGTTOrders = symbolGTTOrders.filter(gtt => 
            ["expired", "cancelled", "rejected", "pending"].includes(gtt.status.toLowerCase())
          )
          if (cancelledGTTOrders.length > 0) {
            // Use the first cancelled GTT order (usually the current one)
            matchingGTTOrder = cancelledGTTOrders.find(gtt => gtt.is_current) || cancelledGTTOrders[0]
          }
        }
        
        // Can reinstate if we found a matching GTT order AND it hasn't been reinstated before
        const canReinstate = !!matchingGTTOrder && !matchingGTTOrder.reinstated
        
        if (!canReinstate || !matchingGTTOrder) {
          if (matchingGTTOrder?.reinstated) {
            return <span className="text-muted-foreground text-xs" title="This order has already been reinstated">Already reinstated</span>
          }
          return <span className="text-muted-foreground text-xs">—</span>
        }
        
        // Note: Orders with order_id can still be reinstated.
        // The old order stays in cancelled orders table (from Alpaca),
        // and a new order will get a new order_id when placed.
        
        const isReinstating = isConfirming(`reinstate-${order.id || `${symbol}-${matchingGTTOrder.order_index}`}`)
        
        return (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={isReinstating}
            onClick={async (e) => {
              e.stopPropagation()
              const buttonKey = `reinstate-${order.id || `${symbol}-${matchingGTTOrder.order_index}`}`
              addConfirmingButton(buttonKey)
              
              try {
                const response = await fetch(`${apiBaseUrl}/api/reinstate-gtt-order`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({
                    symbol: symbol,
                    order_index: matchingGTTOrder.order_index
                  })
                })
                
                const data = await response.json()
                
                if (response.ok) {
                  // Refresh data to show updated status
                  refreshData()
                  console.log(`Successfully re-instated order for ${symbol}`)
                } else {
                  console.error(`Failed to re-instate order: ${data.error}`)
                  // Show detailed error message
                  const errorMsg = data.error || 'Unknown error'
                  const suggestion = data.suggestion ? `\n\n${data.suggestion}` : ''
                  alert(`Failed to re-instate order:\n\n${errorMsg}${suggestion}`)
                }
              } catch (error) {
                console.error('Error re-instating order:', error)
                alert(`Error re-instating order: ${error}`)
              } finally {
                setTimeout(() => removeConfirmingButton(buttonKey), 2000)
              }
            }}
          >
            {isReinstating ? (
              <>
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                Re-instating...
              </>
            ) : (
              <>
                <RotateCcw className="h-3 w-3 mr-1" />
                Re-instate
              </>
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

  const stocksOrderCategories = useMemo(() => categorizeOrders(stocksActiveOrders), [stocksActiveOrders])
  const cryptoOrderCategories = useMemo(() => categorizeOrders(cryptoActiveOrders), [cryptoActiveOrders])
  
  // Show loading while checking auth - use explicit colors to prevent black screen
  if (isAuthenticated === null) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center" 
        style={{ 
          backgroundColor: 'oklch(0.1 0 0)', 
          minHeight: '100vh',
          color: 'oklch(0.95 0 0)'
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <div 
            className="w-8 h-8 border-2 rounded-full animate-spin" 
            style={{ 
              borderColor: 'oklch(0.5 0.2 250 / 0.2)', 
              borderTopColor: 'oklch(0.7 0.2 250)' 
            }} 
          />
          <p className="text-sm" style={{ color: 'oklch(0.65 0 0)' }}>Checking authentication...</p>
        </div>
      </div>
    )
  }
  
  // Redirect if not authenticated (handled by useEffect, but show loading) - use explicit colors
  if (isAuthenticated === false) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center" 
        style={{ 
          backgroundColor: 'oklch(0.1 0 0)', 
          minHeight: '100vh',
          color: 'oklch(0.95 0 0)'
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <div 
            className="w-8 h-8 border-2 rounded-full animate-spin" 
            style={{ 
              borderColor: 'oklch(0.5 0.2 250 / 0.2)', 
              borderTopColor: 'oklch(0.7 0.2 250)' 
            }} 
          />
          <p className="text-sm" style={{ color: 'oklch(0.65 0 0)' }}>Redirecting to login...</p>
        </div>
      </div>
    )
  }
  
  // All hooks have been called - now render the UI

  // Check for API errors
  const hasApiError = ordersError || accountError || pricesError
  const apiErrorMessages: string[] = []
  if (ordersError) apiErrorMessages.push(`Orders: ${ordersError.message || 'Failed to load orders'}`)
  if (accountError) apiErrorMessages.push(`Account: ${accountError.message || 'Failed to load account'}`)
  if (pricesError) apiErrorMessages.push(`Prices: ${pricesError.message || 'Failed to load prices'}`)

  return (
    <div className="min-h-screen bg-background p-2 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Error Banner - Show API errors */}
        {hasApiError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-red-400 mb-1">Connection Error</h3>
                <p className="text-xs text-red-300/80 mb-2">Unable to connect to backend API. Please check:</p>
                <ul className="text-xs text-red-300/80 list-disc list-inside space-y-1">
                  {apiErrorMessages.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
                <p className="text-xs text-red-300/80 mt-2">
                  API URL: <code className="bg-red-500/20 px-1 py-0.5 rounded">{apiBaseUrl}</code>
                </p>
                <button
                  onClick={refreshData}
                  className="mt-3 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded border border-red-500/30 transition-colors"
                >
                  Retry Connection
                </button>
              </div>
            </div>
          </div>
        )}
        
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
                    
                    {/* Market Status Icon - Always show */}
                    {marketStatus && (
                      <IconTooltip
                        icon={
                          marketStatus.is_open === true ? (
                            <Activity className="h-4 w-4 text-green-500 cursor-help" />
                          ) : marketStatus.is_open === false ? (
                            <Clock className="h-4 w-4 text-yellow-500/70 cursor-help" />
                          ) : (
                            <Clock className="h-4 w-4 text-gray-500 cursor-help" />
                          )
                        }
                        title="Market Status"
                        content={
                          <>
                            {marketStatus.is_open === true ? (
                              <>
                                <span className="text-green-500 font-medium">Markets are open</span>
                                {marketStatus.next_close && (
                                  <span className="block mt-1 text-xs">
                                    Closes: <span className="text-primary">{formatMarketTime(marketStatus.next_close)}</span>
                                  </span>
                                )}
                              </>
                            ) : marketStatus.is_open === false ? (
                              <>
                                <span>Markets are currently closed. Prices may be stale.</span>
                                {marketStatus.next_open && (
                                  <span className="block mt-1 font-medium text-foreground">
                                    Opens: <span className="text-primary">{formatMarketTime(marketStatus.next_open)}</span>
                                  </span>
                                )}
                              </>
                            ) : (
                              <span>Market status unknown</span>
                            )}
                          </>
                        }
                        isVisible={tooltipState.warning}
                        onMouseEnter={() => setTooltipState(prev => ({ ...prev, warning: true }))}
                        onMouseLeave={() => setTooltipState(prev => ({ ...prev, warning: false }))}
                      />
                    )}
                    
                    {/* Logout Icon - Rightmost */}
                    <div 
                      onClick={handleLogout}
                      className="cursor-pointer"
                    >
                      <IconTooltip
                        icon={
                          <LogOut className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" />
                        }
                        title="Logout"
                        content={
                          <>Click to log out and return to the login page</>
                        }
                        isVisible={tooltipState.logout}
                        onMouseEnter={() => setTooltipState(prev => ({ ...prev, logout: true }))}
                        onMouseLeave={() => setTooltipState(prev => ({ ...prev, logout: false }))}
                      />
                    </div>
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
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <WifiOff className="h-4 w-4 text-red-500" />
                  <span className="text-[9px] text-red-500/70 leading-tight">
                    Offline
                  </span>
                  
                  {/* Logout Icon - Rightmost */}
                  <div 
                    onClick={handleLogout}
                    className="cursor-pointer ml-2"
                  >
                    <IconTooltip
                      icon={
                        <LogOut className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" />
                      }
                      title="Logout"
                      content={
                        <>Click to log out and return to the login page</>
                      }
                      isVisible={tooltipState.logout}
                      onMouseEnter={() => setTooltipState(prev => ({ ...prev, logout: true }))}
                      onMouseLeave={() => setTooltipState(prev => ({ ...prev, logout: false }))}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Bottom row: Account Summary - After Status */}
          {account && (
            <Card className="gap-0 py-1 w-full">
              <CardContent className="p-1.5 sm:p-2">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 sm:gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground font-medium">Buying Power</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(account.buying_power)}</span>
                  </div>
                  <div className="hidden sm:block h-4 w-px bg-border"></div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground font-medium">Cash</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(account.cash)}</span>
                  </div>
                  <div className="hidden sm:block h-4 w-px bg-border"></div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground font-medium">Equity</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(account.equity)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="stocks-positions" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-6 gap-1 h-auto sm:h-9 overflow-hidden">
            <TabsTrigger value="stocks-positions" className="flex items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-sm px-1 sm:px-2 py-1.5 sm:py-1 whitespace-normal sm:whitespace-nowrap min-h-[2.5rem] sm:min-h-0 data-[state=active]:!bg-purple-500/15 data-[state=active]:!text-purple-400 data-[state=active]:!border-purple-500/40 [&_svg]:text-purple-400/70 data-[state=active]:[&_svg]:!text-purple-400 overflow-hidden min-w-0">
              <Wallet className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="text-center leading-tight break-words truncate min-w-0">Stock/ETF Positions</span>
            </TabsTrigger>
            <TabsTrigger value="stocks-orders" className="flex items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-sm px-1 sm:px-2 py-1.5 sm:py-1 whitespace-normal sm:whitespace-nowrap min-h-[2.5rem] sm:min-h-0 data-[state=active]:!bg-purple-500/15 data-[state=active]:!text-purple-400 data-[state=active]:!border-purple-500/40 [&_svg]:text-purple-400/70 data-[state=active]:[&_svg]:!text-purple-400 overflow-hidden min-w-0">
              <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="text-center leading-tight break-words truncate min-w-0">Stock/ETF Orders</span>
            </TabsTrigger>
            <TabsTrigger value="stocks-gtt" className="flex items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-sm px-1 sm:px-2 py-1.5 sm:py-1 whitespace-normal sm:whitespace-nowrap min-h-[2.5rem] sm:min-h-0 data-[state=active]:!bg-purple-500/15 data-[state=active]:!text-purple-400 data-[state=active]:!border-purple-500/40 [&_svg]:text-purple-400/70 data-[state=active]:[&_svg]:!text-purple-400 overflow-hidden min-w-0">
              <TrendingDown className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="text-center leading-tight break-words truncate min-w-0">Stock/ETF GTT</span>
            </TabsTrigger>
            <TabsTrigger value="crypto-positions" className="flex items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-sm px-1 sm:px-2 py-1.5 sm:py-1 whitespace-normal sm:whitespace-nowrap min-h-[2.5rem] sm:min-h-0 data-[state=active]:!bg-pink-500/15 data-[state=active]:!text-pink-400 data-[state=active]:!border-pink-500/40 [&_svg]:text-pink-400/70 data-[state=active]:[&_svg]:!text-pink-400 overflow-hidden min-w-0">
              <Wallet className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="text-center leading-tight break-words truncate min-w-0">Crypto Positions</span>
            </TabsTrigger>
            <TabsTrigger value="crypto-orders" className="flex items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-sm px-1 sm:px-2 py-1.5 sm:py-1 whitespace-normal sm:whitespace-nowrap min-h-[2.5rem] sm:min-h-0 data-[state=active]:!bg-pink-500/15 data-[state=active]:!text-pink-400 data-[state=active]:!border-pink-500/40 [&_svg]:text-pink-400/70 data-[state=active]:[&_svg]:!text-pink-400 overflow-hidden min-w-0">
              <Wallet className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="text-center leading-tight break-words truncate min-w-0">Crypto Orders</span>
            </TabsTrigger>
            <TabsTrigger value="crypto-gtt" className="flex items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-sm px-1 sm:px-2 py-1.5 sm:py-1 whitespace-normal sm:whitespace-nowrap min-h-[2.5rem] sm:min-h-0 data-[state=active]:!bg-pink-500/15 data-[state=active]:!text-pink-400 data-[state=active]:!border-pink-500/40 [&_svg]:text-pink-400/70 data-[state=active]:[&_svg]:!text-pink-400 overflow-hidden min-w-0">
              <Sparkles className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="text-center leading-tight break-words truncate min-w-0">Crypto GTT</span>
            </TabsTrigger>
          </TabsList>

          {/* Upload Message - Show in all tabs */}
          {uploadMessage && (
            <div className="mt-4">
              <Card className={uploadMessage.type === 'success' ? 'bg-green-500/10 border-green-500/50' : 'bg-red-500/10 border-red-500/50'}>
                <CardContent className="py-2 px-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm ${uploadMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                      {uploadMessage.text}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setUploadMessage(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Stock/ETF Positions Tab */}
          <TabsContent value="stocks-positions" className="space-y-4 mt-4">
            {positionsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading positions...</div>
            ) : positionsError ? (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-destructive">
                Error loading positions: {positionsError.message}
              </div>
            ) : stockPositions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No stock positions</div>
            ) : (
              <DataTable columns={positionsColumns} data={stockPositions} />
            )}
          </TabsContent>

          {/* Crypto Positions Tab */}
          <TabsContent value="crypto-positions" className="space-y-4 mt-4">
            {positionsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading positions...</div>
            ) : positionsError ? (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-destructive">
                Error loading positions: {positionsError.message}
              </div>
            ) : cryptoPositions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No crypto positions</div>
            ) : (
              <DataTable columns={positionsColumns} data={cryptoPositions} />
            )}
          </TabsContent>

          {/* Stock/ETF Orders Tab */}
          <TabsContent value="stocks-orders" className="space-y-4 mt-4">
            {/* Active Orders Section */}
            <Card className="gap-0 py-1">
              <CardHeader className="p-1.5 sm:p-2">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  Active
                  {stocksOrderCategories.active.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {stocksOrderCategories.active.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">Orders currently placed and live (buying power locked)</CardDescription>
              </CardHeader>
              <CardContent className="p-1.5 sm:p-2">
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <p className="text-sm text-muted-foreground">
                        {loadingStatus?.message || "Loading orders..."}
                      </p>
                    </div>
                  </div>
                ) : stocksOrderCategories.active.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No active stock/ETF orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={stocksOrderCategories.active}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (stocksGttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id
                      const symbolGTTOrders = stocksGttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
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
                                      <TableCell>
                                        <OrderIdLink orderId={gttOrder.order_id} className="font-mono text-xs text-muted-foreground" />
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
            <Card className="gap-0 py-1">
              <CardHeader className="p-1.5 sm:p-2">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  Completed
                  {stocksOrderCategories.completed.length > 0 && (
                    <Badge variant="default" className="ml-2">
                      {stocksOrderCategories.completed.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">Orders that have been filled (executed)</CardDescription>
              </CardHeader>
              <CardContent className="p-1.5 sm:p-2">
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <p className="text-sm text-muted-foreground">
                        {loadingStatus?.message || "Loading orders..."}
                      </p>
                    </div>
                  </div>
                ) : stocksOrderCategories.completed.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No completed stock/ETF orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={stocksOrderCategories.completed}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (stocksGttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id
                      const symbolGTTOrders = stocksGttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
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
                                      <TableCell>
                                        <OrderIdLink orderId={gttOrder.order_id} className="font-mono text-xs text-muted-foreground" />
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
            <Card className="gap-0 py-1">
              <CardHeader className="p-1.5 sm:p-2">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  Cancelled
                  {stocksOrderCategories.cancelled.length > 0 && (
                    <Badge variant="outline" className="ml-2">
                      {stocksOrderCategories.cancelled.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">Orders that were cancelled, expired, or rejected</CardDescription>
              </CardHeader>
              <CardContent className="p-1.5 sm:p-2">
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <p className="text-sm text-muted-foreground">
                        {loadingStatus?.message || "Loading orders..."}
                      </p>
                    </div>
                  </div>
                ) : stocksOrderCategories.cancelled.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No cancelled stock/ETF orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={stocksOrderCategories.cancelled}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (stocksGttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id
                      const symbolGTTOrders = stocksGttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
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
                                      <TableCell>
                                        <OrderIdLink orderId={gttOrder.order_id} className="font-mono text-xs text-muted-foreground" />
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

          {/* Stock/ETF GTT Tab */}
          <TabsContent value="stocks-gtt" className="space-y-4 mt-4">
            {/* CSV Upload and Download Buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadTemplate('stocks')}
                className="bg-green-600/10 hover:bg-green-600/20 text-green-600 border-green-600/30 hover:border-green-600/50"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
              <div className="relative">
                <input
                  type="file"
                  accept=".csv"
                  id="stocks-csv-upload"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleCsvPreview(file, 'stocks')
                    e.target.value = ''
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('stocks-csv-upload')?.click()}
                  disabled={uploadingStocks}
                  className="bg-green-500/10 hover:bg-green-500/20 text-green-500 border-green-500/30 hover:border-green-500/50"
                >
                  {uploadingStocks ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Stocks CSV
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Search/Filter Bar */}
            <div className="flex items-center justify-end gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by symbol or name..."
                  value={gttSearchQuery}
                  onChange={(e) => setGttSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
                {gttSearchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => setGttSearchQuery("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            {isLoading && stocksGttOrders.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-4">
                    <div className="relative">
                      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-lg font-medium text-foreground">Loading stocks GTT orders...</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : Object.keys(filteredStocksGttBySymbol).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {gttSearchQuery ? (
                    <div>
                      <p>No stocks found matching "{gttSearchQuery}"</p>
                      <Button
                        variant="link"
                        className="mt-2"
                        onClick={() => setGttSearchQuery("")}
                      >
                        Clear search
                      </Button>
                    </div>
                  ) : (
                    <span>No stocks GTT orders found.</span>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Accordion 
                type="single" 
                collapsible 
                className="w-full space-y-4"
                value={expandedAccordion || undefined}
                onValueChange={(value) => setExpandedAccordion(value || null)}
              >
                {Object.entries(filteredStocksGttBySymbol).map(([symbol, orders]) => {
                  const currentPrice = prices[symbol]
                  const isUnavailable = orders[0]?.is_available_on_alpaca === false
                  
                  const completedOrders = orders.filter(o => o.status.toLowerCase() === "filled")
                  const placedOrders = orders.filter(o => o.order_id && o.status.toLowerCase() !== "filled")
                  const pendingOrders = orders.filter(o => !o.order_id && o.status.toLowerCase() === "pending")
                  
                  const totalOrders = orders.length
                  const placedCount = placedOrders.length + completedOrders.length
                  const remainingCount = pendingOrders.length
                  
                  const columns = createGTTColumns(currentPrice, refreshData)
                  
                  return (
                    <AccordionItem key={symbol} value={symbol} className="border-none">
                      <Card className={`gap-0 py-1 ${isUnavailable ? 'border-red-500/50 bg-red-500/5' : ''}`}>
                        <CardHeader className="p-1.5 sm:p-2">
                          <AccordionTrigger className="hover:no-underline py-0 items-start">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between w-full pr-8 sm:pr-2 gap-3 sm:gap-1">
                              <div className="text-left flex-1 min-w-0 w-full sm:w-auto">
                                <CardTitle className={`text-base sm:text-lg ${isUnavailable ? 'text-red-500' : ''}`}>
                                  {symbol}
                                  {isUnavailable && (
                                    <span className="ml-1.5 text-xs font-normal text-red-500/70">(Not available)</span>
                                  )}
                                </CardTitle>
                                <CardDescription className={`mt-0 text-xs ${isUnavailable ? 'text-red-400' : ''}`}>
                                  {orders[0]?.company}
                                </CardDescription>
                              </div>
                              
                              <div className="flex flex-col sm:flex-row gap-1.5 sm:gap-1 sm:ml-1 flex-shrink-0 w-full sm:w-auto items-start sm:items-center">
                                <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
                                  {currentPrice && (
                                    <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0 inline-flex items-center gap-1">
                                      <span>Current: {formatCurrency(currentPrice)}</span>
                                      <PriceStatusIndicator symbol={symbol} marketStatus={marketStatus} />
                                    </Badge>
                                  )}
                                  {(() => {
                                    const currentOrder = orders.find(o => o.is_current)
                                    if (currentOrder) {
                                      return (
                                        <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0">
                                          Next Limit: {formatCurrency(currentOrder.price)}
                                        </Badge>
                                      )
                                    }
                                    return null
                                  })()}
                                </div>
                                
                                <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
                                  <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0 bg-primary/10 text-primary border-primary/30">
                                    {placedCount} of {totalOrders} placed
                                  </Badge>
                                  <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0 bg-muted/50 text-muted-foreground">
                                    {remainingCount} remaining
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>
                        </CardHeader>
                        <AccordionContent>
                          <CardContent className="p-1.5 sm:p-2 space-y-4">
                            <DataTable
                              columns={columns}
                              data={orders}
                            />
                            <div className="pt-2 border-t" data-chart-symbol={symbol}>
                              <StockChart 
                                symbol={symbol} 
                                apiBaseUrl={apiBaseUrl} 
                                height={200}
                                enabled={expandedAccordion === symbol}
                                highlightedPrice={highlightedPrices[symbol] || null}
                                onPriceHover={(price) => {
                                  setHighlightedPrices(prev => ({ ...prev, [symbol]: price }))
                                }}
                                onPriceClick={(price) => {
                                  // Find the table row with this price and scroll to it
                                  const tableRow = document.querySelector(`[data-order-price="${symbol}-${price.toFixed(2)}"]`)
                                  if (tableRow) {
                                    tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    // Temporarily highlight the row
                                    const rowElement = tableRow.closest('tr')
                                    if (rowElement) {
                                      rowElement.classList.add('bg-primary/20')
                                      setTimeout(() => {
                                        rowElement.classList.remove('bg-primary/20')
                                      }, 2000)
                                    }
                                  }
                                }}
                              />
                            </div>
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            )}
          </TabsContent>

          {/* Crypto Orders Tab */}
          <TabsContent value="crypto-orders" className="space-y-4 mt-4">
            {/* Active Orders Section */}
            <Card className="gap-0 py-1">
              <CardHeader className="p-1.5 sm:p-2">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  Active
                  {cryptoOrderCategories.active.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {cryptoOrderCategories.active.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">Orders currently placed and live (buying power locked)</CardDescription>
              </CardHeader>
              <CardContent className="p-1.5 sm:p-2">
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <p className="text-sm text-muted-foreground">
                        {loadingStatus?.message || "Loading orders..."}
                      </p>
                    </div>
                  </div>
                ) : cryptoOrderCategories.active.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No active crypto orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={cryptoOrderCategories.active}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (cryptoGttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id
                      const symbolGTTOrders = cryptoGttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
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
                                      <TableCell>
                                        <OrderIdLink orderId={gttOrder.order_id} className="font-mono text-xs text-muted-foreground" />
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
            <Card className="gap-0 py-1">
              <CardHeader className="p-1.5 sm:p-2">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  Completed
                  {cryptoOrderCategories.completed.length > 0 && (
                    <Badge variant="default" className="ml-2">
                      {cryptoOrderCategories.completed.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">Orders that have been filled (executed)</CardDescription>
              </CardHeader>
              <CardContent className="p-1.5 sm:p-2">
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <p className="text-sm text-muted-foreground">
                        {loadingStatus?.message || "Loading orders..."}
                      </p>
                    </div>
                  </div>
                ) : cryptoOrderCategories.completed.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No completed crypto orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={cryptoOrderCategories.completed}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (cryptoGttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id
                      const symbolGTTOrders = cryptoGttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
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
                                      <TableCell>
                                        <OrderIdLink orderId={gttOrder.order_id} className="font-mono text-xs text-muted-foreground" />
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
            <Card className="gap-0 py-1">
              <CardHeader className="p-1.5 sm:p-2">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  Cancelled
                  {cryptoOrderCategories.cancelled.length > 0 && (
                    <Badge variant="outline" className="ml-2">
                      {cryptoOrderCategories.cancelled.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">Orders that were cancelled, expired, or rejected</CardDescription>
              </CardHeader>
              <CardContent className="p-1.5 sm:p-2">
                {isLoading ? (
                  <div className="py-8 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                      <p className="text-sm text-muted-foreground">
                        {loadingStatus?.message || "Loading orders..."}
                      </p>
                    </div>
                  </div>
                ) : cryptoOrderCategories.cancelled.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No cancelled crypto orders</div>
                ) : (
                  <DataTable
                    columns={activeOrderColumns}
                    data={cryptoOrderCategories.cancelled}
                    getRowCanExpand={(row) => {
                      const symbol = row.original.symbol
                      return (cryptoGttBySymbol[symbol] || []).length > 0
                    }}
                    renderSubComponent={(row) => {
                      const symbol = row.original.symbol
                      const orderId = row.original.id
                      const symbolGTTOrders = cryptoGttBySymbol[symbol] || []
                      
                      if (symbolGTTOrders.length === 0) {
                        return null
                      }
                      
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
                                      <TableCell>
                                        <OrderIdLink orderId={gttOrder.order_id} className="font-mono text-xs text-muted-foreground" />
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

          {/* Crypto GTT Tab */}
          <TabsContent value="crypto-gtt" className="space-y-4 mt-4">
            {/* CSV Upload and Download Buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadTemplate('crypto')}
                className="bg-green-600/10 hover:bg-green-600/20 text-green-600 border-green-600/30 hover:border-green-600/50"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
              <div className="relative">
                <input
                  type="file"
                  accept=".csv"
                  id="crypto-csv-upload"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleCsvPreview(file, 'crypto')
                    e.target.value = ''
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('crypto-csv-upload')?.click()}
                  disabled={uploadingCrypto}
                  className="bg-green-500/10 hover:bg-green-500/20 text-green-500 border-green-500/30 hover:border-green-500/50"
                >
                  {uploadingCrypto ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Crypto CSV
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Search/Filter Bar */}
            <div className="flex items-center justify-end gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by symbol or name..."
                  value={gttSearchQuery}
                  onChange={(e) => setGttSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
                {gttSearchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => setGttSearchQuery("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            {isLoading && cryptoGttOrders.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-4">
                    <div className="relative">
                      <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-lg font-medium text-foreground">Loading crypto GTT orders...</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : Object.keys(filteredCryptoGttBySymbol).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {gttSearchQuery ? (
                    <div>
                      <p>No crypto found matching "{gttSearchQuery}"</p>
                      <Button
                        variant="link"
                        className="mt-2"
                        onClick={() => setGttSearchQuery("")}
                      >
                        Clear search
                      </Button>
                    </div>
                  ) : (
                    <span>No crypto GTT orders found.</span>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Accordion 
                type="single" 
                collapsible 
                className="w-full space-y-4"
                value={expandedAccordion || undefined}
                onValueChange={(value) => setExpandedAccordion(value || null)}
              >
                {Object.entries(filteredCryptoGttBySymbol).map(([symbol, orders]) => {
                  const currentPrice = prices[symbol]
                  const isUnavailable = orders[0]?.is_available_on_alpaca === false
                  
                  const completedOrders = orders.filter(o => o.status.toLowerCase() === "filled")
                  const placedOrders = orders.filter(o => o.order_id && o.status.toLowerCase() !== "filled")
                  const pendingOrders = orders.filter(o => !o.order_id && o.status.toLowerCase() === "pending")
                  
                  const totalOrders = orders.length
                  const placedCount = placedOrders.length + completedOrders.length
                  const remainingCount = pendingOrders.length
                  
                  const columns = createGTTColumns(currentPrice, refreshData)
                  
                  return (
                    <AccordionItem key={symbol} value={symbol} className="border-none">
                      <Card className={`gap-0 py-1 ${isUnavailable ? 'border-red-500/50 bg-red-500/5' : ''}`}>
                        <CardHeader className="p-1.5 sm:p-2">
                          <AccordionTrigger className="hover:no-underline py-0 items-start">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between w-full pr-8 sm:pr-2 gap-3 sm:gap-1">
                              <div className="text-left flex-1 min-w-0 w-full sm:w-auto">
                                <CardTitle className={`text-base sm:text-lg ${isUnavailable ? 'text-red-500' : ''}`}>
                                  {symbol}
                                  {isUnavailable && (
                                    <span className="ml-1.5 text-xs font-normal text-red-500/70">(Not available)</span>
                                  )}
                                </CardTitle>
                                <CardDescription className={`mt-0 text-xs ${isUnavailable ? 'text-red-400' : ''}`}>
                                  {orders[0]?.company}
                                </CardDescription>
                              </div>
                              
                              <div className="flex flex-col sm:flex-row gap-1.5 sm:gap-1 sm:ml-1 flex-shrink-0 w-full sm:w-auto items-start sm:items-center">
                                <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
                                  {currentPrice && (
                                    <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0 inline-flex items-center gap-1">
                                      <span>Current: {formatCurrency(currentPrice)}</span>
                                      <PriceStatusIndicator symbol={symbol} marketStatus={marketStatus} />
                                    </Badge>
                                  )}
                                  {(() => {
                                    const currentOrder = orders.find(o => o.is_current)
                                    if (currentOrder) {
                                      return (
                                        <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0">
                                          Next Limit: {formatCurrency(currentOrder.price)}
                                        </Badge>
                                      )
                                    }
                                    return null
                                  })()}
                                </div>
                                
                                <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
                                  <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0 bg-primary/10 text-primary border-primary/30">
                                    {placedCount} of {totalOrders} placed
                                  </Badge>
                                  <Badge variant="outline" className="text-xs shrink-0 px-1.5 py-0 bg-muted/50 text-muted-foreground">
                                    {remainingCount} remaining
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </AccordionTrigger>
                        </CardHeader>
                        <AccordionContent>
                          <CardContent className="p-1.5 sm:p-2 space-y-4">
                            <DataTable
                              columns={columns}
                              data={orders}
                            />
                            <div className="pt-2 border-t" data-chart-symbol={symbol}>
                              <StockChart 
                                symbol={symbol} 
                                apiBaseUrl={apiBaseUrl} 
                                height={200}
                                enabled={expandedAccordion === symbol}
                                highlightedPrice={highlightedPrices[symbol] || null}
                                onPriceHover={(price) => {
                                  setHighlightedPrices(prev => ({ ...prev, [symbol]: price }))
                                }}
                                onPriceClick={(price) => {
                                  // Find the table row with this price and scroll to it
                                  const tableRow = document.querySelector(`[data-order-price="${symbol}-${price.toFixed(2)}"]`)
                                  if (tableRow) {
                                    tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    // Temporarily highlight the row
                                    const rowElement = tableRow.closest('tr')
                                    if (rowElement) {
                                      rowElement.classList.add('bg-primary/20')
                                      setTimeout(() => {
                                        rowElement.classList.remove('bg-primary/20')
                                      }, 2000)
                                    }
                                  }
                                }}
                              />
                            </div>
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* CSV Preview Modal */}
      {csvPreview?.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col">
            <CardHeader className="flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  CSV Preview - {csvPreview.type === 'stocks' ? 'Stocks/ETFs' : 'Crypto'}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCsvPreview(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>
                Review your CSV data before uploading. {csvPreview.file?.name}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">Symbols</div>
                  <div className="text-2xl font-bold">{csvPreview.previewData.length}</div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">Total Orders</div>
                  <div className="text-2xl font-bold">
                    {csvPreview.previewData.reduce((sum: number, item: any) => sum + item.order_count, 0)}
                  </div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground">Status</div>
                  <div className="text-lg font-semibold">
                    {csvPreview.errors.length > 0 ? (
                      <span className="text-destructive">Has Errors</span>
                    ) : csvPreview.warnings.length > 0 ? (
                      <span className="text-yellow-600">Has Warnings</span>
                    ) : (
                      <span className="text-green-600">Ready</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Errors */}
              {csvPreview.errors.length > 0 && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <h3 className="font-semibold text-destructive">Errors ({csvPreview.errors.length})</h3>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-sm text-destructive">
                    {csvPreview.errors.map((error, idx) => (
                      <li key={idx}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {csvPreview.warnings.length > 0 && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <h3 className="font-semibold text-yellow-600">Warnings ({csvPreview.warnings.length})</h3>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-sm text-yellow-600">
                    {csvPreview.warnings.map((warning, idx) => (
                      <li key={idx}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview Table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Row</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Order Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvPreview.previewData.map((item: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs">{item.row}</TableCell>
                          <TableCell className="font-medium">{item.company}</TableCell>
                          <TableCell className="font-mono">{item.symbol}</TableCell>
                          <TableCell className="text-right">{item.order_count}</TableCell>
                          <TableCell>
                            {item.is_available === false ? (
                              <Badge variant="destructive">Not Available</Badge>
                            ) : item.is_available === true ? (
                              <Badge variant="default">Available</Badge>
                            ) : (
                              <Badge variant="secondary">Unknown</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {item.orders.map((order: any) => (
                                <Badge key={order.order_num} variant="outline" className="text-xs">
                                  #{order.order_num}: {order.amount} @ ${order.price.toFixed(2)}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
            <div className="flex-shrink-0 border-t p-4 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setCsvPreview(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (csvPreview.file) {
                    handleCsvUpload(csvPreview.file, csvPreview.type)
                  }
                }}
                disabled={csvPreview.errors.length > 0 || uploadingStocks || uploadingCrypto}
              >
                {uploadingStocks || uploadingCrypto ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Confirm & Upload
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
