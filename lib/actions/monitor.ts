'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import {
  setDdnsEnabled,
  setTunnelEnabled,
  openTunnel,
  setTunnelPort,
  createHost,
  deleteHost,
  setMonitoringConfig,
  setBackupConfig,
} from '@/lib/monitor';

export async function toggleDdnsAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await setDdnsEnabled(host, formData.get('enabled') === 'true');
  revalidatePath('/monitor');
  revalidatePath(`/monitor/${host}`);
}

export async function disableTunnelAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await setTunnelEnabled(host, false);
  revalidatePath('/monitor');
  revalidatePath(`/monitor/${host}`);
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
  revalidatePath(`/monitor/${host}`);
}

export async function setTunnelPortAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  const port = Number(formData.get('port'));
  if (!host || !Number.isInteger(port) || port <= 1024 || port > 65535) return;
  await setTunnelPort(host, port);
  revalidatePath('/monitor');
  revalidatePath(`/monitor/${host}`);
}

export async function setMonitoringConfigAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  const diskRaw = String(formData.get('diskThresholdPct') || '').trim();
  const memRaw = String(formData.get('memoryThresholdPct') || '').trim();
  const cpuRaw = String(formData.get('cpuThresholdPct') || '').trim();
  const diskThresholdPct = diskRaw ? Number(diskRaw) : undefined;
  const memoryThresholdPct = memRaw ? Number(memRaw) : undefined;
  const cpuThresholdPct = cpuRaw ? Number(cpuRaw) : undefined;
  if (diskThresholdPct != null && (!Number.isInteger(diskThresholdPct) || diskThresholdPct < 1 || diskThresholdPct > 100)) return;
  if (memoryThresholdPct != null && (!Number.isInteger(memoryThresholdPct) || memoryThresholdPct < 1 || memoryThresholdPct > 100)) return;
  // CPU vai ate cpuCount*100 (100% = 1 nucleo), entao o teto nao e 100.
  if (cpuThresholdPct != null && (!Number.isInteger(cpuThresholdPct) || cpuThresholdPct < 1 || cpuThresholdPct > 6400)) return;
  await setMonitoringConfig(host, { diskThresholdPct, memoryThresholdPct, cpuThresholdPct });
  revalidatePath(`/monitor/${host}`);
}

export async function setBackupConfigAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  const retentionRaw = String(formData.get('retentionDays') || '').trim();
  const retentionDays = retentionRaw ? Number(retentionRaw) : undefined;
  if (retentionDays != null && (!Number.isInteger(retentionDays) || retentionDays < 1)) return;
  await setBackupConfig(host, {
    enabled: formData.get('enabled') === 'on',
    encrypted: formData.get('encrypted') === 'on',
    retentionDays,
    target: String(formData.get('target') || '').trim() || undefined,
  });
  revalidatePath(`/monitor/${host}`);
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
