'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { components } from '@/types/api';
import { COUNTIES, EVENT_TYPES } from '@/lib/validation';
import { api } from './api';
import { useRequireLogin } from './AuthProvider';
import { TYPE_LABEL } from './EventsBrowser';
import { eatInputToUtcIso, nowAsEatInput } from './time';
import { Button, Card, Field, Loading, Notice, PageTitle, Select, TextInput } from './ui';

type Event = components['schemas']['Event'];

export function NewEventForm() {
  const { user, ready } = useRequireLogin();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const startsAt = eatInputToUtcIso(String(form.get('startsAt')));
    const endsAt = eatInputToUtcIso(String(form.get('endsAt')));
    if (!startsAt) return setError('Enter a valid start date and time.');
    if (!endsAt) return setError('Enter a valid end date and time.');

    setBusy(true);
    setError(null);
    const res = await api<Event>('/api/events', {
      method: 'POST',
      body: {
        name: String(form.get('name')),
        type: String(form.get('type')),
        county: String(form.get('county')),
        area: String(form.get('area')),
        venue: String(form.get('venue')),
        startsAt,
        endsAt,
        expectedGuests: Number(form.get('expectedGuests')),
      },
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    router.push(`/events/${res.data.id}`);
  }

  if (!ready || !user) return <Loading>Checking your login...</Loading>;
  const earliest = nowAsEatInput();

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle intro="Tell us about the day. You can add the staff roles you need on the next page.">Post an event</PageTitle>
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Event name">
            <TextInput name="name" required maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type of event">
              <Select name="type" defaultValue="wedding">
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expected guests">
              <TextInput name="expectedGuests" type="number" min={1} max={100000} defaultValue={100} required />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="County">
              <Select name="county" defaultValue="Nairobi">
                {COUNTIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Area" hint="For example Westlands, Kilimani, Nyali.">
              <TextInput name="area" required maxLength={80} />
            </Field>
          </div>
          <Field label="Venue">
            <TextInput name="venue" required maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" hint="Nairobi time.">
              <TextInput name="startsAt" type="datetime-local" min={earliest} required />
            </Field>
            <Field label="Ends" hint="Nairobi time.">
              <TextInput name="endsAt" type="datetime-local" min={earliest} required />
            </Field>
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Posting...' : 'Post event'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
