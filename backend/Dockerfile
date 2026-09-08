# Multi-stage production Dockerfile for Toowix Mail Platform Backend
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Runtime Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./src/db/migrations
COPY src/db/migrations ./dist/db/migrations

EXPOSE 4000

# Run migrations and start API server
CMD ["node", "dist/index.js"]
