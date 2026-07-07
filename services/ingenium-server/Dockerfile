# Multi-stage build for the Ingenium MCP stdio server
# Stage 1: Build TypeScript
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Minimal runtime image with dist + node_modules only
FROM node:22-alpine AS runtime
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER appuser
CMD ["node", "dist/scripts/mcp-server.js"]
