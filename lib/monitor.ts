import crypto from 'crypto';
import { ObjectId } from 'mongodb';
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
    token: existing ? undefined : nextToken,
    nextIntervalSec: 60,
    tunnel: payload.tunnel?.enabled ? payload.tunnel : undefined,
    jobs: pendingJobs.map((job) => ({
      id: job._id?.toString(),
      type: job.type,
      ...job.payload,
    })),
  };
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