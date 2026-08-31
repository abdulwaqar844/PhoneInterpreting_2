FROM node:22.15.0-alpine AS builder

WORKDIR /app

COPY ./package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:22.15.0-alpine

WORKDIR /app

COPY --from=builder /app ./

ENTRYPOINT ["npm"]
CMD ["start"]
