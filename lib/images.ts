import type { Db } from 'mongodb';
import clientPromise from './mongodb';
import {
  enqueueBuildJob,
  pickBuildWorker,
  resolveIncident,
  upsertIncident,
  normalizeHostName,
  type AgentJob,
  type MonitorHost,
} from './monitor';
import { currentRunningBuild, startBuild, type MonitorBuild } from './builds';
import { listServices, stackOf, type MonitorService } from './services';
import { getStack, imageBaseFor, splitIdentity } from './stacks';

// Atualizacao de imagem: o que roda nos hosts e o que e' base dos nossos apps.
//
// Duas perguntas diferentes, com respostas diferentes:
//   1. Imagem PUBLICA rodando num host (nginx, redis, mongo, mailu...) tem
//      versao nova na mesma tag? -> resolve com pull + recriar o container
//      (job image-apply, que roda served-scripts/atualiza-imagens.sh).
//   2. Imagem BASE de um app nosso (FROM node:24-alpine, FROM nginx:alpine)
//      tem versao nova desde o build que esta em producao? -> resolve com
//      REBUILD do mesmo commit (build tem --pull desde o agente 2.18), com
//      tag "<sha>-b<data>" pra nao colidir com a imagem anterior.
//
// As duas sao verificadas SEM baixar nada (digest remoto x local), a cada
// 6h, pelo job image-check -- o us tem disco curto, e baixar periodicamente
// deixaria GBs de imagem parada esperando alguem aplicar.

export const IMAGE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type ImageEntry = {
  project: string;
  service: string;
  image: string;
  fixed: boolean;
  local: string;
  remote: string;
  // atualizar = digest remoto difere do rodando; desconhecido = registry nao
  // respondeu (ex.: quay.io); local = imagem sem digest (buildada no host).
  status: 'ok' | 'atualizar' | 'desconhecido' | 'local' | 'sem-container';
};

type ImageCheckDoc = { host: string; checkedAt: Date; images: ImageEntry[] };
type BaseDigestDoc = { ref: string; remote: string; checkedAt: Date; host: string };

export type StaleApp = {
  service: string;
  tag?: string;
  // false = o build em producao e' anterior ao registro de bases (agente <
  // 2.19): nao da pra afirmar nada, so' oferecer o rebuild.
  hasBases: boolean;
  stale: { ref: string; used: string; remote: string }[];
};

const sha = (d?: string) => (d || '').replace(/^.*@/, '');

// ---------------------------------------------------------------- filas

