import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Db, ObjectId } from 'mongodb';
import clientPromise from './mongodb';
import { sendTunnelKeyApprovalEmail, sendIncidentEmail } from './email';
import { ingestInventory, saveRepoState } from './services';
import { finishBuild } from './builds';
import { ingestRepoHeads, requestRepoHeadsThrottled } from './polling';
import { maybeAutoPromote } from './promote';
import redis from './redis';

// Fonte unica pra versao do agente: app/install/route.ts interpola isso no
// script gerado, e registerHeartbeat compara contra o que cada host reporta
// pra enfileirar 'update-agent' sozinho. Bump SEMPRE que o conteudo de
// AGENT_BIN mudar -- nao mudar isso foi o motivo do host-info ter ficado
// invisivel: o codigo novo foi adicionado sem bump, entao nenhum host
// existente jamais teria motivo pra se atualizar sozinho.
export const AGENT_VERSION = '2.10.0';

// Uma porta ou faixa de portas, com protocolo -- o suficiente pra
// representar o que o `us` ja tem aberto de verdade hoje na mao (ex:
// RustDesk usa faixa 21115-21119 TCP + porta unica 21116 UDP; um numero
// isolado nao dava conta disso). 'end' ausente = porta unica.
export type PortRule = { start: number; end?: number; proto: 'tcp' | 'udp' };

export type HeartbeatPayload = {
  host?: string;
  token?: string;
  version?: string;
  time?: string;
  network?: {
    ipv4?: string;
    ipv6?: string;
    publicIp?: string;
  };
  system?: {
    uptime?: number;
    load1?: number;
    // Media desde o heartbeat anterior (~60s), na mesma unidade do painel
    // do provedor: 100% = 1 nucleo. Num host de 2 nucleos o teto e 200%.
    cpuPct?: number;
    cpuCount?: number;
    topCpu?: string;
    diskRootPct?: number;
    diskVarPct?: number | null;
    diskVarLogPct?: number | null;
    // So o runner reporta: uso do disco onde os backups sao guardados.
    backupDiskPct?: number | null;
    memoryPct?: number;
  };
  tunnel?: {
    enabled?: boolean;
    localSshPort?: number;
    activeRemotePort?: number;
  };
  capabilities?: string[];
  results?: AgentJobResult[];
};

export type AgentJobResult = {
  id?: string;
  type?: string;
  status?: 'ok' | 'warn' | 'fail' | 'unknown';
  message?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
};

export type MonitorHost = {
  _id: ObjectId;
  name: string;
  tokenHash?: string;
  status?: 'ok' | 'warn' | 'down' | 'unknown';
  lastSeen?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  version?: string;
  network?: HeartbeatPayload['network'];
  system?: HeartbeatPayload['system'];
  tunnel?: HeartbeatPayload['tunnel'];
  capabilities?: string[];
  lastIp?: string;
  ddnsEnabled?: boolean;
  cfRecordId?: string;
  tunnelEnabled?: boolean;
  tunnelPort?: number;
  // Limite que, se ultrapassado num heartbeat, abre um incidente em
  // monitor_incidents (ver checkMonitoringThresholds) -- e resolvido
  // sozinho no primeiro heartbeat de volta abaixo do limite.
  monitoring?: {
    // Chave geral dos alertas deste host. Ausente = desligado, e e' assim
    // de proposito: host novo nasce sem alertar. Ter limite configurado
    // nao basta -- alguem tem que ligar explicitamente.
    //
    // O motivo apareceu na pratica: `rec02` estava fora ha 40h e `m2`
    // nunca tinha dado sinal. Ligar deteccao de host caido sem esta chave
    // abriria incidente pros dois no primeiro ciclo, e alerta que nasce
    // gritando e' alerta que se aprende a ignorar.
    enabled?: boolean;
    diskThresholdPct?: number;
    memoryThresholdPct?: number;
    // Em unidade de nucleo (100% = 1 nucleo), pra bater com o que o
    // provedor mostra. A janela aqui e de ~60s contra as 2h da Linode.
    cpuThresholdPct?: number;
  };
  // Heartbeats CONSECUTIVOS acima do limite, pra memoria/cpu -- um pico de
  // build/GC de 1 minuto nao deveria abrir e fechar incidente sozinho.
  // Disco fica de fora de proposito: nao tem "pico passageiro" de disco,
  // se passou do limite e porque encheu de verdade.
  breachStreaks?: {
    memory?: number;
    cpu?: number;
  };
  // Espelho do breachStreaks, mas pra fechar: so conta enquanto o
  // incidente ja esta aberto (streak de abertura >= CONSECUTIVE_BREACHES_
  // REQUIRED). Sem isso, memoria/cpu oscilando bem em cima do limite abre
  // e fecha incidente a cada heartbeat -- visto ao vivo no bag (90%
  // exatamente no limite, flapping a cada ~1min).
  clearStreaks?: {
    memory?: number;
    cpu?: number;
  };
  // O que copiar deste host. A execucao continua local no runner
  // (rsnapshot), isso aqui e a fonte da verdade que gera a config dele --
  // mesmo formato que os .bkp escritos a mao usam hoje.
  backup?: {
    enabled?: boolean;
    // Varios diretorios, cada um com seus proprios excludes.
    includes?: {
      path: string;
      excludes?: string[];
      // Ponto de montagem a exigir ANTES de rodar. Nao e sempre igual a
      // 'path' -- ex: HD externo monta em /media/rcaldas/1TB, mas o que se
      // quer copiar e /media/rcaldas/1TB/pics (subdiretorio, nunca o
      // mountpoint em si). Se preenchido e nao estiver montado, o
      // rsnapshot RECUSA rodar (o host inteiro, nesse ciclo) em vez de
      // seguir com origem vazia -- que com --delete (rsync_long_args do
      // gerador) apagaria o destino inteiro silenciosamente, exit 0, sem
      // nenhum alerta disparando.
      mountPoint?: string;
    }[];
    // Mesmos intervalos do rsnapshot atual (hora/dia/semana/mes).
    retention?: { hora?: number; dia?: number; semana?: number; mes?: number };
  };
  // Marca este host como o que EXECUTA os backups da frota. So um por vez;
  // trocar e marcar outro e rodar o setup nele.
  backupRunner?: {
    enabled?: boolean;
    snapshotRoot?: string;
  };
  // Host que hospeda a stack de producao. So estes sao inventariados: hosts
  // de desenvolvimento tambem tem um compose com os mesmos nomes de servico
  // (web, car, wallet...), e inventariar todos misturaria dev com producao
  // no mesmo registro, sem jeito de distinguir depois.
  //
  // Diferente do backupRunner, mais de um pode existir -- o dia em que
  // houver um segundo servidor de producao, ele entra aqui sem mudar nada.
  deployTarget?: {
    enabled?: boolean;
  };
  // Host que pode construir imagens. Varios ao mesmo tempo, ao contrario do
  // backupRunner (que desmarca os outros ao marcar um): nao ha estado
  // compartilhado entre workers, cada build e' independente.
  //
  // Marcar nao basta pra receber trabalho -- ver pickBuildWorker: o host
  // precisa estar vivo E declarar a capacidade. E' isso que faz um notebook
  // como o `tp` poder ficar marcado o tempo todo e simplesmente nao receber
  // build quando esta fechado, sem ninguem lembrar de desmarcar.
  buildWorker?: {
    enabled?: boolean;
  };
  // Quando o inventario foi PEDIDO, nao quando chegou. Reagendar pelo
  // pedido evita martelar um host onde o job falha sempre -- que foi como
  // 4101 jobs de host-info viraram lixo entre 15 e 19/08.
  inventoryRequestedAt?: Date;
  // 'standard' (padrao, ate undefined): host comum, sem exposicao publica
  // esperada. 'proxy'/'home': precisa aceitar trafego de fora por design
  // (web/mail/roteador) -- muda qual sugestao de firewall faz sentido, ver
  // getFirewallPlan()/renderNftablesSuggestion().
  //
  // Nao aplica nada sozinho -- so guarda o que a sugestao de nftables.conf
  // deve conter. A implementacao no host e sempre manual (ver historico:
  // teve versao anterior que aplicava remoto com reversao automatica, deu
  // dois bugs de producao reais e confusao sobre se tinha aplicado ou nao
  // -- desfeito de proposito).
  role?: 'standard' | 'proxy' | 'home';
  firewall?: {
    // Portas publicas -- so tem efeito na sugestao quando role e' proxy/home.
    ports?: PortRule[];
    // Portas liberadas so pra faixas RFC1918 (10/8, 172.16/12, 192.168/16)
    // -- vale pra QUALQUER role, inclusive standard. Resolve o caso de
    // acessar um servico (ex: VNC) de outro dispositivo na mesma rede
    // local sem expor pro mundo nem precisar saber qual rede especifica
    // (a faixa privada e' a mesma em qualquer rede domestica/local).
    lanPorts?: PortRule[];
    // Interfaces do papel de router (role 'home' = router da LAN; 'proxy'
    // e' o equivalente na WAN). So' tem efeito quando a LAN esta definida.
    //
    // Ficam aqui APENAS as interfaces, e nao um escopo de DHCP inteiro, de
    // proposito: reserva por MAC e mapa de intranet sao dado de alta
    // rotatividade cujo dono natural e' o proprio router, que tem gerencia
    // local. O Monitor guarda so' o que precisa pra gerar firewall e
    // observa o resto pelo heartbeat -- um dono so', sem round-trip
    // central a cada reserva.
    lanIface?: string;
    wanIface?: string;
  };
  // Fastfetch filtrado do host (mesmo comando que roda no fim do /init).
  // NAO vem no heartbeat -- e bem maior que o resto do payload, entao e
  // buscado por job (ver enqueueJob 'host-info'), no maximo 1-2x por dia,
  // reaproveitando o mesmo hasJobs que ja existe pra backup-config etc.
  info?: {
    text: string;
    collectedAt: Date;
  };
};

// Um host da frota faz o backup dos outros (o `bag` hoje). Puxa via SSH,
// usando os tuneis quando o host esta atras de NAT -- por isso a config
// precisa ser gerada aqui, que e quem sabe a porta de cada um.
export type BackupPlanEntry = {
  host: string;
  // Como o runner alcanca esse host: porta do tunel no relay, ou direto.
  sshPort: number;
  sshHost: string;
  includes: { path: string; excludes?: string[]; mountPoint?: string }[];
  retention: { hora: number; dia: number; semana: number; mes: number };
};

// Fila de acoes que o servidor quer que um host execute. O heartbeat so
// avisa QUE existe algo (hasJobs), e o agente busca em /agent-jobs -- assim
// o heartbeat, que roda a cada 60s em toda a frota, continua minusculo.
//
// `type` e uma acao NOMEADA que o agente sabe executar, nunca um comando
// arbitrario vindo do banco: se o Monitor fosse comprometido, poder mandar
// shell livre pra frota inteira seria bem pior do que poder pedir uma das
// acoes conhecidas.
export type AgentJob = {
  _id: ObjectId;
  host: string;
  type: 'backup-config' | 'update-agent' | 'host-info' | 'service-inventory' | 'build' | 'repo-heads' | 'deploy';
  status: 'pending' | 'sent' | 'done' | 'failed';
  // Parametros do job, PLANOS de proposito: o agente fatia a resposta do
  // /agent-jobs com grep -o de {...} e qualquer objeto aninhado aqui
  // quebraria esse recorte, entregando o job truncado.
  repo?: string; // diretorio do submodulo em /var/rcaldas/rcaldas
  imageBase?: string; // registry.rcaldas.com/rcaldas/<nome>, sem tag
  ref?: string; // branch remoto a buildar (vazio = main)
  repos?: string; // lista separada por virgula -- so no job repo-heads
  createdAt: Date;
  sentAt?: Date;
  doneAt?: Date;
  result?: string;
};

