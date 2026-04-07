import { redirect } from 'next/navigation';

export default function SetupIndexPage() {
  redirect('/finance/setup/profile');
}
