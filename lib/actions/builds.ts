'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { enqueueBuildJob, pickBuildWorker, setBuildWorker } from '@/lib/monitor';
import { getService } from '@/lib/services';
import { hasRunningBuild, startBuild } from '@/lib/builds';

export async function setBuildWorkerAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await setBuildWorker(host, formData.get('enabled') === 'on');
  revalidatePath('/monitor');
  revalidatePath(`/monitor/${host}`);
}

export type BuildTriggerResult = { ok: boolean; message: string };

export async function triggerBuildAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get('service') || '');
  if (!name) return;

  const svc = await getService(name);
  // Só serviço que NÓS construímos tem o que buildar. Um 'upstream' tem
  // imagem publicada por terceiro; 'managed'/'external' não têm imagem.
  if (!svc || svc.source?.kind !== 'build') return;

  // Um build por serviço de cada vez. Sem isso, clicar duas vezes enfileira
  // dois jobs que disputam a MESMA worktree em /var/rcaldas/build/<repo> --
  // o segundo apagaria a árvore do primeiro no meio do docker build.
  if (await hasRunningBuild(name)) return;

  const worker = await pickBuildWorker();
  if (!worker) return;

  const jobId = await enqueueBuildJob(worker, {
    repo: svc.source.repo,
    imageBase: `registry.rcaldas.com/rcaldas/${name}`,
    ref: svc.source.ref,
  });
  if (!jobId) return;

  await startBuild({ service: name, repo: svc.source.repo, worker, jobId });
  revalidatePath(`/monitor/servicos/${name}`);
}
