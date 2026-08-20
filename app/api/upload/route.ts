import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import fs from 'node:fs';
import path from 'node:path';
import busboy from 'busboy';
import { AuthError, requireAuth } from '@/lib/auth';
import { listDomains } from '@/lib/domains';
import { rateLimit } from '@/lib/rate-limit';
import {
  UPLOAD_ROOT,
  UPLOADS_SUBDIR,
  MAX_UPLOAD_BYTES,
  ensureUploadDirs,
  checkFreeSpace,
  generateStorageFilename,
  createUploadLink,
} from '@/lib/shortlinks';

// Precisa do runtime Node -- fs/stream/busboy nao existem no Edge.
export const runtime = 'nodejs';

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

export async function POST(request: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
    }
    throw error;
  }

  // 20 uploads / 10min por usuario -- insurance barata contra double-submit
  // acidental empilhando uso de disco/memoria, nao porque se espera
  // malicia de uma ferramenta com requireAuth().
  const limited = await rateLimit(`upload:${user._id}`, 20, 600);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Muitos uploads em pouco tempo. Tente de novo em alguns minutos.' },
      { status: 429 }
    );
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Content-Type invalido.' }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ error: 'Corpo da requisicao vazio.' }, { status: 400 });
  }

  // Rejeita antes de escrever qualquer byte se o cliente ja declarou um
  // tamanho acima do limite.
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 0 && contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Arquivo acima do limite de ${MAX_MB}MB.` }, { status: 413 });
  }

  // Guarda de disco: nunca deixar o upload derrubar o host inteiro. Usa o
  // Content-Length se confiavel, senao assume o pior caso (o proprio
  // limite maximo) pra checagem.
  const declaredSize = contentLength > 0 ? contentLength : MAX_UPLOAD_BYTES;
  const hasSpace = await checkFreeSpace(declaredSize);
  if (!hasSpace) {
    return NextResponse.json({ error: 'Sem espaco em disco suficiente no momento.' }, { status: 507 });
  }

  await ensureUploadDirs();

  let domain = '';
  let destPath = '';
  let originalFilename = '';
  let mimeType = 'application/octet-stream';
  let fileHandled = false;
  let rejected: { status: number; error: string } | null = null;
  let filePipeline: Promise<void> | null = null;

  const bb = busboy({
    headers: { 'content-type': contentType },
    limits: { files: 1, fileSize: MAX_UPLOAD_BYTES },
  });

  bb.on('field', (name, value) => {
    if (name === 'domain') domain = value;
  });

  // busboy trunca o stream do arquivo (nao aborta o parse inteiro) quando
  // fileSize estoura -- esse e' o backstop de verdade contra um
  // Content-Length mentiroso/ausente, independente da checagem acima.
  bb.on('file', (_name, stream, info) => {
    if (!info.filename) {
      stream.resume(); // campo de arquivo vazio -- so descarta
      return;
    }
    fileHandled = true;
    originalFilename = info.filename;
    mimeType = info.mimeType || 'application/octet-stream';
    const storageFilename = generateStorageFilename(originalFilename);
    destPath = path.join(UPLOAD_ROOT, UPLOADS_SUBDIR, storageFilename);

    stream.on('limit', () => {
      rejected = { status: 413, error: `Arquivo acima do limite de ${MAX_MB}MB.` };
    });

    const writeStream = fs.createWriteStream(destPath);
    // Guarda a promise em vez de so bufferizar bytes -- precisa esperar o
    // destino terminar de fato (flush + close), nao so o lado de leitura
    // acabar, senao um stat() logo depois podia pegar o arquivo pela
    // metade.
    filePipeline = pipeline(stream, writeStream);
  });

  const parsed = new Promise<void>((resolve, reject) => {
    bb.on('close', resolve);
    bb.on('error', reject);
  });

  Readable.fromWeb(request.body as unknown as NodeWebReadableStream).pipe(bb);

  try {
    await parsed;
    if (filePipeline) await filePipeline;
  } catch (error) {
    console.error('erro no upload:', error);
    if (destPath) await fs.promises.unlink(destPath).catch(() => {});
    return NextResponse.json({ error: 'Falha ao processar o upload.' }, { status: 500 });
  }

  if (rejected) {
    // TS nao consegue provar, so' pela analise de fluxo, que a reatribuicao
    // dentro de stream.on('limit', ...) (closure aninhado no callback de
    // bb.on('file', ...)) acontece antes deste ponto -- estreita sozinho
    // pra 'never'. A anotacao explicita contorna isso sem mudar nada em
    // runtime (never e' subtipo de qualquer tipo, a atribuicao e' sempre
    // valida).
    const rejection: { status: number; error: string } = rejected;
    if (destPath) await fs.promises.unlink(destPath).catch(() => {});
    return NextResponse.json({ error: rejection.error }, { status: rejection.status });
  }

  if (!fileHandled || !destPath) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
  }

  if (!domain) {
    await fs.promises.unlink(destPath).catch(() => {});
    return NextResponse.json({ error: 'Dominio nao selecionado.' }, { status: 400 });
  }

  const domains = await listDomains();
  const domainAllowed = domains.some((d) => d.name === domain && d.shortLinksEnabled);
  if (!domainAllowed) {
    await fs.promises.unlink(destPath).catch(() => {});
    return NextResponse.json({ error: 'Dominio invalido ou sem links curtos habilitados.' }, { status: 400 });
  }

  const stat = await fs.promises.stat(destPath).catch(() => null);
  if (!stat || stat.size <= 0) {
    if (destPath) await fs.promises.unlink(destPath).catch(() => {});
    return NextResponse.json({ error: 'Upload vazio ou falhou.' }, { status: 400 });
  }

  const link = await createUploadLink({
    domain,
    storagePath: path.join(UPLOADS_SUBDIR, path.basename(destPath)),
    originalFilename,
    mimeType,
    size: stat.size, // tamanho autoritativo, nunca o declarado pelo cliente
    createdBy: user._id,
  });

  return NextResponse.json({ url: `https://${domain}/${link.slug}`, slug: link.slug, domain });
}
