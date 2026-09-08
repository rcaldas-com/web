FROM node:24-alpine AS base
LABEL maintainer="RCaldas <docker@rcaldas.com>"

FROM base AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci


FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build


FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# tesseract.js uses dynamic worker scripts not traced by Next.js standalone
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tesseract.js ./node_modules/tesseract.js
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tesseract.js-core ./node_modules/tesseract.js-core

# O deploy fixa `user:` no compose para que o container rode com o uid do
# dono dos arquivos sincronizados -- o /init serve o authorized_keys ao
# vivo, e ele e' 600 do dono. Como o uid de runtime deixa de ser o do
# build, o cache do Next precisa ser gravavel por qualquer uid: sem isto a
# primeira escrita (otimizacao de imagem, ISR) falha, e falha em silencio.
#
# A imagem continua sem saber QUAL uid -- cravar 8484 aqui amarraria o
# artefato a este deploy e atrapalharia a portabilidade pro k8s, onde o uid
# costuma ser imposto de fora.
RUN mkdir -p .next/cache && chmod 777 .next/cache

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
