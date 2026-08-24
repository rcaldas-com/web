// Consulta ao Loki (log centralizado). Usado pra enriquecer o email de
// incidente com o trecho de log que explica o alarme, em vez de mandar o
// admin abrir SSH pra descobrir o que aconteceu.
//
// O Loki fica na mesma rede do compose, entao o `web` alcanca pelo nome do
// servico. Nunca e' exposto publicamente -- quem ve log de fora e' o
// Grafana, em logs.rcaldas.com.
const LOKI_URL = process.env.LOKI_URL || 'http://loki:3100';
const GRAFANA_URL = process.env.GRAFANA_URL || 'https://logs.rcaldas.com';

// Nunca deixar uma consulta de log segurar o envio de um alerta: o
// incidente ja esta salvo, e o email atrasado e' pior que o email sem o
// trecho de log.
const TIMEOUT_MS = 4000;

export type LinhaLog = { ts: Date; linha: string };

/**
 * Ultimas linhas de um seletor LogQL. Devolve [] em qualquer falha --
 * Loki fora do ar, timeout, seletor sem resultado. Quem chama trata
 * ausencia como normal, nunca como erro.
 */
export async function tailLoki(seletor: string, opts?: { limite?: number; desde?: Date; ate?: Date }): Promise<LinhaLog[]> {
  const limite = opts?.limite ?? 25;
  const ate = opts?.ate ?? new Date();
  // Janela larga de proposito: o alarme costuma chegar minutos depois da
  // linha que o causou (o agente so' reporta no proximo heartbeat).
  const desde = opts?.desde ?? new Date(ate.getTime() - 60 * 60 * 1000);

  const url = new URL('/loki/api/v1/query_range', LOKI_URL);
  url.searchParams.set('query', seletor);
  url.searchParams.set('start', `${desde.getTime()}000000`);
  url.searchParams.set('end', `${ate.getTime()}000000`);
  url.searchParams.set('limit', String(limite));
  url.searchParams.set('direction', 'backward');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!resp.ok) return [];

    const data = await resp.json();
    const streams = data?.data?.result ?? [];
    const linhas: LinhaLog[] = [];
    for (const s of streams) {
      for (const [ns, texto] of s.values ?? []) {
        // O Loki devolve nanossegundos como STRING de 19 digitos. Passar
        // isso por Number() perde precisao (1,7e18 > MAX_SAFE_INTEGER) e
        // BigInt exige target >= ES2020, que este projeto nao usa.
        // Cortar os 6 ultimos digitos da string ja da milissegundos, com
        // 13 digitos -- bem dentro do seguro.
        const ms = Number(String(ns).slice(0, -6));
        linhas.push({ ts: new Date(ms), linha: texto });
      }
    }
    // O Loki devolve ordenado por stream; pra leitura humana o que vale e'
    // a ordem cronologica do conjunto todo.
    linhas.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    return linhas.slice(-limite);
  } catch {
    return [];
  }
}

// Blobs com cara de credencial saem antes de entrar num email. O trecho de
// log e' util justamente por ser cru, mas cru inclui o que nao deveria
// circular por fora.
const PADRAO_SEGREDO = /\b[A-Za-z0-9_\-]{24,}\b/g;

export function redigir(texto: string): string {
  return texto.replace(PADRAO_SEGREDO, '***');
}

/** Trecho pronto pro corpo do email: redigido e truncado por linha. */
export function formatarTail(linhas: LinhaLog[], maxColunas = 160): string {
  return linhas
    .map((l) => {
      const hora = l.ts.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const texto = redigir(l.linha).slice(0, maxColunas);
      return `${hora}  ${texto}`;
    })
    .join('\n');
}

/**
 * Link pra investigar o log de um host, ja centrado na janela do incidente.
 *
 * Vai pro Logs Drilldown (grafana-lokiexplore-app, v2.5.1 nesta
 * instalacao) e nao pro Explore nem pro dashboard: e' a superficie feita
 * pra "o que aconteceu aqui?" -- quebra por label, deteccao de padrao e
 * filtro por valor sem escrever LogQL.
 *
 * RESSALVA: a rota e os nomes de parametro pertencem ao PLUGIN, nao ao
 * Grafana, entao um upgrade pode muda-los -- e email e' artefato
 * permanente, o link de hoje precisa continuar valendo daqui a meses. Por
 * isso a URL vive isolada nesta funcao: se quebrar, conserta-se aqui e
 * so' aqui. O dashboard `rcaldas-host-logs` continua existindo como
 * destino estavel (uid e nomes de variavel sao contrato nosso) -- ver
 * urlDashboardDoHost abaixo.
 */
export function urlLogDoHost(host: string, quando: Date = new Date(), janelaMin = 30): string {
  const from = quando.getTime() - janelaMin * 60 * 1000;
  const to = quando.getTime() + janelaMin * 60 * 1000;
  // `var-filters=host|=|bag` e' a sintaxe de filtro de label do Drilldown.
  const filtro = encodeURIComponent(`host|=|${host}`);
  return `${GRAFANA_URL}/a/grafana-lokiexplore-app/explore?var-ds=loki&var-filters=${filtro}&from=${from}&to=${to}`;
}

/** Destino estavel, sob contrato nosso (uid + nomes de variavel). */
export function urlDashboardDoHost(host: string, quando: Date = new Date(), janelaMin = 30): string {
  const from = quando.getTime() - janelaMin * 60 * 1000;
  const to = quando.getTime() + janelaMin * 60 * 1000;
  return `${GRAFANA_URL}/d/rcaldas-host-logs/logs-por-host?var-host=${encodeURIComponent(host)}&from=${from}&to=${to}`;
}
