import { Db, ObjectId } from 'mongodb';
import clientPromise from './mongodb';

// Registro de servicos do Monitor.
//
// O modelo NAO tem um booleano "buildavel". A pergunta que importa e' dupla
// e os dois lados sao independentes: quem PRODUZ o artefato e quem EXECUTA.
// Colapsar os dois num enum so' e' o que faz registro de servico apodrecer
// -- e e' o eixo de execucao que porta pro Kubernetes depois, trocando so'
// o executor. Ver CICD.md.

export type ServiceSource =
  // nos produzimos a imagem a partir de um repo nosso
  | { kind: 'build'; repo: string; ref?: string; context?: string }
  // imagem publica fixada (mongo, redis, grafana...): nao builda, mas tem
  // pipeline -- observar tag nova upstream e promover pelo mesmo botao
  | { kind: 'upstream'; image: string }
  // nao tem imagem (haproxy, webssh, certbot): sem pipeline. O valor da
  // pagina aqui e' inventario -- onde esta deployado, onde loga, qual
  // config. E' exatamente o que faltava quando a jail do fail2ban ficou
  // apontando pro caminho velho do log do Mongo sem ninguem perceber.
  | { kind: 'managed'; unit?: string; configPath?: string }
  // terceiro (S3/Storj, Cloudflare): so saude e dependencia
  | { kind: 'external' };

export type ServiceDeployment =
  | { kind: 'compose'; host: string; project: string; service: string }
  | { kind: 'systemd'; host: string; unit: string }
  | { kind: 'none' };

export type MonitorService = {
  _id: ObjectId;
  name: string;
  source: ServiceSource;
  deployment: ServiceDeployment;
  // Observado no host, nunca editado a mao -- vem do job service-inventory.
  observed?: {
    declaredImage?: string; // o que o compose do host manda subir
    runningImage?: string; // o que o container esta rodando de fato
    state?: string;
    seenAt: Date;
  };
  // Enriquecimento manual. Inventario digitado a mao rota; o que se digita
  // aqui e' so o que a maquina nao tem como saber.
  logPath?: string;
  url?: string;
  autoPromote?: boolean;
  // Abre incidente (e email, pelo caminho normal) quando o build falha.
  //
  // Por SERVICO e nao por host, embora o build rode num worker: quem
  // quebrou foi a esteira do servico, nao a maquina. E a escolha do worker
  // e' dinamica (desempate por menos jobs pendentes entre os habilitados),
  // entao amarrar no host daria alerta nao-deterministico -- a mesma falha
  // avisando hoje e ficando muda amanha, conforme quem pegou o job. O
  // interruptor de alerta do host (monitoring.enabled) e' outra coisa:
  // cuida da saude da MAQUINA (disco, memoria, cpu, offline).
  //
  // Nasce desligado, como autoPromote e como o alerta de host.
  alertBuildFailure?: boolean;
  // Ultima promocao PEDIDA. Existe porque promover nao coloca nada em
  // producao na hora: escreve a tag no git e enfileira o deploy, e o selo
  // "em producao" so' muda quando o inventario confirma. Sem registrar o
  // pedido, a tela voltava identica depois do clique -- nenhum sinal de
  // que a acao valeu, e o caminho natural era clicar de novo.
  //
  // Fica no documento, e nao em estado de tela, justamente pra sobreviver
  // ao refresh e a outra aba: quem abrir a pagina no meio do caminho ve o
  // mesmo que quem clicou.
  promoted?: { tag: string; at: Date };
  createdAt: Date;
  updatedAt: Date;
};

// Estado do repo de deploy no host alvo. E' o que detecta a deriva que
// motivou tudo isto: tag editada direto no host, sem commit.
export type RepoState = {
  host: string;
  dirtyFiles: string[];
  ahead: number;
  behind: number;
  seenAt: Date;
};

let indexesEnsured = false;
async function ensureIndexes(db: Db) {
  if (indexesEnsured) return;
  try {
    await db.collection<MonitorService>('monitor_services').createIndexes([
      { key: { name: 1 }, unique: true, name: 'name_unique' },
    ]);
    indexesEnsured = true;
  } catch (error) {
    console.error('falha ao criar indices de servicos:', error);
  }
}

// Origem inferida na PRIMEIRA vez que o servico aparece, so pra nao nascer
// vazio. Depois disso nunca sobrescreve: o que o admin editou vale mais que
// o palpite. `$setOnInsert` garante isso.
function guessSource(image: string): ServiceSource {
  if (image.startsWith('registry.rcaldas.com/')) {
    // registry.rcaldas.com/rcaldas/web:2.11 -> repo 'web'
    const semTag = image.split(':')[0];
    const repo = semTag.split('/').pop() || '';
    return { kind: 'build', repo };
  }
  return { kind: 'upstream', image: image.split(':')[0] };
}

