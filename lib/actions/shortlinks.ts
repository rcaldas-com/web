'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { listDomains } from '@/lib/domains';
import {
  createExistingFileLink,
  createTextLink,
  createUrlLink,
  deleteLink,
  sanitizeSlug,
  updateTextLink,
} from '@/lib/shortlinks';

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

  const preferredSlug = sanitizeSlug(String(formData.get('slug') || '')) || undefined;

  await assertDomainAllowed(domain);
  await createExistingFileLink({ domain, filename, createdBy: user._id, preferredSlug });
  revalidatePath('/upload');
}

export async function createUrlLinkAction(formData: FormData) {
  const user = await requireAuth();
  const targetUrl = String(formData.get('targetUrl') || '');
  const domain = String(formData.get('domain') || '');
  if (!targetUrl || !domain) return;

  const preferredSlug = sanitizeSlug(String(formData.get('slug') || '')) || undefined;

  await assertDomainAllowed(domain);
  await createUrlLink({
    domain,
    targetUrl,
    title: String(formData.get('title') || ''),
    createdBy: user._id,
    preferredSlug,
  });
  revalidatePath('/upload');
}

export async function createTextLinkAction(formData: FormData) {
  const user = await requireAuth();
  const domain = String(formData.get('domain') || '');
  if (!domain) return;

  const preferredSlug = sanitizeSlug(String(formData.get('slug') || '')) || undefined;

  await assertDomainAllowed(domain);
  await createTextLink({
    domain,
    content: String(formData.get('content') || ''),
    title: String(formData.get('title') || ''),
    createdBy: user._id,
    preferredSlug,
  });
  revalidatePath('/upload');
}

export async function saveTextLinkAction(formData: FormData) {
  const user = await requireAuth();
  const id = String(formData.get('id') || '');
  const slug = String(formData.get('slug') || '');
  if (!id) return;
  await updateTextLink(id, user._id, String(formData.get('content') || ''));
  // Revalida a propria anotacao e a lista -- sem isso o textarea volta com
  // o conteudo antigo, porque a pagina e' server component cacheada.
  if (slug) revalidatePath(`/n/${slug}`);
  revalidatePath('/upload');
}

export async function deleteLinkAction(formData: FormData) {
  const user = await requireAuth();
  const id = String(formData.get('id') || '');
  if (!id) return;
  await deleteLink(id, user._id);
  revalidatePath('/upload');
}
