#!/bin/bash
set -e

echo "=== Step 1: Remove old Docker packages ==="
sudo apt-get remove -y docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc 2>/dev/null || true

echo "=== Step 2: Update and install prerequisites ==="
sudo apt-get update -qq
sudo apt-get install -y ca-certificates curl

echo "=== Step 3: Add Docker GPG key ==="
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "=== Step 4: Add Docker repository ==="
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -qq

echo "=== Step 5: Install Docker Engine ==="
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "=== Step 6: Add current user to docker group ==="
sudo usermod -aG docker $USER

echo "=== Step 7: Start Docker service ==="
sudo service docker start

echo "=== Step 8: Verify installation ==="
sudo docker run hello-world

echo ""
echo "============================================"
echo "  Docker installed successfully!"
echo "  NOTE: Log out and back in (or restart WSL)"
echo "  to use docker without sudo."
echo "============================================"
