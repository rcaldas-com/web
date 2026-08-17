import type { Metadata } from 'next';

// Escopado a este segmento -- so /monitor* vira instalavel, o resto do app
// (finance, wallet...) continua sem manifest nenhum. app/monitor/icon.png e
// apple-icon.png (convencao de arquivo do Next) fazem o mesmo escopo pro
// favicon da aba e pro icone do iOS, sem precisar repetir aqui.
export const metadata: Metadata = {
  manifest: '/monitor-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Monitor',
  },
};

export default function MonitorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
