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

export async function getAvailableSymbols(apiBaseUrl: string, assetType: 'stock' | 'crypto', search?: string, limit?: number): Promise<SymbolOption[]> {
  const params = new URLSearchParams({ asset_type: assetType })
  if (search) {
    params.append('search', search)
  }
  if (limit) {
    params.append('limit', limit.toString())
  }
  
  const res = await fetch(`${apiBaseUrl}/api/available-symbols?${params.toString()}`, {
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
  // First try the single symbol endpoint (works for any symbol)
  try {
    const res = await fetch(`${apiBaseUrl}/api/price/${encodeURIComponent(symbol)}`, {
      credentials: 'include'
    })
    
    if (res.ok) {
      const data = await res.json()
      if (data.price && data.price > 0) {
        return data.price
      }
      // Price is null or 0
      throw new Error(`No price data available for ${symbol}. The symbol may not be trading or market data is unavailable.`)
    }
    
    // Handle different HTTP status codes
    const status = res.status
    let errorData: { error?: string } = {}
    
    try {
      errorData = await res.json()
    } catch {
      // Response is not JSON
    }
    
    const errorMessage = errorData.error || ''
    
    // Provide specific error messages based on status code and error content
    if (status === 404) {
      if (errorMessage.toLowerCase().includes('not found') || errorMessage.toLowerCase().includes('symbol')) {
        throw new Error(`Symbol "${symbol}" not found. Please verify the symbol is correct and try again.`)
      } else if (errorMessage.toLowerCase().includes('no price data') || errorMessage.toLowerCase().includes('price data')) {
        throw new Error(`No price data available for ${symbol}. The market may be closed or this symbol is not currently trading.`)
      } else {
        throw new Error(`Symbol "${symbol}" not found or price data unavailable. Please check the symbol and try again.`)
      }
    } else if (status === 503) {
      throw new Error(`Service temporarily unavailable. The price service is not initialized. Please try again in a moment.`)
    } else if (status === 500) {
      // Check for specific error messages from the API
      if (errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('connection')) {
        throw new Error(`Network error: Unable to connect to price service. Please check your connection and try again.`)
      } else if (errorMessage.toLowerCase().includes('timeout')) {
        throw new Error(`Request timed out. The price service took too long to respond. Please try again.`)
      } else if (errorMessage) {
        throw new Error(`Price service error: ${errorMessage}`)
      } else {
        throw new Error(`Server error: Unable to fetch price for ${symbol}. Please try again later.`)
      }
    } else {
      throw new Error(errorMessage || `Failed to fetch price (HTTP ${status}). Please try again.`)
    }
  } catch (err: any) {
    // If it's already an Error with a message, re-throw it
    if (err instanceof Error && err.message && !err.message.includes('Failed to fetch')) {
      throw err
    }
    
    // Handle network errors (fetch failures)
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(`Network error: Unable to connect to the server. Please check your internet connection and try again.`)
    }
    
    // Fallback to prices endpoint (only works for symbols in GTT system)
    try {
      const res = await fetch(`${apiBaseUrl}/api/prices`, {
        credentials: 'include'
      })
      if (res.ok) {
        const data = await res.json()
        const price = data.prices?.[symbol]
        if (price && price > 0) {
          return price
        }
      }
    } catch (fallbackErr) {
      // Both failed - throw the original error with better message
      if (err instanceof Error) {
        throw err
      }
    }
    
    // If we get here, both endpoints failed
    throw err instanceof Error ? err : new Error(`Unable to fetch price for ${symbol}. Please verify the symbol and try again.`)
  }
}

