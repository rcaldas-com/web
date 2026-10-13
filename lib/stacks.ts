// Fonte UNICA de verdade sobre quais bases de deploy existem.
//
// Ate aqui o Monitor so conhecia uma: rcaldas-com/dev em /var/rcaldas/rcaldas,
// hardcoded em meia duzia de arquivos (promote.ts, monitor.ts, polling.ts,
// install.sh...). A segunda base (bndes_dev, primeiro app: bolo) nao cabe
// nesse molde -- e o terceiro cabe menos ainda se cada lugar continuar
// descobrindo sozinho. Daqui pra frente, uma stack nova e' uma linha aqui
// (mais o bootstrap manual descrito no README dela: clonar, env, Mongo,
// HAProxy -- isso nunca foi automatico e continua nao sendo).
//
// O NOME da stack e' tambem: o namespace da imagem
// (registry.rcaldas.com/<stack>/<app>), o nome do diretorio
// (/var/rcaldas/<stack>) e, pra servico de uma stack que nao e' a rcaldas,
// o prefixo da identidade em monitor_services (ver guessSource em
// services.ts) -- "bndes/redis" e nao so "redis", porque as duas stacks tem
// um redis e um emailer proprios e o nome e' a chave unica do cadastro.
// rcaldas fica SEM prefixo de proposito: e' a base original, tem meses de
// dado (autoPromote, backup, url) gravado sob o nome puro, e renomear isso
// pra "rcaldas/web" so pra simetria custaria uma migracao sem ganhar nada.

export type Stack = {
  name: string;
  // Caminho absoluto no host de produção/build, sempre /var/rcaldas/<name>.
  dir: string;
  composeFile: string;
  // owner/repo no GitHub -- onde promoteImage escreve a tag.
  repo: string;
  branch: string;
};

export const STACKS: Stack[] = [
  { name: 'rcaldas', dir: '/var/rcaldas/rcaldas', composeFile: 'docker-compose.prod.yml', repo: 'rcaldas-com/dev', branch: 'main' },
  { name: 'bndes', dir: '/var/rcaldas/bndes', composeFile: 'docker-compose.prod.yml', repo: 'rcaldas-com/bndes_dev', branch: 'main' },
];

export function getStack(name: string): Stack | null {
  return STACKS.find((s) => s.name === name) ?? null;
}

export function imageBaseFor(stack: string, service: string): string {
  return `registry.rcaldas.com/${stack}/${service}`;
}

/**
 * De uma imagem completa (`registry.rcaldas.com/<stack>/<app>:<tag>`) pro
 * nome da stack, SE ela pertencer a uma stack conhecida -- senão null (caso
 * do emailer da stack bndes, que roda a imagem `rcaldas/emailer`: pertence
 * à stack rcaldas, não à bndes, mesmo rodando dentro do compose dela. Ver
 * guessSource em services.ts, que é quem decide o que fazer com esse null).
 */
export function stackFromImage(image: string): string | null {
  const m = image.match(/^registry\.rcaldas\.com\/([^/]+)\//);
  if (!m) return null;
  return STACKS.some((s) => s.name === m[1]) ? m[1] : null;
}

/**
 * Identidade em monitor_services pra um serviço de uma stack. Ver o
 * comentário no topo do arquivo sobre por que rcaldas fica sem prefixo.
 */
export function serviceIdentity(stack: string, service: string): string {
  return stack === 'rcaldas' ? service : `${stack}/${service}`;
}

/** Desfaz serviceIdentity(). 'web' -> {stack:'rcaldas', service:'web'}; 'bndes/bolo' -> {stack:'bndes', service:'bolo'}. */
export function splitIdentity(name: string): { stack: string; service: string } {
  const i = name.indexOf('/');
  if (i < 0) return { stack: 'rcaldas', service: name };
  return { stack: name.slice(0, i), service: name.slice(i + 1) };
}
