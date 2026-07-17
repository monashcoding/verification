# syntax=docker/dockerfile:1

# ── Build stage: compile the server (tsc) and bundle the SPA (vite) ───────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_AUTH_URL is baked into the SPA bundle at build time (browser-exposed).
# Default is the real prod auth service; override with --build-arg if needed.
ARG VITE_AUTH_URL=https://auth.monashcoding.com
ENV VITE_AUTH_URL=$VITE_AUTH_URL
RUN npm run build

# ── Runtime stage: prod deps + compiled output only ───────────────────────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled server + SPA, and the SQL migrations the entrypoint applies on boot.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
