import { ObjectId } from 'mongodb';
import clientPromise from '@/lib/mongodb';

// Domínios que a app conhece e pode usar (links curtos hoje; upload/CDN
// depois). Cada um pode ter credenciais próprias -- times/contas
// diferentes de Cloudflare por domínio não são incomuns aqui.
export type Domain = {
  _id: ObjectId;
  name: string;
  cloudflare?: {
    apiToken: string;
    zoneId: string;
  };
  shortLinksEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeDomainName(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

export async function listDomains() {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db
    .collection<Domain>('domains')
    .find({}, { projection: { 'cloudflare.apiToken': 0 } })
    .sort({ name: 1 })
    .toArray();

  return docs.map((d) => ({
    ...d,
    _id: d._id.toString(),
    hasCloudflare: Boolean(d.cloudflare?.zoneId),
    createdAt: d.createdAt?.toISOString(),
    updatedAt: d.updatedAt?.toISOString(),
  }));
}

// Uso interno (ex: gerador de link curto) -- inclui o token, nunca sai
// pra UI. Separado de listDomains de proposito, pra ficar dificil de
// vazar por acidente numa tela nova que reuse a funcao errada.
export async function getDomainWithCredentials(name: string) {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<Domain>('domains').findOne({ name: normalizeDomainName(name) });
}

export async function createDomain(name: string) {
  const normalized = normalizeDomainName(name);
  if (!normalized || !normalized.includes('.')) return;
  const client = await clientPromise;
  const db = client.db();
  const now = new Date();
  await db
    .collection<Domain>('domains')
    .updateOne(
      { name: normalized },
      { $setOnInsert: { name: normalized, createdAt: now, updatedAt: now } },
      { upsert: true }
    );
}

export async function deleteDomain(id: string) {
  if (!ObjectId.isValid(id)) return;
  const client = await clientPromise;
  const db = client.db();
  await db.collection<Domain>('domains').deleteOne({ _id: new ObjectId(id) });
}

export async function setShortLinksEnabled(id: string, enabled: boolean) {
  if (!ObjectId.isValid(id)) return;
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<Domain>('domains')
    .updateOne({ _id: new ObjectId(id) }, { $set: { shortLinksEnabled: enabled, updatedAt: new Date() } });
}

// apiToken vazio no form = "manter o que ja tem" (mesmo padrao do campo
// de token do /install) -- nao existe forma de reexibir um segredo
// salvo, entao forcar preenchimento a cada edicao so incentivaria copiar
// e colar o token em algum lugar inseguro pra nao perder.
export async function setDomainCloudflare(id: string, zoneId: string, apiToken: string) {
  if (!ObjectId.isValid(id)) return;
  const client = await clientPromise;
  const db = client.db();
  const set: Record<string, unknown> = { 'cloudflare.zoneId': zoneId, updatedAt: new Date() };
  if (apiToken.trim()) set['cloudflare.apiToken'] = apiToken.trim();
  await db.collection<Domain>('domains').updateOne({ _id: new ObjectId(id) }, { $set: set });
}

export async function clearDomainCloudflare(id: string) {
  if (!ObjectId.isValid(id)) return;
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<Domain>('domains')
    .updateOne({ _id: new ObjectId(id) }, { $unset: { cloudflare: '' }, $set: { updatedAt: new Date() } });
}
