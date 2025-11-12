"use client"

import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

interface ConfirmationDialogProps {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "destructive"
}

export function ConfirmationDialog({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  variant = "default"
}: ConfirmationDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-background rounded-lg shadow-lg w-full max-w-md m-4" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`flex-shrink-0 ${variant === "destructive" ? "text-destructive" : "text-foreground"}`}>
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button 
              variant={variant === "destructive" ? "destructive" : "default"} 
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

