import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Db, ObjectId } from 'mongodb';
import clientPromise from './mongodb';
import { sendTunnelKeyApprovalEmail, sendIncidentEmail } from './email';

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
    diskThresholdPct?: number;
    memoryThresholdPct?: number;
    // Em unidade de nucleo (100% = 1 nucleo), pra bater com o que o
    // provedor mostra. A janela aqui e de ~60s contra as 2h da Linode.
    cpuThresholdPct?: number;
  };
  // O que copiar deste host. A execucao continua local no runner
  // (rsnapshot), isso aqui e a fonte da verdade que gera a config dele --
  // mesmo formato que os .bkp escritos a mao usam hoje.
  backup?: {
    enabled?: boolean;
    // Varios diretorios, cada um com seus proprios excludes.
    includes?: { path: string; excludes?: string[] }[];
    // Mesmos intervalos do rsnapshot atual (hora/dia/semana/mes).
    retention?: { hora?: number; dia?: number; semana?: number; mes?: number };
  };
  // Marca este host como o que EXECUTA os backups da frota. So um por vez;
  // trocar e marcar outro e rodar o setup nele.
  backupRunner?: {
    enabled?: boolean;
    snapshotRoot?: string;
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
  includes: { path: string; excludes?: string[] }[];
  retention: { hora: number; dia: number; semana: number; mes: number };
};

export type MonitorIncident = {
  _id: ObjectId;
  key: string;
  target: string;
  status: 'open' | 'resolved';
  severity: 'info' | 'warning' | 'critical';
  summary: string;
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
  }
) {
  const now = new Date();
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
      detail: params.detail,
      resolved: false,
    });
  } catch (error) {
    console.error('incident email failed:', error);
  }
}

async function resolveIncident(db: Db, key: string) {
  const open = await db.collection<MonitorIncident>('monitor_incidents').find({ key, status: 'open' }).toArray();
  if (!open.length) return;

  await db
    .collection<MonitorIncident>('monitor_incidents')
    .updateMany({ key, status: 'open' }, { $set: { status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() } });

  for (const incident of open) {
    try {
      await sendIncidentEmail({
        host: incident.target,
        severity: incident.severity,
        summary: incident.summary,
        resolved: true,
      });
    } catch (error) {
      console.error('incident resolved email failed:', error);
    }
  }
}

// So faz alguma coisa se o admin configurou um limite pra esse host na
// pagina de detalhe (MonitorHost.monitoring) -- sem config, e um no-op.
// Abre/atualiza um incidente quando cruza o limite, resolve sozinho no
// primeiro heartbeat de volta abaixo dele.
async function checkMonitoringThresholds(db: Db, host: string, existing: MonitorHost | null, system?: HeartbeatPayload['system']) {
  const cfg = existing?.monitoring;
  if (!cfg || !system) return;

  if (cfg.diskThresholdPct != null) {
    const pct = Math.max(system.diskRootPct ?? 0, system.diskVarPct ?? 0, system.diskVarLogPct ?? 0);
    const key = `disk:${host}`;
    if (pct >= cfg.diskThresholdPct) {
      await upsertIncident(db, {
        key,
        target: host,
        severity: pct >= cfg.diskThresholdPct + 10 ? 'critical' : 'warning',
        summary: `Disco em ${pct}% (limite ${cfg.diskThresholdPct}%)`,
      });
    } else {
      await resolveIncident(db, key);
    }
  }

  if (cfg.memoryThresholdPct != null && system.memoryPct != null) {
    const key = `mem:${host}`;
    if (system.memoryPct >= cfg.memoryThresholdPct) {
      await upsertIncident(db, {
        key,
        target: host,
        severity: system.memoryPct >= cfg.memoryThresholdPct + 10 ? 'critical' : 'warning',
        summary: `Memoria em ${system.memoryPct}% (limite ${cfg.memoryThresholdPct}%)`,
      });
    } else {
      await resolveIncident(db, key);
    }
  }

  if (cfg.cpuThresholdPct != null && system.cpuPct != null) {
    const key = `cpu:${host}`;
    if (system.cpuPct >= cfg.cpuThresholdPct) {
      const cores = system.cpuCount ? ` de ${system.cpuCount * 100}%` : '';
      await upsertIncident(db, {
        key,
        target: host,
        severity: system.cpuPct >= cfg.cpuThresholdPct + 20 ? 'critical' : 'warning',
        summary: `CPU em ${system.cpuPct}%${cores} (limite ${cfg.cpuThresholdPct}%)`,
        // Isso e o que o alerta do provedor nao entrega: quem esta comendo CPU.
        detail: system.topCpu ? `Processos no topo: ${system.topCpu}` : undefined,
      });
    } else {
      await resolveIncident(db, key);
    }
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

  await checkMonitoringThresholds(db, host, existing, payload.system);

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

const TUNNEL_PORT_RANGE_START = 7701;

async function nextTunnelPort(db: Db, excludeHost: string) {
  const used = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({ tunnelPort: { $exists: true }, name: { $ne: excludeHost } }, { projection: { tunnelPort: 1 } })
    .toArray();
  const usedPorts = new Set(used.map((h) => h.tunnelPort));
  let port = TUNNEL_PORT_RANGE_START;
  while (usedPorts.has(port)) port++;
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
  };
}

export async function setMonitoringConfig(
  hostName: string,
  config: { diskThresholdPct?: number; memoryThresholdPct?: number; cpuThresholdPct?: number }
) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { monitoring: config, updatedAt: new Date() } });
}

export async function setBackupConfig(hostName: string, config: MonitorHost['backup']) {
  const host = normalizeHostName(hostName);
  const client = await clientPromise;
  const db = client.db();
  await db
    .collection<MonitorHost>('monitor_hosts')
    .updateOne({ name: host }, { $set: { backup: config, updatedAt: new Date() } });
}

const TUNNEL_RELAY_HOST = process.env.TUNNEL_RELAY_HOST || 'us.rcaldas.com';
const DIRECT_SSH_PORT = Number(process.env.DIRECT_SSH_PORT || 8422);

// Monta o plano que o runner executa. E aqui que "o sistema resolve as
// questoes de acesso": o Monitor sabe quem tem tunel e em que porta, entao
// traduz isso pra como o rsnapshot deve alcancar cada host.
//
// Host atras de NAT: vai pelo relay, na porta do tunel dele.
// Host com IP proprio e porta aberta (o us): direto na 8422.
// Quem faz o backup nao entra no proprio plano.
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
    .filter((h) => h.name !== runner && (h.backup?.includes?.length ?? 0) > 0)
    .map((h) => {
      const viaTunnel = Boolean(h.tunnelEnabled && h.tunnelPort);
      return {
        host: h.name,
        sshHost: TUNNEL_RELAY_HOST,
        sshPort: viaTunnel ? (h.tunnelPort as number) : DIRECT_SSH_PORT,
        includes: h.backup?.includes ?? [],
        retention: {
          hora: h.backup?.retention?.hora ?? 6,
          dia: h.backup?.retention?.dia ?? 7,
          semana: h.backup?.retention?.semana ?? 4,
          mes: h.backup?.retention?.mes ?? 3,
        },
      };
    });
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

  // Online primeiro, offline depois (cada grupo por nome) -- online/offline
  // e computado aqui, nao vem do banco, entao esse agrupamento so da pra
  // fazer depois do find, nao no sort do Mongo.
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
      return aDown - bDown || a.name.localeCompare(b.name);
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
