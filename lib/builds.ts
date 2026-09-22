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
  // Marcado por sweepStaleBuilds quando fecha um 'running' por idade, nunca
  // pelo worker. Existe pra finishBuild saber aceitar o resultado real se
  // ele chegar depois -- ver os dois comentarios la.
  staleTimeout?: boolean;
};

const DIA = 24 * 60 * 60;
let indexesEnsured = false;

// Teto de idade pra um build em 'running'. Bem acima do normal de
// proposito (builds deste projeto levam ~110s) -- e' so' pra pegar o caso
// do worker que morreu/suspendeu no meio e nunca mais respondeu, nao pra
// apertar builds legitimos que so' estao demorando. Achado num incidente
// real: o worker (notebook) suspendeu durante um build do wallet e o
// registro ficou 'running' por ~22min ate a maquina acordar sozinha: se
// nao tivesse acordado, ficaria travado pra sempre, sem timeout e sem
// retry (ver sweepStaleBuilds).
const STALE_RUNNING_MS = 20 * 60 * 1000;

function staleCutoff(): Date {
  return new Date(Date.now() - STALE_RUNNING_MS);
}

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
 *
 * Casa tambem um doc que sweepStaleBuilds ja fechou como 'fail' por idade
 * (staleTimeout: true) -- de proposito: e' exatamente o caso do incidente
 * que originou esse sweep. O worker (notebook) suspendeu, o build ficou
 * 'running' alem do teto e foi marcado como falha automatica, mas depois
 * a maquina acordou sozinha e o build TERMINOU DE VERDADE, com sucesso.
 * Sem esta segunda condicao, esse resultado real chegaria tarde demais e
 * seria descartado (nenhum doc 'running' pra casar), perdendo silenciosamente
 * um build que na verdade deu certo -- e a promocao automatica que depende
 * do retorno desta funcao nunca aconteceria.
 */
export async function finishBuild(
  jobId: string,
  outcome: { ok: boolean; sha?: string; tag?: string; image?: string; message?: string }
): Promise<{ service: string; tag?: string; ok: boolean } | null> {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<MonitorBuild>('monitor_builds');
  const doc = await col.findOne({ jobId, $or: [{ status: 'running' }, { staleTimeout: true }] });
  if (!doc) return null;
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
      $unset: { staleTimeout: '' },
    }
  );

  // Devolve servico e tag pra quem chamou poder decidir a auto-promocao
  // sem uma segunda consulta -- e sem builds.ts precisar saber o que
  // promocao significa.
  //
  // Devolve TAMBEM quando falhou (com ok:false), e nao null: antes o
  // fracasso era indistinguivel de "nao havia build rodando com esse id",
  // entao quem chamava nao tinha como saber qual servico quebrou -- e o
  // build que falha ficava silencioso. null agora significa so' uma coisa:
  // nenhum build 'running' casou com este jobId.
  return { service: doc.service, tag: outcome.tag, ok: outcome.ok };
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

/**
 * Ultimo sha que este servico TENTOU buildar -- com sucesso ou nao.
 *
 * Comparar com a ultima tentativa, e nao com o ultimo sucesso, e' o que
 * impede rebuild em loop: se o commit X falha ao buildar, ele nao volta a
 * ser enfileirado a cada 5 minutos pra sempre. Falha exige commit novo ou
 * um clique manual -- que e' o comportamento certo, porque build que falha
 * sozinho tende a continuar falhando sozinho.
 */
export async function lastAttemptedSha(service: string): Promise<string | null> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db
    .collection<MonitorBuild>('monitor_builds')
    .findOne({ service, sha: { $exists: true } }, { sort: { startedAt: -1 }, projection: { sha: 1 } });
  return doc?.sha ?? null;
}

/**
 * Ultimo build BEM-SUCEDIDO com tag, se houver.
 *
 * Existe pra resolver um caso que so' aparece na pratica: marcar
 * auto-promocao depois que o build ja terminou. O gancho normal roda no
 * fim do build, entao ligar a caixa depois nao promovia nada, e o polling
 * tambem nao reconstruia (o SHA nao mudou) -- o servico ficava com imagem
 * nova pronta e tag velha em producao, esperando um commit que talvez
 * demorasse dias.
 */
