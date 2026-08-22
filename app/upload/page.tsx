import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AuthError, requireAuth } from '@/lib/auth';
import { listDomains, normalizeDomainName } from '@/lib/domains';
import { listLinksForUser, listUnlinkedUploadFiles } from '@/lib/shortlinks';
import { createExistingLinkAction, deleteLinkAction } from '@/lib/actions/shortlinks';
import SubmitButton from '@/components/SubmitButton';
import ConfirmSubmit from '@/components/ConfirmSubmit';
import CopyLinkButton from '@/components/CopyLinkButton';
import UploadWidget from './UploadWidget';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

export default async function UploadPage() {
  let user;
  try {
    user = await requireAuth();
  } catch (error) {
    if (error instanceof AuthError) redirect('/login?callbackUrl=/upload');
    throw error;
  }

  const [allDomains, links, existingFiles, headersList] = await Promise.all([
    listDomains(),
    listLinksForUser(user._id),
    listUnlinkedUploadFiles(),
    headers(),
  ]);

  const domainNames = allDomains.filter((d) => d.shortLinksEnabled).map((d) => d.name);
  const currentHost = normalizeDomainName(headersList.get('host') || '');
  const defaultDomain = domainNames.includes(currentHost) ? currentHost : domainNames[0] || '';

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-5 py-10">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Upload/Links</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Envie um arquivo e receba um link curto pra compartilhar, ou gere um link pra algo que já está em{' '}
          <code>live/upload</code>.
        </p>
      </div>

      <UploadWidget domains={domainNames} defaultDomain={defaultDomain} />

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Gerar link de um arquivo existente</h2>
        {existingFiles.length ? (
          <form action={createExistingLinkAction} className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Arquivo em live/upload</span>
              <select
                name="filename"
                required
                className="w-64 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              >
                {existingFiles.map((f) => (
                  <option key={f.filename} value={f.filename}>
                    {f.filename} — {formatBytes(f.size)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Domínio</span>
              <select
                name="domain"
                defaultValue={defaultDomain}
                required
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              >
                {domainNames.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Link (opcional)</span>
              <input
                type="text"
                name="slug"
                placeholder="aleatório"
                title="Letras, números, - e _. Texto inválido é sanitizado; se já estiver em uso, ganha um sufixo."
                className="w-32 rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <SubmitButton className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
              gerar link
            </SubmitButton>
          </form>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Nenhum arquivo novo em <code>live/upload</code> (fora dos que já têm link).
          </p>
        )}
      </section>

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Meus links <span className="text-zinc-400 dark:text-zinc-500">({links.length})</span>
        </h2>
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {links.map((link) => {
            const url = `https://${link.domain}/${link.slug}`;
            return (
              <div key={link._id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-900 dark:text-zinc-50">{link.originalFilename}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono">{url}</span>
                    <span>{formatBytes(link.size)}</span>
                    <span>{link.hits} acesso{link.hits === 1 ? '' : 's'}</span>
                    <span>{formatDate(link.createdAt)}</span>
                    {link.type === 'existing' && (
                      <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">arquivo externo</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CopyLinkButton
                    url={url}
                    className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  />
                  <form action={deleteLinkAction}>
                    <input type="hidden" name="id" value={link._id} />
                    <ConfirmSubmit
                      message={
                        link.type === 'upload'
                          ? `Apagar o link de "${link.originalFilename}"?\n\nO arquivo enviado também será apagado.`
                          : `Apagar o link de "${link.originalFilename}"?\n\nO arquivo continua em live/upload, só o link some.`
                      }
                      className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
                    >
                      apagar
                    </ConfirmSubmit>
                  </form>
                </div>
              </div>
            );
          })}
          {!links.length && <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">Nenhum link criado ainda.</div>}
        </div>
      </section>
    </main>
  );
}
