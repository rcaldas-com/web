import type { Metadata } from 'next';

// ATUALIZACAO 24/08/2026 -- por que existe o hostname monitor.rcaldas.com
//
// O PWA continuava sendo instalado como "/finance" mesmo com tudo abaixo
// correto, e a causa nao estava no metadata: `/monitor` sem sessao devolve
// 307 pro `/login`, que renderiza o layout RAIZ e portanto linka o manifest
// da raiz (start_url /finance, logo.png). Quem instala pela tela de login
// captura aquela identidade, nao esta.
//
// Nao adianta so' linkar este manifest no /login: o navegador ignora
// manifest cujo `scope` nao cobre a pagina atual, e o escopo era /monitor.
//
// A saida foi dar um hostname proprio ao Monitor. Com isso o `scope` deste
// manifest passa a ser "/" -- o host inteiro, login incluido -- e o
// `start_url` continua /monitor. Instalar de qualquer pagina de
// monitor.rcaldas.com produz a identidade certa. O `id` explicito garante
// que os dois caminhos (/manifest.webmanifest servido pelo HAProxy naquele
// host e este arquivo) sejam o MESMO app pro navegador, nao dois.

// Escopado a este segmento -- so /monitor* vira instalavel, o resto do app
// (finance, wallet...) continua sem manifest nenhum.
//
// TUDO aqui e' campo manual explicito, de proposito -- NAO convencao de
// arquivo (nao existe app/monitor/manifest.ts nem confiar so em
// app/monitor/icon.png ser "achado sozinho"). Motivo, achado testando
// com sessao autenticada de verdade (nao so checando se o arquivo
// responde 200 isolado, que engana): mesmo com app/monitor/icon.png e
// apple-icon.png existindo, o <head> renderizado de /monitor continuava
// linkando o favicon/logo da RAIZ -- convencao de arquivo aninhada nao
// sobrescreve a da raiz de forma confiavel neste Next. E pior: um
// app/monitor/manifest.ts (convencao de arquivo) colide de vez com o
// segmento dinamico irmao [host] (Next tenta casar "manifest.webmanifest"
// como valor de host, 404/500 em vez de servir o manifest). A unica
// combinacao que funcionou de verdade: campo manual aqui + arquivos
// referenciados por URL absoluta (icon.png/apple-icon.png continuam
// existindo como convencao de arquivo -- servem certo quando pedidos
// direto -- so nao dependem de serem "descobertos" sozinhos pro <head>).
export const metadata: Metadata = {
  manifest: '/monitor-manifest.webmanifest',
  icons: {
    icon: '/monitor/icon.png',
    apple: '/monitor/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Monitor',
  },
};

export default function MonitorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
