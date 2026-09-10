#!/usr/bin/env bash

# Check if Node.js is installed
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required but was not found in your PATH."
  echo "Please install Node.js from https://nodejs.org"
  exit 1
fi

# Change to script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo ""
echo "🚀 Starting iPhone 4 Music Server..."
echo ""

# Launch server
exec node server.js "$@"