export async function latestSuccessfulBuild(service: string): Promise<{ tag: string; sha?: string } | null> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db
    .collection<MonitorBuild>('monitor_builds')
    .findOne({ service, status: 'ok', tag: { $exists: true } }, { sort: { startedAt: -1 } });
  return doc?.tag ? { tag: doc.tag, sha: doc.sha } : null;
}

/**
 * O build 'running' deste servico, se houver -- ignorando um que ja
 * passou do teto de idade (ver STALE_RUNNING_MS). E' a fonte da verdade
 * pra "esta bloqueado agora?": nao depende do sweep ja ter rodado, entao
 * o bloqueio se autolimpa mesmo se o proximo heartbeat demorar.
 */
export async function currentRunningBuild(
  service: string
): Promise<{ startedAt: Date; worker: string } | null> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db
    .collection<MonitorBuild>('monitor_builds')
    .findOne(
      { service, status: 'running', startedAt: { $gt: staleCutoff() } },
      { sort: { startedAt: -1 }, projection: { startedAt: 1, worker: 1 } }
    );
  return doc ? { startedAt: doc.startedAt, worker: doc.worker } : null;
}

export async function hasRunningBuild(service: string): Promise<boolean> {
  return (await currentRunningBuild(service)) !== null;
}

/**
 * Fecha, como falha, todo build que ficou em 'running' alem do teto de
 * idade -- o caso do worker que sumiu no meio (suspensao, crash, rede) e
 * nunca mandou o resultado de volta. Sem isso o registro fica 'running'
 * pra sempre: hasRunningBuild ja ignora esses pra efeito de bloqueio
 * (currentRunningBuild acima), mas sem fechar o doc (a) a tela de builds
 * mostra um 'running' mentiroso indefinidamente e (b) lastAttemptedSha
 * nunca chega a formar opiniao sobre esse sha porque o worker nunca preencheu
 * `sha` -- o que ja e' o comportamento certo: sem sha gravado, o proximo
 * poll trata como se nunca tivesse tentado e reenfileira sozinho, desta
 * vez com pickBuildWorker() podendo escolher outro worker vivo.
 *
 * Marca staleTimeout: true (nunca so' status: 'fail') pra finishBuild saber
 * aceitar o resultado real se o worker acordar e reportar depois -- ver o
 * comentario la, e' o caso exato do incidente que motivou este sweep.
 *
 * Pendurada no mesmo polling throttled de build (ver requestRepoHeadsThrottled
 * em lib/polling.ts) -- mesmo padrao de sweepOfflineHosts em lib/monitor.ts:
 * pega carona no heartbeat, sem processo dedicado.
 */
// Devolve o que fechou, pra quem chama poder abrir incidente -- essa
// funcao fica em builds.ts e nao sabe o que incidente significa (mesma
// separacao de responsabilidade que finishBuild ja tem com maybeAutoPromote
// em lib/monitor.ts).
export async function sweepStaleBuilds(): Promise<{ service: string; worker: string; minutos: number }[]> {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<MonitorBuild>('monitor_builds');
  const stale = await col
    .find({ status: 'running', startedAt: { $lte: staleCutoff() } })
    .project<{ _id: ObjectId; service: string; worker: string; startedAt: Date }>({
      service: 1,
      worker: 1,
      startedAt: 1,
    })
    .toArray();

  const fechados: { service: string; worker: string; minutos: number }[] = [];
  for (const doc of stale) {
    const now = new Date();
    const minutos = Math.round((now.getTime() - doc.startedAt.getTime()) / 60000);
    await col.updateOne(
      { _id: doc._id, status: 'running' },
      {
        $set: {
          status: 'fail',
          staleTimeout: true,
          message: `build travado: sem retorno do worker '${doc.worker}' por ${minutos}min (worker provavelmente caiu ou suspendeu) -- marcado como falha automaticamente`,
          finishedAt: now,
          durationMs: now.getTime() - doc.startedAt.getTime(),
        },
      }
    );
    console.warn(`build travado marcado como falha: ${doc.service} em ${doc.worker} (rodando ha ${minutos}min)`);
    fechados.push({ service: doc.service, worker: doc.worker, minutos });
  }
  return fechados;
}
