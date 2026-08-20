'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { listDomains } from '@/lib/domains';
import { createExistingFileLink, deleteLink } from '@/lib/shortlinks';

// So os dominios que o admin marcou shortLinksEnabled sao aceitos --
// checado aqui de novo (nao so na UI) porque o form podia, em tese, ser
// re-submetido com um dominio diferente do que a tela mostrou.
async function assertDomainAllowed(domain: string) {
  const domains = await listDomains();
  const match = domains.find((d) => d.name === domain && d.shortLinksEnabled);
  if (!match) throw new Error('dominio invalido ou sem links curtos habilitados');
}

export async function createExistingLinkAction(formData: FormData) {
  const user = await requireAuth();
  const filename = String(formData.get('filename') || '');
  const domain = String(formData.get('domain') || '');
  if (!filename || !domain) return;

  await assertDomainAllowed(domain);
  await createExistingFileLink({ domain, filename, createdBy: user._id });
  revalidatePath('/upload');
}

export async function deleteLinkAction(formData: FormData) {
  const user = await requireAuth();
  const id = String(formData.get('id') || '');
  if (!id) return;
  await deleteLink(id, user._id);
  revalidatePath('/upload');
}
