"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { X, RefreshCw, Search } from "lucide-react"
import { getAvailableSymbols, getAssetInfo, getCurrentPrice, SymbolOption } from "@/lib/gtt-api"

interface ManualGTTFormProps {
  onCancel: () => void
  onSubmit: (data: {
    symbol: string
    company: string
    amount: number
    price: number
    asset_type: 'stock' | 'crypto'
  }) => Promise<void>
  defaultAssetType?: 'stock' | 'crypto'
  apiBaseUrl: string
}

export function ManualGTTForm({ onCancel, onSubmit, defaultAssetType = 'stock', apiBaseUrl }: ManualGTTFormProps) {
  const [symbol, setSymbol] = useState("")
  const [company, setCompany] = useState("")
  const [amount, setAmount] = useState("")
  const [price, setPrice] = useState("")
  const [assetType, setAssetType] = useState<'stock' | 'crypto'>(defaultAssetType)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Symbol autocomplete with server-side search
  const [filteredSymbols, setFilteredSymbols] = useState<SymbolOption[]>([])
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false)
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false)
  const [isLoadingCompany, setIsLoadingCompany] = useState(false)
  const symbolInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const selectedSymbolRef = useRef<string | null>(null) // Track when symbol is selected vs typed
  
  // Price fetching
  const [isFetchingPrice, setIsFetchingPrice] = useState(false)

  // Debounced search function
  const searchSymbols = useCallback(async (searchTerm: string) => {
    if (searchTerm.trim().length < 1) {
      setFilteredSymbols([])
      return
    }

    setIsLoadingSymbols(true)
    try {
      // Use server-side search with limit
      const symbols = await getAvailableSymbols(apiBaseUrl, assetType, searchTerm, 20)
      setFilteredSymbols(symbols)
      setShowSymbolDropdown(symbols.length > 0)
    } catch (err) {
      console.error('Failed to search symbols:', err)
      setFilteredSymbols([])
    } finally {
      setIsLoadingSymbols(false)
    }
  }, [apiBaseUrl, assetType])

  // Handle symbol input change with debouncing
  const handleSymbolChange = (value: string) => {
    setSymbol(value)
    
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    // If symbol was selected from dropdown, don't search
    if (selectedSymbolRef.current === value) {
      selectedSymbolRef.current = null
      return
    }
    
    // Debounce search - wait 300ms after user stops typing
    searchTimeoutRef.current = setTimeout(() => {
      searchSymbols(value)
    }, 300)
  }

  // Fetch company info only when symbol is selected from dropdown
  const fetchCompanyInfo = useCallback(async (symbolValue: string) => {
    if (!symbolValue.trim()) {
      setCompany("")
      return
    }

    setIsLoadingCompany(true)
    try {
      // Normalize symbol for API call
      let apiSymbol = symbolValue.trim().toUpperCase()
      if (assetType === 'crypto' && !apiSymbol.includes('/')) {
        apiSymbol = `${apiSymbol}/USD`
      }
      const info = await getAssetInfo(apiBaseUrl, apiSymbol)
      setCompany(info.name)
    } catch (err) {
      console.error('Failed to fetch company name:', err)
      setCompany("") // Clear company if fetch fails
    } finally {
      setIsLoadingCompany(false)
    }
  }, [assetType, apiBaseUrl])

  // Clear search when asset type changes
  useEffect(() => {
    setSymbol("")
    setCompany("")
    setPrice("")
    setFilteredSymbols([])
    setShowSymbolDropdown(false)
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
  }, [assetType])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])


  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        symbolInputRef.current &&
        !symbolInputRef.current.contains(event.target as Node)
      ) {
        setShowSymbolDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSymbolSelect = (selectedOption: SymbolOption) => {
    // For crypto, show short form in input but use full form for API
    const displaySymbol = assetType === 'crypto' && selectedOption.symbol_short 
      ? selectedOption.symbol_short 
      : selectedOption.symbol
    
    selectedSymbolRef.current = displaySymbol
    setSymbol(displaySymbol)
    setShowSymbolDropdown(false)
    
    // Fetch company info immediately when selected
    fetchCompanyInfo(selectedOption.symbol)
    setPrice("") // Clear price when symbol changes
  }

  const handleFetchPrice = async () => {
    if (!symbol.trim()) {
      setError("Please enter a symbol first")
      return
    }
    
    setIsFetchingPrice(true)
    setError(null)
    try {
      // Normalize symbol for price fetching
      let priceSymbol = symbol.trim().toUpperCase()
      if (assetType === 'crypto' && !priceSymbol.includes('/')) {
        priceSymbol = `${priceSymbol}/USD`
      }
      const currentPrice = await getCurrentPrice(apiBaseUrl, priceSymbol)
      if (currentPrice !== null && currentPrice > 0) {
        setPrice(currentPrice.toFixed(2))
        setError(null)
      } else {
        setError(`No price data available for ${priceSymbol}. The symbol may not be trading or market data is unavailable.`)
      }
    } catch (err: any) {
      // Use the detailed error message from getCurrentPrice
      const errorMessage = err.message || "Failed to fetch price"
      setError(errorMessage)
    } finally {
      setIsFetchingPrice(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!symbol.trim()) {
      setError("Symbol is required")
      return
    }
    
    // If company is not loaded, try to fetch it now (user might have typed symbol manually)
    if (!company.trim() && symbol.trim()) {
      setIsLoadingCompany(true)
      try {
        await fetchCompanyInfo(symbol)
        // Wait a moment for state to update
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (err) {
        // Will be caught below
      } finally {
        setIsLoadingCompany(false)
      }
    }
    
    if (!company.trim()) {
      setError("Company name could not be loaded. Please try selecting the symbol from the dropdown.")
      return
    }
    const amountNum = parseFloat(amount)
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError("Amount must be greater than 0")
      return
    }
    const priceNum = parseFloat(price)
    if (!price || isNaN(priceNum) || priceNum <= 0) {
      setError("Price must be greater than 0")
      return
    }

    setIsSubmitting(true)
    try {
      // Normalize symbol for crypto (add /USD if needed)
      let normalizedSymbol = symbol.trim().toUpperCase()
      if (assetType === 'crypto' && !normalizedSymbol.includes('/')) {
        normalizedSymbol = `${normalizedSymbol}/USD`
      }
      
      await onSubmit({
        symbol: normalizedSymbol,
        company: company.trim(),
        amount: amountNum,
        price: priceNum,
        asset_type: assetType
      })
      // Reset form on success
      setSymbol("")
      setCompany("")
      setAmount("")
      setPrice("")
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to create GTT order')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm">Add Manual GTT Order</h3>
        <Button variant="ghost" size="icon" onClick={onCancel} className="h-6 w-6">
          <X className="h-4 w-4" />
        </Button>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="asset_type" className="text-xs">Asset Type</Label>
          <select
            id="asset_type"
            value={assetType}
            onChange={(e) => {
              setAssetType(e.target.value as 'stock' | 'crypto')
              setSymbol("")
              setCompany("")
              setPrice("")
            }}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="stock">Stock/ETF</option>
            <option value="crypto">Crypto</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 relative">
            <Label htmlFor="symbol" className="text-xs">Symbol *</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={symbolInputRef}
                id="symbol"
                value={symbol}
                onChange={(e) => {
                  handleSymbolChange(e.target.value)
                  if (e.target.value.trim()) {
                    setShowSymbolDropdown(true)
                  }
                }}
                onFocus={() => {
                  if (symbol.trim() && filteredSymbols.length > 0) {
                    setShowSymbolDropdown(true)
                  }
                }}
                placeholder={assetType === 'crypto' ? "Type to search (e.g., BTC)" : "Type to search (e.g., AAPL)"}
                className="h-8 text-sm pl-8"
                required
              />
              {showSymbolDropdown && (filteredSymbols.length > 0 || isLoadingSymbols) && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-auto"
                >
                  {isLoadingSymbols ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                      Searching...
                    </div>
                  ) : filteredSymbols.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                      No symbols found
                    </div>
                  ) : (
                    filteredSymbols.map((opt) => {
                      const displaySymbol = assetType === 'crypto' && opt.symbol_short 
                        ? opt.symbol_short 
                        : opt.symbol
                      return (
                        <button
                          key={opt.symbol}
                          type="button"
                          onClick={() => handleSymbolSelect(opt)}
                          className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                        >
                          <div className="font-medium">{displaySymbol}</div>
                          <div className="text-xs text-muted-foreground">{opt.name}</div>
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company" className="text-xs">Company</Label>
            <div 
              id="company"
              className="h-8 px-0 py-1.5 text-sm flex items-center text-foreground"
            >
              {isLoadingCompany ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : company ? (
                <span>{company}</span>
              ) : (
                <span className="text-muted-foreground">Select a symbol</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="amount" className="text-xs">Amount *</Label>
            <Input
              id="amount"
              type="number"
              step="0.00000001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10"
              className="h-8 text-sm"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price" className="text-xs">Price *</Label>
            <div className="flex gap-1">
              <Input
                id="price"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="150.00"
                className="h-8 text-sm flex-1"
                required
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleFetchPrice}
                disabled={!symbol.trim() || isFetchingPrice}
                className="h-8 w-8"
                title="Get current price"
              >
                <RefreshCw className={`h-3 w-3 ${isFetchingPrice ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded p-2">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Order'}
          </Button>
        </div>
      </form>
    </div>
  )
}
