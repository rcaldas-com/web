import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import clientPromise from './mongodb';
import { sendVerificationEmail } from './email';
import { AuthUser, UserSession } from './definitions';

export async function getUserById(userId: string): Promise<AuthUser | null> {
  try {
    const client = await clientPromise;
    const db = client.db();
    const user = await db.collection('user').findOne(
      { _id: new ObjectId(userId) },
      { projection: { password: 0 } }
    );

    if (!user) return null;

    return {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      password: '',
      globalRole: user.globalRole || null,
      createdAt: user.createdAt,
      isActive: user.isActive ?? true,
      emailVerified: user.emailVerified ?? false,
      verificationToken: user.verificationToken || null,
      verificationTokenExpires: user.verificationTokenExpires || null,
    };
  } catch (error) {
    console.error('Database Error:', error);
    return null;
  }
}

export async function getUserByEmail(email: string): Promise<AuthUser | null> {
  try {
    const client = await clientPromise;
    const db = client.db();

    const user = await db.collection('user').findOne({ email });
    if (!user) return null;

    if (user.isActive === false) {
      return null;
    }

    return {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      password: user.password,
      globalRole: user.globalRole || null,
      createdAt: user.createdAt,
      isActive: user.isActive ?? true,
      emailVerified: user.emailVerified ?? true,
      verificationToken: user.verificationToken ?? null,
      verificationTokenExpires: user.verificationTokenExpires ?? null,
    };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch user.');
  }
}

export async function authenticateUser(email: string, password: string): Promise<UserSession | null> {
  try {
    const user = await getUserByEmail(email);
    if (!user) return null;

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) return null;

    if (!user.emailVerified) {
      return null;
    }

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      globalRole: user.globalRole,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
    };
  } catch (error) {
    console.error('Authentication Error:', error);
    return null;
  }
}

export async function verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
  try {
    const client = await clientPromise;
    const db = client.db();

    const tokenDoc = await db.collection('rcaldas_token').findOne({
      token,
      feature: 'verify-email',
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
      return { success: false, message: 'Token inválido ou expirado' };
    }

    await db.collection('user').updateOne(
      { email: tokenDoc.email },
      { $set: { emailVerified: true } }
    );

    await db.collection('rcaldas_token').updateOne(
      { _id: tokenDoc._id },
      { $set: { used: new Date() } }
    );

    return { success: true, message: 'Email verificado com sucesso!' };
  } catch (error) {
    console.error('Verify Email Error:', error);
    return { success: false, message: 'Erro ao verificar email' };
  }
}

export async function resendVerificationEmail(email: string): Promise<{ success: boolean; message: string }> {
  try {
    const user = await getUserByEmail(email);

    if (!user) {
      return { success: false, message: 'Usuário não encontrado' };
    }

    if (user.emailVerified) {
      return { success: false, message: 'Email já verificado' };
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const client = await clientPromise;
    const db = client.db();

    await db.collection('rcaldas_token').insertOne({
      email,
      token: verificationToken,
      feature: 'verify-email',
      app: 'rcaldas',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      used: false,
    });

    await sendVerificationEmail(email, verificationToken, user.name);

    return { success: true, message: 'Email de verificação reenviado com sucesso' };
  } catch (error) {
    console.error('Resend Verification Email Error:', error);
    return { success: false, message: 'Erro ao reenviar email de verificação' };
  }
}