export type MonitorIncident = {
  _id: ObjectId;
  key: string;
  target: string;
  status: 'open' | 'resolved';
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  // Definido SO na criacao, nunca reescrito enquanto o incidente segue
  // aberto (ao contrario de 'summary', que upsertIncident atualiza a cada
  // re-ocorrencia). Existe pra manter o assunto do email identico entre a
  // abertura e a resolucao -- disco/memoria/cpu tem valor ao vivo no
  // summary (ex: "Disco em 87%"), que muda a cada heartbeat; sem um campo
  // separado e estavel, o email de resolucao levaria o ULTIMO valor visto,
  // quase sempre diferente do primeiro, e o Gmail nunca agruparia os dois
  // na mesma conversa.
  emailSubject?: string;
  openedAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  count?: number;
};

export type MonitorMailEvent = {
  _id: ObjectId;
  ts?: Date | string;
  event?: string;
  status?: string;
  from?: string;
  to?: string;
  originalTo?: string;
  message?: string;
};

// Chave publica do host que faz backup da frota. Vai no heartbeat pra
// que cada agente a autorize sozinho -- assim trocar de runner e mudar
// este arquivo, sem reprovisionar host nenhum.
const SYNC_HOME_DIR = process.env.SYNC_HOME_DIR || '/var/rcaldas/live/home';

// Cache: sem isso seria um read de disco por heartbeat de cada host,
// pra um arquivo que quase nunca muda.
let runnerKeyCache: { valor?: string; ate: number } = { ate: 0 };

function readBackupRunnerKey(): string | undefined {
  if (Date.now() < runnerKeyCache.ate) return runnerKeyCache.valor;
  try {
    const k = fs.readFileSync(path.join(SYNC_HOME_DIR, '.ssh/backup-runner.pub'), 'utf8').trim();
    // Sanity check: uma linha, formato de chave. Nunca mandar lixo pros
    // hosts, que vao gravar isso em authorized_keys.
    const valor = /^ssh-[a-z0-9-]+ [A-Za-z0-9+/=]+( \S+)?$/.test(k) ? k : undefined;
    runnerKeyCache = { valor, ate: Date.now() + 60_000 };
    return valor;
  } catch {
    runnerKeyCache = { valor: undefined, ate: Date.now() + 60_000 };
    return undefined;
  }
}

// Tetos contra abuso: /heartbeat aceita qualquer host novo (e assim que
// um host recem-provisionado se registra), entao o dano de quem abusar
// precisa ser limitado por aqui.
const MAX_RESULTS_POR_HEARTBEAT = 20;
const MAX_EMAILS_POR_HOST_HORA = 10;

function normalizeHostName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 80);
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function serializeDate(value?: Date | string) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function getRemoteIp(headers: Headers) {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    undefined
  );
}

