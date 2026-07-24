// Destino pós-login/registro/reset. Aceita caminho relativo ou URL absoluta de
// uma origem conhecida (o wallet, que em produção roda em domínio próprio) —
// nunca um host arbitrário vindo da query, para não virar open redirect.
// Função pura (sem Mongo/bcrypt) para poder ser importada tanto pelo
// middleware (Edge runtime) quanto pelas server actions de auth.
export function resolveCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return '/dashboard';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;

  const allowedOrigins = [process.env.WALLET_URL, process.env.AUTH_TRUST_HOST]
    .filter((u): u is string => Boolean(u))
    .map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return null;
      }
    })
    .filter((o): o is string => o !== null);

  try {
    const url = new URL(raw);
    if (allowedOrigins.includes(url.origin)) return url.toString();
  } catch {
    // URL inválida — cai no padrão.
  }
  return '/dashboard';
}
