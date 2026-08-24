'use server';

import redis from '@/lib/redis';
import { MASTER_ADMIN_EMAIL } from '@/lib/auth';

const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';
const APP_NAME = process.env.TITLE || 'RCaldas';
const QUEUE_NAME = 'email:send';

// A identidade do app viaja COM a mensagem. Antes ela morava no ambiente do
// worker (TITLE, AUTH_TRUST_HOST, TEMPLATE_PREFIX), o que obrigava um
// container de emailer por app -- cada um com sua fila, só pra trocar três
// strings. Quem publica sabe quem é; mandar junto é mais barato e mais
// confiável do que manter um processo por marca.
// Ver `resolve_brand` em emailer/app.py.
const BRAND = {
  name: APP_NAME,
  appUrl: APP_URL, // vira {appUrl}/logo.png no template
  templatePrefix: '', // sem sobrescrita: usa os templates base
};

async function enqueueEmail(to: string, subject: string, template: string, variables: Record<string, string>) {
  const payload = JSON.stringify({ to, subject, template, variables, brand: BRAND });
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
  // Seletor LogQL do que explica ESTE alarme. Quando vem, o email leva o
  // trecho de log junto -- e' a diferenca entre "backup falhou" e saber
  // por que falhou sem abrir SSH. Ver upsertIncident em lib/monitor.ts.
  logSelector?: string;
}) {
  // Sem prefixo tipo "[CRITICO]"/"[Resolvido]" no assunto -- ele ja aparece
  // como badge colorido no corpo do email. Se o assunto variasse entre
  // abertura e resolucao, o Gmail (que agrupa por assunto identico quando
  // nao ha cabecalho de thread) nunca juntaria os dois na mesma conversa,
  // e cada incidente virava dois emails soltos na caixa de entrada.
  // Busca o trecho de log so' na ABERTURA: no email de resolucao ele
  // mostraria as linhas de quando ja voltou ao normal, que nao ajudam e
  // ainda dao a impressao errada de que o problema continua.
  let logTail = '';
  if (params.logSelector && !params.resolved) {
    const { tailLoki, formatarTail } = await import('@/lib/loki');
    logTail = formatarTail(await tailLoki(params.logSelector, { limite: 20 }));
  }

  const { urlLogDoHost } = await import('@/lib/loki');

  await enqueueEmail(MASTER_ADMIN_EMAIL, `${params.host}: ${params.emailSubject || params.summary}`, 'incident', {
    host: params.host,
    severity: params.severity,
    summary: params.summary,
    detail: params.detail || '',
    resolved: params.resolved ? 'sim' : '',
    hostUrl: `${APP_URL}/monitor/${params.host}`,
    // Botao separado do "Ver no Monitor": o Monitor mostra o ESTADO do
    // host (incidentes abertos, disco, tunel); o log mostra o que
    // aconteceu. Pra diagnosticar, quase sempre e' o log que se quer.
    logUrl: urlLogDoHost(params.host),
    logTail,
    app: APP_NAME,
  });
}