async function updateCloudflareDdns(name: string, ipv6: string, cachedRecordId?: string) {
  const token = process.env.CF_TOKEN;
  const zoneId = process.env.CF_ZONE_ID;
  if (!token || !zoneId) return undefined;

  const cfName = `${name}.rcaldas.com`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let recordId = cachedRecordId;

  if (!recordId) {
    const lookup = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=AAAA&name=${encodeURIComponent(cfName)}`,
      { headers }
    );
    const lookupData = await lookup.json();
    recordId = lookupData?.result?.[0]?.id;
  }

  const body = JSON.stringify({ type: 'AAAA', name: cfName, content: ipv6, ttl: 60, proxied: false });
  if (recordId) {
    await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'PUT',
      headers,
      body,
    });
    return recordId;
  }

  const created = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers,
    body,
  });
  const createdData = await created.json();
  return createdData?.result?.id as string | undefined;
}

// Notifica so na TRANSICAO (incidente novo), nunca a cada heartbeat --
// senao um disco cheio viraria um email por minuto. Enquanto continua
// aberto, so incrementa o contador.
async function upsertIncident(
  db: Db,
  params: {
    key: string;
    target: string;
    severity: MonitorIncident['severity'];
    summary: string;
    detail?: string;
    // Texto estavel pro assunto do email. Se omitido, usa 'summary' --
    // seguro pra quem ja e invariavel (ex: alarme de backup, sempre a
    // mesma frase pra um mesmo id). So precisa ser passado por quem tem
    // valor ao vivo no summary (disco/memoria/cpu).
    emailSubject?: string;
    // Seletor LogQL do log que explica este incidente. Quando vem, o email
    // de abertura leva as ultimas linhas junto.
    logSelector?: string;
  }
) {
  const now = new Date();
  const emailSubject = params.emailSubject || params.summary;
  const existing = await db.collection<MonitorIncident>('monitor_incidents').findOne({ key: params.key, status: 'open' });
  if (existing) {
    await db
      .collection<MonitorIncident>('monitor_incidents')
      .updateOne({ _id: existing._id }, { $set: { summary: params.summary, severity: params.severity, updatedAt: now }, $inc: { count: 1 } });
    return;
  }
  await db.collection<MonitorIncident>('monitor_incidents').insertOne({
    _id: new ObjectId(),
    key: params.key,
    target: params.target,
    status: 'open',
    severity: params.severity,
    summary: params.summary,
    emailSubject,
    openedAt: now,
    updatedAt: now,
    count: 1,
  });

  // Teto de emails por host/hora. O incidente sempre fica registrado; o
  // que e limitado e o AVISO. Sem isso, quem conseguisse mandar alarmes
  // variando o id gerava um email por alarme -- flood na caixa e risco de
  // queimar a reputacao do dominio como remetente.
  const umaHoraAtras = new Date(now.getTime() - 60 * 60 * 1000);
  const recentes = await db
    .collection<MonitorIncident>('monitor_incidents')
    .countDocuments({ target: params.target, openedAt: { $gte: umaHoraAtras } });

  if (recentes > MAX_EMAILS_POR_HOST_HORA) {
    console.warn(`incident email throttled for ${params.target} (${recentes} na ultima hora)`);
    return;
  }

  // Falha de email nunca pode derrubar o heartbeat -- o incidente ja esta
  // salvo de qualquer forma.
  try {
    await sendIncidentEmail({
      host: params.target,
      severity: params.severity,
      summary: params.summary,
      emailSubject,
      detail: params.detail,
      resolved: false,
      logSelector: params.logSelector,
    });
  } catch (error) {
    console.error('incident email failed:', error);
  }
}

// notify=false: fecha sem avisar. Usado quando o admin DESLIGA os alertas
// do host -- ali o incidente nao foi resolvido, foi silenciado, e mandar
// "resolvido" seria mentira sobre o estado do host (o disco continua
// cheio). Fechar mesmo assim e' necessario: com os alertas desligados o
// caminho que resolveria (o proximo heartbeat dentro do limite) nao roda
// mais, e o incidente ficaria aberto pra sempre na tela.
async function resolveIncident(db: Db, key: string, notify = true) {
  const open = await db.collection<MonitorIncident>('monitor_incidents').find({ key, status: 'open' }).toArray();
  if (!open.length) return;

  await db
    .collection<MonitorIncident>('monitor_incidents')
    .updateMany({ key, status: 'open' }, { $set: { status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() } });

  if (!notify) return;

  for (const incident of open) {
    try {
      await sendIncidentEmail({
        host: incident.target,
        severity: incident.severity,
        summary: incident.summary,
        // Sempre o valor gravado na abertura, nunca 'incident.summary' --
        // aquele muda a cada re-ocorrencia (o pct de disco/memoria/cpu
        // sobe/desce), este fica fixo. E o que faz o email de resolucao
        // ter o MESMO assunto do de abertura, pro Gmail agrupar os dois.
        emailSubject: incident.emailSubject || incident.summary,
        resolved: true,
      });
    } catch (error) {
      console.error('incident resolved email failed:', error);
    }
  }
}

// Alerta por CONTEUDO de log, vindo do alerting do Grafana por webhook.
//
// Fecha o ciclo que faltava: ate aqui o Monitor so' sabia de host (disco,
// cpu, memoria, heartbeat) e de alarme reportado pelo agente. Agora uma
// regra sobre o texto do log tambem abre incidente -- e reaproveita tudo
// que ja existe: dedupe, email so' na transicao, teto por host/hora e a
// mesma listagem em /monitor.
//
// O Grafana e' quem avalia a regra (ele ja fala com o Loki e ja tem
// alerting); aqui so' se traduz o webhook em incidente. Nao ha logica de
// threshold deste lado de proposito -- dois lugares decidindo quando algo
// esta ruim e' garantia de divergencia.
export async function handleLogAlert(alerta: {
  status: 'firing' | 'resolved';
  host: string;
  service?: string;
  summary: string;
  detail?: string;
  severity?: MonitorIncident['severity'];
  // Filtro de linha LogQL da regra que disparou -- ex:
  // '|~ `(?i)error` != `Cannot polyfill`'.
  //
  // Sem ele o email trazia as ULTIMAS linhas do servico, nao as linhas do
  // PROBLEMA: pro haproxy isso e' log de acesso comum, que nada tem a ver
  // com o assunto do alerta. Viaja junto da regra (annotation) de
  // proposito -- assim regra e email nao divergem por construcao.
  logFilter?: string;
}) {
  const client = await clientPromise;
  const db = client.db();

  // Uma chave por host+servico. Sem o servico no meio, dois servicos
  // barulhentos no mesmo host se sobrescreveriam no mesmo incidente.
  const key = `log:${alerta.host}:${alerta.service || 'all'}`;

  if (alerta.status === 'resolved') {
    await resolveIncident(db, key);
    return { key, acao: 'resolvido' as const };
  }

  await upsertIncident(db, {
    key,
    target: alerta.host,
    severity: alerta.severity || 'warning',
    summary: alerta.summary,
    detail: alerta.detail,
    // Estavel: o summary do Grafana carrega a contagem, que muda a cada
    // avaliacao. Sem isto o assunto do email mudaria a cada re-ocorrencia
    // e o Gmail nunca agruparia abertura e resolucao na mesma conversa.
    emailSubject: `erro no log de ${alerta.service || alerta.host}`,
    logSelector:
      (alerta.service
        ? `{host="${alerta.host}", service="${alerta.service}"}`
        : `{host="${alerta.host}"}`) + (alerta.logFilter ? ` ${alerta.logFilter}` : ''),
  });
  return { key, acao: 'aberto' as const };
}

// Build tem enqueue proprio porque a deduplicacao do enqueueJob e' por
// {host, type} -- o que e' certo pra host-info/update-agent (nao faz
// sentido enfileirar dois) e ERRADO aqui: buildar `web` e `car` sao dois
// jobs do mesmo tipo no mesmo host, e um sobrescreveria o outro. Aqui a
// chave inclui o repo.
export async function enqueueBuildJob(
  hostName: string,
  params: { repo: string; imageBase: string; ref?: string }
): Promise<string | null> {
  const host = normalizeHostName(hostName);
  if (!host || !params.repo || !params.imageBase) return null;
  const client = await clientPromise;
  const db = client.db();
  const now = new Date();
  const res = await db.collection<AgentJob>('monitor_agent_jobs').findOneAndUpdate(
    { host, type: 'build', repo: params.repo, status: 'pending' },
    {
      $set: { host, type: 'build', status: 'pending', repo: params.repo, imageBase: params.imageBase, ref: params.ref },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return res?._id?.toString() ?? null;
}

// Dedup por {host,type}: nao faz sentido ter duas leituras de HEAD
// pendentes pro mesmo worker. A lista de repos e' sobrescrita, entao a
// pendente sempre reflete o cadastro mais recente.
export async function enqueueRepoHeadsJob(hostName: string, repos: string): Promise<void> {
  const host = normalizeHostName(hostName);
  if (!host || !repos) return;
  const client = await clientPromise;
  const db = client.db();
  const now = new Date();
  await db.collection<AgentJob>('monitor_agent_jobs').updateOne(
    { host, type: 'repo-heads', status: 'pending' },
    { $set: { host, type: 'repo-heads', status: 'pending', repos }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
}

// Pede reconciliacao aos hosts de producao: eles puxam o commit e
// convergem. Dedup por {host,type} -- dois deploys pendentes pro mesmo
// host nao fazem sentido, o segundo aplicaria o mesmo estado final.
//
// So' quem DECLARA a capacidade, mesma regra do resto: pedir a um agente
// que nao sabe executar produz job morto.
export async function enqueueDeployJobs(): Promise<string[]> {
  const client = await clientPromise;
  const db = client.db();
  const alvos = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({ 'deployTarget.enabled': true, capabilities: 'deploy' }, { projection: { name: 1 } })
    .toArray();
  const now = new Date();
  for (const alvo of alvos) {
    await db.collection<AgentJob>('monitor_agent_jobs').updateOne(
      { host: alvo.name, type: 'deploy', status: 'pending' },
      { $set: { host: alvo.name, type: 'deploy', status: 'pending' }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  }
  return alvos.map((a) => a.name);
}

// Chamado pela rota autenticada quando o agente vem buscar. Marca como
// 'sent' pra nao entregar de novo no ciclo seguinte enquanto executa.


export async function setBuildWorker(hostName: string, enabled: boolean) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { buildWorker: { enabled }, updatedAt: new Date() } });
}

// Quanto tempo sem heartbeat pra considerar um worker indisponivel. Mais
// curto que o alerta de host caido (5min) de proposito: aqui errar so
// significa mandar o build pro outro worker, nao acordar ninguem.


// Quanto tempo sem heartbeat pra considerar um worker indisponivel. Mais
// curto que o alerta de host caido (5min) de proposito: aqui errar so
// significa mandar o build pro outro worker, nao acordar ninguem.
const WORKER_ALIVE_WINDOW_MS = 3 * 60 * 1000;

/**
 * Escolhe onde rodar o proximo build.
 *
 * Tres filtros, nesta ordem:
 *   1. marcado como buildWorker
 *   2. VIVO -- heartbeat nos ultimos 3 minutos
 *   3. DECLARA a capacidade 'build'
 *
 * O filtro 2 e' o fallback de verdade: e' o que deixa o `tp` (notebook)
 * ficar marcado permanentemente e simplesmente nao receber trabalho quando
 * esta fechado. Sem ele o job iria pra fila de um host desligado e ficaria
 * la ate o requeue de 10min, atrasando o build sem motivo.
 *
 * O filtro 3 e' a licao do host-info: pedir a um agente que nao conhece o
 * tipo produz `tipo desconhecido` e job morto. Capacidade e' auto-descritiva.
 *
 * Desempate por menos jobs pendentes -- distribui carga sem precisar de
 * estado compartilhado nem lock entre workers.
 */


/**
 * Escolhe onde rodar o proximo build.
 *
 * Tres filtros, nesta ordem:
 *   1. marcado como buildWorker
 *   2. VIVO -- heartbeat nos ultimos 3 minutos
 *   3. DECLARA a capacidade 'build'
 *
 * O filtro 2 e' o fallback de verdade: e' o que deixa o `tp` (notebook)
 * ficar marcado permanentemente e simplesmente nao receber trabalho quando
 * esta fechado. Sem ele o job iria pra fila de um host desligado e ficaria
 * la ate o requeue de 10min, atrasando o build sem motivo.
 *
 * O filtro 3 e' a licao do host-info: pedir a um agente que nao conhece o
 * tipo produz `tipo desconhecido` e job morto. Capacidade e' auto-descritiva.
 *
 * Desempate por menos jobs pendentes -- distribui carga sem precisar de
 * estado compartilhado nem lock entre workers.
 */
export async function pickBuildWorker(): Promise<string | null> {
  const client = await clientPromise;
  const db = client.db();
  const vivos = await db
    .collection<MonitorHost>('monitor_hosts')
    .find(
      {
        'buildWorker.enabled': true,
        lastSeen: { $gt: new Date(Date.now() - WORKER_ALIVE_WINDOW_MS) },
        capabilities: 'build',
      },
      { projection: { name: 1 } }
    )
    .toArray();
  if (!vivos.length) return null;
  if (vivos.length === 1) return vivos[0].name;

  const jobs = db.collection<AgentJob>('monitor_agent_jobs');
  const cargas = await Promise.all(
    vivos.map(async (h) => ({
      name: h.name,
      pendentes: await jobs.countDocuments({ host: h.name, status: { $in: ['pending', 'sent'] } }),
    }))
  );
  cargas.sort((a, b) => a.pendentes - b.pendentes || a.name.localeCompare(b.name));
  return cargas[0].name;
}

// Sem exclusividade, ao contrario do backupRunner: dois hosts de producao
// nao brigam entre si -- cada um inventaria a propria stack.

// Encerramento manual pelo admin -- pro caso do "copia offsite falhou" que
// so seria checado de novo pelo cron do dia seguinte, mas a causa raiz ja
// foi corrigida por fora (ex: bucket criado na mao). Reusa resolveIncident
// (mesmo email, mesmo agrupamento por assunto) em vez de duplicar logica.
// Sem risco real: se a causa nao tiver sido corrigida de verdade, o proximo
// heartbeat/cron que falhar reabre sozinho.
export async function resolveIncidentManually(incidentId: string) {
  const client = await clientPromise;
  const db = client.db();
  const incident = await db
    .collection<MonitorIncident>('monitor_incidents')
    .findOne({ _id: new ObjectId(incidentId), status: 'open' });
  if (!incident) return;
  await resolveIncident(db, incident.key);
}

// Heartbeats seguidos acima do limite antes de abrir incidente de
// memoria/cpu -- ~3 minutos sustentados, nao um pico de build/GC de 60s
// que se resolve sozinho sem ninguem fazer nada. Ver MonitorHost.breachStreaks.
const CONSECUTIVE_BREACHES_REQUIRED = 3;

// So faz alguma coisa se o admin configurou um limite pra esse host na
// pagina de detalhe (MonitorHost.monitoring) -- sem config, e um no-op.
// Disco: abre/resolve no primeiro heartbeat que cruza o limite em
// qualquer direcao -- nao tem "pico passageiro" de disco de verdade.
// Memoria/CPU: abre so depois de CONSECUTIVE_BREACHES_REQUIRED heartbeats
// seguidos acima do limite, e fecha so depois da MESMA quantidade seguidos
// de volta abaixo -- histerese simetrica, ver comentario no bloco de
// memoria pra o bug real que isso corrige.
// Indices do Monitor, criados sob demanda no mesmo padrao de
// ensureIndexes() em lib/shortlinks.ts. Ate 23/08/2026 NENHUMA colecao
// deste projeto tinha indice alem do _id_.
//
// REGRA DOS TTL: expirar pelo campo de CONCLUSAO, nunca por createdAt.
// O TTL do Mongo so apaga documento onde o campo indexado e uma Date --
// quem nao tem o campo e ignorado pra sempre. Indexando doneAt/resolvedAt,
// job pendente e incidente ABERTO nunca somem sozinhos, por construcao.
// Por createdAt, sumiriam justamente os que nao podem sumir.
//
// A excecao e o backstop de monitor_agent_jobs: job que nunca conclui
// tambem nunca ganha doneAt, e ficaria eterno. Isso nao e hipotetico --
// ha 4 jobs do tipo 'tunnel' de 15/08/2026 presos em pending/sent, de um
// tipo que nem esta mais na whitelist de AgentJob e portanto nunca vai ser
// executado. Dai o segundo TTL, por createdAt, com prazo bem mais longo:
// 90 dias da folga pra um host offline voltar e pegar o job que esperava
// por ele, e ainda assim nada fica eterno.
const DIA = 24 * 60 * 60;
let monitorIndexesEnsured = false;

async function ensureMonitorIndexes(db: Db) {
  if (monitorIndexesEnsured) return;
  try {
    await Promise.all([
      // receivedAt, nao createdAt: e o nome do campo de verdade nesta
      // colecao (conferido no banco). TTL apontando pra campo inexistente
      // nao da erro nenhum -- simplesmente nunca apaga nada, em silencio.
      db.collection('monitor_results').createIndexes([
        { key: { receivedAt: 1 }, expireAfterSeconds: 90 * DIA, name: 'ttl_receivedAt' },
        { key: { host: 1, receivedAt: -1 }, name: 'host_receivedAt' },
      ]),
      db.collection('monitor_agent_jobs').createIndexes([
        { key: { doneAt: 1 }, expireAfterSeconds: 30 * DIA, name: 'ttl_doneAt' },
        { key: { createdAt: 1 }, expireAfterSeconds: 90 * DIA, name: 'ttl_createdAt_backstop' },
        { key: { host: 1, status: 1 }, name: 'host_status' },
      ]),
      db.collection('monitor_incidents').createIndexes([
        { key: { resolvedAt: 1 }, expireAfterSeconds: 180 * DIA, name: 'ttl_resolvedAt' },
        { key: { key: 1, status: 1 }, name: 'key_status' },
        { key: { target: 1, openedAt: -1 }, name: 'target_openedAt' },
      ]),
    ]);
    monitorIndexesEnsured = true;
  } catch (error) {
    // Nunca derrubar o heartbeat por causa de indice: sem ele o sistema
    // funciona igual, so mais lento e sem expirar. A proxima chamada tenta
    // de novo, porque a flag nao chega a ser marcada.
    console.error('falha ao criar indices do monitor:', error);
  }
}

// Tempo sem heartbeat antes de abrir incidente. Cinco minutos = cinco
// ciclos perdidos, nao dois: a pagina marca "down" com 2min porque ali o
// custo de errar e' um rotulo cinza, enquanto aqui e' um email. Reboot e
// oscilacao de rede levam mais de 2min e menos de 5 com frequencia.
const HOST_OFFLINE_AFTER_MS = 5 * 60 * 1000;

// Chave da trava da varredura. TTL um pouco abaixo do intervalo do agente
// (60s) pra nao pular um ciclo por diferenca de relogio.
const OFFLINE_SWEEP_LOCK = 'monitor:offline-sweep';
const OFFLINE_SWEEP_LOCK_TTL = 55;

// Host caido nao manda heartbeat -- entao, ao contrario de disco/memoria/
// cpu, nao existe evento dele mesmo pra disparar a checagem. A varredura
// pega carona no heartbeat de QUALQUER host: alguem sempre esta vivo (o
// `us` e' o relay e roda agente), e a trava no Redis garante uma passada
// por minuto por mais hosts que batam nesse intervalo.
//
// Alternativa considerada e descartada: um container so' pra isso
// (monitor-worker). Ele existia no repo, nunca foi pra producao, e
// reimplementava pior o upsertIncident/resolveIncident daqui -- que ja
// deduplicam e mandam email so' na transicao.
export async function sweepOfflineHosts(db: Db) {
  const cutoff = new Date(Date.now() - HOST_OFFLINE_AFTER_MS);
  const hosts = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({ 'monitoring.enabled': true }, { projection: { name: 1, lastSeen: 1 } })
    .toArray();

  for (const doc of hosts) {
    const key = `down:${doc.name}`;
    // Nunca visto nao gera alerta: nao houve queda pra reportar, o host
    // simplesmente nunca subiu. E' o caso do `m2` -- avisar "esta fora"
    // sobre algo que nunca esteve dentro so' gera ruido.
    if (!doc.lastSeen) continue;

    if (doc.lastSeen < cutoff) {
      const minutos = Math.round((Date.now() - doc.lastSeen.getTime()) / 60000);
      await upsertIncident(db, {
        key,
        target: doc.name,
        severity: 'critical',
        summary: `Sem heartbeat ha ${minutos} min`,
        // Estavel: o summary cresce a cada ciclo e mudaria o assunto do
        // email a cada minuto, quebrando o agrupamento no Gmail.
        emailSubject: 'sem heartbeat',
      });
    } else {
      await resolveIncident(db, key);
    }
  }
}

async function sweepOfflineHostsThrottled(db: Db) {
  try {
    const gotLock = await redis.set(OFFLINE_SWEEP_LOCK, '1', 'EX', OFFLINE_SWEEP_LOCK_TTL, 'NX');
    if (!gotLock) return;
    await sweepOfflineHosts(db);
  } catch (error) {
    // Nunca pode derrubar o heartbeat: o host que esta reportando esta bem,
    // e falhar aqui apagaria o registro dele por causa de outro host.
    console.error('varredura de hosts offline falhou:', error);
  }
}

async function checkMonitoringThresholds(db: Db, host: string, existing: MonitorHost | null, system?: HeartbeatPayload['system']) {
  const cfg = existing?.monitoring;
  if (!cfg?.enabled || !system) return;

  if (cfg.diskThresholdPct != null) {
    // Nomear o sistema de arquivos, nao so' a porcentagem. O alerta antigo
    // dizia "Disco em 94%" e pronto -- quem recebia tinha que entrar no
    // host pra descobrir se era /, /var ou /var/log, que e' justamente a
    // informacao que decide o que fazer (limpar log e' diferente de
    // aumentar disco).
    const filesystems = [
      { mount: '/', pct: system.diskRootPct },
      { mount: '/var', pct: system.diskVarPct },
      { mount: '/var/log', pct: system.diskVarLogPct },
    ].filter((fs): fs is { mount: string; pct: number } => fs.pct != null);

    // backupDiskPct fica FORA do maximo de proposito: so' o runner reporta,
    // e o disco de backup encher nao e' o mesmo problema operacional que o
    // disco do sistema encher. Entra so' como informacao no corpo do email.
    const extras = system.backupDiskPct != null ? [{ mount: 'backup', pct: system.backupDiskPct }] : [];

    const worst = filesystems.reduce<{ mount: string; pct: number }>(
      (acc, fs) => (fs.pct > acc.pct ? fs : acc),
      { mount: '/', pct: 0 }
    );
    const key = `disk:${host}`;
    if (worst.pct >= cfg.diskThresholdPct) {
      await upsertIncident(db, {
        key,
        target: host,
        severity: worst.pct >= cfg.diskThresholdPct + 10 ? 'critical' : 'warning',
        summary: `Disco ${worst.mount} em ${worst.pct}% (limite ${cfg.diskThresholdPct}%)`,
        emailSubject: `disco ${worst.mount} acima do limite (${cfg.diskThresholdPct}%)`,
        // O assunto congela no sistema de arquivos que abriu o incidente
        // (e' o que mantem a thread do Gmail junta), entao a lista completa
        // vai no corpo -- se outro sistema piorar depois, aparece aqui.
        detail: [...filesystems, ...extras].map((fs) => `${fs.mount} ${fs.pct}%`).join(' · '),
      });
    } else {
      await resolveIncident(db, key);
    }
  }

  const streaks = { ...existing?.breachStreaks };
  const clearStreaks = { ...existing?.clearStreaks };
  let streaksChanged = false;

  if (cfg.memoryThresholdPct != null && system.memoryPct != null) {
    const key = `mem:${host}`;
    if (system.memoryPct >= cfg.memoryThresholdPct) {
      if (clearStreaks.memory) {
        clearStreaks.memory = 0;
        streaksChanged = true;
      }
      streaks.memory = (streaks.memory ?? 0) + 1;
      streaksChanged = true;
      if (streaks.memory >= CONSECUTIVE_BREACHES_REQUIRED) {
        await upsertIncident(db, {
          key,
          target: host,
          severity: system.memoryPct >= cfg.memoryThresholdPct + 10 ? 'critical' : 'warning',
          summary: `Memoria em ${system.memoryPct}% (limite ${cfg.memoryThresholdPct}%)`,
          emailSubject: `memoria acima do limite (${cfg.memoryThresholdPct}%)`,
        });
      }
    } else if ((streaks.memory ?? 0) >= CONSECUTIVE_BREACHES_REQUIRED) {
      // Incidente ja aberto: exige a MESMA quantidade de heartbeats bons
      // seguidos antes de fechar -- simetrico com a abertura. Sem isso,
      // um valor oscilando bem em cima do limite abre e fecha a cada
      // heartbeat que volta a ficar abaixo (visto ao vivo no bag: 90%
      // exato, flapping a cada ~1min).
      clearStreaks.memory = (clearStreaks.memory ?? 0) + 1;
      streaksChanged = true;
      if (clearStreaks.memory >= CONSECUTIVE_BREACHES_REQUIRED) {
        streaks.memory = 0;
        clearStreaks.memory = 0;
        await resolveIncident(db, key);
      }
    } else if (streaks.memory) {
      // Nunca chegou a abrir (streak de abertura nao completou) -- so
      // ruido abaixo do limiar de alerta, limpa na hora.
      streaks.memory = 0;
      streaksChanged = true;
    }
  }

  if (cfg.cpuThresholdPct != null && system.cpuPct != null) {
    const key = `cpu:${host}`;
    if (system.cpuPct >= cfg.cpuThresholdPct) {
      if (clearStreaks.cpu) {
        clearStreaks.cpu = 0;
        streaksChanged = true;
      }
      streaks.cpu = (streaks.cpu ?? 0) + 1;
      streaksChanged = true;
      if (streaks.cpu >= CONSECUTIVE_BREACHES_REQUIRED) {
        const cores = system.cpuCount ? ` de ${system.cpuCount * 100}%` : '';
        await upsertIncident(db, {
          key,
          target: host,
          severity: system.cpuPct >= cfg.cpuThresholdPct + 20 ? 'critical' : 'warning',
          summary: `CPU em ${system.cpuPct}%${cores} (limite ${cfg.cpuThresholdPct}%)`,
          emailSubject: `cpu acima do limite (${cfg.cpuThresholdPct}%)`,
          // Isso e o que o alerta do provedor nao entrega: quem esta comendo CPU.
          detail: system.topCpu ? `Processos no topo: ${system.topCpu}` : undefined,
        });
      }
    } else if ((streaks.cpu ?? 0) >= CONSECUTIVE_BREACHES_REQUIRED) {
      clearStreaks.cpu = (clearStreaks.cpu ?? 0) + 1;
      streaksChanged = true;
      if (clearStreaks.cpu >= CONSECUTIVE_BREACHES_REQUIRED) {
        streaks.cpu = 0;
        clearStreaks.cpu = 0;
        await resolveIncident(db, key);
      }
    } else if (streaks.cpu) {
      streaks.cpu = 0;
      streaksChanged = true;
    }
  }

  if (streaksChanged) {
    await db
      .collection<MonitorHost>('monitor_hosts')
      .updateOne({ name: host }, { $set: { breachStreaks: streaks, clearStreaks } });
  }
}

export async function registerHeartbeat(payload: HeartbeatPayload, headers: Headers) {
  if (!payload.host) {
    return { ok: false, status: 400, error: 'host is required' };
  }

  const host = normalizeHostName(payload.host);
  if (!host) {
    return { ok: false, status: 400, error: 'invalid host' };
  }

  const now = new Date();
  const client = await clientPromise;
  const db = client.db();
  const hosts = db.collection<MonitorHost>('monitor_hosts');
  const results = db.collection('monitor_results');

  const existing = await hosts.findOne({ name: host });
  const token = payload.token?.trim();
  const updateToken = !existing?.tokenHash || (token && existing.tokenHash === hashToken(token));
  if (existing?.tokenHash && (!token || existing.tokenHash !== hashToken(token))) {
    return { ok: false, status: 401, error: 'invalid token' };
  }

  const nextToken = token || makeToken();
  const set: Partial<MonitorHost> = {
    name: host,
    status: 'ok',
    lastSeen: now,
    updatedAt: now,
    version: payload.version,
    network: { ...payload.network, publicIp: payload.network?.publicIp || getRemoteIp(headers) },
    system: payload.system,
    tunnel: payload.tunnel,
    capabilities: payload.capabilities || [],
    lastIp: getRemoteIp(headers),
  };
  if (updateToken) {
    set.tokenHash = hashToken(nextToken);
  }

  const ipv6 = payload.network?.ipv6;
  if (existing?.ddnsEnabled && ipv6 && (!existing.cfRecordId || ipv6 !== existing.network?.ipv6)) {
    try {
      const recordId = await updateCloudflareDdns(host, ipv6, existing.cfRecordId);
      if (recordId) set.cfRecordId = recordId;
    } catch (error) {
      console.error('ddns update failed:', error);
    }
  }

  await hosts.updateOne(
    { name: host },
    {
      $set: set,
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  await ensureMonitorIndexes(db);
  await checkMonitoringThresholds(db, host, existing, payload.system);
  await sweepOfflineHostsThrottled(db);
  await requestRepoHeadsThrottled();

  let infoCollectedAt = existing?.info?.collectedAt;

  if (payload.results?.length) {
    // Teto no lote: sem isso um POST unico com 100k entradas vira 100k
    // inserts no Mongo. O agente real manda poucas por ciclo.
    const lote = payload.results.slice(0, MAX_RESULTS_POR_HEARTBEAT);
    await results.insertMany(
      lote.map((result) => ({
        ...result,
        host,
        receivedAt: now,
      }))
    );

    // Pipeline de incidente agnostico de origem: qualquer result do tipo
    // "alarm" vira incidente, sem o servidor precisar saber quem gerou.
    // Hoje quem manda e o proprio agente; amanha pode ser um alarme do
    // Netdata repassado (curl 127.0.0.1:19999/api/v1/alarms) ou qualquer
    // outra fonte -- sem mudar nada aqui.
    // Detalhes do build (sha/tag/imagem) chegam num result proprio, mas quem
    // sabe se DEU CERTO e' o result do job. Coletar antes do laco de jobs e'
    // o que permite fechar o build com as duas metades juntas -- na ordem
    // inversa, um build de sucesso fecharia sem saber a tag que gerou.
    const buildsPorJob = new Map<string, { sha: string; tag: string; image: string }>();
    for (const result of lote) {
      if (result.type !== 'build' || !result.message) continue;
      const [jobId, sha, tag, image] = result.message.split(' ');
      if (jobId && sha && tag && image) buildsPorJob.set(jobId, { sha, tag, image });
    }

    // HEAD remoto dos repos -> enfileira build do que mudou (Fase 3).
    for (const result of lote) {
      if (result.type !== 'repo-heads' || !result.message) continue;
      try {
        await ingestRepoHeads(db, JSON.parse(result.message) as Record<string, string>);
      } catch (error) {
        console.error('repo-heads invalido:', error);
      }
    }

    // Confirmacao de execucao de job: fecha o ciclo enfileirar -> executar.
    for (const result of lote) {
      if (result.type !== 'job' || !result.id) continue;
      try {
        await db.collection<AgentJob>('monitor_agent_jobs').updateOne(
          { _id: new ObjectId(result.id), host },
          {
            $set: {
              status: result.status === 'ok' ? 'done' : 'failed',
              doneAt: now,
              result: result.message?.slice(0, 500),
            },
          }
        );
        // Fecha o build correspondente, se este job era um. finishBuild casa
        // por jobId e nao faz nada quando nao ha build 'running' com esse id
        // -- entao chamar pra todo job e' barato e dispensa um lookup extra.
        //
        // Sem isto o build roda, publica a imagem e fica 'running' pra
        // sempre na tela: o proximo clique em "buildar agora" seria
        // bloqueado por um build que ja terminou ha horas.
        const fechado = await finishBuild(result.id, {
          ok: result.status === 'ok',
          sha: buildsPorJob.get(result.id)?.sha,
          tag: buildsPorJob.get(result.id)?.tag,
          image: buildsPorJob.get(result.id)?.image,
          message: result.message,
        });
        // Build terminou bem: promove sozinho se o servico estiver marcado.
        // Nao e' o default -- subir pra producao sem clique tem que ser
        // escolha explicita por servico.
        if (fechado?.tag) await maybeAutoPromote(fechado.service, fechado.tag);
      } catch {
        // id malformado -- ignora em vez de derrubar o heartbeat
      }
    }

    // Ficha do host (fastfetch filtrado). Canal separado do 'job' acima de
    // proposito: o result de um job comum trunca em 500 chars (o bastante
    // pra um "ok"/"falhou -- ver log"), mas o texto do fastfetch e maior
    // que isso -- por isso vai pro documento do host, nao pro registro do
    // job.
    for (const result of lote) {
      if (result.type !== 'info' || result.id !== 'host-info' || !result.message) continue;
      await hosts.updateOne({ name: host }, { $set: { info: { text: result.message.slice(0, 8000), collectedAt: now } } });
      // Reflete no mesmo ciclo -- sem isso, a checagem de idade la embaixo
      // ainda ve o 'existing' capturado antes deste update (info de 14h+
      // atras) e enfileiraria outro job redundante bem no heartbeat que
      // acabou de entregar o resultado fresco.
      infoCollectedAt = now;
    }

    // Inventario de servicos. Canal proprio ('inventory'), pelo mesmo
    // motivo do host-info: sao tres payloads JSON que nao cabem nos 500
    // chars do result de job comum.
    const inventario: Record<string, string> = {};
    for (const result of lote) {
      if (result.type !== 'inventory' || !result.id || !result.message) continue;
      inventario[result.id] = result.message;
    }
    if (inventario['services-declared'] && inventario['services-running']) {
      try {
        await ingestInventory({
          host,
          project: 'rcaldas',
          declared: JSON.parse(inventario['services-declared']),
          running: JSON.parse(inventario['services-running']),
        });
      } catch (error) {
        // JSON malformado nao pode derrubar o heartbeat do host -- ele
        // esta bem, quem esta ruim e o inventario.
        console.error('inventario de servicos invalido:', error);
      }
    }
    if (inventario['repo-state']) {
      try {
        const estado = JSON.parse(inventario['repo-state']) as {
          dirty?: string[];
          ahead?: number;
          behind?: number;
        };
        await saveRepoState({
          host,
          dirtyFiles: estado.dirty ?? [],
          ahead: estado.ahead ?? 0,
          behind: estado.behind ?? 0,
        });
      } catch (error) {
        console.error('estado do repo invalido:', error);
      }
    }

    for (const result of lote) {
      if (result.type !== 'alarm' || !result.id) continue;
      const key = `alarm:${host}:${result.id}`;
      if (result.status === 'ok') {
        await resolveIncident(db, key);
      } else {
        await upsertIncident(db, {
          key,
          target: host,
          severity: result.status === 'fail' ? 'critical' : 'warning',
          summary: result.message || `Alarme ${result.id}`,
          detail: result.details ? JSON.stringify(result.details) : undefined,
          // Log do host que reportou. Pro alarme de backup isso traz as
          // linhas do rcaldas-backup (que agora passa pelo logger), que
          // sao exatamente as que dizem POR QUE falhou -- a mensagem do
          // alarme sozinha so' diz QUE falhou.
          logSelector: `{host="${host}"}`,
        });
      }
    }
  }

  // Diretiva de tunel e autoritativa do servidor (o que o admin configurou
  // via Monitor), nao um eco do que o agente relatou -- e assim que o
  // agente aprende que deve abrir/manter/derrubar um tunel a cada
  // heartbeat, sem depender de um job avulso e com expiracao.
  const tunnelEnabled = existing?.tunnelEnabled ?? false;
  const tunnelPort = existing?.tunnelPort;

  // Ficha do host: busca no maximo 1-2x por dia, nunca a cada heartbeat --
  // e um payload bem maior que o resto, sem necessidade de ficar fresco
  // minuto a minuto. Mesmo mecanismo hasJobs que ja existe pra
  // backup-config/update-agent, so que agendado por idade em vez de por
  // mudanca de configuracao.
  const infoStaleCutoff = new Date(now.getTime() - 14 * 60 * 60 * 1000);
  if (!infoCollectedAt || infoCollectedAt < infoStaleCutoff) {
    await enqueueJob(host, 'host-info');
  }

  // Auto-update: o agente ja sabe rodar 'update-agent' sozinho (recebeu
  // essa capacidade antes do host-info), so faltava o servidor pedir. Sem
  // isso, todo host congela na versao que tinha no dia do /install e so
  // atualiza se alguem lembrar de rodar o curl na mao de novo -- foi
  // exatamente isso que deixou host-info invisivel em tp/bag/us por dias.
  if (payload.version && payload.version !== AGENT_VERSION) {
    await enqueueJob(host, 'update-agent');
  }

  // Inventario de servicos: so em host de producao, e so quando o agente
  // DECLARA que sabe fazer.
  //
  // A guarda e' por capacidade, nao por versao. Enfileirar um tipo que o
  // agente nao conhece produz `tipo desconhecido` e o job morre como
  // failed -- foi assim que 4101 jobs de host-info viraram lixo no banco
  // entre 15 e 19/08, o servidor pedindo algo que aquela versao do agente
  // nao sabia fazer.
  //
  // Comparar com AGENT_VERSION resolveria o caso comum e falharia no pior:
  // a constante e o codigo do agente vivem no mesmo arquivo mas podem ser
  // publicados em momentos diferentes, e ai a versao bate sem o codigo
  // existir. Capacidade e' auto-descritiva -- quem tem o codigo diz que
  // tem, e quem nao tem nunca recebe o pedido.
  const sabeInventariar = (payload.capabilities || []).includes('service-inventory');
  if (existing?.deployTarget?.enabled && sabeInventariar) {
    const inventoryStaleCutoff = new Date(now.getTime() - 30 * 60 * 1000);
    const ultimoPedido = existing?.inventoryRequestedAt;
    if (!ultimoPedido || ultimoPedido < inventoryStaleCutoff) {
      await enqueueJob(host, 'service-inventory');
      await hosts.updateOne({ name: host }, { $set: { inventoryRequestedAt: now } });
    }
  }

  // Devolve pra fila o que ficou preso em 'sent' (host reiniciou no meio)
  // antes de contar, senao um job travado nunca mais seria entregue.
  await requeueStaleJobs(db, host);
  const hasJobs =
    (await db.collection<AgentJob>('monitor_agent_jobs').countDocuments({ host, status: 'pending' }, { limit: 1 })) > 0;

  return {
    ok: true,
    status: 200,
    host,
    token: existing?.tokenHash ? undefined : nextToken,
    nextIntervalSec: 60,
    tunnel: tunnelEnabled && tunnelPort ? { enabled: true, port: tunnelPort } : { enabled: false },
    // Vai DEPOIS do tunnel: o agente extrai a porta com um sed ancorado em
    // "tunnel":{...}, entao nada pode ser inserido antes dele sem quebrar
    // todos os agentes ja instalados.
    backupRunnerKey: readBackupRunnerKey(),
    // So o SINAL. O agente busca o conteudo em /agent-jobs quando ha algo
    // -- assim a resposta do heartbeat nao cresce com a fila.
    hasJobs,
  };
}

export async function setDdnsEnabled(hostName: string, enabled: boolean) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { ddnsEnabled: enabled, updatedAt: new Date() } });
}

export async function setTunnelEnabled(hostName: string, enabled: boolean) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { tunnelEnabled: enabled, updatedAt: new Date() } });
}

// Faixa fechada de proposito: o `us` ja tem exatamente 7700-7799 aberto na
// mao no nftables real dele. Sem um teto, esse alocador podia devolver uma
// porta fora do que qualquer sugestao/regra existente abre -- teto aqui
// garante que a sugestao gerada (getFirewallPlan) e o alocador nunca
// divergem, mesmo que um dia o `us` passe a aplicar a sugestao de verdade.
const TUNNEL_PORT_RANGE_START = 7701;
const TUNNEL_PORT_RANGE_END = 7799;

async function nextTunnelPort(db: Db, excludeHost: string) {
  const used = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({ tunnelPort: { $exists: true }, name: { $ne: excludeHost } }, { projection: { tunnelPort: 1 } })
    .toArray();
  const usedPorts = new Set(used.map((h) => h.tunnelPort));
  let port = TUNNEL_PORT_RANGE_START;
  while (usedPorts.has(port)) {
    port++;
    if (port > TUNNEL_PORT_RANGE_END) {
      throw new Error(`faixa de portas de tunel esgotada (${TUNNEL_PORT_RANGE_START}-${TUNNEL_PORT_RANGE_END})`);
    }
  }
  return port;
}

// Habilita o tunel (se ainda nao estava) e atribui a proxima porta livre a
// partir de TUNNEL_PORT_RANGE_START se o host ainda nao tiver uma. Nao
// precisa disparar nada explicitamente: o proprio agente ve essa diretiva
// no proximo heartbeat (ate 60s) e abre o tunel sozinho, verificando de
// novo a cada ciclo dali em diante -- se cair por qualquer motivo, o
// agente reabre no ciclo seguinte, sem exigir outro clique aqui.
export async function openTunnel(hostName: string) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();

  const hostDoc = await db.collection<MonitorHost>('monitor_hosts').findOne({ name: host });
  if (!hostDoc) throw new Error('host nao encontrado');

  const port = hostDoc.tunnelPort ?? (await nextTunnelPort(db, host));

  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { tunnelEnabled: true, tunnelPort: port, updatedAt: new Date() } });

  return port;
}

// Ponte de compatibilidade com o zxnet antigo: GET /ping?host=X esperando de
// volta "0" (matar tunel), ou um numero de porta >1024 (abrir/manter tunel
// nessa porta). Cada host que ainda pinga vira/atualiza um host normal em
// monitor_hosts (aparece no Monitor como qualquer outro), so que marcado via
// capabilities pra indicar que so fala esse protocolo velho, sem heartbeat
// completo. So define tunnelEnabled/porta na primeira vez que o host aparece
// -- pings seguintes nao sobrescrevem o que o admin decidir depois no Monitor.
export async function registerLegacyPing(hostName: string, headers: Headers): Promise<number> {
  const host = normalizeHostName(hostName);
  if (!host) return 0;

  const client = await clientPromise;
  const db = client.db();
  const now = new Date();

  const existing = await db.collection<MonitorHost>('monitor_hosts').findOne({ name: host });

  // O protocolo legado nao tem como se autenticar (o zxnet so faz um GET
  // sem segredo nenhum), entao esta rota NAO cria host. Sem isso, qualquer
  // um cria hosts a vontade com um curl -- inclusive em loop, enchendo a
  // base. Host novo tem que ser cadastrado no Monitor de proposito, e so
  // depois o ping dele passa a valer.
  if (!existing) return 0;

  const port = existing.tunnelPort ?? (await nextTunnelPort(db, host));
  const tunnelEnabled = existing.tunnelEnabled ?? true;

  // getRemoteIp ja cuida de pegar o IP real por tras do Cloudflare/HAProxy
  // (cf-connecting-ip antes de x-forwarded-for) -- o zxnet antigo nao manda
  // nenhum payload com IP, entao essa e a unica fonte que temos pra ele.
  // Muitos desses hosts nao tem IPv6 (o proprio caso que motivou isso), daí
  // guardar em ambos os campos em vez de exigir um ou outro: ipv6 alimenta
  // o DDNS, ipv4 garante que pelo menos algum IP aparece no Monitor.
  const ip = getRemoteIp(headers);
  const isIpv6 = !!ip?.includes(':');
  const network = {
    ...existing?.network,
    ...(isIpv6 ? { ipv6: ip } : { ipv4: ip }),
  };

  const set: Partial<MonitorHost> = {
    name: host,
    status: 'ok',
    lastSeen: now,
    updatedAt: now,
    tunnelPort: port,
    capabilities: ['tunnel-legacy'],
    network,
    lastIp: ip,
  };

  // DDNS NAO sai daqui de proposito. Como este endpoint nao autentica
  // ninguem, quem chamasse /ping?host=X apontaria o DNS de X pro proprio
  // IP -- sequestro de subdominio com um curl. Ja aconteceu por acidente:
  // um teste feito do tp reescreveu o registro do lev. DDNS so pelo
  // /heartbeat, que exige token do agente.

  await db.collection<MonitorHost>('monitor_hosts').updateOne({ name: host }, { $set: set });

  return tunnelEnabled ? port : 0;
}

// Qual host executa os backups. So um por vez -- se marcarem dois, vence
// o primeiro por nome, de forma estavel, em vez de alternar entre eles.
export async function findBackupRunner(): Promise<string | undefined> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db
    .collection<MonitorHost>('monitor_hosts')
    .findOne({ 'backupRunner.enabled': true }, { projection: { name: 1 }, sort: { name: 1 } });
  return doc?.name;
}

export async function findHostByRole(role: 'proxy' | 'home'): Promise<string | undefined> {
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection<MonitorHost>('monitor_hosts').findOne({ role }, { projection: { name: 1 }, sort: { name: 1 } });
  return doc?.name;
}

// Mesma comparacao que o heartbeat faz, exposta pras rotas que precisam
// autenticar o agente sem processar um heartbeat inteiro.
export async function verifyAgentToken(hostName: string, token: string) {
  const host = normalizeHostName(hostName);
  if (!host || !token) return false;
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection<MonitorHost>('monitor_hosts').findOne({ name: host }, { projection: { tokenHash: 1 } });
  if (!doc?.tokenHash) return false;
  return doc.tokenHash === hashToken(token);
}

// Enfileira uma acao pra um host. Idempotente por (host, type, pending):
// mexer nos diretorios de backup dez vezes seguidas nao gera dez jobs.
export async function enqueueJob(hostName: string, type: AgentJob['type']) {
  const host = normalizeHostName(hostName);
  if (!host) return;
  const client = await clientPromise;
  const db = client.db();
  const now = new Date();
  await db.collection<AgentJob>('monitor_agent_jobs').updateOne(
    { host, type, status: 'pending' },
    { $set: { host, type, status: 'pending' }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
}

// Chamado pela rota autenticada quando o agente vem buscar. Marca como
// 'sent' pra nao entregar de novo no ciclo seguinte enquanto executa.
export async function takePendingJobs(hostName: string) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<AgentJob>('monitor_agent_jobs');

  const jobs = await col.find({ host, status: 'pending' }).limit(10).toArray();
  if (jobs.length) {
    await col.updateMany(
      { _id: { $in: jobs.map((j) => j._id) } },
      { $set: { status: 'sent', sentAt: new Date() } }
    );
  }
  // Os parametros PRECISAM sair daqui: sem isto o agente recebe um job de
  // build sem repo/imageBase e desiste na primeira linha. Passou batido no
  // teste manual porque la o job foi escrito a mao.
  //
  // Campo ausente nao vira chave vazia -- o recorte do lado do agente e'
  // fragil e nao ha motivo pra engordar o payload.
  return jobs.map((j) => ({
    id: j._id.toString(),
    type: j.type,
    ...(j.repo ? { repo: j.repo } : {}),
    ...(j.imageBase ? { imageBase: j.imageBase } : {}),
    ...(j.ref ? { ref: j.ref } : {}),
    ...(j.repos ? { repos: j.repos } : {}),
  }));
}

// Jobs que ficaram 'sent' sem resposta viram 'pending' de novo: se o host
// reiniciou no meio da execucao, o job se perderia pra sempre.
async function requeueStaleJobs(db: Db, host: string) {
  const limite = new Date(Date.now() - 10 * 60 * 1000);
  await db
    .collection<AgentJob>('monitor_agent_jobs')
    .updateMany({ host, status: 'sent', sentAt: { $lt: limite } }, { $set: { status: 'pending' } });
}

// Sem exclusividade, ao contrario do backupRunner: dois hosts de producao
// nao brigam entre si -- cada um inventaria a propria stack.
export async function setDeployTarget(hostName: string, enabled: boolean) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { deployTarget: { enabled }, updatedAt: new Date() } });
}

export async function setBackupRunner(hostName: string, enabled: boolean, snapshotRoot?: string) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<MonitorHost>('monitor_hosts');
  // So um runner por vez: marcar este desmarca os outros, senao dois hosts
  // fariam o mesmo backup em paralelo, brigando pelos mesmos tuneis.
  if (enabled) await col.updateMany({ name: { $ne: host } }, { $set: { 'backupRunner.enabled': false } });
  await col.updateOne(
    { name: host },
    { $set: { backupRunner: { enabled, snapshotRoot: snapshotRoot || undefined }, updatedAt: new Date() } }
  );
}

export async function setTunnelPort(hostName: string, port: number) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { tunnelPort: port, updatedAt: new Date() } });
}

export async function getMonitorHost(hostName: string) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  const doc = await db
    .collection<MonitorHost>('monitor_hosts')
    .findOne({ name: host }, { projection: { tokenHash: 0 } });
  if (!doc) return null;

  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000);
  return {
    ...doc,
    _id: doc._id.toString(),
    status: doc.lastSeen && doc.lastSeen > staleCutoff ? doc.status || 'ok' : 'down',
    lastSeen: doc.lastSeen?.toISOString(),
    updatedAt: doc.updatedAt?.toISOString(),
    createdAt: doc.createdAt?.toISOString(),
    info: doc.info ? { text: doc.info.text, collectedAt: doc.info.collectedAt?.toISOString() } : undefined,
  };
}

export async function setMonitoringConfig(
  hostName: string,
  config: {
    enabled?: boolean;
    diskThresholdPct?: number;
    memoryThresholdPct?: number;
    cpuThresholdPct?: number;
  }
) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { monitoring: config, updatedAt: new Date() } });

  // Desligar tem que fechar o que ja esta aberto. Sem isto, um incidente
  // aberto ficaria "open" pra sempre: quem resolve e' o proximo heartbeat
  // dentro do limite, e com os alertas desligados esse caminho nao roda
  // mais -- o host apareceria eternamente com alerta na tela.
  if (!config.enabled) {
    for (const key of [`disk:${host}`, `mem:${host}`, `cpu:${host}`, `down:${host}`]) {
      await resolveIncident(db, key, false);
    }
  }
}

export async function setBackupConfig(hostName: string, config: MonitorHost['backup']) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { backup: config, updatedAt: new Date() } });
}

export async function setHostRole(hostName: string, role: MonitorHost['role']) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { role, updatedAt: new Date() } });
}

export async function setFirewallConfig(hostName: string, config: MonitorHost['firewall']) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { firewall: config, updatedAt: new Date() } });
}

const TUNNEL_RELAY_HOST = process.env.TUNNEL_RELAY_HOST || 'us.rcaldas.com';
const DIRECT_SSH_PORT = Number(process.env.DIRECT_SSH_PORT || 8422);

// Monta o plano que o runner executa. E aqui que "o sistema resolve as
// questoes de acesso": o Monitor sabe quem tem tunel e em que porta, entao
// traduz isso pra como o rsnapshot deve alcancar cada host.
//
// Host atras de NAT: vai pelo relay, na porta do tunel dele.
// Host com IP proprio e porta aberta (o us): direto na 8422.
// O runner entra na propria lista tambem, se tiver includes -- por
// loopback (ver isSelf abaixo), nunca pelo relay.
export async function getBackupPlan(runnerHost: string): Promise<BackupPlanEntry[]> {
  const runner = normalizeHostName(runnerHost);
  const client = await clientPromise;
  const db = client.db();

  const hosts = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({ 'backup.enabled': true }, { projection: { tokenHash: 0 } })
    .sort({ name: 1 })
    .toArray();

  return hosts
    .filter((h) => (h.backup?.includes?.length ?? 0) > 0)
    .map((h) => {
      // O runner pode fazer backup de si mesmo: nesse caso vai por
      // loopback, nunca pelo relay -- SSH em si mesmo atraves do
      // us.rcaldas.com so funcionaria se o runner tivesse tunel reverso
      // pra si proprio, o que nao existe e nao precisa existir. E mais
      // simples e nao depende de rede/tunel pra uma operacao que e local.
      const isSelf = h.name === runner;
      const viaTunnel = Boolean(h.tunnelEnabled && h.tunnelPort);
      return {
        host: h.name,
        sshHost: isSelf ? '127.0.0.1' : TUNNEL_RELAY_HOST,
        sshPort: isSelf ? DIRECT_SSH_PORT : viaTunnel ? (h.tunnelPort as number) : DIRECT_SSH_PORT,
        includes: h.backup?.includes ?? [],
        // Math.max(N, ...) e nao so '??': rsnapshot rejeita retain 0 em
        // QUALQUER nivel ("must be at least 1 or higher") e derruba o
        // cron do host inteiro -- ja aconteceu uma vez com um 0 explicito
        // vindo do form (?? so pega null/undefined, nao 0). Isso aqui e
        // a segunda camada: mesmo que um 0 volte a entrar no banco por
        // outro caminho, o .conf gerado nunca consegue ficar invalido.
        //
        // 'hora' especificamente precisa de pelo menos 2, nao 1 -- e o
        // UNICO nivel que puxa dado de verdade (os de cima so promovem
        // por hardlink o que ja esta aqui), entao com so 1 slot uma nova
        // puxada correria contra o 'dia' ainda nao ter promovido a
        // anterior, perdendo ela. rsnapshot recusa 'hora' com retain 1
        // sempre que existe um nivel acima -- e como aqui sempre existe
        // (dia/semana/mes sao fixos no modelo), o minimo real e' 2.
        // Confirmado testando os dois: 'dia' com retain 1 e' aceito
        // (a trava e' so do PRIMEIRO nivel, nao de todos).
        retention: {
          hora: Math.max(2, h.backup?.retention?.hora ?? 6),
          dia: Math.max(1, h.backup?.retention?.dia ?? 7),
          semana: Math.max(1, h.backup?.retention?.semana ?? 4),
          mes: Math.max(1, h.backup?.retention?.mes ?? 3),
        },
      };
    });
}

export type FirewallPlan = {
  host: string;
  role: 'standard' | 'proxy' | 'home';
  // standard: quem mais a frota conhece hoje (accept, nunca policy/drop).
  knownHostsV4?: string[];
  knownHostsV6?: string[];
  // proxy/home: portas publicas escolhidas pelo admin.
  ports?: PortRule[];
  // qualquer role: portas so pra faixa RFC1918 (ver renderNftablesSuggestion).
  lanPorts?: PortRule[];
  // role 'home': quando a LAN esta definida, a sugestao ganha DHCP/DNS na
  // LAN, forward e NAT.
  lanIface?: string;
  wanIface?: string;
};

function dedupePortRules(rules: PortRule[]): PortRule[] {
  const seen = new Map<string, PortRule>();
  for (const r of rules) seen.set(`${r.proto}:${r.start}-${r.end ?? r.start}`, r);
  return [...seen.values()].sort((a, b) => a.proto.localeCompare(b.proto) || a.start - b.start);
}

// Monta os dados que a sugestao de nftables precisa -- nunca aplica nada,
// so calcula. Ver renderNftablesSuggestion() pra virar texto.
export async function getFirewallPlan(hostName: string): Promise<FirewallPlan | null> {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  const doc = await db.collection<MonitorHost>('monitor_hosts').findOne({ name: host });
  if (!doc) return null;

  const role = doc.role ?? 'standard';
  const lanPorts = dedupePortRules(doc.firewall?.lanPorts ?? []);

  // Relay de tunel: a sugestao pra ele precisa abrir a faixa inteira de
  // portas de tunel da frota, ou um proxy/router novo montado a partir
  // dessa sugestao quebraria o tunel de todo host atras de NAT -- nao e'
  // algo que o admin deveria precisar lembrar de digitar na mao.
  const isTunnelRelay = host === normalizeHostName(TUNNEL_RELAY_HOST.split('.')[0]);

  if (role !== 'standard') {
    const ports = dedupePortRules(doc.firewall?.ports ?? []);
    if (isTunnelRelay) ports.push({ start: TUNNEL_PORT_RANGE_START, end: TUNNEL_PORT_RANGE_END, proto: 'tcp' });
    return {
      host,
      role,
      ports: dedupePortRules(ports),
      lanPorts,
      lanIface: doc.firewall?.lanIface,
      wanIface: doc.firewall?.wanIface,
    };
  }

  const others = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({ name: { $ne: host } }, { projection: { tokenHash: 0 } })
    .toArray();

  // publicIp e' "de onde o servidor viu a conexao chegar" -- desde que o
  // HAProxy aceita IPv6, isso pode vir em qualquer uma das duas familias
  // pro MESMO host (foi assim que achei este bug: tp/bag/lev tem IPv6
  // proprio, entao publicIp deles e' IPv6, nao IPv4). Confiar no NOME do
  // campo pra decidir a familia e' o erro -- classifica pelo FORMATO de
  // verdade, senao um IPv6 cai dentro de "ip saddr" (so aceita IPv4) e o
  // nft rejeita a config inteira na hora de aplicar.
  const v4 = new Set<string>();
  const v6 = new Set<string>();
  for (const h of others) {
    for (const candidate of [h.network?.publicIp, h.network?.ipv4, h.network?.ipv6, h.lastIp]) {
      if (!candidate) continue;
      (candidate.includes(':') ? v6 : v4).add(candidate);
    }
  }
  const knownHostsV4 = [...v4].sort();
  const knownHostsV6 = [...v6].sort();

  return { host, role, knownHostsV4, knownHostsV6, lanPorts };
}

function formatPortRules(rules: PortRule[]): { tcp: string[]; udp: string[] } {
  const tcp: string[] = [];
  const udp: string[] = [];
  for (const r of rules) {
    const token = r.end != null && r.end !== r.start ? `${r.start}-${r.end}` : `${r.start}`;
    (r.proto === 'udp' ? udp : tcp).push(token);
  }
  return { tcp, udp };
}

const LAN_RANGES_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

// Texto puro -- nunca escrito em disco nem aplicado em host nenhum por
// este app. So pra copiar/colar/adaptar na mao. Duas partes claramente
// demarcadas: um esqueleto completo (serve de ponto de partida pra host
// sem nftables ainda) e o trecho especifico do papel (serve pra colar
// dentro de um nftables ja existente, sem tocar no resto dele).
// Um `set` so' aparece se tiver conteudo: `elements = { }` vazio e erro de
// sintaxe no nft, e um set declarado sem elementos e' ruido no arquivo.
function renderSet(nome: string, tipo: string, elementos: string[], comentario?: string): string {
  if (!elementos.length) return '';
  const cab = comentario ? `\t\t# ${comentario}\n` : '';
  return `${cab}\t\tset ${nome} {
\t\t\ttype ${tipo}
\t\t\tflags interval
\t\t\telements = { ${elementos.join(', ')} }
\t\t}
`;
}

export function renderNftablesSuggestion(plan: FirewallPlan): string {
  const sets: string[] = [];
  const regras: string[] = [];

  if (plan.role === 'standard') {
    const v4 = plan.knownHostsV4 ?? [];
    const v6 = plan.knownHostsV6 ?? [];
    sets.push(renderSet('hosts_conhecidos', 'ipv4_addr', v4, 'outros hosts da frota'));
    sets.push(renderSet('hosts_conhecidos_v6', 'ipv6_addr', v6));
    if (v4.length) regras.push('ip saddr @hosts_conhecidos accept');
    if (v6.length) regras.push('ip6 saddr @hosts_conhecidos_v6 accept');
    if (!v4.length && !v6.length) regras.push('# nenhum outro host conhecido ainda -- so SSH e loopback liberados');
  } else {
    const { tcp, udp } = formatPortRules(plan.ports ?? []);
    sets.push(renderSet('portas_tcp', 'inet_service', tcp, 'portas publicas deste papel'));
    sets.push(renderSet('portas_udp', 'inet_service', udp));
    if (tcp.length) regras.push('tcp dport @portas_tcp accept');
    if (udp.length) regras.push('udp dport @portas_udp accept');
    if (!tcp.length && !udp.length) regras.push('# nenhuma porta publica configurada ainda');
  }

  const lanRules = plan.lanPorts ?? [];
  if (lanRules.length) {
    const { tcp, udp } = formatPortRules(lanRules);
    sets.push(renderSet('portas_lan_tcp', 'inet_service', tcp, 'so alcancaveis de dentro da LAN'));
    sets.push(renderSet('portas_lan_udp', 'inet_service', udp));
    // Ficam como regra e nao entram nos sets acima porque carregam o
    // qualificador de origem -- set guarda valor, nao condicao.
    const lanNets = LAN_RANGES_V4.join(', ');
    if (tcp.length) regras.push(`ip saddr { ${lanNets} } tcp dport @portas_lan_tcp accept`);
    if (udp.length) regras.push(`ip saddr { ${lanNets} } udp dport @portas_lan_udp accept`);
  }

  // Router (role 'home'): DHCP e DNS na interface LAN.
  //
  // ESTA E' A REGRA QUE, FALTANDO, CUSTOU UMA DEPURACAO INTEIRA: com a
  // policy 'drop' da chain input, o DHCPDISCOVER do cliente novo morre
  // ANTES do dnsmasq ver. Nao aparece erro no dnsmasq nem no tcpdump do
  // container -- so' comparando o que chega na interface com o que o
  // firewall deixa passar.
  //
  // Tem que estar DENTRO da chain input principal. Um `accept` numa tabela
  // separada nao resolve: com duas base chains no mesmo hook, um `drop` em
  // qualquer uma e' terminal e o `accept` da outra NAO resgata o pacote
  // (verificado em netns).
  const ehRouter = plan.role === 'home' && !!plan.lanIface;
  if (ehRouter) {
    regras.push(`# Regras da LAN vivem em chain propria (ver os drop-ins).`);
    regras.push(`jump home_lan_input`);
  }

  // Chains VAZIAS + jump: este arquivo cria so' a ESTRUTURA; o conteudo
  // vem dos drop-ins (ver renderRouterDropins).
  //
  // E' o que torna a ativacao barata. Uma vez que a chain existe e o jump
  // aponta pra ela, toda mudanca de regra vira `nft -f` no drop-in --
  // atomico, isolado, sem `flush ruleset`. Sem isso, cada ajuste exigiria
  // recarregar este arquivo, que apaga as regras do Docker e do fail2ban
  // junto -- e o fail2ban falha calado.
  const chainsRouter: string[] = [];
  if (ehRouter) {
    chainsRouter.push('\tchain home_lan_input {', '\t}');
    if (plan.wanIface) chainsRouter.push('\tchain home_lan_forward {', '\t}');
  }
  const blocoChainsRouter = chainsRouter.length ? chainsRouter.join('\n') + '\n' : '';

  const blocoSets = sets.filter(Boolean).join('\n');

  // Forward do router. A chain continua com policy ACCEPT -- ver o
  // comentario dela no template. Default-deny aqui exigiria aceitar
  // explicitamente as pontes do Docker (docker0, br-*), e um esquecimento
  // derruba a rede de todo container do host.
  const linhasForward: string[] = [];
  if (ehRouter && plan.wanIface) {
    linhasForward.push(`\t\tjump home_lan_forward`);
  }
  const blocoForward = linhasForward.length ? `\n${linhasForward.join('\n')}\n` : '';

  // NAT em tabela propria e' seguro: o hook nat postrouting nao tem
  // 'drop' competindo, entao coexistir com a tabela do Docker nao derruba
  // trafego (ao contrario do hook filter).
  // O include vem DEPOIS do bloco que declara as chains, e a ordem nao e'
  // estetica: antes, o `flush chain` do drop-in nao acha o alvo e o nft
  // aborta a carga inteira com "No such file or directory; did you mean
  // chain 'home_lan_input'?". Erro duro, felizmente, nao silencioso.
  //
  // Glob com prefixo `home-` de proposito: o diretorio pode conter
  // drop-ins de outra convencao (statements soltos pra viver DENTRO de uma
  // chain), e misturar os dois formatos quebra na primeira carga.
  const blocoInclude = ehRouter ? '\ninclude "/etc/nftables.d/home-*.conf"\n' : '';

  const blocoNat =
    plan.role === 'home' && plan.wanIface
      ? `
# Mascaramento da LAN saindo pela WAN. Tabela separada de proposito: da'
# pra recarregar so' ela sem tocar no resto.
#
# O Docker tambem registra um nat postrouting. Coexistem, mas se o
# masquerade se comportar de forma estranha, conferir a ordem dos dois.
table ip router_nat {
\tchain postrouting {
\t\ttype nat hook postrouting priority srcnat; policy accept;
\t\toifname "${plan.wanIface}" masquerade
\t}
}
`
      : '';

  return `#!/usr/sbin/nft -f
# Sugestao gerada pelo Monitor pro host "${plan.host}" (papel: ${plan.role}).
# So sugestao -- nada aqui e aplicado automaticamente em lugar nenhum.
# Cole/adapte na mao no /etc/nftables.conf do host.
#
# ============================================================
# ANTES DE RECARREGAR ISTO NUM HOST QUE RODA DOCKER, LEIA:
# ============================================================
# O 'flush ruleset' abaixo apaga o ruleset INTEIRO. Se o host usa
# iptables-nft (o padrao no Debian atual), as regras do Docker e do
# fail2ban moram no mesmo lugar e vao junto. Depois de um reload:
#
#   - os containers ficam inalcancaveis de fora (o NAT das portas
#     publicadas some);
#   - os bans do fail2ban param de valer EM SILENCIO -- o ipset continua
#     existindo, so' que sem nenhuma regra consultando.
#
# O segundo e' o perigoso, porque nada quebra de forma visivel: a
# protecao simplesmente deixa de existir. Aconteceu no 'us' e passou
# despercebido por dias (24.563 falhas registradas contra 8 bans).
#
# Depois de qualquer reload, NESTA ORDEM:
#   systemctl restart docker     # recria a chain DOCKER-USER
#   systemctl restart fail2ban   # reinsere as regras DENTRO dela
# Confira com: ipset list | grep -A2 '^Name: f2b-'
# Se algum aparecer com 'References: 0', o ban daquela jail nao vale nada.
#
# MELHOR: no dia a dia NAO recarregue este arquivo. Os conjuntos abaixo
# tem nome, e set nomeado se altera a quente, sem flush e sem risco:
#
#   nft add element inet filter portas_tcp { 8080 }
#   nft delete element inet filter portas_tcp { 8080 }
#
# Depois so' espelhe a mudanca aqui, pra sobreviver ao boot.

flush ruleset

table inet filter {
${blocoSets}${blocoChainsRouter}
\tchain input {
\t\ttype filter hook input priority filter; policy drop;

\t\tiifname "lo" accept

\t\t# Cedo de proposito: a maioria esmagadora dos pacotes de uma conexao
\t\t# ja estabelecida casa aqui e nao percorre o resto da chain.
\t\tct state established,related accept
\t\tct state invalid drop

\t\t# ICMP/ICMPv6 essenciais (RFC 4890) -- sem isso o NDP quebra e o
\t\t# IPv6 fica morto.
\t\ticmp type { destination-unreachable, time-exceeded, parameter-problem, echo-request, echo-reply } accept
\t\ticmpv6 type {
\t\t\tdestination-unreachable, packet-too-big,
\t\t\ttime-exceeded, parameter-problem,
\t\t\techo-request, echo-reply,
\t\t\tnd-router-solicit, nd-router-advert,
\t\t\tnd-neighbor-solicit, nd-neighbor-advert
\t\t} accept

\t\t# SSH da frota. Fora de qualquer set pra nunca depender de um
\t\t# elemento que alguem possa remover a quente sem perceber.
\t\ttcp dport 8422 accept

\t\t# --- regras do papel: cole so este trecho se ja tiver nftables ---
${regras.map((l) => `\t\t${l}`).join('\n')}
\t\t# --- fim das regras do papel ---

\t\t# Contador = CENSO do que e' dropado; o log abaixo e' AMOSTRA (tem
\t\t# limite). Pra "quantos pacotes?" olhe o contador; pra "o que
\t\t# exatamente esta chegando?" olhe o log.
\t\tcounter comment "total unfiltered input packets"

\t\t# Limite obrigatorio: sem ele um scan enche o disco. Com ele, o log
\t\t# vira uma amostra util -- foi assim que se descobriu no 'us' que
\t\t# 51% do trafego dropado era um cliente legitimo batendo numa porta
\t\t# fechada por engano, nao ataque.
\t\t# As linhas aparecem no journal (tag kernel) e sobem pro Loki
\t\t# sozinhas, ja que o agente encaminha o syslog do host.
\t\tlimit rate 60/minute burst 20 packets log prefix "LIMBO: "
\t}

\tchain forward {
\t\t# accept, nao drop: host rodando Docker roteia trafego dos proprios
\t\t# containers por aqui -- um forward:drop quebra a rede de todo
\t\t# container, mesmo com as regras do Docker corretas.
\t\t#
\t\t# Isso vale MESMO num router. Verificado em netns: com duas base
\t\t# chains no mesmo hook, um 'drop' em qualquer uma e' terminal --
\t\t# entao uma tabela extra com policy drop derrubaria o Docker daqui.
\t\ttype filter hook forward priority filter; policy accept;${blocoForward}\t}

\tchain output {
\t\ttype filter hook output priority filter; policy accept;
\t}
}
${blocoNat}${blocoInclude}`;
}

// Drop-ins da role home (router). Mesmo formato que o
// home/router/provision-router-role.sh gera e consome -- o que a pagina
// do host sugere e o que o script aplica sao literalmente iguais.
//
// Cada arquivo e' AUTOCONTIDO e idempotente: zera a propria chain e
// repovoa, numa transacao so'. Serve aos dois caminhos sem intermediario:
//
//   update a quente:  nft -f /etc/nftables.d/home-lan-input.conf
//   boot:             include "/etc/nftables.d/home-*.conf"
//
// O que NAO tem aqui e' tao importante quanto o que tem: nenhum
// `flush ruleset`. E' por isso que atualizar regra deixou de arriscar as
// regras do Docker e do fail2ban, que vivem no mesmo ruleset (o iptables
// destes hosts e' nf_tables).
export function renderRouterDropins(plan: FirewallPlan): { path: string; content: string }[] {
  if (plan.role !== 'home' || !plan.lanIface) return [];
  const lan = plan.lanIface;
  const arquivos: { path: string; content: string }[] = [];

  arquivos.push({
    path: '/etc/nftables.d/home-lan-input.conf',
    content: `# Gerado pelo Monitor para "${plan.host}". Idempotente.
# Aplicar: nft -f /etc/nftables.d/home-lan-input.conf
#
# Sem esta liberacao, a policy drop da chain input descarta o
# DHCPDISCOVER do cliente novo ANTES do dnsmasq ver -- sem erro no
# dnsmasq e sem nada no tcpdump do container. So' aparece comparando o
# que chega na interface com o que o firewall deixa passar.
flush chain inet filter home_lan_input
add rule inet filter home_lan_input iifname "${lan}" udp dport { 67, 53 } accept
add rule inet filter home_lan_input iifname "${lan}" tcp dport 53 accept
`,
  });

  if (plan.wanIface) {
    arquivos.push({
      path: '/etc/nftables.d/home-lan-forward.conf',
      content: `# Gerado pelo Monitor para "${plan.host}". Idempotente.
# Aplicar: nft -f /etc/nftables.d/home-lan-forward.conf
#
# A chain forward de base continua com policy ACCEPT. Default-deny ali
# derrubaria o trafego dos containers do proprio host: com duas base
# chains no mesmo hook, um drop em qualquer uma e' terminal.
flush chain inet filter home_lan_forward
add rule inet filter home_lan_forward ct state established,related accept
add rule inet filter home_lan_forward iifname "${lan}" oifname "${plan.wanIface}" accept
`,
    });
  }

  return arquivos;
}

export async function createHost(hostName: string, options: { ddnsEnabled: boolean; tunnelEnabled: boolean }) {
  const host = normalizeHostName(hostName);
  if (!host) throw new Error('nome de host invalido');

  const now = new Date();
  const client = await clientPromise;
  const db = client.db();
  await db.collection<MonitorHost>('monitor_hosts').updateOne(
    { name: host },
    {
      $set: {
        name: host,
        ddnsEnabled: options.ddnsEnabled,
        tunnelEnabled: options.tunnelEnabled,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now, status: 'unknown' },
    },
    { upsert: true }
  );
}

export async function deleteHost(hostName: string) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await Promise.all([
    db.collection<MonitorHost>('monitor_hosts').deleteOne({ name: host }),
    db.collection('monitor_agent_jobs').deleteMany({ host }),
    db.collection('monitor_results').deleteMany({ host }),
  ]);
}

