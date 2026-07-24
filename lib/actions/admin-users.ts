'use server';

import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin, MASTER_ADMIN_EMAIL } from '@/lib/auth';
import clientPromise from '@/lib/mongodb';
import { UserRole } from '@/lib/definitions';

const MODULE_ROLES: UserRole[] = ['wallet', 'digitar'];

export type ManagedUser = {
  _id: string;
  name: string;
  email: string;
  globalRole: 'admin' | null;
  roles: UserRole[];
  isActive: boolean;
  emailVerified: boolean;
  createdAt: Date | null;
};

function normalizeRoles(email: string, globalRole?: string | null, roles?: unknown): UserRole[] {
  const normalized = Array.isArray(roles)
    ? roles.filter((role): role is UserRole => MODULE_ROLES.includes(role as UserRole))
    : [];

  if ((email.toLowerCase() === MASTER_ADMIN_EMAIL || globalRole === 'admin') && !normalized.includes('admin')) {
    normalized.unshift('admin');
  }

  return normalized;
}

export async function getManagedUsers(): Promise<ManagedUser[]> {
  await requireAdmin();

  const client = await clientPromise;
  const db = client.db();
  const users = await db.collection('user')
    .find({}, { projection: { password: 0 } })
    .sort({ createdAt: -1, email: 1 })
    .toArray();

  return users.map((user) => ({
    _id: user._id.toString(),
    name: user.name || '',
    email: user.email || '',
    globalRole: user.globalRole === 'admin' ? 'admin' : null,
    roles: normalizeRoles(user.email || '', user.globalRole, user.roles),
    isActive: user.isActive ?? true,
    emailVerified: user.emailVerified ?? false,
    createdAt: user.createdAt ?? null,
  }));
}

export type UpdateManagedUserState = {
  success: boolean;
  message: string;
};

export async function updateManagedUser(
  _prevState: UpdateManagedUserState,
  formData: FormData,
): Promise<UpdateManagedUserState> {
  await requireAdmin();

  const userId = String(formData.get('userId') || '');
  if (!ObjectId.isValid(userId)) {
    return { success: false, message: 'Usuário inválido.' };
  }

  const client = await clientPromise;
  const db = client.db();
  const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });
  if (!user?.email) {
    return { success: false, message: 'Usuário não encontrado.' };
  }

  const email = String(user.email).toLowerCase();
  const requestedRoles = formData.getAll('roles').map(String);
  const roles = MODULE_ROLES.filter(role => requestedRoles.includes(role));
  const isMaster = email === MASTER_ADMIN_EMAIL;

  const update = {
    $set: {
      roles: isMaster ? ['admin', ...roles] : roles,
      globalRole: isMaster ? 'admin' : null,
      isActive: isMaster ? true : formData.get('isActive') === 'on',
      emailVerified: formData.get('emailVerified') === 'on',
      updatedAt: new Date(),
    },
  };

  await db.collection('user').updateOne({ _id: user._id }, update);
  revalidatePath('/configuracoes/usuarios');
  return { success: true, message: 'Salvo com sucesso.' };
}

export type UpdateUserEmailState = {
  success: boolean;
  message: string;
  // Email efetivamente gravado — devolvido para o cliente atualizar a linha
  // sem esperar o revalidate.
  email?: string;
};

const emailSchema = z.string().trim().toLowerCase().email();

// Troca o email de um usuário (login/SSO são por ObjectId, então a sessão dele
// não cai). O email verificado NÃO é mexido aqui — fica sob o checkbox da
// linha. Tokens antigos em `rcaldas_token` ficam presos ao email anterior, mas
// expiram sozinhos; não removemos nada aqui.
export async function updateUserEmail(
  _prevState: UpdateUserEmailState,
  formData: FormData,
): Promise<UpdateUserEmailState> {
  await requireAdmin();

  const userId = String(formData.get('userId') || '');
  if (!ObjectId.isValid(userId)) {
    return { success: false, message: 'Usuário inválido.' };
  }

  const parsed = emailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return { success: false, message: 'Email inválido.' };
  }
  const newEmail = parsed.data;

  const client = await clientPromise;
  const db = client.db();
  const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });
  if (!user?.email) {
    return { success: false, message: 'Usuário não encontrado.' };
  }

  const currentEmail = String(user.email).toLowerCase();
  if (currentEmail === MASTER_ADMIN_EMAIL) {
    return { success: false, message: 'Não é possível alterar o email do administrador master.' };
  }
  if (newEmail === MASTER_ADMIN_EMAIL) {
    return { success: false, message: 'Este email é reservado ao administrador master.' };
  }
  if (newEmail === currentEmail) {
    return { success: true, message: 'Email inalterado.', email: currentEmail };
  }

  // Unicidade: nenhum OUTRO usuário pode ter esse email.
  const clash = await db.collection('user').findOne({
    email: newEmail,
    _id: { $ne: user._id },
  });
  if (clash) {
    return { success: false, message: 'Já existe um usuário com esse email.' };
  }

  await db.collection('user').updateOne(
    { _id: user._id },
    { $set: { email: newEmail, updatedAt: new Date() } },
  );
  revalidatePath('/configuracoes/usuarios');
  return { success: true, message: 'Email atualizado.', email: newEmail };
}
