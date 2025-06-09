FROM node:20.13.1-slim AS base
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS builder

RUN --mount=type=cache,target=/usr/src/app/.npm \
  npm set cache /usr/src/app/.npm && \
  npm ci
COPY . .
RUN npm run build

FROM base AS prod

COPY --chown=node:node --from=builder /usr/src/app/dist dist/
COPY --chown=node:node --from=builder /usr/src/app/node_modules node_modules/
COPY --chown=node:node --from=builder /usr/src/app/.env.example .env

USER node
EXPOSE 5460

CMD [ "dumb-init", "node", "--no-warnings=ExperimentalWarning", "dist/index.js" ]
