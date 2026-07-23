import { NextResponse } from 'next/server';
import { registerHeartbeat, type HeartbeatPayload } from '@/lib/monitor';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as HeartbeatPayload;
    const result = await registerHeartbeat(payload, request.headers);
    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error('monitor heartbeat error:', error);
    return NextResponse.json({ ok: false, error: 'invalid heartbeat' }, { status: 400 });
  }
}