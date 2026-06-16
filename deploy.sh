#!/bin/bash
set -e

echo "=== Starting Web OS Deploy Process ==="

# Check if docker is installed
if ! [ -x "$(command -v docker)" ]; then
  echo "Error: docker is not installed. Please install Docker." >&2
  exit 1
fi

# Check if docker-compose is installed
if ! [ -x "$(command -v docker-compose)" ] && ! docker compose version &>/dev/null; then
  echo "Error: docker-compose is not installed." >&2
  exit 1
fi

# Pull latest code
echo "Pulling latest changes from git..."
git pull origin main || echo "Git pull warning: not a git repository or remote not found. Skipping git pull."

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating default .env configuration..."
  SECRET_KEY=$(openssl rand -hex 24 2>/dev/null || echo "random-secret-key-321")
  cat <<EOT > .env
OS_WEBOS_SESSION_SECRET=$SECRET_KEY
OS_WEBOS_USER=admin
OS_WEBOS_PASS=admin
EOT
  echo ".env created. Change OS_WEBOS_PASS in it before production deployment!"
fi

# Build and start services
echo "Building and starting container stack..."
if docker compose version &>/dev/null; then
  docker compose down
  docker compose up --build -d
else
  docker-compose down
  docker-compose up --build -d
fi

echo "=== Deployment Successful! Application is running on port 9500 ==="
