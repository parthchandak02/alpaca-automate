"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import useSWR from "swr"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, ColumnHeaderWithDropdown } from "@/components/data-table"
import { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TrendingUp, TrendingDown, ExternalLink, LogOut } from "lucide-react"

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

interface PositionsResponse {
  stocks: Position[]
  crypto: Position[]
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-"
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-"
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatNumber(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return "-"
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

function getAlpacaTradingUrl(position: Position): string {
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

export default function PositionsPage() {
  const router = useRouter()
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  
  // Get API base URL
  const apiPort = process.env.NEXT_PUBLIC_API_PORT || '8080'
  let apiHost = process.env.NEXT_PUBLIC_API_HOST
  if (!apiHost && typeof window !== 'undefined') {
    const hostname = window.location.hostname
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      apiHost = `api-${hostname}`
    } else {
      apiHost = 'localhost'
    }
  } else if (!apiHost) {
    apiHost = 'localhost'
  }
  const protocol = (apiHost && apiHost !== 'localhost') ? 'https' : 'http'
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
  
  // Check authentication on mount
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
  
  // Fetch positions
  const { data: positionsData, error: positionsError, isLoading } = useSWR<PositionsResponse>(
    isAuthenticated ? `${apiBaseUrl}/api/positions` : null,
    async (url) => {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        const error = new Error('Failed to fetch positions')
        // @ts-ignore
        error.status = res.status
        throw error
      }
      return res.json()
    },
    {
      refreshInterval: 5000, // Refresh every 5 seconds
      revalidateOnFocus: true,
    }
  )
  
  // Define columns for positions table
  const columns: ColumnDef<Position>[] = useMemo(() => [
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
        return <span className="tabular-nums">{formatCurrency(row.getValue("current_price"))}</span>
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
        return <span className="tabular-nums">{formatNumber(Math.abs(qty), 8)}</span>
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
        return <span className="tabular-nums">{formatCurrency(row.getValue("market_value"))}</span>
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
        return <span className="tabular-nums">{formatCurrency(row.getValue("avg_entry_price"))}</span>
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
        return <span className="tabular-nums">{formatCurrency(row.getValue("cost_basis"))}</span>
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
            {formatPercent(todayPlpc)}
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
            {formatCurrency(todayPl)}
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
            {formatPercent(plpc)}
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
            {formatCurrency(pl)}
          </span>
        )
      },
    },
  ], [])
  
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }
  
  if (isAuthenticated === false) {
    return null // Will redirect to login
  }
  
  const stockPositions = positionsData?.stocks || []
  const cryptoPositions = positionsData?.crypto || []
  
  return (
    <div className="min-h-screen bg-background p-2 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Positions</h1>
            <div className="flex items-center gap-3 mt-1">
              <Link 
                href="/" 
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Orders
              </Link>
              <span className="text-muted-foreground">•</span>
              <Link 
                href="/positions" 
                className="text-xs text-foreground font-medium"
              >
                Positions
              </Link>
            </div>
          </div>
          <div 
            onClick={handleLogout}
            className="cursor-pointer"
            title="Logout"
          >
            <LogOut className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" />
          </div>
        </div>
        
        {positionsError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-destructive">
            Error loading positions: {positionsError.message}
          </div>
        )}
        
        <Tabs defaultValue="stocks" className="w-full">
          <TabsList>
            <TabsTrigger value="stocks">
              Stocks/ETFs ({stockPositions.length})
            </TabsTrigger>
            <TabsTrigger value="crypto">
              Crypto ({cryptoPositions.length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="stocks" className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading positions...</div>
            ) : stockPositions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No stock positions</div>
            ) : (
              <DataTable columns={columns} data={stockPositions} />
            )}
          </TabsContent>
          
          <TabsContent value="crypto" className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading positions...</div>
            ) : cryptoPositions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No crypto positions</div>
            ) : (
              <DataTable columns={columns} data={cryptoPositions} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

