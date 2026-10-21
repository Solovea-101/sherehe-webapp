'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { components } from '@/types/api';
import { api } from './api';
import { useAuth } from './AuthProvider';
import { TYPE_LABEL } from './EventsBrowser';
import { OffersPanel } from './OffersPanel';
import { RoleForm } from './RoleForm';
import { RolesTable } from './RolesTable';
import { TrainCrew } from './TrainCrew';
import { formatEat } from './time';
import { Badge, Card, Loading, Notice, PageTitle } from './ui';

type Event = components['schemas']['Event'];
type Role = components['schemas']['Role'];
type Offer = components['schemas']['Offer'];

export function EventDetail({ eventId }: { eventId: string }) {
  const { user, ready } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  // null: not the organiser (or not logged in). An array: the organiser, with the offers on the event.
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [eventRes, rolesRes] = await Promise.all([api<Event>(`/api/events/${eventId}`), api<Role[]>(`/api/events/${eventId}/roles`)]);
    if (!eventRes.ok) {
      setError(eventRes.status === 404 ? 'We could not find that event.' : eventRes.message);
      setLoaded(true);
      return;
    }
    setEvent(eventRes.data);
    setRoles(rolesRes.ok ? rolesRes.data : []);
    // The offers list is for the organiser only: it answers 403 to everybody else. That is how the
    // page learns whether to show the organiser's tools.
    const offersRes = user ? await api<Offer[]>(`/api/events/${eventId}/offers`) : null;
    setOffers(offersRes?.ok ? offersRes.data : null);
    setLoaded(true);
  }, [eventId, user]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready || !loaded) return <Loading>Loading event...</Loading>;
  if (error || !event) {
    return (
      <div className="space-y-4">
        <Notice kind="error">{error ?? 'We could not load that event.'}</Notice>
        <Link href="/" className="text-brand hover:underline">Back to all events</Link>
      </div>
    );
  }

  const isOwner = offers !== null;
  const upcoming = event.status === 'upcoming';

  return (
    <div className="space-y-6">
      <PageTitle>{event.name}</PageTitle>
      <Card className="space-y-1 text-sm">
        <p>
          <Badge tone="neutral">{TYPE_LABEL[event.type]}</Badge>{' '}
          {!upcoming && <Badge tone="bad">{event.status}</Badge>}
        </p>
        <p>{formatEat(event.startsAt)} to {formatEat(event.endsAt)}</p>
        <p>{event.venue}, {event.area}, {event.county}</p>
        <p>About {event.expectedGuests} guests</p>
        {isOwner && <p className="pt-1 font-semibold text-brand">This is your event.</p>}
      </Card>

      <section aria-labelledby="roles-heading">
        <h2 id="roles-heading" className="mb-2 text-xl font-semibold">Staff needed</h2>
        <Card>
          <RolesTable roles={roles} />
        </Card>
      </section>

      {isOwner && upcoming && (
        <section aria-labelledby="add-role-heading">
          <h2 id="add-role-heading" className="mb-2 text-xl font-semibold">Add a staff role</h2>
          <Card>
            <RoleForm eventId={event.id} onAdded={() => void load()} />
          </Card>
        </section>
      )}

      {isOwner && (
        <section aria-labelledby="offers-heading">
          <h2 id="offers-heading" className="mb-2 text-xl font-semibold">Offers from Kazi Connect</h2>
          <Card>
            <OffersPanel offers={offers} roles={roles} onDecided={() => void load()} />
          </Card>
        </section>
      )}

      {isOwner && upcoming && (
        <section aria-labelledby="train-heading">
          <h2 id="train-heading" className="mb-2 text-xl font-semibold">Train your crew</h2>
          <Card>
            <TrainCrew event={event} />
          </Card>
        </section>
      )}

      {!isOwner && (
        <Notice>
          {user ? 'Only the organiser can add roles and decide on offers.' : (
            <>
              Are you the organiser? <Link href={`/login?next=/events/${event.id}`} className="font-semibold underline">Log in</Link> to manage this event.
            </>
          )}
        </Notice>
      )}
    </div>
  );
}
