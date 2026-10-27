'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { Button } from './ui';

const links = [
  { href: '/', label: 'Events' },
  { href: '/events/new', label: 'Post an event' },
  { href: '/training', label: 'Training' },
  { href: '/certificates', label: 'Certificates' },
  { href: '/docs', label: 'API docs' },
];

export function Nav() {
  const { user, ready, signOut } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b border-stone-200 bg-white">
      <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-xl font-bold text-brand">
          Sherehe
        </Link>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="text-stone-700 hover:text-brand hover:underline">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {!ready ? null : user ? (
            <>
              <span className="text-stone-700">
                Signed in as <strong>{user.name}</strong>
              </span>
              <Button
                variant="secondary"
                onClick={async () => {
                  await signOut();
                  router.push('/');
                }}
              >
                Log out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-stone-700 hover:text-brand hover:underline">
                Log in
              </Link>
              <Link href="/register" className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-dark">
                Register
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
