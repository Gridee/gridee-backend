FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json knexfile.ts ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/knexfile.ts ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["dumb-init", "node", "dist/src/index.js"]
