FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY ../../packages/ingenium-core ./packages/ingenium-core
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER appuser
EXPOSE 4097
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:4097/api/v1/health || exit 1
CMD ["node", "dist/scripts/api-server.js"]
