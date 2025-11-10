"use client"

import { useState } from "react"
import useSWR from "swr"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "MAX"

interface StockChartProps {
  symbol: string
  apiBaseUrl: string
  height?: number
  enabled?: boolean // Only fetch when enabled (accordion is open)
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
    color: "hsl(var(--chart-1))",
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

  const chartData = data?.bars?.map((bar: any) => ({
    timestamp: new Date(bar.timestamp).getTime(),
    date: new Date(bar.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(timeframe === "1D" && { hour: "numeric", minute: "2-digit" }),
    }),
    close: bar.close,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    volume: bar.volume,
  })) || []

  const formatPrice = (value: number) => `$${value.toFixed(2)}`

  return (
    <div className="w-full space-y-2">
      {/* Timeframe Buttons */}
      <div className="flex items-center gap-1 flex-wrap">
        {(Object.keys(timeframeLabels) as Timeframe[]).map((tf) => (
          <Button
            key={tf}
            variant={timeframe === tf ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2"
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
          <ChartContainer config={chartConfig} className="h-full">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatPrice}
                domain={["dataMin - 1", "dataMax + 1"]}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatPrice(value as number)}
                    labelFormatter={(label, payload) => {
                      const data = payload?.[0]?.payload
                      if (!data) return label
                      return (
                        <div className="space-y-1">
                          <div className="font-medium">{data.date}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(data.timestamp).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      )
                    }}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke="var(--color-close)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>
    </div>
  )
}

