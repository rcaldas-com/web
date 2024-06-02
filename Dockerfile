FROM node:22-alpine as base
LABEL maintainer="RCaldas <docker@rcaldas.com>"

FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install -g npm && npm ci

FROM base AS dev
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]