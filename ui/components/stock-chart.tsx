"use client"

import { useState } from "react"
import useSWR from "swr"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, ReferenceLine } from "recharts"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "MAX"

interface StockChartProps {
  symbol: string
  apiBaseUrl: string
  height?: number
  enabled?: boolean // Only fetch when enabled (accordion is open)
}

interface GTTOrder {
  order_index: number
  price: number
  status: string
  order_id: string | null
  timestamp: string | null
  is_current: boolean
}

const timeframeLabels: Record<Timeframe, string> = {
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  "1Y": "1Y",
  "MAX": "MAX",
}

const chartConfig = {
  close: {
    label: "Price",
    theme: {
      light: "hsl(45, 100%, 50%)", // Yellow for light mode
      dark: "oklch(0.85 0.15 95)", // Alpaca yellow for dark mode
    },
  },
}

export function StockChart({ symbol, apiBaseUrl, height = 200, enabled = true }: StockChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M")
  
  // Only fetch when enabled (accordion is open) - lazy loading best practice
  const { data, error, isLoading } = useSWR(
    enabled ? `${apiBaseUrl}/api/chart/${symbol}?timeframe=${timeframe}` : null,
    async (url: string) => {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error("Failed to fetch chart data")
      return res.json()
    },
    {
      revalidateOnFocus: false,
      refreshInterval: enabled && timeframe === "1D" ? 60000 : 0, // Refresh 1D every minute only when enabled
    }
  )

  const chartData = data?.bars?.map((bar: any) => {
    const date = new Date(bar.timestamp)
    let dateLabel: string
    
    if (timeframe === "1D") {
      // For 1D: Show time only (e.g., "1:50 AM")
      dateLabel = date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    } else if (timeframe === "1W" || timeframe === "1M") {
      // For 1W/1M: Show month and day (e.g., "Nov 10")
      dateLabel = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    } else {
      // For longer timeframes: Show month and day (e.g., "Nov 10")
      dateLabel = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    }
    
    return {
      timestamp: date.getTime(),
      date: dateLabel,
      fullDate: date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: timeframe === "1Y" || timeframe === "MAX" ? "numeric" : undefined,
      }),
      time: date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      close: bar.close,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      volume: bar.volume,
    }
  }) || []

  const gttOrders: GTTOrder[] = data?.gtt_orders || []

  const formatPrice = (value: number) => `$${value.toFixed(2)}`
  
  // Calculate proper Y-axis domain with padding (including GTT orders)
  const calculateDomain = () => {
    if (chartData.length === 0) return ["auto", "auto"]
    
    const prices = chartData.map((d: any) => d.close)
    const gttPrices = gttOrders.map((o: GTTOrder) => o.price)
    const allPrices = [...prices, ...gttPrices]
    
    if (allPrices.length === 0) return ["auto", "auto"]
    
    const minPrice = Math.min(...allPrices)
    const maxPrice = Math.max(...allPrices)
    const priceRange = maxPrice - minPrice
    
    // Add 5% padding above and below
    const padding = priceRange * 0.05
    
    return [
      Math.max(0, minPrice - padding), // Don't go below 0
      maxPrice + padding
    ]
  }
  
  const yAxisDomain = calculateDomain()

  // Calculate evenly spaced ticks for Y-axis (for gridlines)
  const calculateYTicks = () => {
    if (chartData.length === 0 || yAxisDomain[0] === "auto" || yAxisDomain[1] === "auto") return []
    const [min, max] = yAxisDomain as [number, number]
    const range = max - min
    const tickCount = 5 // Number of horizontal gridlines
    const step = range / (tickCount - 1)
    const ticks: number[] = []
    for (let i = 0; i < tickCount; i++) {
      ticks.push(min + step * i)
    }
    return ticks
  }

  // Calculate evenly spaced ticks for X-axis (for gridlines)
  const calculateXTicks = () => {
    if (chartData.length === 0) return []
    const timestamps = chartData.map((d: any) => d.timestamp)
    const minTime = Math.min(...timestamps)
    const maxTime = Math.max(...timestamps)
    const tickCount = 6 // Number of vertical gridlines
    const step = (maxTime - minTime) / (tickCount - 1)
    const ticks: number[] = []
    for (let i = 0; i < tickCount; i++) {
      ticks.push(minTime + step * i)
    }
    return ticks
  }

  const yTicks = calculateYTicks()
  const xTicks = calculateXTicks()

  // Get color for GTT order status
  const getOrderColor = (status: string) => {
    const statusLower = status.toLowerCase()
    if (statusLower === "filled") return "oklch(0.7 0.2 145)" // Green
    if (statusLower === "pending") return "oklch(0.85 0.15 95)" // Yellow
    if (["cancelled", "canceled", "expired", "rejected"].includes(statusLower)) return "oklch(0.65 0.2 25)" // Red
    return "oklch(0.65 0 0)" // Default gray
  }

  return (
    <div className="w-full space-y-2">
      {/* Timeframe Buttons */}
      <div className="flex items-center gap-1 flex-wrap">
        {(Object.keys(timeframeLabels) as Timeframe[]).map((tf) => (
          <Button
            key={tf}
            variant={timeframe === tf ? "default" : "outline"}
            size="sm"
            className={`h-7 text-xs px-2 ${
              timeframe === tf 
                ? "bg-primary text-primary-foreground border-primary" 
                : "bg-transparent text-muted-foreground border-border hover:bg-muted/50"
            }`}
            onClick={() => setTimeframe(tf)}
          >
            {timeframeLabels[tf]}
          </Button>
        ))}
      </div>

      {/* Chart */}
      <div className="w-full" style={{ height: `${height}px` }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Failed to load chart data
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No data available
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-full w-full">
            <LineChart 
              data={chartData} 
              margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
              width={undefined}
              height={undefined}
            >
              <defs>
                <linearGradient id={`gradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.85 0.15 95)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="oklch(0.85 0.15 95)" stopOpacity={0} />
                </linearGradient>
              </defs>
              
              {/* Evenly spaced horizontal gridlines */}
              {yTicks.map((tick, idx) => (
                <ReferenceLine
                  key={`h-grid-${idx}`}
                  y={tick}
                  stroke="oklch(0.25 0 0)"
                  strokeOpacity={0.4}
                  strokeDasharray="none"
                />
              ))}
              
              {/* Evenly spaced vertical gridlines */}
              {xTicks.map((tick, idx) => {
                // Find closest data point for this timestamp
                const closestDataPoint = chartData.reduce((prev: any, curr: any) => 
                  Math.abs(curr.timestamp - tick) < Math.abs(prev.timestamp - tick) ? curr : prev
                )
                return (
                  <ReferenceLine
                    key={`v-grid-${idx}`}
                    x={closestDataPoint.date}
                    stroke="oklch(0.25 0 0)"
                    strokeOpacity={0.15}
                    strokeDasharray="1 3"
                  />
                )
              })}
              
              {/* GTT Order horizontal lines - always visible */}
              {gttOrders.map((order, idx) => (
                <ReferenceLine
                  key={`gtt-order-${order.order_index}-${idx}`}
                  y={order.price}
                  stroke={getOrderColor(order.status)}
                  strokeWidth={order.is_current ? 2.5 : 1.5}
                  strokeOpacity={order.is_current ? 0.8 : 0.6}
                  strokeDasharray={order.status === "pending" ? "4 4" : "none"}
                  label={{
                    value: `Order ${order.order_index} (${order.status})`,
                    position: "right",
                    fill: getOrderColor(order.status),
                    fontSize: 10,
                    offset: 5,
                  }}
                />
              ))}
              
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                style={{ fontSize: '11px' }}
                angle={-45}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatPrice}
                domain={yAxisDomain}
                width={60}
                style={{ fontSize: '11px' }}
                allowDataOverflow={false}
                ticks={yTicks}
              />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null
                  
                  const data = payload[0].payload
                  const value = payload[0].value as number
                  
                  return (
                    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 min-w-[140px]">
                      <div className="space-y-1">
                        <div className="font-semibold text-foreground text-sm">
                          {data.fullDate || data.date}
                        </div>
                        {timeframe === "1D" && data.time && (
                          <div className="text-xs text-muted-foreground">
                            {data.time}
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-4 pt-1 border-t border-border">
                          <span className="text-muted-foreground text-xs">Price</span>
                          <span className="text-foreground font-semibold tabular-nums">
                            {formatPrice(value)}
                          </span>
                        </div>
                        {/* Show GTT orders at this price level */}
                        {gttOrders.filter((o: GTTOrder) => Math.abs(o.price - value) < 0.01).length > 0 && (
                          <div className="pt-1 border-t border-border space-y-0.5">
                            <div className="text-xs text-muted-foreground">GTT Orders:</div>
                            {gttOrders
                              .filter((o: GTTOrder) => Math.abs(o.price - value) < 0.01)
                              .map((o: GTTOrder) => (
                                <div key={o.order_index} className="text-xs" style={{ color: getOrderColor(o.status) }}>
                                  Order {o.order_index}: {o.status} @ {formatPrice(o.price)}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke="var(--color-close)"
                strokeWidth={3}
                dot={false}
                activeDot={{ 
                  r: 6, 
                  fill: "var(--color-close)",
                  strokeWidth: 3,
                  stroke: "oklch(0.15 0 0)"
                }}
                isAnimationActive={true}
                animationDuration={300}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>
    </div>
  )
}
