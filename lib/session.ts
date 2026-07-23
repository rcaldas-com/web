import { SignJWT, jwtVerify } from 'jose';

// Sem dependências de banco — pode rodar no middleware (Edge runtime).
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

// Assina um id de usuário num JWT curto, para uso em cookie de sessão.
// O cookie passa a ser à prova de forjamento: qualquer edição no valor
// invalida a assinatura e o token é tratado como "não autenticado".
export async function signSessionToken(userId: string, expiresIn = '30d'): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

// Verifica e decodifica o token. Retorna null se ausente, expirado ou adulterado.
export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
