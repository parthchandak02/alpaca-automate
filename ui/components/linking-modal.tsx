"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { X, Search } from "lucide-react"
import { AvailableOrder } from "@/lib/gtt-api"
import { GTTOrder } from "@/app/page"

interface LinkingModalProps {
  type: 'gtt-to-order' | 'order-to-gtt'
  gttOrderId?: number
  alpacaOrderId?: string
  symbol?: string
  availableOrders?: AvailableOrder[]
  gttOrders?: GTTOrder[]
  onLink: (gttOrderId: number, alpacaOrderId: string) => void
  onClose: () => void
}

export function LinkingModal({
  type,
  gttOrderId,
  alpacaOrderId,
  symbol,
  availableOrders = [],
  gttOrders = [],
  onLink,
  onClose
}: LinkingModalProps) {
  const [searchQuery, setSearchQuery] = useState("")

  // Filter orders based on type
  const filteredOrders = useMemo(() => {
    if (type === 'gtt-to-order') {
      // Show available Alpaca orders, optionally filtered by symbol
      let filtered = availableOrders.filter(order => !order.is_linked)
      if (symbol) {
        filtered = filtered.filter(order => order.symbol === symbol)
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        filtered = filtered.filter(order =>
          order.symbol.toLowerCase().includes(query) ||
          order.id.toLowerCase().includes(query) ||
          order.status.toLowerCase().includes(query)
        )
      }
      return filtered
    } else {
      // Show GTT orders, filtered by symbol if provided
      let filtered = gttOrders.filter(order => !order.order_id && order.gtt_order_id)
      if (symbol) {
        filtered = filtered.filter(order => order.symbol === symbol)
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        filtered = filtered.filter(order =>
          order.symbol.toLowerCase().includes(query) ||
          order.company.toLowerCase().includes(query) ||
          order.order_index.toString().includes(query)
        )
      }
      return filtered
    }
  }, [type, availableOrders, gttOrders, symbol, searchQuery])

  const handleLink = (targetId: string | number) => {
    if (type === 'gtt-to-order' && gttOrderId) {
      onLink(gttOrderId, targetId as string)
    } else if (type === 'order-to-gtt' && alpacaOrderId) {
      onLink(targetId as number, alpacaOrderId)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg w-full max-w-4xl max-h-[80vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">
            {type === 'gtt-to-order' ? 'Link GTT Order to Executed Order' : 'Link Executed Order to GTT Order'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by symbol, ID, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {filteredOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No orders found matching your search' : 'No orders available for linking'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {type === 'gtt-to-order' ? (
                    <>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Limit Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Action</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Order #</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => {
                  if (type === 'gtt-to-order') {
                    const alpacaOrder = order as AvailableOrder
                    return (
                      <TableRow key={alpacaOrder.id}>
                        <TableCell className="font-medium">{alpacaOrder.symbol}</TableCell>
                        <TableCell className="font-mono text-xs">{alpacaOrder.id}</TableCell>
                        <TableCell>{alpacaOrder.quantity}</TableCell>
                        <TableCell>{alpacaOrder.limit_price ? `$${alpacaOrder.limit_price.toFixed(2)}` : '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{alpacaOrder.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(alpacaOrder.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleLink(alpacaOrder.id)}
                          >
                            Link
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  } else {
                    const gttOrder = order as GTTOrder
                    return (
                      <TableRow key={gttOrder.gtt_order_id}>
                        <TableCell className="font-medium">{gttOrder.symbol}</TableCell>
                        <TableCell>#{gttOrder.order_index}</TableCell>
                        <TableCell>{gttOrder.company}</TableCell>
                        <TableCell>{gttOrder.amount}</TableCell>
                        <TableCell>${gttOrder.price.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{gttOrder.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleLink(gttOrder.gtt_order_id!)}
                          >
                            Link
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  }
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}


