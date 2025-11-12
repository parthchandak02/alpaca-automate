"use client"

import { useState, useEffect, useRef } from "react"
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
  
  // Symbol autocomplete
  const [symbolOptions, setSymbolOptions] = useState<SymbolOption[]>([])
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false)
  const [filteredSymbols, setFilteredSymbols] = useState<SymbolOption[]>([])
  const symbolInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  // Price fetching
  const [isFetchingPrice, setIsFetchingPrice] = useState(false)

  // Load symbols when asset type changes
  useEffect(() => {
    const loadSymbols = async () => {
      try {
        const symbols = await getAvailableSymbols(apiBaseUrl, assetType)
        setSymbolOptions(symbols)
        setFilteredSymbols(symbols.slice(0, 50)) // Show first 50 initially
      } catch (err) {
        console.error('Failed to load symbols:', err)
      }
    }
    loadSymbols()
  }, [assetType, apiBaseUrl])

  // Filter symbols as user types
  useEffect(() => {
    if (!symbol.trim()) {
      setFilteredSymbols(symbolOptions.slice(0, 50))
      return
    }
    
    const searchTerm = symbol.toUpperCase()
    const filtered = symbolOptions.filter(opt => 
      opt.symbol.toUpperCase().includes(searchTerm) ||
      opt.name.toUpperCase().includes(searchTerm) ||
      (opt.symbol_short && opt.symbol_short.toUpperCase().includes(searchTerm))
    ).slice(0, 20) // Limit to 20 results
    
    setFilteredSymbols(filtered)
  }, [symbol, symbolOptions])

  // Auto-fill company when symbol is selected or changes
  useEffect(() => {
    if (symbol.trim()) {
      const fetchCompany = async () => {
        try {
          // Normalize symbol for API call
          let apiSymbol = symbol.trim().toUpperCase()
          if (assetType === 'crypto' && !apiSymbol.includes('/')) {
            apiSymbol = `${apiSymbol}/USD`
          }
          const info = await getAssetInfo(apiBaseUrl, apiSymbol)
          setCompany(info.name)
        } catch (err) {
          // Set error but don't prevent form submission - company will be empty
          console.error('Failed to fetch company name:', err)
          setCompany("") // Clear company if fetch fails
        }
      }
      fetchCompany()
      // Clear price when symbol changes (user must click refresh to get new price)
      setPrice("")
    } else {
      setCompany("") // Clear company when symbol is cleared
      setPrice("") // Clear price when symbol is cleared
    }
  }, [symbol, assetType, apiBaseUrl])


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

  const handleSymbolSelect = (selectedSymbol: string) => {
    // For crypto, show short form in input but use full form for API
    if (assetType === 'crypto' && selectedSymbol.endsWith('/USD')) {
      setSymbol(selectedSymbol.replace('/USD', ''))
    } else {
      setSymbol(selectedSymbol)
    }
    setShowSymbolDropdown(false)
    // Company will be auto-populated by useEffect when symbol changes
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
    if (!company.trim()) {
      setError("Company name could not be loaded. Please try selecting the symbol again.")
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
                  setSymbol(e.target.value)
                  setShowSymbolDropdown(true)
                }}
                onFocus={() => setShowSymbolDropdown(true)}
                placeholder={assetType === 'crypto' ? "BTC or BTC/USD" : "AAPL"}
                className="h-8 text-sm pl-8"
                required
              />
              {showSymbolDropdown && filteredSymbols.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-auto"
                >
                  {filteredSymbols.map((opt) => (
                    <button
                      key={opt.symbol}
                      type="button"
                      onClick={() => handleSymbolSelect(opt.symbol)}
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium">{opt.symbol}</div>
                        <div className="text-xs text-muted-foreground">{opt.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company" className="text-xs">Company</Label>
            <div 
              id="company"
              className="h-8 px-3 py-1.5 text-sm bg-muted/50 border border-border rounded-md flex items-center text-muted-foreground"
            >
              {company || (symbol.trim() ? "Loading..." : "Select a symbol")}
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
