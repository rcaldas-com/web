import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ObjectId } from 'mongodb';
import clientPromise from '@/lib/mongodb';

// Em prod (us), .env aponta isso pra /var/rcaldas/live/upload (bind mount
// read-write do docker-compose). Em dev, cai num diretorio local que nao
// precisa existir de antemao -- ensureUploadDirs() cria.
export const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(process.cwd(), '.data', 'upload');
export const UPLOADS_SUBDIR = '_uploads';
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB
export const MIN_FREE_AFTER_BYTES = 2 * 1024 * 1024 * 1024; // piso de seguranca: nunca deixar menos que isso livre

export type ShortLinkType = 'upload' | 'existing';

export type ShortLink = {
  _id: ObjectId;
  slug: string;
  domain: string; // hostname puro, comparado direto contra o Host header -- ver nota em resolveLink
  type: ShortLinkType;
  storagePath: string; // relativo a UPLOAD_ROOT
  originalFilename: string; // so exibicao/Content-Disposition, nunca usado pra montar caminho de disco
  mimeType: string;
  size: number; // de fs.stat na criacao -- nunca o valor declarado pelo cliente
  createdBy: ObjectId;
  hits: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ShortLinkView = {
  _id: string;
  slug: string;
  domain: string;
  type: ShortLinkType;
  originalFilename: string;
  mimeType: string;
  size: number;
  hits: number;
  createdAt: string;
};

// Next sempre prioriza rota estatica/arquivo-convencao sobre [slug]
// dinamico, entao colisao nunca quebra a rota fixa -- mas deixaria esse
// slug aleatorio especifico inacessivel silenciosamente sem essa lista
// (o retry-on-duplicate do Mongo nao pega isso, nao e' colisao de indice).
const RESERVED_SLUGS = new Set([
  'favicon.ico',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'opengraph-image',
  'agent-jobs',
  'api',
  'approve-tunnel-key',
  'backup-config',
  'configuracoes',
  'dashboard',
  'digitar',
  'finance',
  'habitar',
  'heartbeat',
  'init',
  'init-auto',
  'install',
  'monitor',
  'ping',
  'remove-zxnet',
  'setup-backup-runner',
  'sync-dotfiles',
  'wallet',
  'upload',
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'verify-email',
]);

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeTypeFromExt(filename: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

let indexesEnsured = false;
async function ensureIndexes() {
  if (indexesEnsured) return;
  const client = await clientPromise;
  const db = client.db();
  await db.collection<ShortLink>('short_links').createIndexes([
    { key: { domain: 1, slug: 1 }, unique: true, name: 'domain_slug_unique' },
    { key: { createdBy: 1, createdAt: -1 }, name: 'createdBy_createdAt' },
  ]);
  indexesEnsured = true;
}

export function generateSlug(): string {
  return crypto.randomBytes(6).toString('base64url');
}

const CUSTOM_SLUG_MAX_LEN = 60;

// Minusculas, digitos, hifen e underscore -- o resto (acento, espaco,
// simbolo, emoji) vira hifen; hifens repetidos ou nas pontas somem. Texto
// que sobra vazio depois disso (ex: so emoji) faz insertWithRetry cair
// pro slug aleatorio de sempre -- nunca rejeita o upload por causa disso.
export function sanitizeSlug(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // marcas de acento (combining diacritics) que sobram depois do NFD
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CUSTOM_SLUG_MAX_LEN);
}

// attempt 0: o slug preferido exato (se veio um e nao e' reservado).
// attempts 1-3: o preferido + sufixo curto aleatorio -- fica perto do que
// a pessoa pediu em vez de descartar a escolha inteira por causa de uma
// colisao. Do attempt 4 em diante (ou sempre, se nao tem preferido):
// aleatorio puro, igual sempre foi.
function candidateSlug(attempt: number, preferred?: string): string {
  if (preferred) {
    if (attempt === 0 && !RESERVED_SLUGS.has(preferred)) return preferred;
    if (attempt <= 3) return `${preferred}-${crypto.randomBytes(2).toString('base64url')}`;
  }
  return generateSlug();
}

// Gera o nome real em disco -- nunca o nome que o cliente mandou. A
// extensao e' so cosmetica (ajuda quem olha o diretorio a mao) e passa
// por uma whitelist estrita antes de entrar no caminho.
export function generateStorageFilename(originalName: string): string {
  const rawExt = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const ext = /^\.[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : '';
  return `${crypto.randomUUID()}${ext}`;
}

export async function ensureUploadDirs() {
  await fs.promises.mkdir(path.join(UPLOAD_ROOT, UPLOADS_SUBDIR), { recursive: true });
}

// bavail (blocos disponiveis pra usuario sem privilegio), nao bfree (que
// inclui blocos reservados a root) -- e' o numero que realmente importa
// pra saber se o upload cabe.
export async function checkFreeSpace(declaredBytes: number): Promise<boolean> {
  const stat = await fs.promises.statfs(UPLOAD_ROOT);
  const availableBytes = stat.bavail * stat.bsize;
  return availableBytes - declaredBytes >= MIN_FREE_AFTER_BYTES;
}

// insertOne direto contra o indice unico {domain,slug} + retry no erro de
// chave duplicada (code 11000), em vez de pre-checar com findOne primeiro
// -- pre-checar seria uma race (TOCTOU) sob concorrencia; isso e' correto
// de graca. preferredSlug (ja sanitizado pelo caller) tenta primeiro o
// valor exato, depois com sufixo curto, antes de desistir e cair pro
// aleatorio -- ver candidateSlug().
async function insertWithRetry(
  doc: Omit<ShortLink, '_id' | 'slug'>,
  preferredSlug?: string,
  maxRetries = 6
): Promise<ShortLink> {
  await ensureIndexes();
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<ShortLink>('short_links');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let slug = candidateSlug(attempt, preferredSlug);
    while (RESERVED_SLUGS.has(slug)) slug = generateSlug();
    const full = { ...doc, slug, _id: new ObjectId() } as ShortLink;
    try {
      await col.insertOne(full);
      return full;
    } catch (err) {
      const isDuplicate = (err as { code?: number } | null)?.code === 11000;
      if (isDuplicate && attempt < maxRetries - 1) continue;
      throw err;
    }
  }
  throw new Error('nao foi possivel gerar um slug unico');
}

export async function createUploadLink(params: {
  domain: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  createdBy: string;
  preferredSlug?: string;
}): Promise<ShortLink> {
  const now = new Date();
  return insertWithRetry(
    {
      domain: params.domain,
      type: 'upload',
      storagePath: params.storagePath,
      originalFilename: params.originalFilename,
      mimeType: params.mimeType,
      size: params.size,
      createdBy: new ObjectId(params.createdBy),
      hits: 0,
      createdAt: now,
      updatedAt: now,
    },
    params.preferredSlug
  );
}

async function isFileLinked(storagePath: string): Promise<boolean> {
  const client = await clientPromise;
  const db = client.db();
  const existing = await db
    .collection<ShortLink>('short_links')
    .findOne({ type: 'existing', storagePath }, { projection: { _id: 1 } });
  return Boolean(existing);
}

// Fluxo reverso: nunca confia no filename vindo do form -- revalida
// contra o disco de novo (readdir fresco, feito por listUnlinkedUploadFiles
// antes de chamar isto na action) e confirma que o caminho resolvido
// continua dentro de UPLOAD_ROOT antes de aceitar.
export async function createExistingFileLink(params: {
  domain: string;
  filename: string;
  createdBy: string;
  preferredSlug?: string;
}): Promise<ShortLink> {
  const safeName = path.basename(params.filename);
  const fullPath = path.join(UPLOAD_ROOT, safeName);
  if (path.dirname(fullPath) !== path.resolve(UPLOAD_ROOT)) {
    throw new Error('caminho invalido');
  }

  const stat = await fs.promises.stat(fullPath).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error('arquivo nao encontrado em live/upload');

  if (await isFileLinked(safeName)) {
    throw new Error('esse arquivo ja tem um link -- apague o link existente antes de criar outro');
  }

  const now = new Date();
  return insertWithRetry(
    {
      domain: params.domain,
      type: 'existing',
      storagePath: safeName,
      originalFilename: safeName,
      mimeType: mimeTypeFromExt(safeName),
      size: stat.size,
      createdBy: new ObjectId(params.createdBy),
      hits: 0,
      createdAt: now,
      updatedAt: now,
    },
    params.preferredSlug
  );
}

export async function listLinksForUser(userId: string): Promise<ShortLinkView[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db
    .collection<ShortLink>('short_links')
    .find({ createdBy: new ObjectId(userId) })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map((d) => ({
    _id: d._id.toString(),
    slug: d.slug,
    domain: d.domain,
    type: d.type,
    originalFilename: d.originalFilename,
    mimeType: d.mimeType,
    size: d.size,
    hits: d.hits,
    createdAt: d.createdAt.toISOString(),
  }));
}

// Arquivos de primeiro nivel de UPLOAD_ROOT (fora de _uploads/, que e' so
// destino de upload direto) que ainda nao tem link tipo 'existing'.
export async function listUnlinkedUploadFiles(): Promise<{ filename: string; size: number }[]> {
  const entries = await fs.promises.readdir(UPLOAD_ROOT, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));
  if (!files.length) return [];

  const client = await clientPromise;
  const db = client.db();
  const linked = await db
    .collection<ShortLink>('short_links')
    .find({ type: 'existing' }, { projection: { storagePath: 1 } })
    .toArray();
  const linkedSet = new Set(linked.map((l) => l.storagePath));

  const results: { filename: string; size: number }[] = [];
  for (const entry of files) {
    if (linkedSet.has(entry.name)) continue;
    const stat = await fs.promises.stat(path.join(UPLOAD_ROOT, entry.name)).catch(() => null);
    if (stat) results.push({ filename: entry.name, size: stat.size });
  }
  return results;
}

