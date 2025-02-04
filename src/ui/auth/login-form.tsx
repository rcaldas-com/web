'use client';

import { Button } from '@/ui/button';
import Input from '@/ui/input';
import Label from '@/ui/label';
import { login } from '@/lib/auth/actions';
import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';

export function LoginForm() {
  const initialState = { message: '', errors: {} as any };
  const [state, action] = useFormState(login, undefined);

  return (
    <form action={dispatch}>
      <div className="flex flex-col gap-2">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            placeholder="m@example.com"
            type="email"
          />
          <div id="email-error" aria-live="polite" aria-atomic="true">
            {state.errors?.email &&
              state.errors.email.map((error: string) => (
                <p className="text-sm text-red-500" key={error}>{error}</p>
              ))}
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link className="text-sm underline" href="/auth/reset">
              Forgot your password?
            </Link>
          </div>
          <Input id="password" type="password" name="password" />
          <div id="password-error" aria-live="polite" aria-atomic="true">
            {state.errors?.password &&
              state.errors.password.map((error: string) => (
                <p className="mt-2 text-sm text-red-500" key={error}>
                  {error}
                </p>
              ))}
          </div>
        </div>
        {state.message && (
          <>
            <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
            <p className="text-sm text-red-500">{state.message}</p>
          </>
        )}
        <LoginButton />
      </div>
    </form>
  );
}

export function LoginButton() {
  const { pending } = useFormStatus();

  return (
    <Button aria-disabled={pending} type="submit" className="mt-4 w-full">
      {pending ? 'Submitting...' : 'Sign up'}
    </Button>
  );
}