'use server';

const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';

export async function sendVerificationEmail(email: string, token: string, name: string) {
  const verificationUrl = `${APP_URL}/verify-email?token=${token}`;

  console.log('\n=== EMAIL DE VERIFICAÇÃO (DEV MODE) ===');
  console.log('Para:', email);
  console.log('Nome:', name);
  console.log('Link:', verificationUrl);
  console.log('========================================\n');

  return { success: true, devMode: true };
}

export async function sendPasswordResetEmail(email: string, token: string, name: string) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  console.log('\n=== EMAIL DE REDEFINIÇÃO DE SENHA (DEV MODE) ===');
  console.log('Para:', email);
  console.log('Nome:', name);
  console.log('Link:', resetUrl);
  console.log('=================================================\n');

  return { success: true, devMode: true };
}
