import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { normalizeDomainName } from '@/lib/domains';
import { UPLOAD_ROOT, resolveLink, incrementHits } from '@/lib/shortlinks';

// Catch-all dinamico na raiz -- fora de qualquer prefixo protegido, entao
// resolve sem login (e' o ponto: o link precisa funcionar pra quem recebeu,
// nao so pra quem criou). Next sempre prioriza rota estatica/arquivo-
// convencao (ex: /favicon.ico, /upload, /monitor) sobre este [slug], entao
// nenhuma rota existente e' afetada por ele existir.
export const runtime = 'nodejs';

function contentDispositionFilename(name: string): string {
  // ASCII puro como fallback (clientes antigos) + filename* UTF-8 (padrao
  // RFC 5987) pra nomes com acento -- navegador moderno usa o segundo.
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const domain = normalizeDomainName(request.headers.get('host') || '');

  const link = await resolveLink(domain, slug);
  if (!link) {
    return new NextResponse('Não encontrado.', { status: 404 });
  }

  const filePath = path.join(UPLOAD_ROOT, link.storagePath);
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return new NextResponse('Arquivo não encontrado.', { status: 404 });
  }

  incrementHits(link._id);

  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as NodeWebReadableStream;

  return new NextResponse(webStream as unknown as ReadableStream, {
    headers: {
      'Content-Type': link.mimeType || 'application/octet-stream',
      'Content-Length': String(stat.size),
      // Sempre attachment, nunca inline -- um .html/.svg malicioso servido
      // inline com Content-Type escolhido por quem fez o upload, na mesma
      // origem que hospeda o app autenticado, seria XSS armazenado contra
      // qualquer sessao no mesmo navegador. Uma linha aqui neutraliza isso
      // por completo, sem depender de sniff de magic bytes.
      'Content-Disposition': contentDispositionFilename(link.originalFilename),
      'Cache-Control': 'private, no-store',
    },
  });
}
