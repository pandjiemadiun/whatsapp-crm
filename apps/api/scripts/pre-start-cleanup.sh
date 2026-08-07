#!/bin/bash
# Pre-start port cleanup — kill any stale process on PORT before starting fresh.
# This prevents the EADDRINUSE crash loop where PM2 restarts the API but the
# old process hasn't released port 3000 yet.
PORT="${PORT:-3000}"

# Check if port is in use
PID=$(lsof -t -i":${PORT}" 2>/dev/null)
if [ -n "$PID" ]; then
  echo "[pre-start] Port ${PORT} is in use by PID ${PID}, killing..."
  kill -TERM "$PID" 2>/dev/null
  sleep 2
  # Force kill if still alive
  PID=$(lsof -t -i":${PORT}" 2>/dev/null)
  if [ -n "$PID" ]; then
    echo "[pre-start] PID ${PID} did not exit, force killing..."
    kill -9 "$PID" 2>/dev/null
    sleep 1
  fi
fi

echo "[pre-start] Port ${PORT} is free."
