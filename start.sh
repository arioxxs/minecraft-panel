#!/bin/bash

mkdir -p /data

if [ ! -f /data/server.jar ]; then
  echo "Downloading Paper server..."
  curl -L -o /data/server.jar https://api.papermc.io/v2/projects/paper/versions/1.21.5/builds/61/downloads/paper-1.21.5-61.jar
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
level-type=minecraft\:normal
generator-settings={}
EOF

cd /data

java -Xms256M -Xmx512M -jar /data/server.jar --nogui &
MC_PID=$!

echo "Waiting for Minecraft server..."
for i in $(seq 1 60); do
  if nc -z localhost 25575 2>/dev/null; then
    echo "RCON is ready!"
    break
  fi
  sleep 1
done

cd /app/backend
node server.js &
PANEL_PID=$!

echo "=== Panel: port 5000 | Minecraft: port 25565 ==="

wait $MC_PID $PANEL_PID
