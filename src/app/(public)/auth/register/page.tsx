import Link from 'next/link';
import { RegisterForm } from '@/ui/auth/register-form';


export default function RegisterPage() {
  return (
    <div className="flex flex-col p-4 lg:w-1/3">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Create an account</h1>
        <p className="text-gray-500">Enter your information to get started</p>
      </div>
      <div className="mt-6">
        <RegisterForm />
      </div>
      <div className="mt-6 text-center text-sm">
        Already have an account?{' '}
        <Link className="underline" href="/auth/login">
          Login
        </Link>
      </div>
    </div>
  );
}