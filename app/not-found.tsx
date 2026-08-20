import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">404</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Página não encontrada.</p>
      <Link href="/" className="text-sm text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
        Voltar pro início
      </Link>
    </main>
  );
}
