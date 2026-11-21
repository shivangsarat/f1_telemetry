FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --no-audit --no-fund
COPY backend/ ./backend/
RUN cd backend && npm run build

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM node:22-bookworm-slim
WORKDIR /app/backend
ENV NODE_ENV=production PORT=8080
COPY --from=builder /app/backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/frontend/dist /app/frontend/dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
