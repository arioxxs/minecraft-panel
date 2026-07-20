#!/bin/bash

mkdir -p /data

echo "Paper 1.21.5 build 114..."
curl -L --retry 3 --retry-delay 5 -o /data/server.jar \
  "https://fill-data.papermc.io/v1/objects/2ae6ae22adf417699746e0f89fc2ef6cb6ee050a5f6608cee58f0535d60b509e/paper-1.21.5-114.jar"

FILE_SIZE=$(wc -c < /data/server.jar 2>/dev/null || echo 0)
echo "Downloaded: ${FILE_SIZE} bytes"

if [ "$FILE_SIZE" -lt 10000000 ]; then
  echo "ERROR: Download failed"
  exit 1
fi

echo "eula=true" > /data/eula.txt

cat > /data/server.properties << 'EOF'
server-port=25565
level-name=world
gamemode=survival
difficulty=normal
max-players=10
online-mode=false
view-distance=8
simulation-distance=6
enable-rcon=true
rcon.port=25575
rcon.password=minecraft123
enable-command-block=false
spawn-protection=0
EOF

cd /data

java -Xms256M -Xmx512M -jar /data/server.jar --nogui &
MC_PID=$!

echo "Waiting for Minecraft server..."
for i in $(seq 1 90); do
  if nc -z localhost 25575 2>/dev/null; then
    echo "RCON is ready!"
    break
  fi
  if ! kill -0 $MC_PID 2>/dev/null; then
    echo "ERROR: Minecraft server process died"
    exit 1
  fi
  sleep 1
done

cd /app/backend
node server.js &
PANEL_PID=$!

echo "=== Panel: port 5000 | Minecraft: port 25565 ==="

wait $MC_PID $PANEL_PID
