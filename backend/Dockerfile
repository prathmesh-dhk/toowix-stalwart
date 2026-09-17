# Multi-stage production Dockerfile for Toowix Mail Platform Backend
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Runtime Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# bash/mongodb-tools/aws-cli/openssl are for scripts/backup-s3.sh, run in this
# same image by the backup-cron service (see deploy/docker-compose.prod.yml)
# with an overridden entrypoint — not needed by the API server itself.
RUN apk add --no-cache bash mongodb-tools aws-cli openssl

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY scripts/ ./scripts/
RUN chmod +x ./scripts/*.sh

EXPOSE 4000

# Start API server
CMD ["node", "dist/index.js"]

