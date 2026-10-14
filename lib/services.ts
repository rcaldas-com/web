import { Db, ObjectId } from 'mongodb';
import clientPromise from './mongodb';
import { serviceIdentity, stackFromImage } from './stacks';

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

// Backup de DADOS do servico -- eixo separado do backup de host.
//
// O rsnapshot copia ARQUIVO de um host. Nem Mongo nem S3 sao arquivo: um
// precisa de dump logico, o outro de sync de bucket. Por isso a config
// mora aqui, no servico, e nao em monitor_hosts.backup.includes.
//
// A retencao e' do OFFSITE (restic), nao do local. Localmente fica so' a
// copia corrente -- guardar N copias datadas no tank seria pagar duas
// vezes pelo mesmo historico que o restic ja mantem deduplicado.
export type ServiceBackup = {
  enabled: boolean;
  // O METODO decide o que o runner executa. Nao da' pra inferir do
  // 'source': tanto um 'upstream' quanto um 'external' podem precisar de
  // qualquer um dos dois (um Mongo gerenciado por terceiro seria
  // external + mongodump).
  method: 'mongodump' | 's3-sync' | 'mysqldump';
  // Retencao LOCAL, no tank -- os mesmos niveis que os hosts ja tem, e
  // pelo mesmo mecanismo: o rsnapshot roda o dump como `backup_script` e
  // versiona a saida com hardlink, exatamente como faz com arquivo de
  // host. Um dump de Mongo que nao mudou nao ocupa espaco duas vezes.
  //
  // Nao ha nivel "hora" aqui de proposito: o menor nivel e' quem executa
  // o dump de verdade (os de cima so' promovem), e nem bater no Mongo nem
  // varrer o bucket de 451 objetos de 4 em 4 horas se paga -- o dado
  // desses dois muda em escala de dia, nao de hora.
  retention?: { dia?: number; semana?: number; mes?: number };
};

// Retencao do OFFSITE (restic). E' UMA SO' pro repositorio inteiro, e nao
// por servico -- nao por escolha, por como o restic funciona: o `forget`
// opera sobre SNAPSHOTS, e cada snapshot carrega todas as fontes juntas.
// Nao existe expirar o Mongo de 30 dias atras mantendo o S3 do mesmo
// snapshot. Deixar isso configuravel por servico daria a impressao de um
// controle que nao existe: quem pedisse 7 dias num servico veria a
// politica mais longa valendo pra ele tambem.
export const RETENCAO_OFFSITE = { dia: 14, semana: 8, mes: 12 };

export type MonitorService = {
  _id: ObjectId;
  // Identidade: nome puro pra rcaldas (compatibilidade com tudo que ja
  // existe), "<stack>/<nome>" pra qualquer outra -- ver serviceIdentity em
  // stacks.ts. E' a CHAVE do registro (name_unique), por isso tem que ser
  // isso que desambigua "redis" da stack rcaldas do "redis" da stack bndes.
  name: string;
  // Ausente so em documento anterior a multi-stack -- trate como 'rcaldas'
  // (ver stackOf abaixo). Sempre presente a partir de ingestInventory novo.
  stack?: string;
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
  // Ausente = servico sem backup de dados (o caso da maioria: o dado deles
  // ou e' efemero ou ja viaja no backup de arquivo do host).
  backup?: ServiceBackup;
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
  // Resultado da ultima sondagem HTTP da `url` (lib/probes.ts). So existe
  // em servico com `url` cadastrada -- e' ela que liga a sondagem.
  health?: ServiceHealth;
  createdAt: Date;
  updatedAt: Date;
};

export type ServiceHealth = {
  ok: boolean;
  status?: number;
  message?: string;
  checkedAt: Date;
  // Desde quando esta no estado atual (ok ou fora) -- e' o que deixa a
  // tela dizer "fora ha 12 min" em vez de so' "fora".
  since: Date;
  consecutiveFailures: number;
};

