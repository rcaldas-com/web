import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { normalizeDomainName } from '@/lib/domains';
import { MAX_TEXT_BYTES, resolveLink } from '@/lib/shortlinks';
import { saveTextLinkAction } from '@/lib/actions/shortlinks';
import SubmitButton from '@/components/SubmitButton';

// Anotacao simples. Leitura publica de proposito -- o link e' pra ser
// compartilhado, e exigir login pra ler tornaria o recurso inutil. Escrita
// so' de quem criou, checada em updateTextLink (no ponto de mutacao, nao
// so' aqui na tela).
//
// Nao ha cache: uma anotacao editavel servida de cache mostra texto velho
// pra quem acabou de salvar em outra aba.
export const dynamic = 'force-dynamic';

export default async function NotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const headersList = await headers();
  const domain = normalizeDomainName(headersList.get('host') || '');

  const link = await resolveLink(domain, slug);
  if (!link || link.type !== 'text') notFound();

  const user = await getCurrentUser();
  const canEdit = Boolean(user && link.createdBy.toString() === user._id);
  const content = link.content ?? '';

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-5 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{link.originalFilename}</h1>
        <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
          {domain}/{link.slug}
        </span>
      </div>

      {canEdit ? (
        <form action={saveTextLinkAction} className="space-y-3">
          <input type="hidden" name="id" value={link._id.toString()} />
          <input type="hidden" name="slug" value={link.slug} />
          <textarea
            name="content"
            defaultValue={content}
            rows={20}
            maxLength={MAX_TEXT_BYTES}
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-200 bg-white p-3 font-mono text-sm leading-relaxed text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <div className="flex items-center gap-3">
            <SubmitButton className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
              salvar
            </SubmitButton>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              até {Math.round(MAX_TEXT_BYTES / 1024)}KB
            </span>
          </div>
        </form>
      ) : (
        // whitespace-pre-wrap e nao dangerouslySetInnerHTML: o conteudo e'
        // texto do usuario e e' servido na MESMA origem do app autenticado.
        // Renderizar como HTML aqui seria XSS armazenado contra qualquer
        // sessao aberta no mesmo navegador.
        <pre className="w-full whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-relaxed text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          {content || 'Anotação vazia.'}
        </pre>
      )}
    </main>
  );
}
