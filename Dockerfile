FROM node:20.13.1-slim AS base
RUN apt-get update && apt-get install -y dumb-init curl jq && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS builder

RUN --mount=type=cache,target=/usr/src/app/.npm \
  npm set cache /usr/src/app/.npm && \
  npm ci
COPY . .

RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,env=SENTRY_AUTH_TOKEN \
  npm run build && \
  ./uploadSourcemaps.sh

FROM base AS prod

RUN npm ci --omit=dev
COPY --chown=node:node --from=builder /usr/src/app/dist dist/
COPY --chown=node:node --from=builder /usr/src/app/src/instrument.mjs dist/instrument.mjs
COPY --chown=node:node --from=builder /usr/src/app/.env.example .env

USER node
EXPOSE 5460

CMD [ "dumb-init", "node", "dist/index.js" ]
