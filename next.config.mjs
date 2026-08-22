/** @type {import('next').NextConfig} */

// Nao existe assetPrefix aqui de proposito -- os assets sao servidos pelo
// MESMO hostname que serve a pagina, e e' isso que a gente quer.
//
// Havia um `assetPrefix: process.env.AUTH_TRUST_HOST` que nunca funcionou:
// assetPrefix e' resolvido em build time e o Dockerfile.prd nao passa
// nenhum ARG/ENV, entao o valor era sempre undefined (confirmado no HTML
// servido em producao -- src="/_next/static/...", relativo). Foi removido
// em vez de "consertado" porque consertar quebraria coisas:
//
//   - servir asset de outro hostname forca DNS+TCP+TLS novos e mata o
//     connection coalescing do HTTP/2 (o HAProxy faz bind com alpn h2) --
//     fica mais lento, nao mais rapido; domain sharding morreu com HTTP/1.1
//   - nao ganha cache nenhum: a Cloudflare ja da HIT em /_next/static de
//     cada hostname proxied, por extensao + Cache-Control immutable do Next
//   - fonte, wasm e worker cross-origin passam a exigir CORS -- o
//     tesseract.js do DigitaR carrega worker dinamico e quebraria
const nextConfig = {
    output: "standalone",
    serverExternalPackages: ['tesseract.js', 'pdf-to-img', 'pdfjs-dist'],
    experimental: {
        serverActions: {
            bodySizeLimit: '10mb',
        },
    },
};

export default nextConfig;
