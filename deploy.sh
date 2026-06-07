#!/bin/bash
set -e

echo "Building NTU Rental Finder..."
docker compose build

echo "Starting services..."
docker compose up -d

echo "Done! Access at http://localhost:3003"