// Dono real checado AQUI -- o ponto de mutacao de verdade, nao so na
// camada de action (que tambem checa, mas isso e' defesa em profundidade).
export async function deleteLink(id: string, userId: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<ShortLink>('short_links');
  const doc = await col.findOne({ _id: new ObjectId(id) });
  if (!doc || doc.createdBy.toString() !== userId) return false;

  // So apaga o arquivo se for upload direto (1:1 com o link). Link tipo
  // 'existing' aponta pra um arquivo gerenciado fora do app (scp manual,
  // Syncthing) -- apagar o link deve deixar o arquivo disponivel de novo
  // pro picker, nunca destrui-lo.
  if (doc.type === 'upload') {
    const fullPath = path.join(UPLOAD_ROOT, doc.storagePath);
    await fs.promises.unlink(fullPath).catch((err: NodeJS.ErrnoException) => {
      if (err?.code !== 'ENOENT') throw err;
    });
  }

  await col.deleteOne({ _id: doc._id });
  return true;
}

// Rota publica: um unico lookup indexado, sem consultar a collection
// `domains` nesse caminho -- evita round-trip extra numa rota que pode ser
// sondada, e evita que desabilitar shortLinksEnabled num dominio depois de
// criar links ja distribuidos quebre retroativamente algo ja compartilhado
// (esse flag so vale na CRIACAO do link, checado em createUploadLink's
// caller / createExistingLinkAction).
export async function resolveLink(domain: string, slug: string): Promise<ShortLink | null> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<ShortLink>('short_links').findOne({ domain, slug });
}

// Fire-and-forget de proposito -- nao atrasa o streaming dos bytes de
// volta pro cliente por causa de um contador.
export function incrementHits(id: ObjectId) {
  clientPromise
    .then((client) => client.db().collection<ShortLink>('short_links').updateOne({ _id: id }, { $inc: { hits: 1 } }))
    .catch((err) => console.error('falha ao incrementar hits do short link:', err));
}
