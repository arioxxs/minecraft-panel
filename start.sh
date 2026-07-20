#!/bin/bash

mkdir -p /data

if [ ! -f /data/server.jar ]; then
  echo "Downloading Paper server..."
  curl -o /data/server.jar https://api.papermc.io/v2/projects/paper/versions/1.21.5/builds/61/downloads/paper-1.21.5-61.jar
fi

echo "eula=true" > /data/eula.txt

cd /data

java -Xms256M -Xmx512M -jar /data/server.jar --nogui &
MC_PID=$!

echo "Waiting for Minecraft server to start..."
sleep 15

cd /app/backend
node server.js &
PANEL_PID=$!

echo "=== Panel running on port 5000 ==="
echo "=== Minecraft server running on port 25565 ==="

wait $MC_PID $PANEL_PID
