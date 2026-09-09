import { getSessionUserId } from '@/lib/auth';
import { getProfile } from '@/lib/finance/data';
import ProfileForm from './ProfileForm';

export default async function ProfileSetupPage() {
  const userId = await getSessionUserId();
  const profile = userId ? await getProfile(userId) : null;

  return (
    <>
      <ProfileForm profile={profile} isGuest={!userId} />
    </>
  );
}
