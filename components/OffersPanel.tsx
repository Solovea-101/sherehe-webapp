'use client';

import { useState } from 'react';
import type { components } from '@/types/api';
import { api } from './api';
import { formatEat } from './time';
import { Badge, Button, Notice } from './ui';

type Offer = components['schemas']['Offer'];
type Role = components['schemas']['Role'];

const TONE = { pending: 'warn', accepted: 'good', declined: 'bad' } as const;

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
    return <p className="text-sm text-stone-600">No offers yet. Kazi Connect will offer student workers for your roles.</p>;
  }
  return (
    <ul className="divide-y divide-stone-200">
      {offers.map((offer) => (
        <li key={offer.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                {offer.workersOffered} worker{offer.workersOffered === 1 ? '' : 's'} for {roleTitle(offer.roleId)}
              </p>
              <p className="text-sm text-stone-600">Offered {formatEat(offer.createdAt)}</p>
              {offer.note && <p className="mt-1 text-sm text-stone-700">&ldquo;{offer.note}&rdquo;</p>}
            </div>
            {offer.status === 'pending' ? (
              <div className="flex gap-2">
                <Button disabled={busyId === offer.id} onClick={() => decide(offer.id, 'accepted')}>
                  Accept
                </Button>
                <Button variant="secondary" disabled={busyId === offer.id} onClick={() => decide(offer.id, 'declined')}>
                  Decline
                </Button>
              </div>
            ) : (
              <Badge tone={TONE[offer.status]}>{offer.status}</Badge>
            )}
          </div>
          {errors[offer.id] && <Notice kind="error">{errors[offer.id]}</Notice>}
        </li>
      ))}
    </ul>
  );
}
