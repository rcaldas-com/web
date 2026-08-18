import { redirect } from 'next/navigation';
import { listDomains } from '@/lib/domains';
import { AuthError, requireAdmin } from '@/lib/auth';
import {
  createDomainAction,
  deleteDomainAction,
  toggleShortLinksAction,
  setDomainCloudflareAction,
  clearDomainCloudflareAction,
} from '@/lib/actions/domains';
import SubmitButton from '@/components/SubmitButton';
import ConfirmSubmit from '@/components/ConfirmSubmit';

export default async function DomainsSettingsPage() {
  let domains;
  try {
    await requireAdmin();
    domains = await listDomains();
  } catch (error) {
    if (error instanceof AuthError) redirect('/login?callbackUrl=/configuracoes/dominios');
    throw error;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Domínios</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Domínios que a app conhece. Credenciais da Cloudflare são opcionais -- só entram se o domínio precisar de
          gerenciamento automático de DNS (ex: links curtos como subdomínio).
        </p>
      </div>

      <form
        action={createDomainAction}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <input
          type="text"
          name="name"
          placeholder="exemplo.com"
          required
          className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <SubmitButton className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          novo domínio
        </SubmitButton>
      </form>

      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {domains.map((domain) => (
            <div key={domain._id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-zinc-950 dark:text-zinc-50">{domain.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      domain.hasCloudflare
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {domain.hasCloudflare ? 'Cloudflare configurada' : 'sem Cloudflare'}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-sm">
                  <form action={toggleShortLinksAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={domain._id} />
                    <input type="hidden" name="enabled" value={domain.shortLinksEnabled ? 'false' : 'true'} />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Links curtos</span>
                    <SubmitButton
                      className={`rounded-full px-2 py-1 text-xs ${
                        domain.shortLinksEnabled
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {domain.shortLinksEnabled ? 'ativo' : 'inativo'}
                    </SubmitButton>
                  </form>

                  <form action={deleteDomainAction}>
                    <input type="hidden" name="id" value={domain._id} />
                    <ConfirmSubmit
                      message={`Apagar "${domain.name}"?\n\nSe links curtos estiverem usando esse domínio, param de funcionar.`}
                      className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
                    >
                      apagar
                    </ConfirmSubmit>
                  </form>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                  credenciais da Cloudflare
                </summary>
                <form action={setDomainCloudflareAction} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
                  <input type="hidden" name="id" value={domain._id} />
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Zone ID</span>
                    <input
                      type="text"
                      name="zoneId"
                      defaultValue={domain.cloudflare?.zoneId ?? ''}
                      className="w-56 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      API Token {domain.hasCloudflare && '(em branco = manter o atual)'}
                    </span>
                    <input
                      type="password"
                      name="apiToken"
                      autoComplete="new-password"
                      placeholder={domain.hasCloudflare ? '••••••••' : ''}
                      className="w-56 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </label>
                  <SubmitButton className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                    salvar
                  </SubmitButton>
                </form>
                {domain.hasCloudflare && (
                  <form action={clearDomainCloudflareAction} className="mt-2">
                    <input type="hidden" name="id" value={domain._id} />
                    <ConfirmSubmit
                      message={`Remover as credenciais da Cloudflare de "${domain.name}"?`}
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      remover credenciais
                    </ConfirmSubmit>
                  </form>
                )}
              </details>
            </div>
          ))}
          {!domains.length && <div className="p-4 text-sm text-zinc-500">Nenhum domínio cadastrado ainda.</div>}
        </div>
      </div>
    </div>
  );
}
