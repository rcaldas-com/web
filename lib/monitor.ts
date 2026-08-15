import crypto from 'crypto';
import { Db, ObjectId } from 'mongodb';
import clientPromise from './mongodb';

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
    diskRootPct?: number;
    diskVarPct?: number | null;
    diskVarLogPct?: number | null;
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

export type AgentJob = {
  _id?: ObjectId;
  host: string;
  type: string;
  status: 'pending' | 'sent' | 'done' | 'expired';
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
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
  const jobs = db.collection<AgentJob>('monitor_agent_jobs');
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

  if (payload.results?.length) {
    await results.insertMany(
      payload.results.map((result) => ({
        ...result,
        host,
        receivedAt: now,
      }))
    );

    const jobIds = payload.results
      .map((result) => result.id)
      .filter((id): id is string => Boolean(id));
    if (jobIds.length) {
      await jobs.updateMany(
        { _id: { $in: jobIds.map((id) => new ObjectId(id)) }, host },
        { $set: { status: 'done', updatedAt: now } }
      );
    }
  }

  const pendingJobs = await jobs
    .find({ host, status: 'pending', expiresAt: { $gt: now } })
    .sort({ createdAt: 1 })
    .limit(5)
    .toArray();

  if (pendingJobs.length) {
    await jobs.updateMany(
      { _id: { $in: pendingJobs.map((job) => job._id).filter(Boolean) as ObjectId[] } },
      { $set: { status: 'sent', updatedAt: now } }
    );
  }

  return {
    ok: true,
    status: 200,
    host,
    token: existing?.tokenHash ? undefined : nextToken,
    nextIntervalSec: 60,
    tunnel: payload.tunnel?.enabled ? payload.tunnel : undefined,
    jobs: pendingJobs.map((job) => ({
      id: job._id?.toString(),
      type: job.type,
      ...job.payload,
    })),
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

async function insertTunnelJob(db: Db, host: string, port: number) {
  const now = new Date();
  await db.collection<AgentJob>('monitor_agent_jobs').insertOne({
    host,
    type: 'tunnel',
    status: 'pending',
    payload: { port },
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 2 * 60 * 1000),
  });
}

// Habilita o tunel (se ainda nao estava), atribui a proxima porta livre a
// partir de TUNNEL_PORT_RANGE_START se o host ainda nao tiver uma, e ja
// dispara o pedido -- um clique so, sem exigir digitar porta antes.
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

  await insertTunnelJob(db, host, port);
  return port;
}

// Ponte de compatibilidade com o zxnet antigo: GET /ping?host=X esperando de
// volta "0" (matar tunel), ou um numero de porta >1024 (abrir/manter tunel
// nessa porta). Cada host que ainda pinga vira/atualiza um host normal em
// monitor_hosts (aparece no Monitor como qualquer outro), so que marcado via
// capabilities pra indicar que so fala esse protocolo velho, sem heartbeat
// completo. So define tunnelEnabled/porta na primeira vez que o host aparece
// -- pings seguintes nao sobrescrevem o que o admin decidir depois no Monitor.
export async function registerLegacyPing(hostName: string): Promise<number> {
  const host = normalizeHostName(hostName);
  if (!host) return 0;

  const client = await clientPromise;
  const db = client.db();
  const now = new Date();

  const existing = await db.collection<MonitorHost>('monitor_hosts').findOne({ name: host });
  const port = existing?.tunnelPort ?? (await nextTunnelPort(db, host));
  const tunnelEnabled = existing?.tunnelEnabled ?? true;

  await db.collection<MonitorHost>('monitor_hosts').updateOne(
    { name: host },
    {
      $set: {
        name: host,
        status: 'ok',
        lastSeen: now,
        updatedAt: now,
        tunnelPort: port,
        capabilities: ['tunnel-legacy'],
      },
      $setOnInsert: { createdAt: now, tunnelEnabled: true },
    },
    { upsert: true }
  );

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
    db.collection<AgentJob>('monitor_agent_jobs').deleteMany({ host }),
    db.collection('monitor_results').deleteMany({ host }),
  ]);
}

export async function getMonitorOverview() {
  const client = await clientPromise;
  const db = client.db();
  const now = Date.now();
  const staleCutoff = new Date(now - 2 * 60 * 1000);

  const hosts = await db
    .collection<MonitorHost>('monitor_hosts')
    .find({}, { projection: { tokenHash: 0 } })
    .sort({ lastSeen: -1 })
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

  const hostRows = hosts.map((host) => ({
    ...host,
    _id: host._id.toString(),
    status: host.lastSeen && host.lastSeen > staleCutoff ? host.status || 'ok' : 'down',
    lastSeen: host.lastSeen?.toISOString(),
    updatedAt: host.updatedAt?.toISOString(),
    createdAt: host.createdAt?.toISOString(),
  }));

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