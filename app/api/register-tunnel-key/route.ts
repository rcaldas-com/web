import { NextResponse } from 'next/server';
import { requestTunnelKeyApproval } from '@/lib/monitor';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  const { host, publicKey, provisionToken } = body as Record<string, string>;
  if (!process.env.PROVISION_TOKEN || provisionToken !== process.env.PROVISION_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!host || !publicKey) {
    return NextResponse.json({ ok: false, error: 'host e publicKey sao obrigatorios' }, { status: 400 });
  }

  await requestTunnelKeyApproval(host, publicKey);
  return NextResponse.json({ ok: true });
}
