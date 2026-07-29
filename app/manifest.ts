import type { MetadataRoute } from 'next';

// NOTA: esta rota é estática (prerenderizada no build), então process.env.TITLE
// não existe aqui (a env só entra em runtime via env_file) e o nome do PWA usa
// sempre o fallback abaixo — mantido igual ao nome da marca de propósito. Se um
// dia o nome precisar vir do TITLE em runtime, veja o histórico deste arquivo
// (opção force-dynamic) ou passe TITLE como build ARG.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: process.env.TITLE || 'RCaldas',
    short_name: process.env.TITLE || 'RCaldas',
    description: process.env.DESCRIPTION || '',
    start_url: '/finance',
    display: 'standalone',
    background_color: '#18181b',
    theme_color: '#18181b',
    icons: [
      { src: '/logo.png', sizes: '192x192', type: 'image/png' },
      { src: '/logo.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
