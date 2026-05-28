#!/bin/bash
set -e

echo "=== Installing Local Redis and MongoDB (Ubuntu 24.04 Noble) ==="

# 1. Update APT indices
echo -e "\n--- Updating package index ---"
sudo apt-get update

# 2. Prerequisites
echo -e "\n--- Installing prerequisites ---"
sudo apt-get install -y lsb-release curl gpg ca-certificates

# 3. Add Redis official GPG key and repo
echo -e "\n--- Configuring Redis Official Repository ---"
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg --yes
sudo chmod 644 /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list

# 4. Add MongoDB official GPG key and repo (v8.0)
echo -e "\n--- Configuring MongoDB Official Repository ---"
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg --yes
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list

# 5. Install Redis and MongoDB Community Edition
echo -e "\n--- Installing Redis and MongoDB packages ---"
sudo apt-get update
sudo apt-get install -y redis-server mongodb-org

# 6. Start and enable system services
echo -e "\n--- Starting and enabling Redis service ---"
sudo systemctl start redis-server
sudo systemctl enable redis-server

echo -e "\n--- Starting and enabling MongoDB service ---"
sudo systemctl start mongod
sudo systemctl enable mongod

# 7. Verification check
echo -e "\n--- Running connection verification ---"
echo -n "Checking Redis local status: "
if redis-cli ping | grep -q "PONG"; then
    echo "OK (PONG)"
else
    echo "FAILED"
fi

echo -n "Checking MongoDB local status: "
if mongosh --eval "db.runCommand({ping: 1})" --quiet | grep -q "ok: 1" || mongo --eval "db.runCommand({ping: 1})" --quiet | grep -q "ok"; then
    echo "OK (Connected)"
else
    echo "FAILED (Make sure MongoDB service is running)"
fi

echo -e "\n=== Setup complete! Local Redis and MongoDB are now running. ==="
