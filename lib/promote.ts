// Promocao = escrever no git. NUNCA executar o deploy daqui.
//
// Esta e a decisao que decide se o Monitor porta pro Kubernetes ou nao. Se
// o botao rodasse `docker compose up -d`, o Monitor ficaria amarrado ao
// compose. Escrevendo a tag no repo, quem aplica e o reconciliador -- hoje
// o agente do host de deploy, amanha um controlador de cluster lendo o
// mesmo repo. Troca-se o executor, nao a UI nem o modelo. Ver CICD.md.

import { getService, listServices, recordPromotion } from './services';
import { enqueueDeployJobs } from './monitor';

const GITHUB_API = 'https://api.github.com';
const REPO = process.env.DEPLOY_REPO || 'rcaldas-com/dev';
const COMPOSE_PATH = process.env.DEPLOY_COMPOSE_PATH || 'docker-compose.prod.yml';
const BRANCH = process.env.DEPLOY_BRANCH || 'main';

export type PromoteResult =
  | { ok: true; commit: string; de: string; para: string }
  | { ok: false; erro: string };

export function promoteConfigurado(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

function escapaRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function gh(path: string, init?: RequestInit) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  return { res, body } as { res: Response; body: Record<string, unknown> };
}

/**
 * Troca a tag da imagem de UM servico no compose de producao e commita.
 *
 * Edita a linha, nao gera o arquivo: o compose tem volumes, redes, limites
 * e comentarios escritos a mao, e regerar perderia tudo isso. A linha
 * `image:` e alvo estavel e unico por servico.
 *
 * A validacao aqui e mais forte que um parse de YAML pra este caso
 * especifico: exige que o padrao case EXATAMENTE uma linha (zero = servico
 * inexistente ou renomeado; duas = ambiguidade que nao se resolve
 * sozinha), e depois confere que o arquivo novo difere do velho em
 * exatamente uma linha. Um parser diria "ainda e YAML valido" mesmo se a
 * substituicao tivesse acertado o servico errado.
 *
 * Fim de linha preservado de proposito: o docker-compose.prod.yml esta em
 * CRLF, e normalizar geraria um diff de centenas de linhas fantasma que
 * esconderia a mudanca de verdade.
 */
export async function promoteImage(imageBase: string, novaTag: string): Promise<PromoteResult> {
  if (!promoteConfigurado()) {
    return { ok: false, erro: 'GITHUB_TOKEN nao configurado no .env do servidor' };
  }

  const url = `/repos/${REPO}/contents/${encodeURIComponent(COMPOSE_PATH)}`;
  const atual = await gh(`${url}?ref=${BRANCH}`);
  if (!atual.res.ok) {
    return { ok: false, erro: `nao consegui ler ${COMPOSE_PATH}: ${atual.res.status}` };
  }

  const sha = String(atual.body.sha || '');
  const conteudo = Buffer.from(String(atual.body.content || ''), 'base64').toString('utf8');

  // split('\n') mantem o \r no fim de cada linha em arquivo CRLF -- e' o
  // que permite recolocar o terminador exatamente como estava.
  const linhas = conteudo.split('\n');
  const padrao = new RegExp(`^\\s*image:\\s*${escapaRegex(imageBase)}:`);
  const indices = linhas.map((l, i) => (padrao.test(l) ? i : -1)).filter((i) => i >= 0);

  if (indices.length === 0) {
    return { ok: false, erro: `nenhuma linha image: para ${imageBase} em ${COMPOSE_PATH}` };
  }
  if (indices.length > 1) {
    return { ok: false, erro: `${indices.length} linhas image: para ${imageBase} -- ambiguo, nao vou adivinhar` };
  }

  const i = indices[0];
  const original = linhas[i];
  const cr = original.endsWith('\r') ? '\r' : '';
  const indentacao = original.match(/^\s*/)?.[0] ?? '    ';
  const tagAtual = original.trim().split(':').pop()?.replace('\r', '') ?? '';
  if (tagAtual === novaTag) {
    return { ok: false, erro: `producao ja esta em ${novaTag}` };
  }

  linhas[i] = `${indentacao}image: ${imageBase}:${novaTag}${cr}`;
  const novoConteudo = linhas.join('\n');

  // Cinto e suspensorio: confirma que so' aquela linha mudou antes de
  // mandar. Se a contagem der diferente de 1, algo saiu do controle e e'
  // melhor nao commitar do que commitar errado.
  const diferentes = linhas.filter((l, idx) => l !== conteudo.split('\n')[idx]).length;
  if (diferentes !== 1) {
    return { ok: false, erro: `edicao alterou ${diferentes} linhas, esperava 1 -- abortado` };
  }

  const commit = await gh(url, {
    method: 'PUT',
    body: JSON.stringify({
      message: `promove ${imageBase.split('/').pop()}:${novaTag}\n\nPromovido pelo Monitor. O container so muda quando o reconciliador\naplicar este commit -- promover e escrever no git.`,
      content: Buffer.from(novoConteudo, 'utf8').toString('base64'),
      sha,
      branch: BRANCH,
    }),
  });

  if (!commit.res.ok) {
    const msg = (commit.body as { message?: string }).message || String(commit.res.status);
    return { ok: false, erro: `falha ao commitar: ${msg}` };
  }

  const novoSha = ((commit.body.commit as { sha?: string }) || {}).sha || '';

  // Commit feito: pede a reconciliacao. O deploy nao acontece aqui -- o
  // agente do host de producao e' quem aplica, e o que ele aplica e' o
  // commit, nao um parametro que passamos. Se esta chamada falhar, o
  // proximo ciclo de inventario ainda detecta o host atrasado.
  try {
    const alvos = await enqueueDeployJobs();
    if (alvos.length) console.log(`reconciliacao pedida a: ${alvos.join(', ')}`);
  } catch (error) {
    console.error('nao consegui pedir reconciliacao:', error);
  }

  // Registra o PEDIDO. Fica aqui, e nao nos chamadores, porque sao tres
  // caminhos que promovem (botao, auto-promocao ao terminar build, e ligar
  // a caixa de auto-promover) -- se cada um tivesse que lembrar, um deles
  // esqueceria e a tela ficaria muda justo naquele.
  //
  // O nome do servico sai do imageBase porque e' dele que a linha do
  // compose foi encontrada: os dois sao sempre o mesmo servico, entao nao
  // ha como divergirem.
  const servico = imageBase.split('/').pop() || '';
  if (servico) {
    try {
      await recordPromotion(servico, novaTag);
    } catch (error) {
      // A promocao em si ja deu certo -- falhar aqui so' custa o aviso na
      // tela, nunca o deploy. Nao pode virar erro do fluxo.
      console.error(`nao consegui registrar a promocao de ${servico}:`, error);
    }
  }

  return { ok: true, commit: novoSha.slice(0, 7), de: tagAtual, para: novaTag };
}