export async function enqueueImageCheck(hostName: string, refs?: string[]): Promise<void> {
  const host = normalizeHostName(hostName);
  if (!host) return;
  const client = await clientPromise;
  const db = client.db();
  await db.collection<AgentJob>('monitor_agent_jobs').updateOne(
    { host, type: 'image-check', status: 'pending' },
    {
      $set: { host, type: 'image-check', status: 'pending', refs: refs?.length ? refs.join(',') : undefined },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

export async function enqueueImageApply(hostName: string, projects?: string[]): Promise<void> {
  const host = normalizeHostName(hostName);
  if (!host) return;
  const client = await clientPromise;
  const db = client.db();
  await db.collection<AgentJob>('monitor_agent_jobs').updateOne(
    { host, type: 'image-apply', status: 'pending' },
    {
      $set: {
        host,
        type: 'image-apply',
        status: 'pending',
        projects: projects?.length ? projects.join(',') : undefined,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

// ---------------------------------------------------------------- bases

// Build em producao de um servico: o ultimo OK cuja tag e' a declarada no
// compose -- e' a imagem que esta rodando, entao sao as bases dela que valem.
async function productionBuild(db: Db, svc: { name: string; observed?: { declaredImage?: string } }) {
  const tag = svc.observed?.declaredImage?.split(':').pop();
  if (!tag) return null;
  return db
    .collection<MonitorBuild>('monitor_builds')
    .findOne({ service: svc.name, tag, status: 'ok' }, { sort: { startedAt: -1 } });
}

/** Todas as imagens base usadas pelos builds em producao -- o que o worker verifica. */
export async function baseRefs(): Promise<string[]> {
  const client = await clientPromise;
  const db = client.db();
  const refs = new Set<string>();
  for (const svc of (await listServices()).filter((s) => s.source?.kind === 'build')) {
    const b = await productionBuild(db, svc);
    Object.keys(b?.bases ?? {}).forEach((r) => refs.add(r));
  }
  return [...refs].sort();
}

export async function listStaleApps(): Promise<StaleApp[]> {
  const client = await clientPromise;
  const db = client.db();
  const remotos = new Map(
    (await db.collection<BaseDigestDoc>('monitor_base_digests').find({}).toArray()).map((d) => [d.ref, d.remote])
  );
  const out: StaleApp[] = [];
  for (const svc of (await listServices()).filter((s) => s.source?.kind === 'build')) {
    const b = await productionBuild(db, svc);
    const bases = b?.bases ?? {};
    const stale = Object.entries(bases)
      .filter(([ref, used]) => remotos.get(ref) && sha(remotos.get(ref)) !== sha(used))
      .map(([ref, used]) => ({ ref, used: sha(used), remote: sha(remotos.get(ref)) }));
    out.push({ service: svc.name, tag: b?.tag, hasBases: Object.keys(bases).length > 0, stale });
  }
  return out;
}

// ---------------------------------------------------------------- leitura

export async function ingestImageCheck(
  hostName: string,
  data: { images?: ImageEntry[]; bases?: { ref: string; remote: string }[] }
): Promise<void> {
  const host = normalizeHostName(hostName);
  if (!host || !Array.isArray(data.images)) return;
  const client = await clientPromise;
  const db = client.db();
  const now = new Date();
  await db
    .collection<ImageCheckDoc>('monitor_image_checks')
    .updateOne({ host }, { $set: { host, checkedAt: now, images: data.images } }, { upsert: true });
  for (const b of data.bases ?? []) {
    if (!b.ref || !b.remote) continue; // registry nao respondeu: mantem o ultimo conhecido
    await db
      .collection<BaseDigestDoc>('monitor_base_digests')
      .updateOne({ ref: b.ref }, { $set: { ref: b.ref, remote: b.remote, checkedAt: now, host } }, { upsert: true });
  }
  await refreshImageIncidents(db, host);
}

export async function listImageChecks() {
  const client = await clientPromise;
  const db = client.db();
  const checks = await db.collection<ImageCheckDoc>('monitor_image_checks').find({}).sort({ host: 1 }).toArray();
  const capazes = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({ capabilities: 'image-check' }, { projection: { name: 1, lastSeen: 1 } })
    .sort({ name: 1 })
    .toArray();
  const pendentes = await db
    .collection<AgentJob>('monitor_agent_jobs')
    .find({ type: { $in: ['image-check', 'image-apply'] }, status: { $in: ['pending', 'sent'] } })
    .toArray();
  const ultimosApply = await db
    .collection<AgentJob>('monitor_agent_jobs')
    .find({ type: 'image-apply', status: { $in: ['done', 'failed'] } })
    .sort({ doneAt: -1 })
    .limit(20)
    .toArray();
  return capazes.map((h) => {
    const c = checks.find((x) => x.host === h.name);
    const apply = ultimosApply.find((j) => j.host === h.name);
    return {
      host: h.name,
      checkedAt: c?.checkedAt?.toISOString(),
      images: c?.images ?? [],
      pending: pendentes.filter((j) => j.host === h.name).map((j) => j.type),
      lastApply: apply
        ? { status: apply.status, at: apply.doneAt?.toISOString(), result: apply.result }
        : undefined,
    };
  });
}

// ---------------------------------------------------------------- alerta

async function refreshImageIncidents(db: Db, host: string) {
  const doc = await db.collection<ImageCheckDoc>('monitor_image_checks').findOne({ host });
  const novas = (doc?.images ?? []).filter((i) => i.status === 'atualizar');
  const chave = `imagens:${host}`;
  if (novas.length) {
    // Estavel no assunto, viva no summary -- mesmo padrao dos outros
    // incidentes: o email so' sai na abertura e na resolucao.
    await upsertIncident(db, {
      key: chave,
      target: host,
      severity: 'warning',
      summary: `${novas.length} imagem(ns) com versao nova em ${host}: ${novas.map((i) => `${i.project}/${i.service}`).join(', ')}`,
      detail: novas.map((i) => `${i.project}/${i.service} ${i.image}`).join('\n'),
      emailSubject: `imagens com versao nova em ${host}`,
    });
  } else {
    await resolveIncident(db, chave);
  }

  const apps = (await listStaleApps()).filter((a) => a.stale.length);
  if (apps.length) {
    await upsertIncident(db, {
      key: 'imagens-base',
      target: 'pipeline',
      severity: 'warning',
      summary: `${apps.length} app(s) com imagem base nova: ${apps.map((a) => `${a.service} (${a.stale.map((s) => s.ref).join(', ')})`).join('; ')}`,
      emailSubject: 'apps com imagem base nova -- precisam de rebuild',
    });
  } else {
    await resolveIncident(db, 'imagens-base');
  }
}

// ---------------------------------------------------------------- rebuild

/**
 * Rebuild do commit que ja esta no repo, com tag "<sha>-b<AAMMDDhhmm>".
 *
 * Existe pra trazer base nova (nginx, node) sem commit de codigo. A tag
 * precisa ser outra: com a mesma tag do build anterior a promocao recusa
 * ("producao ja esta nesta tag") e o host nem veria imagem nova. Com
 * auto-promocao ligada, segue sozinho ate producao como qualquer build.
 */
export async function rebuildService(
  name: string
): Promise<{ ok: boolean; message: string }> {
  const svc = (await listServices()).find((s) => s.name === name) as (MonitorService & { name: string }) | undefined;
  if (!svc || svc.source?.kind !== 'build') return { ok: false, message: `${name}: nao e' servico de build` };
  const emAndamento = await currentRunningBuild(name);
  if (emAndamento) return { ok: false, message: `${name}: ja tem build rodando em ${emAndamento.worker}` };
  const worker = await pickBuildWorker();
  if (!worker) return { ok: false, message: 'nenhum worker de build disponivel' };
  const stack = stackOf(svc);
  const info = getStack(stack);
  if (!info) return { ok: false, message: `${name}: stack ${stack} desconhecida` };

  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const sufixo = `-b${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;

  const jobId = await enqueueBuildJob(worker, {
    repo: svc.source.repo,
    root: info.dir,
    stack,
    imageBase: imageBaseFor(stack, splitIdentity(name).service),
    ref: svc.source.ref,
    tagSuffix: sufixo,
  });
  if (!jobId) return { ok: false, message: `${name}: falha ao enfileirar` };
  await startBuild({ service: name, repo: svc.source.repo, worker, jobId });
  console.log(`rebuild de base enfileirado: ${name} em ${worker} (tag ...${sufixo})`);
  return { ok: true, message: `${name}: rebuild enfileirado em ${worker}` };
}
