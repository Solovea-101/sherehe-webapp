'use client';

import { useState } from 'react';
import type { components } from '@/types/api';
import { api } from './api';
import { formatEat } from './time';
import { Badge, Button, EmptyState, Notice } from './ui';

type Offer = components['schemas']['Offer'];
type Role = components['schemas']['Role'];

const TONE = { pending: 'warn', accepted: 'good', declined: 'bad' } as const;
const GLYPH = { pending: '◆', accepted: '✓', declined: '✕' } as const;

/** Offers of workers from Kazi Connect. Accepting fills places on the role; decisions are final. */
export function OffersPanel({ offers, roles, onDecided }: { offers: Offer[]; roles: Role[]; onDecided: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ [offerId: string]: string }>({});
  const roleTitle = (id: string) => roles.find((r) => r.id === id)?.title ?? id;

  async function decide(offerId: string, status: 'accepted' | 'declined') {
    setBusyId(offerId);
    setErrors((e) => ({ ...e, [offerId]: '' }));
    const res = await api(`/api/offers/${offerId}`, { method: 'PATCH', body: { status } });
    setBusyId(null);
    if (!res.ok) return setErrors((e) => ({ ...e, [offerId]: res.message }));
    onDecided();
  }

  if (offers.length === 0) {
    return <EmptyState>No offers yet. Kazi Connect will offer student workers for your roles.</EmptyState>;
  }

  // Offers waiting for an answer come first, newest at the top of each group.
  const sorted = [...offers].sort((a, b) => {
    const aw = a.status === 'pending' ? 0 : 1;
    const bw = b.status === 'pending' ? 0 : 1;
    return aw - bw || b.createdAt.localeCompare(a.createdAt);
  });

  return (
    <ul className="space-y-3">
      {sorted.map((offer) => {
        const pending = offer.status === 'pending';
        return (
          <li
            key={offer.id}
            className={
              pending
                ? 'space-y-3 rounded-md border-2 border-warn-border bg-surface-warm p-4'
                : 'space-y-2 rounded-md border border-line bg-surface p-3'
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {pending && <p className="mb-1 font-mono text-xs font-bold uppercase tracking-wide text-warn-text">Action needed</p>}
                <p className="font-bold">
                  {offer.workersOffered} worker{offer.workersOffered === 1 ? '' : 's'} for {roleTitle(offer.roleId)}
                </p>
                <p className="font-mono text-xs text-ink-secondary">Offered {formatEat(offer.createdAt)}</p>
                {offer.note && <p className="mt-2 border-l-2 border-brand pl-3 text-sm italic text-ink-secondary">&ldquo;{offer.note}&rdquo;</p>}
              </div>
              {!pending && (
                <Badge tone={TONE[offer.status]} glyph={GLYPH[offer.status]} className="capitalize">
                  {offer.status}
                </Badge>
              )}
            </div>
            {pending && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-warn-text">
                  Decisions are final. Accepting locks in these workers and updates the confirmed places on the role.
                </p>
                <div className="flex gap-2">
                  <Button disabled={busyId === offer.id} onClick={() => decide(offer.id, 'accepted')}>
                    Accept
                  </Button>
                  <Button variant="secondary" disabled={busyId === offer.id} onClick={() => decide(offer.id, 'declined')}>
                    Decline
                  </Button>
                </div>
              </div>
            )}
            {errors[offer.id] && <Notice kind="error">{errors[offer.id]}</Notice>}
          </li>
        );
      })}
    </ul>
  );
}
