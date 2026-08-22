import type { Metadata } from 'next';

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
