'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { components } from '@/types/api';
import { COUNTIES } from '@/lib/validation';
import { api } from './api';
import { formatEat } from './time';
import { Badge, Card, Field, Loading, Notice, Select } from './ui';

type Event = components['schemas']['Event'];

export const TYPE_LABEL: { [type in Event['type']]: string } = {
  wedding: 'Wedding',
  conference: 'Conference',
  concert: 'Concert',
  corporate: 'Corporate',
  other: 'Other',
};

export function EventCard({ event }: { event: Event }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">
          <Link href={`/events/${event.id}`} className="text-ink hover:text-brand hover:underline">
            {event.name}
          </Link>
        </h3>
        <Badge tone="neutral">{TYPE_LABEL[event.type]}</Badge>
      </div>
      <p className="text-sm text-stone-700">{formatEat(event.startsAt)}</p>
      <p className="text-sm text-stone-600">
        {event.venue}, {event.area}, {event.county} &middot; about {event.expectedGuests} guests
      </p>
    </Card>
  );
}

/** Upcoming events, optionally for one county. The same list Kazi Connect reads through the API. */
export function EventsBrowser() {
  const [county, setCounty] = useState('');
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    const query = county ? `&county=${encodeURIComponent(county)}` : '';
    void api<Event[]>(`/api/events?status=upcoming${query}`).then((res) => {
      if (cancelled) return;
      if (res.ok) setEvents(res.data);
      else setError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [county]);

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
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
      {error && <Notice kind="error">{error}</Notice>}
      {!error && events === null && <Loading>Loading events...</Loading>}
      {events && events.length === 0 && <Notice>No upcoming events{county ? ` in ${county}` : ''} yet.</Notice>}
      {events && events.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
