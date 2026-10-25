# Node 24 is the supported production LTS line. Build with --pull for OS fixes.
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app
ARG MING_APP_ORIGIN
ENV MING_APP_ORIGIN=$MING_APP_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS frontend
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=frontend-build --chown=node:node /app/.next/standalone ./
COPY --from=frontend-build --chown=node:node /app/.next/static ./.next/static
COPY --from=frontend-build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:24-bookworm-slim AS backend-build
WORKDIR /app/src/backend
COPY src/backend/package.json src/backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src/backend/ ./
RUN npm run build \
    && rm -rf .mastra/output/node_modules .mastra/output/package-lock.json \
    && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS backend
WORKDIR /app/src/backend
ENV NODE_ENV=production PORT=4111 MASTRA_TELEMETRY_DISABLED=true
COPY --from=backend-build --chown=node:node /app/src/backend/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/src/backend/.mastra/output ./.mastra/output
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4111
CMD ["node", ".mastra/output/index.mjs"]
