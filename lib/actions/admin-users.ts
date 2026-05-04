'use server';

import { ObjectId } from 'mongodb';
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

export async function updateManagedUser(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get('userId') || '');
  if (!ObjectId.isValid(userId)) return;

  const client = await clientPromise;
  const db = client.db();
  const user = await db.collection('user').findOne({ _id: new ObjectId(userId) });
  if (!user?.email) return;

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
}
