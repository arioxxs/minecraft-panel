FROM eclipse-temurin:21-jre-alpine

RUN apk add --no-cache nodejs npm curl wget bash netcat-openbsd

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
