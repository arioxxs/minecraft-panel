FROM node:18-alpine

RUN apk add --no-cache openjdk11-jre curl wget bash netcat-openbsd unzip && \
  wget -q -O /tmp/mcrcon.zip https://github.com/Tiiffi/mcrcon/releases/download/v0.7.2/mcrcon-0.7.2-linux-x86-64-static.zip && \
  unzip -o /tmp/mcrcon.zip -d /usr/local/bin/ && \
  rm /tmp/mcrcon.zip && \
  chmod +x /usr/local/bin/mcrcon

RUN mkdir -p /data /app

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./
COPY panel/ ./public/
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 25565 25575 5000

CMD ["/start.sh"]
