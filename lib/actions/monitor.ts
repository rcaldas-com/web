'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { setDdnsEnabled, requestTunnel } from '@/lib/monitor';

export async function toggleDdnsAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await setDdnsEnabled(host, formData.get('enabled') === 'true');
  revalidatePath('/monitor');
}

export async function requestTunnelAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  const port = Number(formData.get('port'));
  if (!host || !Number.isInteger(port) || port <= 1024 || port > 65535) return;
  await requestTunnel(host, port);
  revalidatePath('/monitor');
}
