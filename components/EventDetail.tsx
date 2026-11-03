'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { components } from '@/types/api';
import { rememberMyEvent } from '@/lib/myEventsMemory';
import { api } from './api';
import { useAuth } from './AuthProvider';
import { TYPE_LABEL } from './EventsBrowser';
import { EventTypeIcon } from './icons';
import { OffersPanel } from './OffersPanel';
import { RoleForm } from './RoleForm';
import { RolesTable } from './RolesTable';
import { TrainCrew } from './TrainCrew';
import { formatEat } from './time';
import { Badge, Card, linkButtonClass, Loading, Notice, PageTitle } from './ui';

type Event = components['schemas']['Event'];
type Role = components['schemas']['Role'];
type Offer = components['schemas']['Offer'];

function SectionHeading({ id, children, aside }: { id: string; children: string; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="font-display text-lg font-semibold sm:text-xl">
        {children}
      </h2>
      {aside}
    </div>
  );
}

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
      setError(
        eventRes.status === 404 ? 'We could not find that event.' : eventRes.status === 401 ? 'Log in to view this event.' : eventRes.message,
      );
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

  // The organiser's own event: this device remembers it so the home page can mark it.
  const isOwner = offers !== null;
  useEffect(() => {
    if (isOwner && user && event) rememberMyEvent(user.id, event);
  }, [isOwner, user, event]);

  if (!ready || !loaded) return <Loading skeletons={2}>Loading event...</Loading>;
  if (error || !event) {
    return (
      <div className="space-y-4">
        <Notice kind="error">{error ?? 'We could not load that event.'}</Notice>
        {error === 'Log in to view this event.' && (
          <p>
            <Link href={`/login?next=/events/${eventId}`} className="font-semibold text-brand hover:underline">Log in</Link> to continue.
          </p>
        )}
        <Link href="/" className="inline-block font-semibold text-brand hover:underline">Back to all events</Link>
      </div>
    );
  }

  const upcoming = event.status === 'upcoming';
  const pendingOffers = (offers ?? []).filter((o) => o.status === 'pending').length;
  const places = roles.reduce((sum, r) => sum + r.headcount, 0);
  const confirmed = roles.reduce((sum, r) => sum + r.filled, 0);

  return (
    <div className="space-y-6">
      <PageTitle>{event.name}</PageTitle>

      <Card variant={isOwner ? 'featured' : 'default'} className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <EventTypeIcon type={event.type} className="text-brand" />
          <Badge tone="neutral">{TYPE_LABEL[event.type]}</Badge>
          {!upcoming && <Badge tone="bad" glyph={event.status === 'cancelled' ? '✕' : '■'} className="capitalize">{event.status}</Badge>}
          {isOwner && (
            <Badge tone="accent" glyph="★">
              This is your event.
            </Badge>
          )}
        </div>
        <div className="grid gap-3 border-t border-dashed border-line pt-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">When</p>
            <p className="font-mono text-xs">{formatEat(event.startsAt)} to {formatEat(event.endsAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Where</p>
            <p>{event.venue}, {event.area}, {event.county}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Scale</p>
            <p className="font-mono text-xs">About {event.expectedGuests} guests</p>
          </div>
        </div>
      </Card>

      {isOwner && upcoming && (
        <nav
          aria-label="On this event"
          className="sticky top-14 z-20 -mx-4 flex gap-2 overflow-x-auto border-y border-line bg-paper px-4 py-2 md:mx-0 md:rounded-md md:border"
        >
          <a href="#roles-heading" className="shrink-0 rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold">
            <span className="font-mono">1</span> Staff roles <span className="font-mono text-ink-muted">{confirmed}/{places} confirmed</span>
          </a>
          <a
            href="#offers-heading"
            className={[
              'shrink-0 rounded-sm border px-3 py-1.5 text-xs font-semibold',
              pendingOffers > 0 ? 'border-warn-border bg-warn-bg text-warn-text' : 'border-line-strong bg-surface',
            ].join(' ')}
          >
            <span className="font-mono">2</span> Offers <span className="font-mono">{pendingOffers} pending</span>
          </a>
          <a href="#train-heading" className="shrink-0 rounded-sm border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold">
            <span className="font-mono">3</span> Training
          </a>
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <section aria-labelledby="roles-heading" className="scroll-mt-32">
            <SectionHeading id="roles-heading">Staff needed</SectionHeading>
            <Card>
              <RolesTable roles={roles} />
            </Card>
          </section>

          {isOwner && upcoming && (
            <section aria-labelledby="add-role-heading" className="scroll-mt-32">
              <SectionHeading id="add-role-heading">Add a staff role</SectionHeading>
              <Card>
                <RoleForm eventId={event.id} onAdded={() => void load()} />
              </Card>
            </section>
          )}

          {isOwner && (
            <section aria-labelledby="offers-heading" className="scroll-mt-32">
              <SectionHeading
                id="offers-heading"
                aside={pendingOffers > 0 ? <Badge tone="warn" glyph="◆">{pendingOffers} pending</Badge> : undefined}
              >
                Offers from Kazi Connect
              </SectionHeading>
              <Card>
                <OffersPanel offers={offers} roles={roles} onDecided={() => void load()} />
              </Card>
            </section>
          )}
        </div>

        <div className="space-y-6 lg:col-span-5">
          {isOwner && upcoming && (
            <section aria-labelledby="train-heading" className="scroll-mt-32">
              <SectionHeading id="train-heading">Train your crew</SectionHeading>
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
          {!isOwner && !user && (
            <div className="flex flex-wrap gap-3">
              <Link href="/register" className={linkButtonClass.secondary}>
                <span className="inline-block first-letter:uppercase">create an account</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