export async function getMonitorOverview() {
  const client = await clientPromise;
  const db = client.db();
  const now = Date.now();
  const staleCutoff = new Date(now - 2 * 60 * 1000);

  // Nome, nao lastSeen -- lastSeen muda a cada heartbeat (ate a cada 60s
  // pros hosts ativos), entao ordenar por ele faz a lista embaralhar
  // sozinha o tempo todo, inclusive entre o clique num botao e a pagina
  // re-renderizar. Nome mantem a posicao estavel independente disso.
  const hosts = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({}, { projection: { tokenHash: 0 } })
    .sort({ name: 1 })
    .limit(100)
    .toArray();

  const incidents = await db
    .collection<MonitorIncident>('monitor_incidents')
    .find({ status: 'open' })
    .sort({ severity: 1, updatedAt: -1 })
    .limit(20)
    .toArray();

  const mailEvents = await db
    .collection<MonitorMailEvent>('monitor_mail_events')
    .find({})
    .sort({ ts: -1 })
    .limit(20)
    .toArray();

  // Online primeiro, offline depois -- online/offline e computado aqui, nao
  // vem do banco, entao esse agrupamento so da pra fazer depois do find, nao
  // no sort do Mongo. Dentro de cada grupo o criterio muda:
  // - online: por nome, ordem fixa. lastSeen muda a cada heartbeat (ate a
  //   cada 60s pros hosts ativos), entao ordenar por ele faria a lista
  //   embaralhar sozinha o tempo todo, inclusive entre o clique num botao
  //   e a pagina re-renderizar.
  // - offline: por lastSeen decrescente. Aqui o problema oposto: por nome,
  //   um host caido ha meses fica misturado com um que caiu agora. Nao
  //   embaralha feito o caso online porque um host offline, por definicao,
  //   nao esta gerando heartbeat novo -- lastSeen so muda quando ele volta,
  //   e ai sai desse grupo. Nunca visto (sem lastSeen) vai pro final.
  const hostRows = hosts
    .map((host) => ({
      ...host,
      _id: host._id.toString(),
      status: host.lastSeen && host.lastSeen > staleCutoff ? host.status || 'ok' : 'down',
      lastSeen: host.lastSeen?.toISOString(),
      updatedAt: host.updatedAt?.toISOString(),
      createdAt: host.createdAt?.toISOString(),
    }))
    .sort((a, b) => {
      const aDown = a.status === 'down' ? 1 : 0;
      const bDown = b.status === 'down' ? 1 : 0;
      if (aDown !== bDown) return aDown - bDown;
      if (!aDown) return a.name.localeCompare(b.name);
      const aTime = a.lastSeen ? new Date(a.lastSeen).getTime() : -Infinity;
      const bTime = b.lastSeen ? new Date(b.lastSeen).getTime() : -Infinity;
      return bTime - aTime;
    });

  return {
    counts: {
      hosts: hostRows.length,
      online: hostRows.filter((host) => host.status === 'ok').length,
      down: hostRows.filter((host) => host.status === 'down').length,
      incidents: incidents.length,
    },
    hosts: hostRows,
    incidents: incidents.map((incident) => ({
      ...incident,
      _id: incident._id.toString(),
      openedAt: incident.openedAt?.toISOString(),
      updatedAt: incident.updatedAt?.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString(),
    })),
    mailEvents: mailEvents.map((event) => ({
      ...event,
      _id: event._id.toString(),
      ts: serializeDate(event.ts),
    })),
  };
}

