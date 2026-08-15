import { NextResponse } from 'next/server';
import { approveTunnelKey, getTunnelKeyRequest } from '@/lib/monitor';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(body: string) {
  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aprovar tunel</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#22223b}
.key{word-break:break-all;font-family:monospace;font-size:0.8rem;color:#4b5563;background:#eef0f3;border-radius:6px;padding:10px;margin:16px 0}
button{background:#27272a;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:1rem;cursor:pointer}
</style></head><body>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

// So mostra o pedido -- a aprovacao de verdade acontece no POST do form
// abaixo. Nao aprova nada so por ser visitado, porque scanners de
// seguranca de provedores de email costumam pre-visitar links em GET.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || '';
  const req = await getTunnelKeyRequest(token);

  if (!req) {
    return page('<h1>Token invalido</h1><p>Esse link nao corresponde a nenhum pedido pendente.</p>');
  }
  if (req.status === 'approved') {
    return page(`<h1>Ja aprovado</h1><p>A chave do host <b>${escapeHtml(req.host)}</b> ja esta autorizada.</p>`);
  }

  return page(`
    <h1>Aprovar tunel para "${escapeHtml(req.host)}"?</h1>
    <p>Essa chave vai poder abrir tunel SSH reverso pro relay, restrita a
    port-forwarding (sem shell, sem X11, sem agent forwarding).</p>
    <div class="key">${escapeHtml(req.publicKey)}</div>
    <form method="POST">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button type="submit">Aprovar</button>
    </form>
  `);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get('token') || '');
  const result = await approveTunnelKey(token);

  if (!result.ok) {
    return page(`<h1>Erro</h1><p>${escapeHtml(result.error || 'falha desconhecida')}</p>`);
  }
  return page(`<h1>Aprovado</h1><p>Host <b>${escapeHtml(result.host || '')}</b> agora pode abrir tunel.</p>`);
}
