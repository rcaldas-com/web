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
  enqueueJob,
  findBackupRunner,
  setBackupRunner,
  resolveIncidentManually,
  setHostRole,
  setFirewallConfig,
  type MonitorHost,
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

// Diretorios chegam como texto (um por linha), no formato:
//   /caminho
//   /caminho !exclude1 !exclude2
//   /caminho/dentro/do/hd @mount=/ponto/de/montagem
// Textarea em vez de campos dinamicos porque e mais rapido de editar a mao
// e nao exige JS pra adicionar/remover linha.
function parseIncludes(raw: string) {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((linha) => {
      const partes = linha.split(/\s+/);
      const path = partes[0];
      const excludes = partes.slice(1).filter((p) => p.startsWith('!')).map((p) => p.slice(1));
      const mountToken = partes.slice(1).find((p) => p.startsWith('@mount='));
      const mountPoint = mountToken ? mountToken.slice('@mount='.length) : undefined;
      return {
        path,
        ...(excludes.length ? { excludes } : {}),
        ...(mountPoint ? { mountPoint } : {}),
      };
    })
    .filter((i) => i.path.startsWith('/'));
}

function intOuPadrao(raw: FormDataEntryValue | null, padrao: number, minimo = 1) {
  // Number('') === 0 em JS -- campo deixado em branco (a intencao de
  // "usa o padrao") virava um 0 EXPLICITO gravado no banco, nao o padrao.
  // rsnapshot rejeita retain 0 em qualquer nivel ("must be at least 1 or
  // higher"), entao isso quebrava o cron inteiro daquele host ate alguem
  // notar pelo alerta -- foi exatamente o que aconteceu com o "bag".
  // 'minimo' e' 1 por padrao mas 'hora' passa 2 -- ver getBackupPlan pro
  // porque (e' o unico nivel que puxa dado de verdade, retain 1 nele
  // corre risco de perder a puxada anterior antes do 'dia' promover).
  const n = Number(String(raw || '').trim());
  return Number.isInteger(n) && n >= minimo ? n : padrao;
}

export async function setBackupConfigAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;

  await setBackupConfig(host, {
    enabled: formData.get('enabled') === 'on',
    includes: parseIncludes(String(formData.get('includes') || '')),
    retention: {
      hora: intOuPadrao(formData.get('retHora'), 6, 2),
      dia: intOuPadrao(formData.get('retDia'), 7),
      semana: intOuPadrao(formData.get('retSemana'), 4),
      mes: intOuPadrao(formData.get('retMes'), 3),
    },
  });
  // O runner e um host com agente como qualquer outro: em vez de voce
  // rodar backup-config na mao, enfileira o job e ele mesmo regera a
  // config no proximo heartbeat.
  const runner = await findBackupRunner();
  if (runner) await enqueueJob(runner, 'backup-config');

  revalidatePath(`/monitor/${host}`);
}

export async function setBackupRunnerAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  const enabled = formData.get('enabled') === 'on';
  const snapshotRoot = String(formData.get('snapshotRoot') || '').trim();
  if (snapshotRoot && !snapshotRoot.startsWith('/')) return;
  await setBackupRunner(host, enabled, snapshotRoot || undefined);
  // Virou runner agora: ja pede as configs de todos os hosts.
  if (enabled) await enqueueJob(host, 'backup-config');
  revalidatePath('/monitor');
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

export async function resolveIncidentAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  if (!id) return;
  await resolveIncidentManually(id);
  revalidatePath('/monitor');
}

export async function setHostRoleAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  const raw = String(formData.get('role') || 'standard');
  const role: MonitorHost['role'] = raw === 'proxy' || raw === 'home' ? raw : 'standard';
  await setHostRole(host, role);
  revalidatePath(`/monitor/${host}`);
}

function parsePorts(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535);
}

export async function setFirewallConfigAction(formData: FormData) {
  await requireAdmin();
  const host = String(formData.get('host') || '');
  if (!host) return;
  await setFirewallConfig(host, {
    enabled: formData.get('enabled') === 'on',
    ports: parsePorts(String(formData.get('ports') || '')),
  });
  revalidatePath(`/monitor/${host}`);
}