// Estado do repo de deploy no host alvo. E' o que detecta a deriva que
// motivou tudo isto: tag editada direto no host, sem commit.
//
// Por {host, stack}, nao so' host: cada stack tem seu proprio repo/HEAD, e
// um host pode estar em dia com a rcaldas e atrasado na bndes (ou nem ter
// a bndes clonada ainda).
export type RepoState = {
  host: string;
  stack: string;
  dirtyFiles: string[];
  ahead: number;
  behind: number;
  // Commit em que o host esta. E' o sinal de convergencia: 'behind' depende
  // de '@{u}', que so' e' verdade logo apos um fetch, e o inventario nao
  // faz fetch -- marcava 0 com o host atrasado. O sha nao depende de nada
  // no host.
  head?: string;
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

/**
 * Origem inferida na PRIMEIRA vez que o servico aparece, so pra nao nascer
 * vazio. Depois disso nunca sobrescreve: o que o admin editou vale mais que
 * o palpite. `$setOnInsert` garante isso.
 *
 * Precisa saber de QUAL stack e' a chamada, nao so' olhar a imagem: o
 * emailer da stack bndes roda `registry.rcaldas.com/rcaldas/emailer`,
 * imagem de OUTRA stack -- e' 'upstream' do ponto de vista do bndes (ele
 * nao builda isso, so' acompanha o que a stack rcaldas publica), nunca
 * 'build'. Sem comparar com a stack que esta perguntando, o palpite
 * tentaria enfileirar um build de "emailer" dentro do diretorio do bndes,
 * que nao tem esse repo.
 */
function guessSource(image: string, stack: string): ServiceSource {
  const semTag = image.split(':')[0];
  if (stackFromImage(image) === stack) {
    // registry.rcaldas.com/<stack>/web:2.11 -> repo 'web'
    const repo = semTag.split('/').pop() || '';
    return { kind: 'build', repo };
  }
  return { kind: 'upstream', image: semTag };
}

/** Stack do serviço, com fallback pra documento anterior a multi-stack. */
export function stackOf(svc: { stack?: string; name: string }): string {
  return svc.stack ?? (svc.name.includes('/') ? svc.name.split('/')[0] : 'rcaldas');
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
  // Stack que gerou este inventário (ver lib/stacks.ts) -- é o que vira o
  // prefixo da identidade (serviceIdentity) e o 'project' do deployment,
  // pra "redis"/"emailer" da stack bndes não sobrescreverem os da rcaldas.
  stack: string;
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
    const name = serviceIdentity(params.stack, svc.name);
    await col.updateOne(
      { name },
      {
        $set: {
          stack: params.stack,
          // deployment.service fica com o nome REAL do compose (sem
          // prefixo) -- é com ele que um futuro `docker compose exec`
          // precisa falar, nunca com a identidade prefixada.
          deployment: { kind: 'compose', host: params.host, project: params.stack, service: svc.name },
          observed: {
            declaredImage: svc.image,
            runningImage: run?.image,
            state: run?.state,
            seenAt: now,
          },
          updatedAt: now,
        },
        $setOnInsert: { name, source: guessSource(svc.image, params.stack), createdAt: now },
      },
      { upsert: true }
    );
  }
}

export type ServiceView = Omit<MonitorService, '_id' | 'createdAt' | 'updatedAt' | 'observed' | 'promoted' | 'health'> & {
  _id: string;
  observed?: { declaredImage?: string; runningImage?: string; state?: string; seenAt: string };
  promoted?: { tag: string; at: string };
  health?: Omit<ServiceHealth, 'checkedAt' | 'since'> & { checkedAt: string; since: string };
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
    health: doc.health
      ? { ...doc.health, checkedAt: doc.health.checkedAt.toISOString(), since: doc.health.since.toISOString() }
      : undefined,
    drift: hasDrift(doc),
  };
}

export async function setServiceHealth(name: string, health: ServiceHealth | null): Promise<void> {
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorService>('monitor_services')
    .updateOne({ name }, health ? { $set: { health } } : { $unset: { health: '' } });
}

