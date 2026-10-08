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
  checkUploadDirWritable,
  checkFreeSpace,
  generateStorageFilename,
  createUploadLink,
  sanitizeSlug,
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

  // ensureUploadDirs ANTES do statfs de proposito: em ambiente novo (dev
  // local, ou um UPLOAD_ROOT que ainda nao existe) o statfs falha com
  // ENOENT se o diretorio nao existir ainda -- criar primeiro e' barato e
  // idempotente (mkdir recursive), e evita esse crash. Em prod nao muda
  // nada na pratica (live/upload ja existe), mas deixa de depender disso.
  await ensureUploadDirs();

  // Antes de ler um byte sequer do corpo: se o diretorio nao aceita
  // escrita (dono errado, remontado read-only, etc.), falhar agora custa
  // um stat(); falhar so' depois custa o upload inteiro ter atravessado a
  // rede pra nada, e aparece pro usuario como "travado" ate o timeout.
  if (!(await checkUploadDirWritable())) {
    console.error('upload: diretorio de destino sem permissao de escrita', path.join(UPLOAD_ROOT, UPLOADS_SUBDIR));
    return NextResponse.json(
      { error: 'Erro de configuracao no servidor (sem permissao de escrita). Avise o administrador.' },
      { status: 500 }
    );
  }

  // Guarda de disco: nunca deixar o upload derrubar o host inteiro. Usa o
  // Content-Length se confiavel, senao assume o pior caso (o proprio
  // limite maximo) pra checagem.
  const declaredSize = contentLength > 0 ? contentLength : MAX_UPLOAD_BYTES;
  const hasSpace = await checkFreeSpace(declaredSize);
  if (!hasSpace) {
    return NextResponse.json({ error: 'Sem espaco em disco suficiente no momento.' }, { status: 507 });
  }

  let domain = '';
  let rawSlug = '';
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
    if (name === 'slug') rawSlug = value;
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
    writeStream.on('error', (err) => {
      // Falhou escrever -- continuar recebendo o resto de um arquivo de
      // centenas de MB so' pra descartar nao serve pra nada, e e' o que
      // fazia um erro (permissao, disco cheio) so' aparecer DEPOIS do
      // upload inteiro atravessar a rede. Destruir o corpo cru fecha a
      // conexao agora: cliente e proxy veem o erro na hora, nao no
      // timeout. So' isso nao bastaria pra `parsed` resolver, por isso o
      // reject direto abaixo -- destruir um lado de um .pipe() comum (sem
      // ser via pipeline()) nao propaga 'close'/'error' pro outro lado.
      rawBody.destroy(err);
      bb.destroy();
      rejectParsed(err);
    });
    // Guarda a promise em vez de so bufferizar bytes -- precisa esperar o
    // destino terminar de fato (flush + close), nao so o lado de leitura
    // acabar, senao um stat() logo depois podia pegar o arquivo pela
    // metade.
    filePipeline = pipeline(stream, writeStream);
  });

  let rejectParsed!: (err: unknown) => void;
  const parsed = new Promise<void>((resolve, reject) => {
    bb.on('close', resolve);
    bb.on('error', reject);
    rejectParsed = reject;
  });

  const rawBody = Readable.fromWeb(request.body as unknown as NodeWebReadableStream);
  rawBody.pipe(bb);

  try {
    await parsed;
    if (filePipeline) await filePipeline;
  } catch (error) {
    console.error('erro no upload:', error);
    if (destPath) await fs.promises.unlink(destPath).catch(() => {});
    // pipeline() rejeita com o MESMO objeto de erro que o writeStream
    // emitiu -- da' pra classificar direto do que chegou aqui, sem
    // precisar guardar o erro numa variavel a parte (que o closure de
    // 'file' reatribuindo deixava o TS estreitar sozinho pra 'never').
    const code = (error as NodeJS.ErrnoException)?.code;
    const message =
      code === 'ENOSPC'
        ? 'Sem espaco em disco no servidor.'
        : code === 'EACCES' || code === 'EPERM'
          ? 'Erro de permissao no servidor. Avise o administrador.'
          : 'Falha ao processar o upload.';
    return NextResponse.json({ error: message }, { status: 500 });
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

  const preferredSlug = sanitizeSlug(rawSlug) || undefined;

  const link = await createUploadLink({
    domain,
    storagePath: path.join(UPLOADS_SUBDIR, path.basename(destPath)),
    originalFilename,
    mimeType,
    size: stat.size, // tamanho autoritativo, nunca o declarado pelo cliente
    createdBy: user._id,
    preferredSlug,
  });

  return NextResponse.json({ url: `https://${domain}/${link.slug}`, slug: link.slug, domain });
}
