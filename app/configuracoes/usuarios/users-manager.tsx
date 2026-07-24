'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ManagedUser } from '@/lib/actions/admin-users';
import UserRow from './user-row';

const PAGE_SIZE = 40;

// Texto pesquisável de um usuário: nome, email e roles, tudo minúsculo, para o
// filtro "enquanto digita" casar com qualquer um deles.
function haystack(user: ManagedUser): string {
  return `${user.name} ${user.email} ${user.roles.join(' ')}`.toLowerCase();
}

export default function UsersManager({
  users,
  masterEmail,
}: {
  users: ManagedUser[];
  masterEmail: string;
}) {
  const [query, setQuery] = useState('');
  // Mantém a digitação fluida mesmo com lista grande: o input responde na hora,
  // a filtragem pesada usa o valor "adiado".
  const deferredQuery = useDeferredValue(query);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return users;
    // Cada termo separado por espaço precisa casar (busca "aditiva").
    const terms = q.split(/\s+/);
    return users.filter((u) => {
      const hay = haystack(u);
      return terms.every((t) => hay.includes(t));
    });
  }, [users, deferredQuery]);

  // Volta ao topo da paginação sempre que o filtro muda.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [deferredQuery]);

  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  // Rolagem sob demanda: quando o sentinela entra na viewport, revela mais.
  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => v + PAGE_SIZE);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, shown.length]);

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar por nome, email ou permissão…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 sm:max-w-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-zinc-700"
        />
        <p className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
          {filtered.length === users.length
            ? `${users.length} usuário${users.length === 1 ? '' : 's'}`
            : `${filtered.length} de ${users.length}`}
        </p>
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden dark:border-zinc-700 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Usuário</th>
                <th className="px-5 py-3 text-left font-semibold">Roles</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
                <th className="px-5 py-3 text-left font-semibold">Criado em</th>
                <th className="px-5 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-zinc-500 dark:text-zinc-400">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                shown.map((user) => (
                  <UserRow
                    key={user._id}
                    user={user}
                    isMaster={user.email.toLowerCase() === masterEmail}
                  />
                ))
              )}
              {hasMore && (
                <tr ref={sentinelRef}>
                  <td colSpan={5} className="px-5 py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
                    Carregando mais…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
