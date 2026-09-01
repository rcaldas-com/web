import { Db } from 'mongodb';
import redis from './redis';
import { listServices } from './services';
import { hasRunningBuild, lastAttemptedSha, startBuild } from './builds';
import { enqueueBuildJob, enqueueRepoHeadsJob, pickBuildWorker } from './monitor';
import { reconcileComposeDrift } from './promote';

// Intervalo entre leituras do HEAD remoto. Era o maior termo isolado da
// latencia da pipeline: as batidas somadas dao ~2,5min e esta trava sozinha
// dava ate 5. Cortada pela metade porque o custo real e' baixo -- um
// git ls-remote por repo, sem API e sem rate limit, num worker que ja esta
// de pe. O teto continua existindo pra nao martelar os repos a cada batida.
const POLL_LOCK = 'monitor:repo-poll';
const POLL_LOCK_TTL = 150;

/**
 * Pede a um worker que leia o HEAD remoto dos repos que a gente builda.
 *
 * Pendurado no heartbeat, como a varredura de hosts offline: nao ha
 * scheduler neste sistema, e criar um so' pra isto seria um processo a
 * mais pra manter vivo. A trava no Redis garante uma passada por janela,
 * por mais hosts que batam nesse intervalo.
 */
export async function requestRepoHeadsThrottled(): Promise<void> {
  try {
    const gotLock = await redis.set(POLL_LOCK, '1', 'EX', POLL_LOCK_TTL, 'NX');
    if (!gotLock) return;

    // Na mesma janela: producao converge pro git tenha ele mudado por quem
    // for, nao so' por promocao. Vai ANTES do worker porque nao depende de
    // haver worker vivo -- o alvo de deploy e' outro host, e sem esta ordem
    // uma frota sem worker deixaria de reconciliar tambem.
    await reconcileComposeDrift();

    const worker = await pickBuildWorker();
    if (!worker) return;

    // So' repos de servicos que NOS buildamos. Um 'upstream' nao tem repo
    // nosso pra observar, e um 'managed' nao tem imagem nenhuma.
    const repos = [
      ...new Set(
        (await listServices())
          .filter((s) => s.source?.kind === 'build')
          .map((s) => (s.source as { kind: 'build'; repo: string }).repo)
          .filter(Boolean)
      ),
    ];
    if (!repos.length) return;

    await enqueueRepoHeadsJob(worker, repos.join(','));
  } catch (error) {
    // Nunca pode derrubar o heartbeat: o host que reportou esta bem.
    console.error('polling de HEAD dos repos falhou:', error);
  }
}

/**
 * Recebe o mapa {repo: sha} do worker e enfileira build do que mudou.
 *
 * Nao decide "o que mudou na imagem" por caminho de arquivo -- isso erra
 * nos dois sentidos (mexer no Dockerfile nao muda path de app; mexer no
 * package.json muda tudo). Builda quando o SHA muda e deixa o cache do
 * Docker decidir o custo: se nada que entra na imagem mudou, o build leva
 * segundos.
 */
export async function ingestRepoHeads(_db: Db, heads: Record<string, string>): Promise<void> {
  const servicos = (await listServices()).filter((s) => s.source?.kind === 'build');

  for (const svc of servicos) {
    const repo = (svc.source as { kind: 'build'; repo: string }).repo;
    const sha = heads[repo];
    if (!sha) continue;

    // Ja tentou este sha (ok ou falha) -- nao repete. Ver lastAttemptedSha.
    if ((await lastAttemptedSha(svc.name)) === sha) continue;
    // Um build por servico de cada vez: dois jobs disputariam a mesma
    // worktree em /var/rcaldas/build/<repo>.
    if (await hasRunningBuild(svc.name)) continue;

    const worker = await pickBuildWorker();
    if (!worker) return; // sem worker vivo agora; tenta na proxima janela

    const jobId = await enqueueBuildJob(worker, {
      repo,
      imageBase: `registry.rcaldas.com/rcaldas/${svc.name}`,
      ref: (svc.source as { ref?: string }).ref,
    });
    if (!jobId) continue;

    await startBuild({ service: svc.name, repo, worker, jobId });
    console.log(`build automatico enfileirado: ${svc.name} ${sha.slice(0, 7)} em ${worker}`);
  }
}
