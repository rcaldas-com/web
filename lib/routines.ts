import type { Db } from 'mongodb';
import redis from './redis';
import clientPromise from './mongodb';
import { upsertIncident, resolveIncident } from './monitor';

// Rotinas periódicas de OUTROS serviços, disparadas daqui.
//
// Por que não um container de cron: já existe esse padrão na casa e ele
// funciona -- a varredura de host offline e o polling de repo pegam carona
// no heartbeat, com trava no Redis definindo a cadência. Um serviço
// dedicado já existiu (monitor-worker), nunca foi pra produção e foi
// removido justamente por reimplementar pior o que o Monitor já fazia.
// Repetir o padrão custa zero serviço novo no compose e herda de graça a
// observabilidade que já existe (incidente + email só na transição).
//
// A lista é declarativa pra que acrescentar rotina do car/web/finance seja
// uma entrada aqui, não código novo.

const HEADER_SEGREDO = 'x-internal-secret';

type Rotina = {
  nome: string;
  url: string;
  segredoEnv: string;
  intervaloSec: number;
  timeoutMs: number;
};

const ROTINAS: Rotina[] = [
  {
    nome: 'wallet-tick',
    // Rede interna do compose: o web resolve `wallet` direto, no mesmo
    // docker network. Ir pela URL pública daria a volta por Cloudflare +
    // HAProxy + TLS pra falar com o container ao lado -- mais lento, mais
    // peça no caminho pra falhar, e sujeito ao teto de 100s da borda.
    url: process.env.WALLET_TICK_URL || 'http://wallet:3000/api/internal/tick',
    segredoEnv: 'INTERNAL_TICK_SECRET',
    intervaloSec: 300,
    timeoutMs: 15_000,
  },
];

// Quantas falhas seguidas antes de virar incidente. Uma só seria barulhenta:
// o deploy do próprio alvo o derruba por alguns segundos, e um tick caindo
// nessa janela viraria email. Duas seguidas (10min, no caso do wallet) não
// acontecem por reinício -- só por problema de verdade.
const FALHAS_PRA_INCIDENTE = 2;

export type RoutineRun = {
  name: string;
  lastRunAt: Date;
  ok: boolean;
  durationMs: number;
  status?: number;
  message?: string;
  consecutiveFailures: number;
};

export async function listRoutineRuns(): Promise<(Omit<RoutineRun, 'lastRunAt'> & { lastRunAt: string })[]> {
  const client = await clientPromise;
  const db = client.db();
  const docs = await db.collection<RoutineRun>('monitor_routines').find({}).sort({ name: 1 }).toArray();
  return docs.map((d) => ({
    name: d.name,
    ok: d.ok,
    durationMs: d.durationMs,
    status: d.status,
    message: d.message,
    consecutiveFailures: d.consecutiveFailures ?? 0,
    lastRunAt: d.lastRunAt.toISOString(),
  }));
}

async function registrarResultado(
  db: Db,
  rotina: Rotina,
  resultado: { ok: boolean; durationMs: number; status?: number; message?: string },
  // Falso pra estado que não é falha de execução (ex.: segredo ausente):
  // grava pra não ficar mudo, mas não acumula contador nem abre incidente
  // -- não adianta alertar de madrugada sobre configuração que só alguém
  // pode preencher à mão.
  contaFalha = true
) {
  const col = db.collection<RoutineRun>('monitor_routines');
  const anterior = await col.findOne({ name: rotina.nome });
  const seguidas = resultado.ok || !contaFalha ? 0 : (anterior?.consecutiveFailures ?? 0) + 1;

  await col.updateOne(
    { name: rotina.nome },
    {
      $set: {
        name: rotina.nome,
        lastRunAt: new Date(),
        ok: resultado.ok,
        durationMs: resultado.durationMs,
        status: resultado.status,
        message: resultado.message?.slice(0, 300),
        consecutiveFailures: seguidas,
      },
    },
    { upsert: true }
  );

  const chave = `rotina:${rotina.nome}`;
  if (!contaFalha) return;
  if (resultado.ok) {
    // Só resolve se havia o que resolver -- resolveIncident já é no-op
    // quando não há incidente aberto com essa chave.
    if ((anterior?.consecutiveFailures ?? 0) >= FALHAS_PRA_INCIDENTE) {
      await resolveIncident(db, chave);
    }
    return;
  }

  if (seguidas >= FALHAS_PRA_INCIDENTE) {
    await upsertIncident(db, {
      key: chave,
      target: rotina.nome,
      severity: 'warning',
      summary: `rotina ${rotina.nome} falhou ${seguidas}x seguidas`,
      detail: resultado.message,
      emailSubject: `rotina ${rotina.nome} falhando`,
      logSelector: `{service_name="web"} |= \`${rotina.nome}\``,
    });
  }
}

async function executarRotina(db: Db, rotina: Rotina, segredo: string) {
  const inicio = Date.now();
  try {
    const res = await fetch(rotina.url, {
      method: 'POST',
      headers: { [HEADER_SEGREDO]: segredo },
      signal: AbortSignal.timeout(rotina.timeoutMs),
      cache: 'no-store',
    });
    const corpo = (await res.text().catch(() => '')).slice(0, 300);
    const ok = res.ok;
    await registrarResultado(db, rotina, {
      ok,
      durationMs: Date.now() - inicio,
      status: res.status,
      message: ok ? undefined : `HTTP ${res.status}: ${corpo}`,
    });
    if (!ok) console.error(`rotina ${rotina.nome} falhou: HTTP ${res.status} ${corpo}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await registrarResultado(db, rotina, { ok: false, durationMs: Date.now() - inicio, message: msg });
    console.error(`rotina ${rotina.nome} falhou: ${msg}`);
  }
}

/**
 * Dispara as rotinas cuja janela venceu. Chamada do heartbeat.
 *
 * NÃO espera o fetch terminar, de propósito: o agente chama /heartbeat com
 * `curl -m 20`, e uma rotina lenta seguraria a resposta até o agente
 * desistir -- o heartbeat falharia e o lote de results dele voltaria pra
 * fila por causa de um serviço terceiro. O que é aguardado aqui é só a
 * trava no Redis (operação de milissegundos); o resto corre solto e grava o
 * próprio resultado.
 *
 * Se o processo morrer no meio (deploy), a trava expira sozinha e a próxima
 * janela refaz -- nada fica preso.
 */
export async function runRoutinesThrottled(): Promise<void> {
  const client = await clientPromise;
  const db = client.db();

  for (const rotina of ROTINAS) {
    try {
      // A trava vem ANTES de qualquer outra coisa: ela é o que define a
      // cadência. Checar o segredo antes gravaria o estado "não
      // configurado" a cada batida de heartbeat (a cada 30s), em vez de
      // uma vez por janela.
      const gotLock = await redis.set(
        `monitor:rotina:${rotina.nome}`,
        '1',
        'EX',
        rotina.intervaloSec,
        'NX'
      );
      if (!gotLock) continue;

      const segredo = process.env[rotina.segredoEnv];
      if (!segredo) {
        // Não pode ser mudo: sem isto, uma rotina declarada no código e sem
        // segredo no .env nunca rodaria e ninguém saberia.
        await registrarResultado(
          db,
          rotina,
          { ok: false, durationMs: 0, message: `${rotina.segredoEnv} não definido no .env do servidor` },
          false
        );
        continue;
      }

      void executarRotina(db, rotina, segredo);
    } catch (error) {
      // Nunca pode derrubar o heartbeat: o host que reportou está bem.
      console.error(`nao consegui disparar a rotina ${rotina.nome}:`, error);
    }
  }
}
