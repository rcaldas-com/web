# DigitaR (OCR)

Ferramenta pessoal de OCR: manda uma imagem ou PDF, recebe o texto extraído
em Markdown. Substitui digitar recibo/documento na mão.

## Arquitetura

```
app/digitar/page.tsx          -- server component, só decide canUseExternalAi
app/digitar/DigitarClient.tsx -- 'use client', upload (drag-drop/paste/picker) + UI de resultado
app/api/digitar/extract/route.ts -- POST, roda o OCR de verdade
```

`page.tsx` não tem gate de auth nenhum -- qualquer um (logado ou não) acessa
`/digitar` e usa o motor local (Tesseract). Só decide se mostra o checkbox
"usar IA externa", via `hasRole(user, 'digitar')`.

## Dois motores

| Motor | Quando roda | Custo | Qualidade |
|---|---|---|---|
| **Tesseract** (`tesseract.js`, WASM) | sempre disponível, default | grátis, local, sem chamada externa | ok pra texto limpo; reconstrução de layout é uma heurística própria (`reconstructFromWords`, agrupa palavras em linhas por proximidade Y/X) -- não é páreo pra um modelo de visão real |
| **OpenAI** (`gpt-4.1` via Responses API, `input_image`) | só se **as três** condições baterem: `OPENAI_API_KEY` setada, usuário com role `digitar` (`lib/definitions.ts`), e o checkbox "usar IA externa" marcado | pago por token, por chamada | bem melhor em documento bagunçado/manuscrito, porque é um modelo de visão de verdade, não OCR clássico |

A escolha final é sempre decidida no servidor (`route.ts`), nunca confia no
que o cliente manda além de "eu prefiro openai" -- se faltar chave ou role,
cai pro Tesseract silenciosamente, sem erro.

## Suporte a PDF

Cliente aceita `application/pdf` (até 20MB) além de JPG/PNG/WEBP (até 10MB).
O fluxo: servidor recebe o PDF inteiro, converte cada página numa imagem
PNG via **`pdf-to-img`** (wrapper em cima do `pdfjs-dist`, roda 100% em
Node/WASM -- sem GraphicsMagick, sem Ghostscript, sem `canvas` nativo,
testado e confirmado rodando limpo no `node:24-alpine` do `Dockerfile.prd`),
depois roda OCR em cada página com o motor escolhido e junta tudo num
markdown só, separado por `## Página N` + `---`.

- **Teto de páginas**: `MAX_PDF_PAGES = 30` em `route.ts`. Sem isso um PDF
  de centenas de páginas travaria a requisição por minutos.
- **Tesseract em lote**: `runTesseractBatch()` cria **um** worker WASM e
  reusa pra todas as páginas (`recognizeOne()` por página) -- criar/destruir
  um worker por página seria bem mais lento. Sequencial de propósito: um
  worker só processa um job por vez mesmo se chamado em paralelo, então
  paralelizar não ganha nada e só gastaria mais memória levantando vários
  workers ao mesmo tempo.
- **OpenAI em lote**: cada página é uma chamada HTTP independente, sem
  recurso local compartilhado -- roda em `Promise.all` (paralelo de
  verdade), corta o tempo total de parede. Importa pro timeout do HAProxy
  (ver abaixo).

## Duas armadilhas reais encontradas construindo o suporte a PDF

**1. `serverExternalPackages` é obrigatório pra qualquer dependência que
resolve arquivo próprio em runtime.** `pdf-to-img`/`pdfjs-dist` tentam
carregar um worker (`pdf.worker.mjs`) relativo à própria localização no
disco. O bundler do Next (webpack em prod, Turbopack em dev) reescreve
imports pra dentro de chunks mesclados, e esse `import.meta.url`-relative
lookup quebra silenciosamente **só em runtime**, nunca no `tsc --noEmit`
nem no `next build` (que compila e faz lint normalmente) -- só estoura
quando a rota é chamada de verdade, com
`Cannot find module '.../pdf.worker.mjs'`. `tesseract.js` já estava na
lista por esse mesmo motivo; `pdf-to-img` e `pdfjs-dist` (a dependência
transitiva -- listar só o pacote de fora não bastou, precisou dos dois)
entraram junto:

