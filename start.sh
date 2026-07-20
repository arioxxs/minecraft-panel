#!/bin/bash

mkdir -p /data

FORGE_VERSION="1.21.11-61.0.8"
FORGE_URL="https://maven.minecraftforge.net/net/minecraftforge/forge/${FORGE_VERSION}/forge-${FORGE_VERSION}-installer.jar"

echo "Downloading Forge ${FORGE_VERSION}..."
curl -L --retry 3 -o /data/forge-installer.jar "$FORGE_URL"

FILE_SIZE=$(wc -c < /data/forge-installer.jar 2>/dev/null || echo 0)
echo "Forge installer: ${FILE_SIZE} bytes"

if [ "$FILE_SIZE" -lt 1000000 ]; then
  echo "ERROR: Forge download failed"
  exit 1
fi

cd /data

if [ ! -f /data/forge-${FORGE_VERSION}-universal.jar ]; then
  echo "Installing Forge server..."
  java -jar /data/forge-installer.jar --installServer
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

FORGE_JAR=$(ls /data/forge-*.jar 2>/dev/null | grep -v installer | head -1)

if [ -z "$FORGE_JAR" ]; then
  echo "ERROR: Forge jar not found after install"
  ls -la /data/
  exit 1
fi

echo "Using: $FORGE_JAR"

java -Xms256M -Xmx512M -jar "$FORGE_JAR" --nogui &
MC_PID=$!

echo "Waiting for Minecraft server..."
for i in $(seq 1 120); do
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

echo "=== Panel: port 5000 | Forge: port 25565 ==="

trap "kill $MC_PID $PANEL_PID 2>/dev/null; exit" SIGTERM SIGINT

while true; do
  if ! kill -0 $MC_PID 2>/dev/null; then
    echo "MC server stopped, restarting..."
    cd /data
    java -Xms256M -Xmx512M -jar "$FORGE_JAR" --nogui &
    MC_PID=$!
    sleep 30
    cd /app/backend
  fi
  sleep 5
done
