'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { BrandMark, NavIcon, type NavIconName } from './icons';
import { Button } from './ui';

const links: Array<{ href: string; label: string; icon: NavIconName }> = [
  { href: '/', label: 'Events', icon: 'events' },
  { href: '/events/new', label: 'Post an event', icon: 'post' },
  { href: '/training', label: 'Training', icon: 'training' },
  { href: '/certificates', label: 'Certificates', icon: 'certificates' },
  { href: '/docs', label: 'API docs', icon: 'docs' },
];

function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || (pathname.startsWith('/events/') && pathname !== '/events/new');
  return pathname.startsWith(href);
}

/**
 * One navigation landmark with the five main links. On a phone it is docked to the bottom of the screen
 * as a tab bar (easier to reach, and no cramped second line of links); from tablet width up it sits in
 * the top bar. Each icon is beside its link, not inside it, so the link's own text is just its name.
 */
export function Nav() {
  const { user, ready, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  return (
    <header className="sticky top-0 z-30 border-b-2 border-line-strong bg-surface">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2.5 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-display text-xl font-bold tracking-tight text-brand">
          <BrandMark />
          Sherehe
        </Link>

        <nav
          aria-label="Main navigation"
          className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line-strong bg-surface md:static md:inset-auto md:z-auto md:border-0 md:bg-transparent"
        >
          <ul className="flex h-16 items-stretch justify-around md:h-auto md:items-center md:justify-start md:gap-5">
            {links.map((l) => {
              const active = isActive(l.href, pathname);
              const accent = l.href === '/events/new';
              return (
                <li
                  key={l.href}
                  className={[
                    'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 md:flex-none md:flex-row',
                    active ? 'text-ink' : accent ? 'text-brand' : 'text-ink-secondary',
                  ].join(' ')}
                >
                  <span className={['md:hidden', active ? 'text-brand' : ''].join(' ')}>
                    <NavIcon name={l.icon} />
                  </span>
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'text-[11px] font-semibold after:absolute after:inset-0 md:py-1 md:text-sm md:hover:text-ink',
                      active ? 'md:border-b-2 md:border-brand' : '',
                    ].join(' ')}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 text-sm md:gap-3">
          {!ready ? null : user ? (
            <>
              <span className="max-w-32 truncate rounded-xs border border-line bg-surface-subtle px-2.5 py-1 font-mono text-xs sm:max-w-none">
                <span className="hidden sm:inline">Signed in as </span>
                <strong>{user.name}</strong>
              </span>
              <Button
                variant="secondary"
                className="h-9 px-3"
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
              <Link href="/login" className="font-semibold text-ink hover:text-brand">
                Log in
              </Link>
              <Link
                href="/register"
                className="inline-flex h-9 items-center rounded-sm border border-line-strong bg-brand px-3 font-semibold text-white shadow-tactile-sm hover:bg-brand-dark"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
