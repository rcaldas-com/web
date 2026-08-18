'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import {
  createDomain,
  deleteDomain,
  setShortLinksEnabled,
  setDomainCloudflare,
  clearDomainCloudflare,
} from '@/lib/domains';

export async function createDomainAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get('name') || '');
  if (!name) return;
  await createDomain(name);
  revalidatePath('/configuracoes/dominios');
}

export async function deleteDomainAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  if (!id) return;
  await deleteDomain(id);
  revalidatePath('/configuracoes/dominios');
}

export async function toggleShortLinksAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  if (!id) return;
  await setShortLinksEnabled(id, formData.get('enabled') === 'true');
  revalidatePath('/configuracoes/dominios');
}

export async function setDomainCloudflareAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  const zoneId = String(formData.get('zoneId') || '').trim();
  const apiToken = String(formData.get('apiToken') || '');
  if (!id || !zoneId) return;
  await setDomainCloudflare(id, zoneId, apiToken);
  revalidatePath('/configuracoes/dominios');
}

export async function clearDomainCloudflareAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') || '');
  if (!id) return;
  await clearDomainCloudflare(id);
  revalidatePath('/configuracoes/dominios');
}
