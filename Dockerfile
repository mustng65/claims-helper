FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --chown=node:node src/ ./

RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps \
    && mkdir -p /app/data \
    && chown node:node /app/data

USER node

EXPOSE 3000

CMD ["node", "server.js"]
