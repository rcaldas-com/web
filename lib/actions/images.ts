'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { getMonitorHost } from '@/lib/monitor';
import {
  baseRefs,
  enqueueImageApply,
  enqueueImageCheck,
  listImageChecks,
  listStaleApps,
  rebuildService,
} from '@/lib/images';

// Todas as acoes so' ENFILEIRAM: quem executa e' o agente do host (ou o
// worker, no rebuild), no proximo heartbeat. A tela mostra "na fila" ate o
// resultado chegar.

export async function checkImagesNowAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  const h = await getMonitorHost(host);
  await enqueueImageCheck(host, h?.buildWorker?.enabled ? await baseRefs() : undefined);
  revalidatePath('/monitor/imagens');
}

export async function applyImagesAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  const projeto = String(formData.get('project') || '');
  if (!host) return;
  await enqueueImageApply(host, projeto ? [projeto] : undefined);
  revalidatePath('/monitor/imagens');
}

export async function rebuildAppAction(formData: FormData) {
  await requireAdmin();
  const service = String(formData.get('service') || '');
  if (!service) return;
  const r = await rebuildService(service);
  console.log(`rebuild pedido pela tela: ${r.message}`);
  revalidatePath('/monitor/imagens');
}

// "Atualizar tudo": aplica em cada host que tem imagem publica nova e
// rebuilda cada app com base nova. Um pedido por host/app, cada um
// independente -- falhar um nao segura os outros.
export async function updateAllAction() {
  await requireAdmin();
  for (const h of await listImageChecks()) {
    if (h.images.some((i) => i.status === 'atualizar')) await enqueueImageApply(h.host);
  }
  for (const a of await listStaleApps()) {
    if (a.stale.length) {
      const r = await rebuildService(a.service);
      console.log(`atualizar tudo: ${r.message}`);
    }
  }
  revalidatePath('/monitor/imagens');
}
