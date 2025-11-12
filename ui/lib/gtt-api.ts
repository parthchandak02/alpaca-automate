// API helper functions for GTT features
export async function toggleGlobalMode(apiBaseUrl: string, mode: 'auto' | 'manual', assetType: 'stock' | 'crypto'): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/toggle-global-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ mode, asset_type: assetType })
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(error.error || 'Failed to toggle global mode')
  }
}

export async function toggleGTTMode(apiBaseUrl: string, gttOrderId: number, mode: 'auto' | 'manual'): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/toggle-gtt-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ gtt_order_id: gttOrderId, mode })
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(error.error || 'Failed to toggle GTT mode')
  }
}

export async function linkGTTToOrder(apiBaseUrl: string, gttOrderId: number, alpacaOrderId: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/link-gtt-to-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ gtt_order_id: gttOrderId, alpaca_order_id: alpacaOrderId })
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(error.error || 'Failed to link GTT to order')
  }
}

export async function linkOrderToGTT(apiBaseUrl: string, alpacaOrderId: string, gttOrderId: number): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/link-order-to-gtt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ alpaca_order_id: alpacaOrderId, gtt_order_id: gttOrderId })
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(error.error || 'Failed to link order to GTT')
  }
}

export interface AvailableOrder {
  id: string
  symbol: string
  side: string
  quantity: number
  limit_price: number | null
  status: string
  created_at: string
  is_linked: boolean
}

export async function getAvailableOrdersForLinking(apiBaseUrl: string): Promise<AvailableOrder[]> {
  const res = await fetch(`${apiBaseUrl}/api/available-orders-for-linking`, {
    credentials: 'include'
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(error.error || 'Failed to get available orders')
  }
  const data = await res.json()
  return data.orders || []
}

export async function createManualGTTOrder(
  apiBaseUrl: string,
  data: {
    symbol: string
    company: string
    amount: number
    price: number
    asset_type: 'stock' | 'crypto'
  }
): Promise<{ gtt_order_id: number }> {
  const res = await fetch(`${apiBaseUrl}/api/create-gtt-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(error.error || 'Failed to create GTT order')
  }
  return await res.json()
}

export interface SymbolOption {
  symbol: string
  name: string
  symbol_short?: string
}

export async function getAvailableSymbols(apiBaseUrl: string, assetType: 'stock' | 'crypto'): Promise<SymbolOption[]> {
  const res = await fetch(`${apiBaseUrl}/api/available-symbols?asset_type=${assetType}`, {
    credentials: 'include'
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(error.error || 'Failed to get available symbols')
  }
  const data = await res.json()
  return data.symbols || []
}

export async function getAssetInfo(apiBaseUrl: string, symbol: string): Promise<{ symbol: string; name: string }> {
  const res = await fetch(`${apiBaseUrl}/api/asset-info/${encodeURIComponent(symbol)}`, {
    credentials: 'include'
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(error.error || 'Failed to get asset info')
  }
  return await res.json()
}

export async function getCurrentPrice(apiBaseUrl: string, symbol: string): Promise<number | null> {
  const res = await fetch(`${apiBaseUrl}/api/prices`, {
    credentials: 'include'
  })
  if (!res.ok) {
    return null
  }
  const data = await res.json()
  return data.prices?.[symbol] || null
}

