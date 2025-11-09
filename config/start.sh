#!/bin/bash
# Combined startup script for GTT Monitor and UI
# This allows PM2 to manage both as a single process

set -e

# Get script directory (config/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Go to project root (one level up from config/)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Set defaults
PORT_API=${PORT_API:-8080}
PORT_UI=${PORT_UI:-3000}

# Function to cleanup on exit
cleanup() {
    if [ ! -z "$UI_PID" ]; then
        kill $UI_PID 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Start UI server in background
echo "Starting UI server on port $PORT_UI..."
cd "$PROJECT_ROOT/ui"
PORT=$PORT_UI NEXT_PUBLIC_API_PORT=$PORT_API npm run dev > "$PROJECT_ROOT/logs/ui-startup.log" 2>&1 &
UI_PID=$!

# Go back to project root directory
cd "$PROJECT_ROOT"

# Start Python monitor in foreground (PM2 tracks this as the main process)
# The Python script starts the API server in a thread, so this is the main process
echo "Starting GTT Monitor (includes API server on port $PORT_API)..."
exec uv run python src/gtt_monitor.py

