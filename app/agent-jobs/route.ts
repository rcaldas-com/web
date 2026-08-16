import { NextResponse } from 'next/server';
import { takePendingJobs, verifyAgentToken } from '@/lib/monitor';

// O agente busca aqui quando o heartbeat responde hasJobs:true.
// Exige o token do agente -- ao contrario do /ping, que e legado e nao tem
// como se autenticar. Sem isso qualquer um consumiria a fila de um host,
// impedindo que a acao chegasse a quem devia executar.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  const { host, token } = body as Record<string, string>;
  if (!host || !token) {
    return NextResponse.json({ ok: false, error: 'host e token sao obrigatorios' }, { status: 400 });
  }

  if (!(await verifyAgentToken(host, token))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const jobs = await takePendingJobs(host);
  return NextResponse.json({ ok: true, jobs });
}
