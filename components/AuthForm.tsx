'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { components } from '@/types/api';
import { api } from './api';
import { useAuth } from './AuthProvider';
import { Button, Card, Field, Notice, PageTitle, TextInput } from './ui';

type AuthResult = components['schemas']['AuthResult'];

/** Where to go after logging in: the page the person was sent from, but only ever a page on this site. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
}

/** The register and login pages are the same form with a name field added. */
export function AuthForm({ mode, next: requestedNext }: { mode: 'login' | 'register'; next?: string }) {
  const { signIn } = useAuth();
  const router = useRouter();
  const next = safeNext(requestedNext ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === 'register';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = registering
      ? { email: String(form.get('email')), name: String(form.get('name')), password: String(form.get('password')) }
      : { email: String(form.get('email')), password: String(form.get('password')) };
    setBusy(true);
    setError(null);
    const res = await api<AuthResult>(registering ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body, auth: false });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    signIn(res.data);
    router.push(next);
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle>{registering ? 'Create your account' : 'Log in'}</PageTitle>
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {registering && (
            <Field label="Your name">
              <TextInput name="name" autoComplete="name" required maxLength={100} />
            </Field>
          )}
          <Field label="Email">
            <TextInput name="email" type="email" autoComplete="email" required maxLength={254} />
          </Field>
          <Field label="Password" hint={registering ? 'At least 8 characters.' : undefined}>
            <TextInput
              name="password"
              type="password"
              autoComplete={registering ? 'new-password' : 'current-password'}
              required
              minLength={registering ? 8 : undefined}
              maxLength={128}
            />
          </Field>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Please wait...' : registering ? 'Create account' : 'Log in'}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-stone-700">
        {registering ? (
          <>
            Already registered? <Link href="/login" className="font-semibold text-brand hover:underline">Log in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/register" className="font-semibold text-brand hover:underline">Create an account</Link>
          </>
        )}
      </p>
    </div>
  );
}
