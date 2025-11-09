#!/bin/bash
# Combined startup script for GTT Monitor and UI
# This allows PM2 to manage both as a single process

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Get script directory (config/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Go to project root (one level up from config/)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Load environment variables safely
if [ -f .env ]; then
    set -a  # Automatically export all variables
    # shellcheck source=/dev/null
    source .env
    set +a
fi

# Set defaults
PORT_API=${PORT_API:-8080}
PORT_UI=${PORT_UI:-3000}

# Track UI process PID
UI_PID=""

# Function to cleanup on exit
cleanup() {
    local exit_code=$?
    
    if [ -n "$UI_PID" ] && kill -0 "$UI_PID" 2>/dev/null; then
        echo "Stopping UI server (PID: $UI_PID)..."
        # Try graceful shutdown first
        kill -TERM "$UI_PID" 2>/dev/null || true
        sleep 2
        # Force kill if still running
        if kill -0 "$UI_PID" 2>/dev/null; then
            kill -KILL "$UI_PID" 2>/dev/null || true
        fi
        wait "$UI_PID" 2>/dev/null || true
    fi
    
    exit $exit_code
}

# Trap signals for graceful shutdown
trap cleanup EXIT TERM INT

# Start UI server in background
echo "Starting UI server on port $PORT_UI..."
cd "$PROJECT_ROOT/ui"
mkdir -p "$PROJECT_ROOT/logs"
PORT=$PORT_UI NEXT_PUBLIC_API_PORT=$PORT_API npm run dev > "$PROJECT_ROOT/logs/ui-startup.log" 2>&1 &
UI_PID=$!

# Give UI a moment to start
sleep 2

# Verify UI started successfully
if ! kill -0 "$UI_PID" 2>/dev/null; then
    echo "ERROR: UI server failed to start. Check logs/ui-startup.log"
    exit 1
fi

# Go back to project root directory
cd "$PROJECT_ROOT"

# Start Python monitor in foreground (PM2 tracks this as the main process)
# The Python script starts the API server in a thread, so this is the main process
echo "Starting GTT Monitor (includes API server on port $PORT_API)..."
exec uv run python -m src.gtt_monitor

