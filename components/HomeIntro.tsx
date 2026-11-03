'use client';

import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { BrandMark } from './icons';
import { linkButtonClass } from './ui';

const STEPS = [
  { n: '1', title: 'Post event and roles', text: 'Tell us the day and the casual staff it needs.' },
  { n: '2', title: 'Answer Kazi Connect offers', text: 'Student workers are offered for your roles.' },
  { n: '3', title: 'Train and verify', text: 'Book Ujuzi training and check certificates.' },
];

/**
 * What a visitor sees first. Signed out: what Sherehe does in three steps and a way in. Signed in: one
 * short line with the quick action. Nothing is shown until the saved login has been checked, so a signed
 * in organiser never sees the welcome flash by.
 */
export function HomeIntro() {
  const { user, ready } = useAuth();
  if (!ready) return <div aria-hidden="true" className="mb-6 min-h-12" />;

  if (user) {
    return (
      <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface px-4 py-3 text-sm">
        <span>Organising something?</span>
        <Link href="/events/new" className="font-semibold text-brand underline-offset-2 hover:underline">
          Post an event
        </Link>
      </p>
    );
  }

  return (
    <section aria-labelledby="welcome-heading" className="mb-8 rounded-md border-2 border-line-strong bg-surface-warm p-5 shadow-tactile sm:p-6">
      <div className="flex items-center gap-2 text-brand">
        <BrandMark size={20} />
        <span className="font-mono text-xs font-bold uppercase tracking-widest">Sherehe</span>
      </div>
      <h2 id="welcome-heading" className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
        Staff and train your event crew across Kenya
      </h2>
      <p className="mt-2 max-w-xl text-ink-secondary">
        Weddings, conferences, concerts and corporate events: list the staff you need, answer offers from student workers, and train your crew before the day.
      </p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-sm border border-dashed border-ink-muted/60 bg-surface p-3">
            <p className="font-mono text-xs font-bold text-brand">{s.n}</p>
            <p className="font-semibold">{s.title}</p>
            <p className="text-sm text-ink-secondary">{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/register" className={linkButtonClass.primary}>
          Create your account
        </Link>
        <Link href="/login" className={linkButtonClass.secondary}>
          Log in
        </Link>
      </div>
    </section>
  );
}