```js
// next.config.mjs
serverExternalPackages: ['tesseract.js', 'pdf-to-img', 'pdfjs-dist'],
```

Regra geral: qualquer nova dependência que carregue um asset/worker/wasm
relativo ao próprio caminho no disco (não um `import` estático comum)
provavelmente precisa entrar aqui. Teste sempre com uma chamada real à
rota, não só `tsc`/`next build` -- esse tipo de erro só aparece em runtime.

**2. `next.config.mjs` não é bind-mounted no `docker-compose.yml` local**
(só `app/`, `components/`, `lib/`, `public/`, `middleware.ts`,
`package.json`, `package-lock.json` são). Editar esse arquivo no host e
reiniciar o container **não** propaga a mudança -- o container continua
rodando a versão que foi assada na imagem. Pra testar uma mudança nele
sem rebuildar a imagem inteira: `docker compose cp next.config.mjs
web:/app/next.config.mjs` antes de reiniciar. Vale também lembrar do
outro caso já visto nesta sessão: `package.json`/`middleware.ts` SÃO
bind-mounted, mas como *arquivo* individual (não diretório) -- uma
ferramenta de edição que faz write-temp+rename (em vez de escrever in-
place) deixa o container preso no inode antigo até um
`docker compose up -d --force-recreate`.

## HAProxy: timeout maior pra PDF grande

`/api/digitar` está na mesma ACL `upload_paths` de `/upload`/`/api/upload`
em `us.haproxy`, roteada pro backend `rcaldas-web-upload` (mesmo destino
`127.0.0.1:8611`, só com `timeout server 10m` em vez do default de 30s).
Motivo: um PDF de várias páginas rodando Tesseract sequencial pode
facilmente passar de 30s de processamento sem nenhum byte trafegando --
e o timeout do HAProxy é por **inatividade**, então uma resposta que
demora silenciosamente é cortada mesmo sem ninguém ter travado de verdade.

## Sobre usar uma API externa de OCR (IBM watsonx e alternativas)

Pesquisado ao vivo (agosto/2026) porque a pergunta "dá pra usar o período
de avaliação do IBM AI" apareceu:

- **IBM watsonx**: a feature de text extraction/OCR é **paga desde a
  primeira página** -- não tem cobertura nenhuma no free tier nem no
  trial de conta nova (o trial cobre outras partes da plataforma, não
  essa). Ou seja: **não dá pra usar o período de avaliação pra isso.**
- **Azure AI Document Intelligence**: tem free tier de verdade (F0),
  **500 páginas/mês, pra sempre, não é trial** -- mas com limite real:
  só processa as **2 primeiras páginas** de qualquer documento no plano
  grátis, e 4MB max por arquivo. Ok pra recibo curto, ruim pra PDF longo.
- **Google Cloud Vision**: também free tier permanente, **1000
  unidades/mês grátis pra sempre**, US$1,50/1000 depois disso. Uma
  unidade = uma imagem OU uma página de PDF -- sem limite artificial de
  "só as 2 primeiras páginas". A API aceita PDF direto (não precisaria
  nem da conversão pra imagem que fizemos aqui, se um dia vier a virar
  motor). É o mais generoso dos três pra uso de verdade.
- **OpenAI** (já integrado): sem free tier, paga por token desde sempre,
  mas sem teto artificial de página nem de volume -- e por ser um modelo
  de visão completo (não um OCR clássico), tende a lidar melhor com
  documento bagunçado/manuscrito do que os OCRs "puros" acima.

Não implementei nenhuma dessas -- ficou registrado pra decisão futura.
Se um dia quiser adicionar Google Vision como terceiro motor: dá pra
mandar o PDF inteiro direto pra API deles (ela pagina sozinha), então
não precisaria reusar o `pdf-to-img` pra esse caminho específico -- só
pros motores que exigem imagem (Tesseract, OpenAI).

## Coisas que faltam / não foram feitas

- Preview de PDF na UI hoje é só um cartão com nome do arquivo (ícone
  📄) -- não renderiza a primeira página como miniatura. Daria pra fazer
  com `pdf-to-img` no cliente também, mas não é crítico.
- Sem cache/dedup: reenviar o mesmo arquivo roda OCR de novo do zero.
- Sem histórico -- o resultado só existe na tela até recarregar a página.
