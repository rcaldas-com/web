'use server';

import { ObjectId } from 'mongodb';
import { revalidatePath } from 'next/cache';
import { requireAdmin, MASTER_ADMIN_EMAIL } from '@/lib/auth';
import clientPromise from '@/lib/mongodb';
import { previewSweep, sweepAndCloseUserWallets, deleteUserWalletDocs, type SweepPreview } from '@/lib/wallet-sweep';

export async function getUserDeletionPreview(userId: string): Promise<SweepPreview> {
  await requireAdmin();
  return previewSweep(userId);
}

export type DeleteUserState = {
  success: boolean;
  message: string;
};

// Exclui um usuário e tudo que é pessoal dele nos três apps (web, wallet,
// car/web), preservando carros e manutenções (car/web administra só o acesso
// a eles). Nenhum email é enviado. A carteira Stellar custodiada é varrida e
// encerrada primeiro — se essa etapa falhar, nada mais é apagado.
export async function deleteUserAction(userId: string): Promise<DeleteUserState> {
  try {
    await requireAdmin();

    if (!ObjectId.isValid(userId)) {
      return { success: false, message: 'Usuário inválido.' };
    }

    const client = await clientPromise;
    const db = client.db();
    const userObjectId = new ObjectId(userId);

    const userDoc = await db.collection('user').findOne({ _id: userObjectId });
    if (!userDoc) {
      return { success: false, message: 'Usuário não encontrado.' };
    }
    if (userDoc.email?.toLowerCase() === MASTER_ADMIN_EMAIL) {
      return { success: false, message: 'Não é possível excluir o administrador master.' };
    }

    // 1) Varre e encerra a(s) carteira(s) Stellar custodiada(s) — aborta sem
    // apagar nada se falhar.
    try {
      await sweepAndCloseUserWallets(userId);
    } catch (err) {
      console.error('Falha ao varrer carteira Stellar do usuário:', err);
      return {
        success: false,
        message: 'Falha ao esvaziar a carteira Stellar do usuário. Nada foi apagado — verifique o erro e tente novamente.',
      };
    }

    // 2) Docs de wallet (já esvaziados/encerrados, ou readOnly sem fundo custodiado).
    await deleteUserWalletDocs(userId);

    // 3) Dados do módulo finance (web).
    await db.collection('financeProfile').deleteMany({ userId });
    await db.collection('financeCard').deleteMany({ userId });
    await db.collection('financeExpense').deleteMany({ userId });
    await db.collection('financeInstallment').deleteMany({ userId });
    await db.collection('financeMonth').deleteMany({ userId });

    // 4) car/web: acessos a carros e wishlist são pessoais — carros e reparos
    // ficam. wishcar não tem referência direta a usuário, só à wishlist.
    const userWishlists = await db
      .collection('wishlist')
      .find({ user: userObjectId }, { projection: { _id: 1 } })
      .toArray();
    const wishlistIds = userWishlists.map((w) => w._id);
    if (wishlistIds.length > 0) {
      await db.collection('wishcar').deleteMany({ wishlistId: { $in: wishlistIds } });
    }
    await db.collection('wishlist').deleteMany({ user: userObjectId });
    await db.collection('user_car_access').deleteMany({
      $or: [{ userId: userObjectId }, { userId }],
    });

    // 5) Tokens de verificação/reset acumulados pelo email (compartilhado pelos 3 apps).
    if (userDoc.email) {
      await db.collection('rcaldas_token').deleteMany({ email: userDoc.email });
    }

    // 6) O usuário em si.
    await db.collection('user').deleteOne({ _id: userObjectId });

    revalidatePath('/configuracoes/usuarios');
    return { success: true, message: 'Usuário excluído com sucesso.' };
  } catch (error) {
    console.error('Delete user error:', error);
    return { success: false, message: 'Erro ao excluir usuário.' };
  }
}
