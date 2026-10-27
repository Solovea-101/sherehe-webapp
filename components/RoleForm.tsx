'use client';

import { useState, type FormEvent } from 'react';
import { CATEGORIES } from '@/lib/validation';
import { api } from './api';
import { eatInputToUtcIso, nowAsEatInput } from './time';
import { Button, Field, Notice, Select, TextInput } from './ui';

/** Adds a staffing role to an event the logged-in organiser owns. */
export function RoleForm({ eventId, onAdded }: { eventId: string; onAdded: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const shiftStart = eatInputToUtcIso(String(form.get('shiftStart')));
    const shiftEnd = eatInputToUtcIso(String(form.get('shiftEnd')));
    if (!shiftStart || !shiftEnd) return setError('Enter a valid start and end time for the shift.');

    setBusy(true);
    setError(null);
    const res = await api(`/api/events/${eventId}/roles`, {
      method: 'POST',
      body: {
        title: String(form.get('title')),
        category: String(form.get('category')),
        headcount: Number(form.get('headcount')),
        shiftStart,
        shiftEnd,
        payPerShift: Number(form.get('payPerShift')),
      },
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    formElement.reset();
    onAdded();
  }

  const earliest = nowAsEatInput();
  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Add a staff role">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" hint="For example Waiters, Ushers, Security guards.">
          <TextInput name="title" required maxLength={80} />
        </Field>
        <Field label="Kind of work">
          <Select name="category" defaultValue="events">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How many people">
          <TextInput name="headcount" type="number" min={1} max={1000} defaultValue={4} required />
        </Field>
        <Field label="Pay per shift (KES)">
          <TextInput name="payPerShift" type="number" min={0} max={100000} defaultValue={1500} required />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shift starts" hint="Nairobi time.">
          <TextInput name="shiftStart" type="datetime-local" min={earliest} required />
        </Field>
        <Field label="Shift ends" hint="Nairobi time.">
          <TextInput name="shiftEnd" type="datetime-local" min={earliest} required />
        </Field>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Adding...' : 'Add role'}
      </Button>
    </form>
  );
}
