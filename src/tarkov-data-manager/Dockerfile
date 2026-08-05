FROM node:24.11.1-slim AS base

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/node/.npm \
    && chown -R node:node /app /home/node/.npm

FROM base AS builder

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM base AS runtime

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/build/app/ ./

RUN npm ci --omit=dev --no-audit --no-fund \
    && chmod +x script/wait-for-it.sh \
    && chown -R node:node /app

USER node

CMD ["sh", "-c", "./script/wait-for-it.sh database:3306 -- node script/wait-for-db.mjs && exec node --enable-source-maps --max-old-space-size=3000 index.mjs"]
