'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { enqueueBuildJob, pickBuildWorker, setBuildWorker } from '@/lib/monitor';
import { getService } from '@/lib/services';
import { currentRunningBuild, startBuild } from '@/lib/builds';
import { promoteImage } from '@/lib/promote';

export async function promoteBuildAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const service = String(formData.get('service') || '');
  const tag = String(formData.get('tag') || '');
  if (!service || !tag) return;

  const svc = await getService(service);
  // So' promove o que tem imagem que alguem publica. 'managed'/'external'
  // nao tem o que promover.
  if (!svc || (svc.source?.kind !== 'build' && svc.source?.kind !== 'upstream')) return;

  const resultado = await promoteImage(`registry.rcaldas.com/rcaldas/${service}`, tag);
  if (!resultado.ok) {
    // Nao lanca: erro de promocao nao deve virar tela de erro 500. Fica no
    // log do servidor e a pagina simplesmente continua mostrando a tag
    // antiga, que e' a verdade.
    console.error(`promocao de ${service}:${tag} falhou: ${resultado.erro}`);
    return;
  }

  console.log(`promovido ${service}: ${resultado.de} -> ${resultado.para} (commit ${resultado.commit})`);
  revalidatePath(`/monitor/servicos/${service}`);
  revalidatePath('/monitor/servicos');
}

export async function setBuildWorkerAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await setBuildWorker(host, formData.get('enabled') === 'on');
  revalidatePath('/monitor');
  revalidatePath(`/monitor/${host}`);
}

export type BuildTriggerResult = { ok: boolean; message: string };

function formatHora(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(value);
}

// Antes retornava void e o clique em "buildar agora" com um build (real)
// em andamento simplesmente nao fazia nada visivel -- parecia bug, nao
// bloqueio deliberado. Devolve motivo agora; a UI (BuildTriggerForm) usa
// useActionState pra mostrar. Builds travados (worker morto ha mais de
// STALE_RUNNING_MS) nao contam aqui -- currentRunningBuild ja os ignora,
// entao o botao libera sozinho sem esperar o proximo sweep. Ver builds.ts.
export async function triggerBuildAction(
  _prevState: BuildTriggerResult,
  formData: FormData
): Promise<BuildTriggerResult> {
  await requireAdmin();
  const name = String(formData.get('service') || '');
  if (!name) return { ok: false, message: 'serviço não informado' };

  const svc = await getService(name);
  // Só serviço que NÓS construímos tem o que buildar. Um 'upstream' tem
  // imagem publicada por terceiro; 'managed'/'external' não têm imagem.
  if (!svc || svc.source?.kind !== 'build') return { ok: false, message: 'serviço não tem build' };

  // Um build por serviço de cada vez. Sem isso, clicar duas vezes enfileira
  // dois jobs que disputam a MESMA worktree em /var/rcaldas/build/<repo> --
  // o segundo apagaria a árvore do primeiro no meio do docker build.
  const emAndamento = await currentRunningBuild(name);
  if (emAndamento) {
    return {
      ok: false,
      message: `já tem um build rodando em ${emAndamento.worker} desde ${formatHora(emAndamento.startedAt)}`,
    };
  }

  const worker = await pickBuildWorker();
  if (!worker) return { ok: false, message: 'nenhum worker de build disponível agora' };

  const jobId = await enqueueBuildJob(worker, {
    repo: svc.source.repo,
    imageBase: `registry.rcaldas.com/rcaldas/${name}`,
    ref: svc.source.ref,
  });
  if (!jobId) return { ok: false, message: 'falha ao enfileirar o job' };

  await startBuild({ service: name, repo: svc.source.repo, worker, jobId });
  revalidatePath(`/monitor/servicos/${name}`);
  return { ok: true, message: 'build enfileirado' };
}
