'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { setDdnsEnabled, setTunnelEnabled, openTunnel, setTunnelPort, createHost, deleteHost } from '@/lib/monitor';

export async function toggleDdnsAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await setDdnsEnabled(host, formData.get('enabled') === 'true');
  revalidatePath('/monitor');
}

export async function disableTunnelAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await setTunnelEnabled(host, false);
  revalidatePath('/monitor');
}

// Um clique so: habilita o tunel se preciso, atribui a proxima porta livre
// se o host ainda nao tiver uma, e ja dispara o pedido de abertura.
export async function openTunnelAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  try {
    await openTunnel(host);
  } catch {
    // host apagado entre o render e o clique -- ignora, a linha some no
    // proximo revalidate
  }
  revalidatePath('/monitor');
}

export async function setTunnelPortAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  const port = Number(formData.get('port'));
  if (!host || !Number.isInteger(port) || port <= 1024 || port > 65535) return;
  await setTunnelPort(host, port);
  revalidatePath('/monitor');
}

export async function createHostAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '').trim();
  if (!host) return;
  await createHost(host, {
    ddnsEnabled: formData.get('ddnsEnabled') === 'on',
    tunnelEnabled: formData.get('tunnelEnabled') === 'on',
  });
  revalidatePath('/monitor');
}

export async function deleteHostAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await deleteHost(host);
  revalidatePath('/monitor');
}
