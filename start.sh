#!/bin/bash

mkdir -p /data /data/db

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

if [ ! -f /data/server.properties ]; then
  echo "Generating fresh server.properties..."
  cat > /data/server.properties << 'EOF'
server-port=25565
level-name=world
gamemode=survival
difficulty=normal
max-players=5
online-mode=false
view-distance=6
simulation-distance=4
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
else
  echo "server.properties already exists, keeping user settings"
fi

echo "[3/4] Starting Minecraft server..."
cd /data
rm -f /data/STOPPED

java -Xms200M -Xmx256M -XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:SoftRefLRUPolicyMSPerMB=0 -jar /data/server.jar --nogui &
MC_PID=$!

save_and_exit() {
  echo ""
  echo "Shutting down - saving world..."
  if kill -0 $MC_PID 2>/dev/null; then
    mcrcon -H localhost -P 25575 -p minecraft123 "save-all" 2>/dev/null || true
    mcrcon -H localhost -P 25575 -p minecraft123 "stop" 2>/dev/null || true
    sleep 3
  fi
  rm -f /data/STOPPED
  kill $PANEL_PID 2>/dev/null
  exit 0
}

trap save_and_exit SIGTERM SIGINT

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

wait $MC_PID
EXIT_CODE=$?

if [ -f /data/STOPPED ]; then
  echo "Server stopped by user. Waiting..."
  while [ -f /data/STOPPED ]; do sleep 5; done
  echo "Restart requested!"
  rm -f /data/STOPPED
  echo "Exiting with code 1 for Railway restart..."
  kill $PANEL_PID 2>/dev/null
  exit 1
fi

echo "Unexpected exit (code $EXIT_CODE), triggering Railway restart..."
kill $PANEL_PID 2>/dev/null
exit 1