export type TunnelKeyRequest = {
  _id: ObjectId;
  host: string;
  publicKey: string;
  approveToken: string;
  status: 'pending' | 'approved';
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
};

// /var/zxnet e o home do usuario dedicado no relay (`us`) que so serve pra
// receber tuneis reversos -- nunca o usuario "rcaldas" normal. O container
// web precisa desse diretorio montado com escrita (ver docker-compose.prod.yml)
// so pra poder gravar authorized_keys apos aprovacao.
const ZXNET_SSH_DIR = process.env.ZXNET_SSH_DIR || '/var/zxnet/.ssh';

// Chamado pelo /init de um host novo (ensure_root_key), com a chave publica
// de root recem-gerada. Nao confia direto -- so cria o pedido e manda um
// email pro admin aprovar; a chave so vira valida em authorized_keys depois
// do clique em approveTunnelKey. Idempotente: se essa exata chave desse
// host ja foi aprovada antes, nao reenvia nada.
export async function requestTunnelKeyApproval(hostName: string, publicKey: string) {
  const host = normalizeHostName(hostName);
  const key = publicKey.trim();
  if (!host || !key) return;

  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<TunnelKeyRequest>('monitor_tunnel_key_requests');

  const existing = await col.findOne({ host, publicKey: key });
  if (existing?.status === 'approved') return;

  const now = new Date();
  const approveToken = crypto.randomBytes(24).toString('base64url');

  await col.updateOne(
    { host, publicKey: key },
    { $set: { host, publicKey: key, approveToken, status: 'pending', updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );

  await sendTunnelKeyApprovalEmail(host, key, approveToken);
}

// authorized_keys precisa ficar dono=zxnet, modo 600 (sem escrita de grupo
// nem "outros") ou o sshd recusa TODAS as chaves ali dentro via StrictModes
// -- ja quebrou producao uma vez essa noite tentando deixar o container
// escrever direto nele. Em vez disso o container so deixa a chave pronta
// (ja com o prefixo restrict,port-forwarding) num diretorio "pendentes" que
// ele mesmo pode possuir; um cron no host, rodando como root, e quem
// efetivamente funde no authorized_keys de verdade com a permissao certa.
const PENDING_KEYS_DIR = process.env.ZXNET_PENDING_KEYS_DIR || path.join(ZXNET_SSH_DIR, 'pending-keys');

// Confirma um pedido pendente: deixa a chave pronta pro cron do host
// aplicar, restrita a so abrir tuneis (nada de shell, X11, agent
// forwarding -- essa chave nao serve pra logar no relay, so pra fazer -R).
// So chamado a partir do POST da pagina de confirmacao, nunca do GET direto
// (scanners de seguranca de email costumam pre-visitar links).
export async function approveTunnelKey(token: string): Promise<{ ok: boolean; host?: string; error?: string }> {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection<TunnelKeyRequest>('monitor_tunnel_key_requests');

  const request = await col.findOne({ approveToken: token });
  if (!request) return { ok: false, error: 'token invalido' };
  if (request.status === 'approved') return { ok: true, host: request.host };

  const line = `restrict,port-forwarding ${request.publicKey} # ${request.host}, aprovado ${new Date().toISOString()}\n`;
  fs.mkdirSync(PENDING_KEYS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(PENDING_KEYS_DIR, `${request.host}-${request._id}.pub`), line, { mode: 0o600 });

  await col.updateOne({ _id: request._id }, { $set: { status: 'approved', approvedAt: new Date() } });
  return { ok: true, host: request.host };
}

export async function getTunnelKeyRequest(token: string) {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<TunnelKeyRequest>('monitor_tunnel_key_requests').findOne({ approveToken: token });
}