/**
 * Cadastra a mao um servico que o inventario nunca vai enxergar.
 *
 * O inventario nasce do docker compose, e nem tudo que importa roda nele:
 * webssh e webvnc sao processos soltos no host. Sem cadastro eles nao
 * tinham como ser sondados -- e sao justamente as ferramentas de acesso de
 * emergencia, as que mais doi descobrir fora do ar na hora de usar.
 *
 * Nasce 'managed' e sem deployment; o resto se preenche na pagina dele.
 * Devolve false se o nome ja existe (nunca sobrescreve um inventariado).
 */
export async function createManualService(name: string, url?: string): Promise<boolean> {
  const client = await clientPromise;
  const db = client.db();
  await ensureIndexes(db);
  const now = new Date();
  const res = await db.collection<MonitorService>('monitor_services').updateOne(
    { name },
    {
      $setOnInsert: {
        name,
        stack: 'rcaldas',
        source: { kind: 'managed' },
        deployment: { kind: 'none' },
        ...(url ? { url } : {}),
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  return res.upsertedCount > 0;
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
  patch: { source?: ServiceSource; logPath?: string; url?: string; autoPromote?: boolean }
) {
  const client = await clientPromise;
  const db = client.db();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.source) set.source = patch.source;
  if (patch.logPath !== undefined) set.logPath = patch.logPath || undefined;
  if (patch.url !== undefined) set.url = patch.url || undefined;
  if (patch.autoPromote !== undefined) set.autoPromote = patch.autoPromote;
  await db.collection<MonitorService>('monitor_services').updateOne({ name }, { $set: set });
}

export async function setServiceBackup(name: string, backup: ServiceBackup | null) {
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorService>('monitor_services')
    .updateOne({ name }, { $set: { backup: backup ?? undefined, updatedAt: new Date() } });
}

// O que o runner precisa saber pra fazer o backup de dados. Devolve so' o
// essencial e NUNCA credencial: quem executa le' as credenciais do .env do
// host de producao na hora, o que mantem uma fonte da verdade so' (trocar
// de provedor de S3 la' passa a valer aqui sem sincronizar nada) e evita
// que segredo de producao passe pelo Mongo do Monitor ou pelo heartbeat.
export async function getDataBackupPlan(): Promise<
  { service: string; method: ServiceBackup['method']; retention: { dia: number; semana: number; mes: number } }[]
> {
  const client = await clientPromise;
  const db = client.db();
  const svcs = await db
    .collection<MonitorService>('monitor_services')
    .find({ 'backup.enabled': true }, { projection: { name: 1, backup: 1 } })
    .sort({ name: 1 })
    .toArray();

  return svcs
    .filter((s) => s.backup?.method)
    .map((s) => ({
      service: s.name,
      method: s.backup!.method,
      // Mesmos defaults dos hosts. rsnapshot recusa retain 0 em qualquer
      // nivel ("must be at least 1 or higher") e derruba o ciclo inteiro
      // daquele .conf, entao o piso e' 1 -- a mesma trava que
      // getBackupPlan ja aplica pros hosts, pelo mesmo motivo.
      retention: {
        dia: Math.max(1, s.backup?.retention?.dia ?? 7),
        semana: Math.max(1, s.backup?.retention?.semana ?? 4),
        mes: Math.max(1, s.backup?.retention?.mes ?? 12),
      },
    }));
}

export async function saveRepoState(state: Omit<RepoState, 'seenAt'>) {
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<RepoState>('monitor_repo_state')
    .updateOne({ host: state.host, stack: state.stack }, { $set: { ...state, seenAt: new Date() } }, { upsert: true });
}

export async function getRepoStates(): Promise<(Omit<RepoState, 'seenAt'> & { seenAt: string })[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection<RepoState>('monitor_repo_state').find({}).toArray();
  return docs.map((d) => ({
    host: d.host,
    // Documento anterior a multi-stack nao tem o campo -- era sempre a
    // rcaldas, a unica que existia.
    stack: d.stack ?? 'rcaldas',
    dirtyFiles: d.dirtyFiles ?? [],
    ahead: d.ahead ?? 0,
    behind: d.behind ?? 0,
    head: d.head,
    seenAt: d.seenAt.toISOString(),
  }));
}
