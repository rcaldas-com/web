import ConfiguracoesNav from '@/app/configuracoes/ConfiguracoesNav';

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-10">
      <div className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Configurações</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Administração da conta e da infraestrutura da app.</p>
      </div>
      <ConfiguracoesNav />
      {children}
    </main>
  );
}
