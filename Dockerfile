FROM node:22-alpine AS client-build

WORKDIR /app/client

COPY client/package.json client/package-lock.json client/.npmrc ./

RUN npm ci

COPY client/ ./

RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY src/package.json src/package-lock.json ./

RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps \
    && mkdir -p /app/data \
    && chown node:node /app/data

COPY --chown=node:node src/server.js ./

COPY --from=client-build --chown=node:node /app/src/dist/public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]
