import { cookies } from 'next/headers';
import { getProfile } from '@/lib/finance/data';
import ProfileForm from './ProfileForm';

export default async function ProfileSetupPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('userId')!.value;
  const profile = await getProfile(userId);

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4">
        <span className="font-semibold text-zinc-900">1. Perfil</span>
        <span>→</span><span>2. Cartões</span>
        <span>→</span><span>3. Despesas</span>
        <span>→</span><span>4. Parcelas</span>
      </div>
      <ProfileForm profile={profile} />
    </>
  );
}
