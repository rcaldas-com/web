import { Db, ObjectId } from 'mongodb';
import clientPromise from './mongodb';

// Historico de builds. Cada linha e' uma tentativa de construir a imagem de
// um servico, com o commit exato que entrou nela -- e' o que liga "esta
// imagem em producao" a "este codigo".

export type MonitorBuild = {
  _id: ObjectId;
  service: string;
  repo: string;
  worker: string;
  jobId: string;
  status: 'running' | 'ok' | 'fail';
  // Preenchidos pelo worker no fim: ele e' quem resolve o ref pro sha, e a
  // tag e' derivada do sha (short sha), nao escolhida por ninguem.
  sha?: string;
  tag?: string;
  image?: string;
  message?: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
};

const DIA = 24 * 60 * 60;
let indexesEnsured = false;

async function ensureIndexes(db: Db) {
  if (indexesEnsured) return;
  try {
    await db.collection<MonitorBuild>('monitor_builds').createIndexes([
      // TTL no campo de CONCLUSAO, nunca em startedAt: build travado em
      // 'running' nao tem finishedAt e por isso nunca expira sozinho --
      // some da tela por estar velho, nao por ser apagado pelas costas.
      // Mesma regra dos outros TTL deste projeto.
      { key: { finishedAt: 1 }, expireAfterSeconds: 90 * DIA, name: 'ttl_finishedAt' },
      { key: { service: 1, startedAt: -1 }, name: 'service_startedAt' },
      { key: { jobId: 1 }, name: 'jobId' },
    ]);
    indexesEnsured = true;
  } catch (error) {
    console.error('falha ao criar indices de builds:', error);
  }
}

export async function startBuild(params: {
  service: string;
  repo: string;
  worker: string;
  jobId: string;
}): Promise<void> {
  const client = await clientPromise;
  const db = client.db();
  await ensureIndexes(db);
  await db.collection<MonitorBuild>('monitor_builds').insertOne({
    _id: new ObjectId(),
    ...params,
    status: 'running',
    startedAt: new Date(),
  });
}

/**
 * Fecha o build a partir do result que o worker devolveu.
 *
 * Casado por jobId e nao por servico: dois builds do mesmo servico podem
 * coexistir (um travado, outro novo), e fechar "o mais recente" fecharia o
 * errado. O jobId e' o unico identificador que atravessa o ciclo inteiro.
 */
export async function finishBuild(
  jobId: string,
  outcome: { ok: boolean; sha?: string; tag?: string; image?: string; message?: string }
): Promise<void> {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<MonitorBuild>('monitor_builds');
  const doc = await col.findOne({ jobId, status: 'running' });
  if (!doc) return;
  const now = new Date();
  await col.updateOne(
    { _id: doc._id },
    {
      $set: {
        status: outcome.ok ? 'ok' : 'fail',
        sha: outcome.sha,
        tag: outcome.tag,
        image: outcome.image,
        message: outcome.message?.slice(0, 500),
        finishedAt: now,
        durationMs: now.getTime() - doc.startedAt.getTime(),
      },
    }
  );
}

export type BuildView = Omit<MonitorBuild, '_id' | 'startedAt' | 'finishedAt'> & {
  _id: string;
  startedAt: string;
  finishedAt?: string;
};

export async function listBuilds(service: string, limit = 20): Promise<BuildView[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db
    .collection<MonitorBuild>('monitor_builds')
    .find({ service })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({
    ...d,
    _id: d._id.toString(),
    startedAt: d.startedAt.toISOString(),
    finishedAt: d.finishedAt?.toISOString(),
  }));
}

export async function hasRunningBuild(service: string): Promise<boolean> {
  const client = await clientPromise;
  const db = client.db();
  return (await db.collection<MonitorBuild>('monitor_builds').countDocuments({ service, status: 'running' })) > 0;
}
