import { NextResponse } from 'next/server';
import { registerLegacyPing } from '@/lib/monitor';

// Compat com o zxnet antigo (curl -4fLksm10 $API), que so entende um numero
// puro no corpo da resposta. Ver lib/monitor.ts:registerLegacyPing.
export async function GET(request: Request) {
  const host = new URL(request.url).searchParams.get('host');
  if (!host) {
    return new NextResponse('0', { headers: { 'content-type': 'text/plain' } });
  }

  const port = await registerLegacyPing(host, request.headers);
  return new NextResponse(String(port), { headers: { 'content-type': 'text/plain' } });
}
