/**
 * Inline GTT creation form component
 */

"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { apiUrl } from "@/lib/api-client";
import { getAvailableSymbols, getAssetInfo, getCurrentPrice, SymbolOption } from "@/lib/gtt-api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Card } from "@/components/ui/Card";
import { X, ChevronDown, ChevronUp, Search, RefreshCw, AlertTriangle, Info } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { useOptimisticGTTContext } from "./GTTOrdersSection";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";

interface CreateGTTFormProps {
  onSuccess: () => void;
  onCancel?: () => void;
  defaultAssetType?: "stock" | "crypto";
}

interface PreviewOrder {
  orderIndex: number;
  amount: number;
  price: number;
  isValid: boolean;
}

export function CreateGTTForm({
  onSuccess,
  onCancel,
  defaultAssetType = "stock",
}: CreateGTTFormProps) {
  // Get optimistic state management (may be null if not within provider)
  const optimisticGTT = useOptimisticGTTContext();
  
  const [symbol, setSymbol] = useState("");
  const [company, setCompany] = useState("");
  const [initialAmount, setInitialAmount] = useState("");
  const [initialPrice, setInitialPrice] = useState("");
  const [incrementQtyBy, setIncrementQtyBy] = useState("");
  const [decrementPriceBy, setDecrementPriceBy] = useState("");
  const [numIterations, setNumIterations] = useState("");
  const [assetType, setAssetType] = useState<"stock" | "crypto">(defaultAssetType);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  
  // Symbol autocomplete with server-side search
  const [filteredSymbols, setFilteredSymbols] = useState<SymbolOption[]>([]);
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
  const [isLoadingCompany, setIsLoadingCompany] = useState(false);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const selectedSymbolRef = useRef<string | null>(null);
  
  // Price fetching
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  
  // Track which inputs have been touched by user
  const [touchedInputs, setTouchedInputs] = useState<Set<string>>(new Set());
  
  // Check which required fields are missing
  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (!symbol.trim()) missing.push('symbol');
    if (!company.trim()) missing.push('description');
    if (!initialAmount.trim() || parseFloat(initialAmount) <= 0) missing.push('initial_amount');
    if (!initialPrice.trim() || parseFloat(initialPrice) <= 0) missing.push('initial_price');
    if (!incrementQtyBy.trim() || parseFloat(incrementQtyBy) <= 0) missing.push('increment_qty');
    if (!decrementPriceBy.trim() || parseFloat(decrementPriceBy) <= 0 || parseFloat(decrementPriceBy) > 1) missing.push('decrement_price');
    if (!numIterations.trim() || parseInt(numIterations) <= 0) missing.push('num_iterations');
    return missing;
  }, [symbol, company, initialAmount, initialPrice, incrementQtyBy, decrementPriceBy, numIterations]);

  // Calculate preview orders
  const previewOrders = useMemo<PreviewOrder[]>(() => {
    if (!initialAmount || !initialPrice || !incrementQtyBy || !decrementPriceBy || !numIterations) {
      return [];
    }

    const initAmount = parseFloat(initialAmount);
    const initPrice = parseFloat(initialPrice);
    const qtyMultiplier = parseFloat(incrementQtyBy);
    const priceMultiplier = parseFloat(decrementPriceBy);
    const iterations = parseInt(numIterations);

    if (
      isNaN(initAmount) || initAmount <= 0 ||
      isNaN(initPrice) || initPrice <= 0 ||
      isNaN(qtyMultiplier) || qtyMultiplier <= 0 ||
      isNaN(priceMultiplier) || priceMultiplier <= 0 || priceMultiplier > 1 ||
      isNaN(iterations) || iterations <= 0
    ) {
      return [];
    }

    const orders: PreviewOrder[] = [];
    let currentAmount = initAmount;
    let currentPrice = initPrice;

    for (let i = 0; i < iterations; i++) {
      const isValid = isFractionable || Number.isInteger(currentAmount);
      
      orders.push({
        orderIndex: i + 1,
        amount: currentAmount,
        price: currentPrice,
        isValid
      });
      currentAmount *= qtyMultiplier;
      currentPrice *= priceMultiplier;
    }

    return orders;
  }, [initialAmount, initialPrice, incrementQtyBy, decrementPriceBy, numIterations, isFractionable]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Debounced search function
  const searchSymbols = useCallback(async (searchTerm: string) => {
    if (searchTerm.trim().length < 1) {
      setFilteredSymbols([]);
      return;
    }

    setIsLoadingSymbols(true);
    try {
      const symbols = await getAvailableSymbols(assetType, searchTerm, 20);
      setFilteredSymbols(symbols);
      setShowSymbolDropdown(symbols.length > 0);
    } catch (err) {
      console.error("Failed to search symbols:", err);
      setFilteredSymbols([]);
    } finally {
      setIsLoadingSymbols(false);
    }
  }, [assetType]);

  // Handle symbol input change with debouncing
  const handleSymbolChange = (value: string) => {
    setSymbol(value);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    if (selectedSymbolRef.current === value) {
      selectedSymbolRef.current = null;
      return;
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      searchSymbols(value);
    }, 300);
  };

  // Define handleFetchPrice first since fetchCompanyInfo depends on it
  const handleFetchPrice = useCallback(async (symbolOverride?: string) => {
    const symbolToUse = symbolOverride || symbol;
    if (!symbolToUse.trim()) {
      setError("Please enter a symbol first");
      return;
    }
    
    setIsFetchingPrice(true);
    setError(null);
    try {
      let priceSymbol = symbolToUse.trim().toUpperCase();
      if (assetType === "crypto" && !priceSymbol.includes("/")) {
        priceSymbol = `${priceSymbol}/USD`;
      }
      const currentPrice = await getCurrentPrice(priceSymbol);
      if (currentPrice !== null && currentPrice > 0) {
        setInitialPrice(currentPrice.toFixed(2));
        setError(null);
      } else {
        setError(`No price data available for ${priceSymbol}. The symbol may not be trading or market data is unavailable.`);
      }
    } catch (err: any) {
      const errorMessage = err.message || "Failed to fetch price";
      setError(errorMessage);
    } finally {
      setIsFetchingPrice(false);
    }
  }, [symbol, assetType]);

  // Fetch company info only when symbol is selected from dropdown
  const fetchCompanyInfo = useCallback(async (symbolValue: string, selectedOption?: SymbolOption) => {
    if (!symbolValue.trim()) {
      setCompany("");
      return;
    }

    setIsLoadingCompany(true);
    try {
      // For crypto, use the full symbol from selectedOption if available (e.g., "BTC/USD")
      // Otherwise construct it from the display symbol
      let apiSymbol: string;
      if (assetType === "crypto") {
        if (selectedOption && selectedOption.symbol) {
          // Use the full symbol from the dropdown (already formatted as BTC/USD)
          apiSymbol = selectedOption.symbol.toUpperCase();
        } else if (symbolValue.includes("/")) {
          // Already has /USD format
          apiSymbol = symbolValue.trim().toUpperCase();
        } else {
          // Need to add /USD
          apiSymbol = `${symbolValue.trim().toUpperCase()}/USD`;
        }
      } else {
        // For stocks, use as-is
        apiSymbol = symbolValue.trim().toUpperCase();
      }
      
      // If we have the selected option from dropdown, use its name directly
      // This is the preferred method since search results already have the name
      if (selectedOption && selectedOption.name) {
        setCompany(selectedOption.name);
        // Auto-trigger price fetch using the API symbol format
        setTimeout(() => {
          handleFetchPrice(apiSymbol);
        }, 100);
        setIsLoadingCompany(false);
        return;
      }
      
      // Otherwise try to fetch from API (fallback)
      try {
        const info = await getAssetInfo(apiSymbol);
        setCompany(info.name);
        
        // Auto-trigger price fetch when company info is successfully loaded
        if (info.name) {
          setTimeout(() => {
            handleFetchPrice(apiSymbol);
          }, 100);
        }
      } catch (err) {
        // For crypto, if API fails, use symbol as name or try to get from search results
        if (assetType === "crypto") {
          // Try to find in recent search results
          const foundSymbol = filteredSymbols.find(s => 
            s.symbol.toUpperCase() === apiSymbol || 
            s.symbol.toUpperCase() === symbolValue.toUpperCase() ||
            (s.symbol_short && s.symbol_short.toUpperCase() === symbolValue.toUpperCase())
          );
          if (foundSymbol && foundSymbol.name) {
            setCompany(foundSymbol.name);
            setTimeout(() => {
              handleFetchPrice(apiSymbol);
            }, 100);
          } else {
            // Fallback: use symbol as name for crypto
            setCompany(symbolValue.toUpperCase());
            setTimeout(() => {
              handleFetchPrice(apiSymbol);
            }, 100);
          }
        } else {
          // Stock asset type - couldn't fetch company name
          console.error("Failed to fetch company name:", err);
          setCompany("");
          setError(`Could not fetch company name for ${symbolValue.toUpperCase()}. Please try selecting the symbol from the dropdown.`);
        }
      }
    } catch (err) {
      console.error("Failed to fetch company name:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      // For crypto, use symbol as fallback name
      if (assetType === "crypto") {
        setCompany(symbolValue.toUpperCase());
        // Check if it's a 404 error
        if (errorMsg.includes("404") || errorMsg.includes("not found")) {
          setError(`Crypto symbol '${symbolValue.toUpperCase()}' not found. Make sure to use the format BTC/USD, ETH/USD, etc.`);
        } else {
          setError(`Could not fetch asset info for ${symbolValue.toUpperCase()}. Using symbol as name.`);
        }
      } else {
        setCompany("");
        if (errorMsg.includes("404") || errorMsg.includes("not found")) {
          setError(`Stock symbol '${symbolValue.toUpperCase()}' not found. Please verify the symbol exists.`);
        } else {
          setError(`Could not fetch company name for ${symbolValue.toUpperCase()}. Please try selecting the symbol from the dropdown.`);
        }
      }
    } finally {
      setIsLoadingCompany(false);
    }
  }, [assetType, handleFetchPrice, filteredSymbols]);

  // Clear search when asset type changes
  useEffect(() => {
    setSymbol("");
    setCompany("");
    setInitialPrice("");
    setFilteredSymbols([]);
    setShowSymbolDropdown(false);
    setTouchedInputs(new Set());
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  }, [assetType]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        symbolInputRef.current &&
        !symbolInputRef.current.contains(event.target as Node)
      ) {
        setShowSymbolDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSymbolSelect = (selectedOption: SymbolOption) => {
    const displaySymbol = assetType === "crypto" && selectedOption.symbol_short 
      ? selectedOption.symbol_short 
      : selectedOption.symbol;
    
    selectedSymbolRef.current = displaySymbol;
    setSymbol(displaySymbol);
    setShowSymbolDropdown(false);
    
    // Pass the selectedOption so we can use its name directly
    fetchCompanyInfo(selectedOption.symbol, selectedOption);
    setInitialPrice("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!symbol.trim()) {
      setError("Symbol is required");
      return;
    }
    
    if (!company.trim() && symbol.trim()) {
      setIsLoadingCompany(true);
      try {
        await fetchCompanyInfo(symbol);
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        // Will be caught below
      } finally {
        setIsLoadingCompany(false);
      }
    }
    
    if (!company.trim()) {
      setError("Company name could not be loaded. Please try selecting the symbol from the dropdown.");
      return;
    }

    if (previewOrders.length === 0) {
      setError("Please fill in all required fields to generate orders");
      return;
    }

    setIsSubmitting(true);
    
    const normalizedSymbol = symbol.trim().toUpperCase() + (assetType === "crypto" && !symbol.includes("/") ? "/USD" : "");
    
    // Add optimistic state immediately (if context available)
    optimisticGTT?.addOptimisticOrders(normalizedSymbol, previewOrders.length);
    
    try {
      const token = localStorage.getItem("token");

      // Create all orders sequentially
      const createdOrders: number[] = [];
      const failedOrders: Array<{ index: number; error: string }> = [];
      
      for (const order of previewOrders) {
        // Update optimistic progress (if context available)
        optimisticGTT?.updateProgress(normalizedSymbol, createdOrders.length);
        
        try {
          const response = await fetch(apiUrl("/api/v1/gtt"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              symbol: normalizedSymbol,
              company: company.trim() || null,
              amount: order.amount,
              price: order.price,
              asset_type: assetType,
            }),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            let errorMessage = data.detail || `HTTP ${response.status}: Failed to create order ${order.orderIndex}`;
            
            // Improve error messages for common issues
            if (response.status === 400) {
              // Bad Request - validation error
              errorMessage = `Order #${order.orderIndex}: ${errorMessage}`;
            } else if (response.status === 404) {
              // Not Found - symbol issue
              if (assetType === "crypto") {
                errorMessage = `Order #${order.orderIndex}: Crypto symbol '${normalizedSymbol}' not found. Make sure to use the format BTC/USD, ETH/USD, etc.`;
              } else {
                errorMessage = `Order #${order.orderIndex}: Stock symbol '${normalizedSymbol}' not found. Please verify the symbol exists.`;
              }
            } else if (response.status === 500) {
              // Server error - provide more context
              errorMessage = `Order #${order.orderIndex}: Server error - ${data.detail || "Internal server error"}`;
            } else if (response.status === 503) {
              // Service unavailable - likely database lock
              errorMessage = `Order #${order.orderIndex}: Server busy (database locked). Try reducing batch size.`;
            }
            
            console.error("Create GTT Order Error:", {
              orderIndex: order.orderIndex,
              symbol: normalizedSymbol,
              assetType: assetType,
              url: apiUrl("/api/v1/gtt"),
              status: response.status,
              statusText: response.statusText,
              error: data,
              errorMessage: errorMessage,
              // Log request body for debugging
              requestBody: {
                symbol: normalizedSymbol,
                amount: order.amount,
                price: order.price,
                asset_type: assetType,
              },
            });
            failedOrders.push({ index: order.orderIndex, error: errorMessage });
            continue;
          }

          const createdOrder = await response.json();
          createdOrders.push(order.orderIndex);
          
          // Update optimistic progress (if context available)
          optimisticGTT?.updateProgress(normalizedSymbol, createdOrders.length);
          
          // Delay between orders - generous delays for reliability (personal project, speed not critical)
          // Prevents database lock contention and rate limiting issues
          const delay = previewOrders.length >= 20 ? 300 : 200; // Doubled for reliability
          await new Promise((resolve) => setTimeout(resolve, delay));
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          console.error("Create GTT Order Exception:", {
            orderIndex: order.orderIndex,
            symbol: normalizedSymbol,
            url: apiUrl("/api/v1/gtt"),
            error: errorMessage,
            fullError: err,
          });
          failedOrders.push({ index: order.orderIndex, error: errorMessage });
        }
      }
      
      // Report results
      if (failedOrders.length > 0) {
        const errorMessages = failedOrders.map(f => `Order #${f.index}: ${f.error}`).join("\n");
        
        // Mark optimistic as error (if context available)
        optimisticGTT?.errorOptimistic(normalizedSymbol, `${failedOrders.length} orders failed`);
        
        throw new Error(`Failed to create ${failedOrders.length} of ${previewOrders.length} orders:\n\n${errorMessages}\n\n${createdOrders.length > 0 ? `${createdOrders.length} orders were created successfully.` : ""}\n\nCheck console for details.`);
      }

      // Mark optimistic as completed (if context available)
      optimisticGTT?.completeOptimistic(normalizedSymbol);

      // Reset form on success
      setSymbol("");
      setCompany("");
      setInitialAmount("");
      setInitialPrice("");
      setIncrementQtyBy("");
      setDecrementPriceBy("");
      setNumIterations("");
      setShowPreview(false);
      setError(null);
      setTouchedInputs(new Set());
      
      // Small delay to ensure backend has finished processing and WebSocket updates are sent
      // This prevents race conditions where frontend refetches before backend is ready
      await new Promise((resolve) => setTimeout(resolve, 500));
      onSuccess();
    } catch (err) {
      // Mark optimistic as error (if context available)
      optimisticGTT?.errorOptimistic(normalizedSymbol, err instanceof Error ? err.message : "Unknown error");
      
      setError(err instanceof Error ? err.message : "Failed to create GTT orders");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-border-table rounded-lg p-4 bg-muted/30 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm">Add Manual GTT Order</h3>
        {onCancel && (
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-6 w-6">
            <X className="h-4 w-4 text-icon-close" />
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Non-fractionable warning banner */
        !isFractionable && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 mb-4 flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-blue-400 mb-1">Whole Shares Only</p>
              <p className="text-muted-foreground">
                This asset does not support fractional trading. All order quantities must be whole numbers (e.g. 1, 2, 5).
              </p>
            </div>
          </div>
        )}

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
                  handleSymbolChange(e.target.value);
                  if (e.target.value.trim()) {
                    setShowSymbolDropdown(true);
                  }
                }}
                onFocus={() => {
                  if (symbol.trim() && filteredSymbols.length > 0) {
                    setShowSymbolDropdown(true);
                  }
                }}
                placeholder={assetType === "crypto" ? "Type to search (e.g., BTC)" : "Type to search (e.g., AAPL)"}
                className={`h-8 text-sm pl-8 ${missingFields.includes('symbol') && previewOrders.length === 0 ? 'border-action-danger/50 focus-visible:ring-action-danger/50' : ''}`}
                required
              />
              {showSymbolDropdown && (filteredSymbols.length > 0 || isLoadingSymbols) && (
                <div
                  ref={dropdownRef}
                  className="absolute z-[1000] w-full mt-1 border border-border-table rounded-md shadow-lg max-h-60 overflow-auto"
                  style={{ 
                    backgroundColor: 'oklch(0.18 0 0)',
                    backdropFilter: 'none'
                  }}
                >
                  {isLoadingSymbols ? (
                    <div 
                      className="px-3 py-2 text-sm text-muted-foreground text-center"
                      style={{ backgroundColor: 'oklch(0.18 0 0)' }}
                    >
                      Searching...
                    </div>
                  ) : filteredSymbols.length === 0 ? (
                    <div 
                      className="px-3 py-2 text-sm text-muted-foreground text-center"
                      style={{ backgroundColor: 'oklch(0.18 0 0)' }}
                    >
                      No symbols found
                    </div>
                  ) : (
                    filteredSymbols.map((opt) => {
                      const displaySymbol = assetType === "crypto" && opt.symbol_short 
                        ? opt.symbol_short 
                        : opt.symbol;
                      return (
                        <button
                          key={opt.symbol}
                          type="button"
                          onClick={() => handleSymbolSelect(opt)}
                          className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent"
                          style={{ backgroundColor: 'oklch(0.18 0 0)' }}
                        >
                          <div className="font-medium">{displaySymbol}</div>
                          <div className="text-xs text-muted-foreground">{opt.name}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs">Description</Label>
            {company && (
              <div 
                id="description"
                className="text-sm text-foreground"
              >
                {isLoadingCompany ? (
                  <span className="text-muted-foreground">Loading...</span>
                ) : (
                  <span>{company}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="initial_amount" className="text-xs">Initial Qty. *</Label>
            <Input
              id="initial_amount"
              type="number"
              step="0.00000001"
              value={initialAmount}
              onChange={(e) => {
                setInitialAmount(e.target.value);
                setTouchedInputs(prev => new Set(prev).add('initial_amount'));
                setShowPreview(false);
              }}
              placeholder="1"
              className={`h-8 text-sm ${!touchedInputs.has('initial_amount') && !initialAmount ? 'text-helper-foreground italic placeholder:text-helper-foreground' : ''} ${missingFields.includes('initial_amount') && previewOrders.length === 0 ? 'border-action-danger/50 focus-visible:ring-action-danger/50' : ''}`}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="initial_price" className="text-xs">Initial Price *</Label>
            <div className="flex gap-1">
              <Input
                id="initial_price"
                type="number"
                step="0.01"
                value={initialPrice}
                onChange={(e) => {
                  setInitialPrice(e.target.value);
                  setTouchedInputs(prev => new Set(prev).add('initial_price'));
                  setShowPreview(false);
                }}
                placeholder="150.00"
                className={`h-8 text-sm flex-1 ${!touchedInputs.has('initial_price') && !initialPrice ? 'text-helper-foreground italic placeholder:text-helper-foreground' : ''} ${missingFields.includes('initial_price') && previewOrders.length === 0 ? 'border-action-danger/50 focus-visible:ring-action-danger/50' : ''}`}
                required
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => handleFetchPrice()}
                disabled={!symbol.trim() || isFetchingPrice}
                className="h-8 w-8"
                title="Get current price"
              >
                <RefreshCw className={`h-3 w-3 text-icon-refresh ${isFetchingPrice ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="total_value" className="text-xs">Value</Label>
            <div className="h-8 px-2 py-1.5 text-sm flex items-center text-foreground">
              {(() => {
                const amount = parseFloat(initialAmount);
                const price = parseFloat(initialPrice);
                if (!isNaN(amount) && !isNaN(price) && amount > 0 && price > 0) {
                  return formatCurrency(amount * price);
                }
                return <span className="text-muted-foreground">—</span>;
              })()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="increment_qty" className="text-xs">Increment Qty By *</Label>
            <Input
              id="increment_qty"
              type="number"
              step="0.1"
              min="0.1"
              value={incrementQtyBy}
              onChange={(e) => {
                setIncrementQtyBy(e.target.value);
                setTouchedInputs(prev => new Set(prev).add('increment_qty'));
                setShowPreview(false);
              }}
              placeholder="1.2"
              className={`h-8 text-sm ${!touchedInputs.has('increment_qty') && !incrementQtyBy ? 'text-helper-foreground italic placeholder:text-helper-foreground' : ''} ${missingFields.includes('increment_qty') && previewOrders.length === 0 ? 'border-action-danger/50 focus-visible:ring-action-danger/50' : ''}`}
              required
            />
            <p className={`text-xs ${previewOrders.length === 0 ? 'text-action-warning' : 'text-muted-foreground'}`}>Multiplier (e.g., 1.2, 1.5, 2.0)</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="decrement_price" className="text-xs">Decrement Price By *</Label>
            <Input
              id="decrement_price"
              type="number"
              step="0.01"
              min="0.01"
              max="1"
              value={decrementPriceBy}
              onChange={(e) => {
                setDecrementPriceBy(e.target.value);
                setTouchedInputs(prev => new Set(prev).add('decrement_price'));
                setShowPreview(false);
              }}
              placeholder="0.9"
              className={`h-8 text-sm ${!touchedInputs.has('decrement_price') && !decrementPriceBy ? 'text-helper-foreground italic placeholder:text-helper-foreground' : ''} ${missingFields.includes('decrement_price') && previewOrders.length === 0 ? 'border-action-danger/50 focus-visible:ring-action-danger/50' : ''}`}
              required
            />
            <p className={`text-xs ${previewOrders.length === 0 ? 'text-action-warning' : 'text-muted-foreground'}`}>Multiplier (0-1, e.g., 0.9 = 10% decrease)</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="num_iterations" className="text-xs">Number of Iterations *</Label>
            <Input
              id="num_iterations"
              type="number"
              min="1"
              value={numIterations}
              onChange={(e) => {
                setNumIterations(e.target.value);
                setTouchedInputs(prev => new Set(prev).add('num_iterations'));
                setShowPreview(false);
              }}
              placeholder="5"
              className={`h-8 text-sm ${!touchedInputs.has('num_iterations') && !numIterations ? 'text-helper-foreground italic placeholder:text-helper-foreground' : ''} ${missingFields.includes('num_iterations') && previewOrders.length === 0 ? 'border-action-danger/50 focus-visible:ring-action-danger/50' : ''}`}
              required
            />
            <p className={`text-xs ${previewOrders.length === 0 ? 'text-action-warning' : 'text-muted-foreground'}`}>Integer &gt; 0</p>
          </div>
        </div>

        {/* Preview Section */}
        {previewOrders.length > 0 && (
          <div className="border border-border-table rounded-lg p-3 bg-background/50">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Order Preview</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="h-6 text-xs bg-action-warning/10 hover:bg-action-warning/20 text-action-warning border-action-warning/30 hover:border-action-warning/50"
              >
                {showPreview ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Hide
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Show
                  </>
                )}
              </Button>
            </div>
            {showPreview && (
              <div className="mt-2 border border-border-table rounded overflow-hidden">
                <div className="overflow-x-auto max-h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Order #</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="w-8"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewOrders.map((order) => (
                        <TableRow key={order.orderIndex} className={!order.isValid ? "bg-action-danger/5 hover:bg-action-danger/10" : ""}>
                          <TableCell className="font-mono text-xs">{order.orderIndex}</TableCell>
                          <TableCell className={`text-right font-mono text-sm ${!order.isValid ? "text-action-danger font-bold" : ""}`}>
                            {order.amount.toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(order.price)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(order.amount * order.price)}</TableCell>
                          <TableCell>
                            {!order.isValid && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className="h-4 w-4 text-action-danger cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent side="left">
                                    <p>Invalid fractional quantity for this asset</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="px-3 py-2 bg-muted/30 border-t border-border-table text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Orders:</span>
                    <span className="font-semibold">{previewOrders.length}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Total Quantity:</span>
                    <span className="font-semibold">{previewOrders.reduce((sum, o) => sum + o.amount, 0).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Total Value:</span>
                    <span className="font-semibold">{formatCurrency(previewOrders.reduce((sum, o) => sum + o.amount * o.price, 0))}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-sm text-action-danger bg-action-danger/10 border border-action-danger/20 rounded p-2">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end mt-4">
          <Button 
            type="submit" 
            size="sm" 
            disabled={isSubmitting || previewOrders.length === 0}
            className={`font-medium transition-all ${
              previewOrders.length === 0
                ? 'bg-muted hover:bg-muted/80 text-muted-foreground cursor-not-allowed'
                : 'bg-action-primary hover:bg-action-primary-hover text-action-primary-text'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isSubmitting 
              ? "Creating..." 
              : previewOrders.length === 0
              ? missingFields.length > 0 
                ? `Fill out all fields (${missingFields.length} missing)`
                : "Fill out all fields"
              : `Place ${previewOrders.length} GTT order${previewOrders.length !== 1 ? "s" : ""}`
            }
          </Button>
        </div>
      </form>
    </div>
  );
}

