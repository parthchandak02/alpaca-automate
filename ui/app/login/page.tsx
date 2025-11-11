"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Lock } from "lucide-react"

export default function LoginPage() {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const router = useRouter()

  // Get API base URL (same logic as main page)
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

  // Check if already authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/auth/verify`, {
          credentials: 'include', // Include cookies
        })
        
        if (response.ok) {
          const data = await response.json()
          if (data.authenticated) {
            router.push('/')
            return
          }
        }
      } catch (err) {
        // Ignore errors during check
      }
      setIsCheckingAuth(false)
    }
    
    checkAuth()
  }, [apiBaseUrl, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies
        body: JSON.stringify({ password }),
      })

      const data = await response.json()

      if (response.ok) {
        // Successful login - redirect to main page
        router.push('/')
      } else {
        setError(data.error || 'Invalid password')
      }
    } catch (err) {
      setError('Failed to connect to server. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md" style={{ backgroundColor: 'var(--card)', color: 'var(--card-foreground)' }}>
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-2">
            <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-card border border-primary/30 flex items-center justify-center">
              <img
                src="/alpaca-logo.png"
                alt="Alpaca Logo"
                className="w-full h-full object-cover scale-150"
                style={{ imageRendering: 'crisp-edges' }}
              />
            </div>
          </div>
          <CardTitle className="text-2xl text-center" style={{ color: 'var(--card-foreground)' }}>Alpaca Order Manager</CardTitle>
          <CardDescription className="text-center" style={{ color: 'var(--muted-foreground)' }}>
            Enter your password to access the trading dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" style={{ color: 'var(--foreground)' }}>Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  disabled={isLoading}
                  autoFocus
                  style={{ backgroundColor: 'var(--input)', color: 'var(--foreground)', borderColor: 'var(--border)' }}
                />
              </div>
            </div>
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-md">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading || !password}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                'Login'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

