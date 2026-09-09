'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Substitui a trilha "1. Perfil → 2. Cartões → ..." (texto fixo, sem link)
// que cada page.tsx repetia. Aquilo forçava passar pelas etapas em ordem
// mesmo pra um ajuste pontual -- incluir uma despesa exigia clicar Próximo
// três vezes a partir do Perfil. Aba navega direto pra qualquer etapa, e
// nenhuma delas trava a outra: todo formulário aqui já salva sozinho,
// então pular a ordem nunca deixou dado pela metade.
const TABS = [
  { href: '/finance/setup/profile', label: 'Perfil' },
  { href: '/finance/setup/cards', label: 'Cartões' },
  { href: '/finance/setup/expenses', label: 'Despesas' },
  { href: '/finance/setup/installments', label: 'Parcelas' },
] as const;

export default function SetupTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
