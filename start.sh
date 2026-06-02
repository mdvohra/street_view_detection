#!/usr/bin/env bash
set -euo pipefail

if [ ! -f ".env" ]; then
  echo ".env not found in project root."
  echo "Create it from .env.example and add your API keys."
  exit 1
fi

echo "Start inference in another terminal first:"
echo "  pip install inference-cli && inference server start"
echo ""
read -r -p "Press Enter when http://localhost:9001/docs is up..."

docker compose up --build
