#!/bin/bash

mkdir -p /data

echo "Paper 1.16.5 build 794..."
curl -L --retry 3 --retry-delay 5 -o /data/server.jar \
  "https://fill-data.papermc.io/v1/objects/e67da4851d08cde378ab2b89be58849238c303351ed2482181a99c2c2b489276/paper-1.16.5-794.jar"

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

rm -f /data/STOPPED

java -Xms256M -Xmx512M -jar /data/server.jar --nogui &
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

echo "=== Panel: port 5000 | MC: port 25565 ==="

trap "kill $MC_PID $PANEL_PID 2>/dev/null; exit" SIGTERM SIGINT

while true; do
  if ! kill -0 $MC_PID 2>/dev/null; then
    if [ -f /data/STOPPED ]; then
      echo "Server stopped by user. Waiting..."
      while [ -f /data/STOPPED ]; do sleep 5; done
      echo "Restart requested!"
      cd /data
      java -Xms256M -Xmx512M -jar /data/server.jar --nogui &
      MC_PID=$!
      sleep 30
      cd /app/backend
    else
      echo "MC crashed, restarting..."
      cd /data
      java -Xms256M -Xmx512M -jar /data/server.jar --nogui &
      MC_PID=$!
      sleep 30
      cd /app/backend
    fi
  fi
  sleep 5
done
