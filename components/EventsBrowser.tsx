'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { components } from '@/types/api';
import { COUNTIES } from '@/lib/validation';
import { readMyEvents, type RememberedEvent } from '@/lib/myEventsMemory';
import { api } from './api';
import { useAuth } from './AuthProvider';
import { EventTypeIcon } from './icons';
import { formatEat } from './time';
import { Badge, Card, EmptyState, Field, linkButtonClass, Loading, Notice, Select } from './ui';

type Event = components['schemas']['Event'];

export const TYPE_LABEL: { [type in Event['type']]: string } = {
  wedding: 'Wedding',
  conference: 'Conference',
  concert: 'Concert',
  corporate: 'Corporate',
  other: 'Other',
};

/** A framed event pass: what, when, where. */
export function EventCard({ event, mine = false }: { event: Event; mine?: boolean }) {
  return (
    <Card variant={mine ? 'featured' : 'default'} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <EventTypeIcon type={event.type} className="text-brand" />
          <Badge tone="neutral">{TYPE_LABEL[event.type]}</Badge>
        </div>
        {mine && (
          <Badge tone="accent" glyph="★">
            Your event
          </Badge>
        )}
      </div>
      <h3 className="font-display text-lg font-bold leading-snug">
        <Link href={`/events/${event.id}`} className="text-ink hover:text-brand">
          {event.name}
        </Link>
      </h3>
      <p className="font-mono text-xs font-semibold text-brand">{formatEat(event.startsAt)}</p>
      <div aria-hidden="true" className="my-1 border-t border-dashed border-line" />
      <p className="text-xs text-ink-secondary">
        {event.venue}, {event.area}, {event.county} &middot; about {event.expectedGuests} guests
      </p>
    </Card>
  );
}

/** Events this device remembers the organiser creating or opening: quick ways back in. */
function YourEvents({ remembered }: { remembered: RememberedEvent[] }) {
  if (remembered.length === 0) return null;
  return (
    <section aria-labelledby="yours-heading" className="rounded-md border-2 border-line-strong bg-surface-warm p-4 shadow-tactile-sm">
      <h2 id="yours-heading" className="font-display text-lg font-semibold">
        Your events on this device
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {remembered.slice(0, 5).map((e) => (
          <li key={e.id}>
            <Link href={`/events/${e.id}`} className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm font-semibold hover:bg-surface-subtle">
              <span aria-hidden="true" className="text-accent">★</span>
              {e.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Upcoming events, optionally for one county. The same list Kazi Connect reads through the API. */
export function EventsBrowser() {
  const { user, ready } = useAuth();
  const [county, setCounty] = useState('');
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [remembered, setRemembered] = useState<RememberedEvent[]>([]);

  // Read after the page is up, so the server's HTML and the first browser render agree.
  useEffect(() => {
    setRemembered(user ? readMyEvents(user.id) : []);
  }, [user, events]);

  // Waits until we know whether someone is logged in, and asks again when that changes: once the
  // partner API is protected by keys, the website reads events with the organiser's login instead.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setEvents(null);
    setError(null);
    setNeedsLogin(false);
    const query = county ? `&county=${encodeURIComponent(county)}` : '';
    void api<Event[]>(`/api/events?status=upcoming${query}`).then((res) => {
      if (cancelled) return;
      if (res.ok) setEvents(res.data);
      else if (res.status === 401) setNeedsLogin(true);
      else setError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [county, ready, user?.id]);

  const mineIds = new Set(remembered.map((e) => e.id));

  return (
    <div className="space-y-4">
      <YourEvents remembered={remembered} />
      <div className="rounded-md border border-line bg-surface-subtle p-3 sm:max-w-sm">
        <Field label="County">
          <Select value={county} onChange={(e) => setCounty(e.target.value)}>
            <option value="">All counties</option>
            {COUNTIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {needsLogin && (
        <Card variant="featured" className="space-y-3">
          <p className="font-display text-xl font-bold">Log in to see the upcoming events</p>
          <p className="max-w-prose text-sm text-ink-secondary">
            Events are shared with signed-in organisers, so you can plan around what is already booked.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/login" className={linkButtonClass.primary}>
              Log in
            </Link>
            <Link href="/register" className={linkButtonClass.secondary}>
              {/* the link's text is the sentence "create an account"; the first letter is capitalised by style only */}
              <span className="inline-block first-letter:uppercase">create an account</span>
            </Link>
          </div>
        </Card>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {!error && !needsLogin && events === null && <Loading skeletons={4}>Loading events...</Loading>}
      {events && events.length === 0 && <EmptyState>No upcoming events{county ? ` in ${county}` : ''} yet.</EmptyState>}
      {events && events.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <EventCard event={event} mine={mineIds.has(event.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
