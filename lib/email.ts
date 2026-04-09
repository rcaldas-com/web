'use server';

import redis from '@/lib/redis';

const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';
const APP_NAME = process.env.TITLE || 'RCaldas';
const QUEUE_NAME = 'email:send';

async function enqueueEmail(to: string, subject: string, template: string, variables: Record<string, string>) {
  const payload = JSON.stringify({ to, subject, template, variables });
  await redis.lpush(QUEUE_NAME, payload);
}

export async function sendVerificationEmail(email: string, token: string, name: string) {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;

  await enqueueEmail(email, 'Verificação de Email', 'verify-email', {
    name,
    verifyUrl,
    app: APP_NAME,
  });
}

export async function sendPasswordResetEmail(email: string, token: string, name: string) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  await enqueueEmail(email, 'Redefinição de Senha', 'reset-password', {
    name,
    resetUrl,
    app: APP_NAME,
  });
}
