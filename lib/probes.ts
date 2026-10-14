import type { Db } from 'mongodb';
import redis from './redis';
import clientPromise from './mongodb';
import { upsertIncident, resolveIncident } from './monitor';
import type { MonitorService, ServiceHealth } from './services';

// Sondagem de SERVICO: o irmao que faltava do alerta de host.
//
// Host com monitoramento ligado avisa por email quando some. Servico nao
// avisava nada: o car respondeu 503 e ninguem soube, e webssh/webvnc caem
// com frequencia sem deixar rastro. O inventario (service-inventory) nao
// cobre isso -- roda a cada 30min, so ve container do compose, e "container
// de pe" nao e' "servico respondendo".
//
// O que liga a sondagem e' a `url` do cadastro: servico com URL e' sondado,
// sem URL nao e'. Nenhuma caixa a mais pra lembrar de marcar.
//
// Vai pela URL PUBLICA de proposito, ao contrario das rotinas (que falam
// pela rede interna do compose): aqui o que se quer medir e' o caminho que
// o usuario faz -- DNS, Cloudflare, HAProxy, container. Um backend fora no
// HAProxy vira 503 exatamente aqui, e pela rede interna passaria batido.
//
// Limite conhecido: quem sonda e' este proprio app, no `us`. Se o `us`
// inteiro (ou o web) cair, nao ha quem sonde nem quem mande o email.
// Cobrir isso exige um vigia FORA do `us`, que nao existe ainda.

const INTERVALO_SEC = 60;
const TIMEOUT_MS = 10_000;

// Duas seguidas antes do incidente, pelo mesmo motivo das rotinas: um
// deploy derruba o alvo por alguns segundos, e uma sondagem caindo nessa
// janela viraria email. Duas a 60s nao acontecem por reinicio.
const FALHAS_PRA_INCIDENTE = 2;

type Resultado = { ok: boolean; status?: number; message?: string };

async function sondar(url: string): Promise<Resultado> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      // Nao segue redirect: app com login responde 307 pra /login, e isso
      // ja' prova que esta de pe. Seguir so' acrescentaria um segundo alvo
      // capaz de falhar por motivo que nao e' deste servico.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
      headers: { 'user-agent': 'rcaldas-monitor-probe' },
    });
    // So' 5xx e' "fora": 401/403/404 sao o servico respondendo (webssh
    // atras de senha devolve 401 e esta perfeitamente vivo).
    if (res.status >= 500) return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    return { ok: true, status: res.status };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('timeout') || msg.includes('aborted')) return { ok: false, message: `sem resposta em ${TIMEOUT_MS / 1000}s` };
    // O fetch do Node diz so' "fetch failed"; o motivo de verdade
    // (ECONNREFUSED, ENOTFOUND, certificado) vem em error.cause.
    const causa = (error as { cause?: { code?: string; message?: string } })?.cause;
    return { ok: false, message: causa?.code || causa?.message || msg };
  }
}

async function registrar(db: Db, svc: Pick<MonitorService, 'name' | 'url' | 'health'>, r: Resultado) {
  const now = new Date();
  const antes = svc.health;
  const seguidas = r.ok ? 0 : (antes?.consecutiveFailures ?? 0) + 1;
  const health: ServiceHealth = {
    ok: r.ok,
    status: r.status,
    message: r.message?.slice(0, 300),
    checkedAt: now,
    since: antes && antes.ok === r.ok ? antes.since : now,
    consecutiveFailures: seguidas,
  };
  await db.collection<MonitorService>('monitor_services').updateOne({ name: svc.name }, { $set: { health } });

  const chave = `service:${svc.name}`;
  if (r.ok) {
    // resolveIncident ja' e' no-op sem incidente aberto com essa chave.
    if ((antes?.consecutiveFailures ?? 0) >= FALHAS_PRA_INCIDENTE) await resolveIncident(db, chave);
    return;
  }
  if (seguidas >= FALHAS_PRA_INCIDENTE) {
    const minutos = Math.max(1, Math.round((now.getTime() - health.since.getTime()) / 60000));
    await upsertIncident(db, {
      key: chave,
      target: svc.name,
      severity: 'critical',
      summary: `${svc.name} fora do ar ha ${minutos} min (${r.message})`,
      detail: `${svc.url} -> ${r.message}`,
      // Estavel: o summary carrega os minutos e mudaria o assunto a cada
      // sondagem, quebrando o agrupamento de abertura/resolucao no Gmail.
      emailSubject: `${svc.name} fora do ar`,
    });
  }
}

/**
 * Sonda todo servico com URL. Chamada do heartbeat, uma passada por janela.
 *
 * Nao espera as sondagens, pelo mesmo motivo de runRoutinesThrottled: o
 * agente chama /heartbeat com `curl -m 20` e um alvo lento seguraria a
 * resposta. So' a trava no Redis e a leitura da lista sao aguardadas.
 */
export async function runProbesThrottled(): Promise<void> {
  try {
    const gotLock = await redis.set('monitor:service-probes', '1', 'EX', INTERVALO_SEC, 'NX');
    if (!gotLock) return;

    const client = await clientPromise;
    const db = client.db();
    const alvos = await db
      .collection<MonitorService>('monitor_services')
      .find({ url: { $type: 'string', $ne: '' } }, { projection: { name: 1, url: 1, health: 1 } })
      .toArray();

    for (const svc of alvos) {
      void sondar(svc.url!)
        .then((r) => registrar(db, svc, r))
        .catch((error) => console.error(`sondagem de ${svc.name} falhou ao registrar:`, error));
    }
  } catch (error) {
    // Nunca pode derrubar o heartbeat: o host que reportou esta bem.
    console.error('sondagem de servicos falhou:', error);
  }
}