/**
 * Reconcilia o registro com o que o host reportou.
 *
 * Faz upsert por nome, gravando o observado e deixando o enriquecimento
 * manual intacto. Servico que sumiu do compose NAO e' apagado -- some do
 * arquivo mas pode ter historico e configuracao que valem mais que a
 * limpeza automatica; some da lista por estar desatualizado, nao por ser
 * removido pelas nossas costas.
 */
export async function ingestInventory(params: {
  host: string;
  project: string;
  declared: { name: string; image: string }[];
  running: { name: string; image: string; state: string }[];
}) {
  const client = await clientPromise;
  const db = client.db();
  await ensureIndexes(db);

  const now = new Date();
  const col = db.collection<MonitorService>('monitor_services');
  const rodando = new Map(params.running.map((r) => [r.name, r]));

  for (const svc of params.declared) {
    const run = rodando.get(svc.name);
    await col.updateOne(
      { name: svc.name },
      {
        $set: {
          deployment: { kind: 'compose', host: params.host, project: params.project, service: svc.name },
          observed: {
            declaredImage: svc.image,
            runningImage: run?.image,
            state: run?.state,
            seenAt: now,
          },
          updatedAt: now,
        },
        $setOnInsert: { name: svc.name, source: guessSource(svc.image), createdAt: now },
      },
      { upsert: true }
    );
  }
}

export type ServiceView = Omit<MonitorService, '_id' | 'createdAt' | 'updatedAt' | 'observed' | 'promoted'> & {
  _id: string;
  observed?: { declaredImage?: string; runningImage?: string; state?: string; seenAt: string };
  promoted?: { tag: string; at: string };
  drift: boolean;
};

// Deriva de imagem: o compose manda subir X, o container roda Y. Acontece
// quando o arquivo mudou e ninguem rodou `up -d`. Servico sem container
// (state ausente) nao conta como deriva -- pode ser um servico que nao
// esta no ar de proposito.
function hasDrift(svc: MonitorService): boolean {
  const o = svc.observed;
  if (!o?.declaredImage || !o.runningImage) return false;
  return o.declaredImage !== o.runningImage;
}

export async function listServices(): Promise<ServiceView[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection<MonitorService>('monitor_services').find({}).sort({ name: 1 }).toArray();
  return docs.map(toView);
}

export async function getService(name: string): Promise<ServiceView | null> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection<MonitorService>('monitor_services').findOne({ name });
  return doc ? toView(doc) : null;
}

function toView(doc: MonitorService): ServiceView {
  return {
    ...doc,
    _id: doc._id.toString(),
    observed: doc.observed
      ? { ...doc.observed, seenAt: doc.observed.seenAt.toISOString() }
      : undefined,
    promoted: doc.promoted ? { tag: doc.promoted.tag, at: doc.promoted.at.toISOString() } : undefined,
    drift: hasDrift(doc),
  };
}

/**
 * Registra que uma promocao foi PEDIDA -- nao que ela chegou em producao.
 * Quem confirma a chegada e' o inventario, comparando observed.declaredImage.
 */
export async function recordPromotion(name: string, tag: string): Promise<void> {
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorService>('monitor_services')
    .updateOne({ name }, { $set: { promoted: { tag, at: new Date() }, updatedAt: new Date() } });
}

export async function setServiceEnrichment(
  name: string,
  patch: { source?: ServiceSource; logPath?: string; url?: string; autoPromote?: boolean; alertBuildFailure?: boolean }
) {
  const client = await clientPromise;
  const db = client.db();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.source) set.source = patch.source;
  if (patch.logPath !== undefined) set.logPath = patch.logPath || undefined;
  if (patch.url !== undefined) set.url = patch.url || undefined;
  if (patch.autoPromote !== undefined) set.autoPromote = patch.autoPromote;
  if (patch.alertBuildFailure !== undefined) set.alertBuildFailure = patch.alertBuildFailure;
  await db.collection<MonitorService>('monitor_services').updateOne({ name }, { $set: set });
}

export async function saveRepoState(state: Omit<RepoState, 'seenAt'>) {
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<RepoState>('monitor_repo_state')
    .updateOne({ host: state.host }, { $set: { ...state, seenAt: new Date() } }, { upsert: true });
}

export async function getRepoStates(): Promise<(Omit<RepoState, 'seenAt'> & { seenAt: string })[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection<RepoState>('monitor_repo_state').find({}).toArray();
  return docs.map((d) => ({
    host: d.host,
    dirtyFiles: d.dirtyFiles ?? [],
    ahead: d.ahead ?? 0,
    behind: d.behind ?? 0,
    seenAt: d.seenAt.toISOString(),
  }));
}
