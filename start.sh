#!/bin/bash

mkdir -p /data

if [ ! -f /data/server.jar ] || [ $(wc -c < /data/server.jar 2>/dev/null || echo 0) -lt 10000000 ]; then
  echo "[1/4] Downloading Paper 1.16.5 build 794..."
  rm -f /data/server.jar
  curl -L --retry 3 --retry-delay 5 -o /data/server.jar \
    "https://fill-data.papermc.io/v1/objects/e67da4851d08cde378ab2b89be58849238c303351ed2482181a99c2c2b489276/paper-1.16.5-794.jar"
fi

FILE_SIZE=$(wc -c < /data/server.jar 2>/dev/null || echo 0)
echo "[2/4] Server jar: ${FILE_SIZE} bytes"

if [ "$FILE_SIZE" -lt 10000000 ]; then
  echo "ERROR: Download failed or jar too small"
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
level-seed=
level-type=DEFAULT
generate-structures=true
spawn-npcs=true
spawn-animals=true
spawn-monsters=true
allow-nether=true
pvp=true
allow-flight=false
max-tick-time=60000
EOF

echo "[3/4] Starting Minecraft server..."
cd /data
rm -f /data/STOPPED

java -Xms512M -Xmx1024M -XX:+UseG1GC -jar /data/server.jar --nogui &
MC_PID=$!

echo "MC PID: $MC_PID"
echo "Waiting for RCON on port 25575..."
RCON_READY=false
for i in $(seq 1 180); do
  if nc -z localhost 25575 2>/dev/null; then
    echo "RCON is ready after ${i}s!"
    RCON_READY=true
    break
  fi
  if ! kill -0 $MC_PID 2>/dev/null; then
    echo "ERROR: MC process died after ${i}s"
    exit 1
  fi
  if [ $((i % 15)) -eq 0 ]; then
    echo "Still waiting... ${i}s elapsed"
  fi
  sleep 1
done

if [ "$RCON_READY" = false ]; then
  echo "WARNING: RCON not ready after 180s, starting panel anyway"
fi

echo "[4/4] Starting panel..."
cd /app/backend
node server.js &
PANEL_PID=$!

echo "=== Panel: port 5000 | MC: port 25565 | RCON: port 25575 ==="

trap "kill $MC_PID $PANEL_PID 2>/dev/null; exit" SIGTERM SIGINT

while true; do
  if ! kill -0 $MC_PID 2>/dev/null; then
    if [ -f /data/STOPPED ]; then
      echo "Server stopped by user. Waiting..."
      while [ -f /data/STOPPED ]; do sleep 5; done
      echo "Restart requested!"
      cd /data
      java -Xms512M -Xmx1024M -XX:+UseG1GC -jar /data/server.jar --nogui &
      MC_PID=$!
      sleep 30
      cd /app/backend
    else
      echo "MC crashed, restarting in 5s..."
      sleep 5
      cd /data
      java -Xms512M -Xmx1024M -XX:+UseG1GC -jar /data/server.jar --nogui &
      MC_PID=$!
      sleep 30
      cd /app/backend
    fi
  fi
  sleep 5
done
