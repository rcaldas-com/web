import { NextResponse } from 'next/server';
import { handleLogAlert } from '@/lib/monitor';

// Recebe o webhook do alerting do Grafana e traduz em incidente.
//
// Por que o Grafana avalia e nao este app: ele ja fala com o Loki, ja tem
// motor de regra com "for" (sustentado por N minutos) e ja mostra o
// historico da avaliacao. Reimplementar isso aqui seria um segundo lugar
// decidindo quando algo esta ruim -- e dois lugares divergem, sempre.
//
// O formato do payload e' o webhook padrao do Grafana: um envelope com
// `alerts[]`, cada um com `status`, `labels` e `annotations`.
type AlertaGrafana = {
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  valueString?: string;
};

export async function POST(request: Request) {
  // Mesmo nivel de confianca do PROVISION_TOKEN: segredo compartilhado no
  // .env, conferido antes de qualquer efeito. O endpoint escreve em
  // monitor_incidents e dispara email -- nao pode ficar aberto.
  const esperado = process.env.LOG_ALERT_TOKEN;
  if (!esperado) {
    return NextResponse.json({ ok: false, error: 'LOG_ALERT_TOKEN nao configurado' }, { status: 503 });
  }
  const header = request.headers.get('authorization') || '';
  if (header !== `Bearer ${esperado}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  const alertas: AlertaGrafana[] = Array.isArray((body as { alerts?: unknown }).alerts)
    ? ((body as { alerts: AlertaGrafana[] }).alerts)
    : [];
  if (!alertas.length) {
    return NextResponse.json({ ok: true, processados: 0 });
  }

  const resultados: string[] = [];
  for (const a of alertas) {
    const labels = a.labels || {};
    const anot = a.annotations || {};
    // O host vem do `sum by (host, service)` da regra. Sem ele nao da pra
    // dizer de quem e' o incidente, entao ignora em vez de abrir um
    // incidente orfao que ninguem sabe interpretar.
    const host = labels.host;
    if (!host) continue;

    const status = a.status === 'resolved' ? 'resolved' : 'firing';
    const service = labels.service;

    const r = await handleLogAlert({
      status,
      host,
      service,
      summary: anot.summary || `Erro no log de ${service || host}`,
      // valueString traz o numero que disparou a regra -- e' o que
      // responde "quanto?" sem abrir o Grafana.
      detail: [anot.description, a.valueString].filter(Boolean).join(' | ') || undefined,
      severity: labels.severity === 'critical' ? 'critical' : 'warning',
    });
    resultados.push(`${r.key}:${r.acao}`);
  }

  return NextResponse.json({ ok: true, processados: resultados.length, resultados });
}
