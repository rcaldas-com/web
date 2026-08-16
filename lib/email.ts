'use server';

import redis from '@/lib/redis';
import { MASTER_ADMIN_EMAIL } from '@/lib/auth';

const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';
const APP_NAME = process.env.TITLE || 'RCaldas';
const QUEUE_NAME = 'email:send';

async function enqueueEmail(to: string, subject: string, template: string, variables: Record<string, string>) {
  const payload = JSON.stringify({ to, subject, template, variables });
  await redis.lpush(QUEUE_NAME, payload);
}

export async function sendVerificationEmail(email: string, token: string, name: string, callbackUrl?: string) {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`;

  await enqueueEmail(email, 'Verificação de Email', 'verify-email', {
    name,
    verifyUrl,
    app: APP_NAME,
  });
}

export async function sendPasswordResetEmail(email: string, token: string, name: string, callbackUrl?: string) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`;

  await enqueueEmail(email, 'Redefinição de Senha', 'reset-password', {
    name,
    resetUrl,
    app: APP_NAME,
  });
}

export async function sendTunnelKeyApprovalEmail(host: string, publicKey: string, approveToken: string) {
  const approveUrl = `${APP_URL}/approve-tunnel-key?token=${approveToken}`;

  await enqueueEmail(MASTER_ADMIN_EMAIL, `Aprovar túnel: ${host}`, 'tunnel-key-approval', {
    host,
    publicKey,
    approveUrl,
    app: APP_NAME,
  });
}

export async function sendIncidentEmail(params: {
  host: string;
  severity: string;
  summary: string;
  detail?: string;
  resolved: boolean;
}) {
  const prefix = params.resolved ? 'Resolvido' : params.severity === 'critical' ? 'CRITICO' : 'Alerta';

  await enqueueEmail(MASTER_ADMIN_EMAIL, `[${prefix}] ${params.host}: ${params.summary}`, 'incident', {
    host: params.host,
    severity: params.severity,
    summary: params.summary,
    detail: params.detail || '',
    resolved: params.resolved ? 'sim' : '',
    hostUrl: `${APP_URL}/monitor/${params.host}`,
    app: APP_NAME,
  });
}
