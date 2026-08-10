import { NextResponse } from 'next/server';

const MAILU_API_URL = process.env.MAILU_API_URL || 'http://admin:8080/api/v1';
const MAILU_FORWARD_TO = process.env.MAILU_FORWARD_TO || 'rclgsm@gmail.com';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  const { host, domain, password, provisionToken } = body as Record<string, string>;
  if (!process.env.PROVISION_TOKEN || provisionToken !== process.env.PROVISION_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!host || !domain || !password) {
    return NextResponse.json({ ok: false, error: 'host, domain e password sao obrigatorios' }, { status: 400 });
  }

  const token = process.env.MAILU_API_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'MAILU_API_TOKEN nao configurado' }, { status: 500 });
  }

  const email = `${host}@${domain}`.toLowerCase();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const payload = {
    email,
    raw_password: password,
    comment: 'criado automaticamente pelo /init',
    enabled: true,
    enable_imap: false,
    enable_pop: false,
    forward_enabled: true,
    forward_destination: [MAILU_FORWARD_TO],
    forward_keep: false,
  };

  const create = await fetch(`${MAILU_API_URL}/user`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (create.status === 409) {
    const update = await fetch(`${MAILU_API_URL}/user/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ raw_password: password }),
    });
    if (!update.ok) {
      const text = await update.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `falha ao atualizar senha: ${text}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, email, updated: true });
  }

  if (!create.ok) {
    const text = await create.text().catch(() => '');
    return NextResponse.json({ ok: false, error: `mailu respondeu ${create.status}: ${text}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, email, created: true });
}
