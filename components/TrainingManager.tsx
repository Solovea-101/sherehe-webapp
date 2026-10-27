'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { components } from '@/types/api';
import { COUNTIES, CATEGORIES } from '@/lib/validation';
import { api } from './api';
import { useRequireLogin } from './AuthProvider';
import { money } from './RolesTable';
import { eatInputToUtcIso, formatEat, nowAsEatInput, utcIsoToEatInput } from './time';
import { Badge, Button, Card, Field, Loading, Notice, PageTitle, Select, TextInput } from './ui';

type Training = components['schemas']['CrewTraining'];
type Option = components['schemas']['TrainingOption'];

const STATUS = {
  pending: { tone: 'warn', text: 'Waiting for the training centre' },
  confirmed: { tone: 'good', text: 'Confirmed' },
  declined: { tone: 'bad', text: 'Declined' },
} as const;

function TrainingRow({ training, onChanged }: { training: Training; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'cancel'>('view');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = STATUS[training.status];

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const preferredStart = eatInputToUtcIso(String(form.get('preferredStart')));
    if (!preferredStart) return setError('Enter a valid date and time.');
    setBusy(true);
    setError(null);
    const res = await api(`/api/crew-trainings/${training.id}`, {
      method: 'PUT',
      body: { crewSize: Number(form.get('crewSize')), preferredStart },
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setMode('view');
    onChanged();
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/crew-trainings/${training.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    onChanged();
  }

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm">
          <p className="font-semibold">
            Crew of {training.crewSize} for <Link href={`/events/${training.eventId}`} className="text-brand hover:underline">event {training.eventId}</Link>
          </p>
          <p className="text-stone-600">Course {training.courseId} &middot; starts {formatEat(training.preferredStart)}</p>
          <p className="text-stone-500">Booked {formatEat(training.createdAt)}</p>
        </div>
        <Badge tone={status.tone}>{status.text}</Badge>
      </div>

      {training.status === 'pending' && mode === 'view' && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMode('edit')}>Change</Button>
          <Button variant="danger" onClick={() => setMode('cancel')}>Cancel booking</Button>
        </div>
      )}

      {mode === 'edit' && (
        <form onSubmit={save} className="grid items-end gap-3 sm:grid-cols-3" noValidate aria-label="Change booking">
          <Field label="Crew size">
            <TextInput name="crewSize" type="number" min={1} max={40} defaultValue={training.crewSize} required />
          </Field>
          <Field label="Preferred start" hint="Nairobi time.">
            <TextInput name="preferredStart" type="datetime-local" min={nowAsEatInput()} defaultValue={utcIsoToEatInput(training.preferredStart)} required />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>Save</Button>
            <Button variant="secondary" onClick={() => { setMode('view'); setError(null); }}>Keep as it was</Button>
          </div>
        </form>
      )}

      {mode === 'cancel' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-red-50 p-3 text-sm">
          <span>Cancel this booking at the training centre?</span>
          <Button variant="danger" disabled={busy} onClick={cancel}>Yes, cancel it</Button>
          <Button variant="secondary" onClick={() => setMode('view')}>No, keep it</Button>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </li>
  );
}

function CourseBrowser() {
  const [category, setCategory] = useState('');
  const [county, setCounty] = useState('');
  const [options, setOptions] = useState<Option[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setError(null);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (county) params.set('county', county);
    const qs = params.toString();
    void api<Option[]>(`/api/training-options${qs ? `?${qs}` : ''}`).then((res) => {
      if (cancelled) return;
      if (res.ok) setOptions(res.data);
      else setError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [category, county]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind of work">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="County">
          <Select value={county} onChange={(e) => setCounty(e.target.value)}>
            <option value="">Any</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!error && options === null && <Loading>Loading courses from Ujuzi...</Loading>}
      {options && options.length === 0 && <Notice>No courses match.</Notice>}
      {options && options.length > 0 && (
        <ul className="divide-y divide-stone-200">
          {options.map((o) => (
            <li key={o.courseId} className="py-3 text-sm">
              <p className="font-semibold">{o.title}</p>
              <p className="text-stone-600">
                {o.centreName}, {o.area}, {o.county} &middot; {o.durationWeeks} week{o.durationWeeks === 1 ? '' : 's'} &middot; {money(o.feeKes)} per trainee &middot; {o.certificateLevel}
              </p>
              <p className="text-stone-500">Next course starts {formatEat(o.nextStart)}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-stone-600">To book, open one of your events and use &ldquo;Train your crew&rdquo;.</p>
    </div>
  );
}

export function TrainingManager() {
  const { user, ready } = useRequireLogin();
  const [trainings, setTrainings] = useState<Training[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<Training[]>('/api/crew-trainings');
    if (res.ok) setTrainings(res.data);
    else setError(res.message);
  }, []);

  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);

  if (!ready || !user) return <Loading>Checking your login...</Loading>;

  return (
    <div className="space-y-8">
      <PageTitle intro="Crew trainings you have booked at Ujuzi, and the courses you can choose from.">Training</PageTitle>
      <section aria-labelledby="mine-heading">
        <h2 id="mine-heading" className="mb-2 text-xl font-semibold">Your bookings</h2>
        <Card>
          {error && <Notice kind="error">{error}</Notice>}
          {!error && trainings === null && <Loading />}
          {trainings && trainings.length === 0 && <p className="text-sm text-stone-600">You have not booked any training yet.</p>}
          {trainings && trainings.length > 0 && (
            <ul className="divide-y divide-stone-200">
              {trainings.map((t) => <TrainingRow key={t.id} training={t} onChanged={() => void load()} />)}
            </ul>
          )}
        </Card>
      </section>
      <section aria-labelledby="courses-heading">
        <h2 id="courses-heading" className="mb-2 text-xl font-semibold">Browse courses</h2>
        <Card>
          <CourseBrowser />
        </Card>
      </section>
    </div>
  );
}