/**
 * Promove sozinho, se o servico estiver marcado pra isso.
 *
 * Chamado quando um build TERMINA BEM. O default e' desmarcado em todo
 * servico: subir pra producao sem clique tem que ser escolha explicita por
 * servico, nunca o comportamento padrao.
 *
 * Falha aqui nunca derruba o heartbeat que trouxe o resultado do build --
 * o build deu certo e a imagem esta publicada de qualquer forma.
 */
export async function maybeAutoPromote(service: string, tag: string): Promise<void> {
  try {
    const svc = await getService(service);
    if (!svc?.autoPromote) return;
    const r = await promoteImage(`registry.rcaldas.com/rcaldas/${service}`, tag);
    if (r.ok) {
      console.log(`auto-promovido ${service}: ${r.de} -> ${r.para} (commit ${r.commit})`);
    } else {
      console.error(`auto-promocao de ${service}:${tag} falhou: ${r.erro}`);
    }
  } catch (error) {
    console.error('auto-promocao falhou:', error);
  }
}

/**
 * Fase 5 do CICD.md: producao converge pro git, tenha o git mudado por quem
 * for.
 *
 * Ate aqui o deploy so' era enfileirado pelo promoteImage. Qualquer outra
 * escrita no compose -- bot de dependencia, edicao a mao, outro chat --
 * ficava no git sem chegar em producao, e so' era aplicada por acidente,
 * de carona no proximo deploy que alguma promocao nao relacionada
 * disparasse. Num modelo em que o git e' a fonte da verdade, isso e' um
 * buraco: o repo dizia uma coisa e a maquina rodava outra, sem ninguem
 * avisar.
 *
 * Compara o que o compose do git manda subir com o que o host reporta ter
 * declarado (observed.declaredImage, do inventario). Divergiu -> deploy.
 *
 * Sem estado proprio de proposito: a propria comparacao e' a memoria. E
 * enqueueDeployJobs faz upsert por {host, type, pending}, entao chamar de
 * novo enquanto um deploy espera nao empilha nada -- e ele ja pede o
 * inventario junto, que e' o que fecha o ciclo e faz a divergencia sumir.
 */
export async function reconcileComposeDrift(): Promise<void> {
  if (!promoteConfigurado()) return;
  try {
    const atual = await gh(`/repos/${REPO}/contents/${encodeURIComponent(COMPOSE_PATH)}?ref=${BRANCH}`);
    if (!atual.res.ok) return;

    const conteudo = Buffer.from(String(atual.body.content || ''), 'base64').toString('utf8');
    // servico -> tag que o git manda subir. O nome sai do proprio caminho da
    // imagem, que e' como o resto do sistema ja identifica servico.
    const noGit = new Map<string, string>();
    for (const linha of conteudo.split('\n')) {
      const m = linha.match(/^\s*image:\s*(\S+?):(\S+?)\s*$/);
      if (!m) continue;
      const nome = m[1].split('/').pop();
      if (nome) noGit.set(nome, m[2]);
    }
    if (!noGit.size) return;

    const servicos = await listServices();
    const divergentes = servicos.filter((s) => {
      const declarada = s.observed?.declaredImage?.split(':').pop();
      // Sem inventario ainda, nao da pra afirmar divergencia -- e chutar
      // aqui viraria deploy em loop no primeiro servico nunca visto.
      if (!declarada) return false;
      const esperada = noGit.get(s.name);
      return Boolean(esperada) && esperada !== declarada;
    });
    if (!divergentes.length) return;

    const alvos = await enqueueDeployJobs();
    console.log(
      `deriva do compose: ${divergentes.map((s) => `${s.name} ${s.observed?.declaredImage?.split(':').pop()}->${noGit.get(s.name)}`).join(', ')} | reconciliacao pedida a: ${alvos.join(', ')}`
    );
  } catch (error) {
    // Nunca pode derrubar o heartbeat que chamou.
    console.error('checagem de deriva do compose falhou:', error);
  }
}
