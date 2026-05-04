import { getCurrentUser, hasRole } from '@/lib/auth';
import DigitarClient from './DigitarClient';

export default async function DigitarPage() {
  const user = await getCurrentUser();
  return <DigitarClient canUseExternalAi={hasRole(user, 'digitar')} />;
}
