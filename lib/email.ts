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
  emailSubject?: string;
  detail?: string;
  resolved: boolean;
}) {
  // Sem prefixo tipo "[CRITICO]"/"[Resolvido]" no assunto -- ele ja aparece
  // como badge colorido no corpo do email. Se o assunto variasse entre
  // abertura e resolucao, o Gmail (que agrupa por assunto identico quando
  // nao ha cabecalho de thread) nunca juntaria os dois na mesma conversa,
  // e cada incidente virava dois emails soltos na caixa de entrada.
  await enqueueEmail(MASTER_ADMIN_EMAIL, `${params.host}: ${params.emailSubject || params.summary}`, 'incident', {
    host: params.host,
    severity: params.severity,
    summary: params.summary,
    detail: params.detail || '',
    resolved: params.resolved ? 'sim' : '',
    hostUrl: `${APP_URL}/monitor/${params.host}`,
    app: APP_NAME,
  });
}
