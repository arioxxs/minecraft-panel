FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./
COPY panel/ ./public/

EXPOSE 5000

CMD ["node", "server.js"]
