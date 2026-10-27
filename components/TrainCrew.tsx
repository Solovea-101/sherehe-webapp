'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { components } from '@/types/api';
import { CATEGORIES } from '@/lib/validation';
import { api } from './api';
import { money } from './RolesTable';
import { eatInputToUtcIso, formatEat, nowAsEatInput } from './time';
import { Button, Field, Loading, Notice, Select, TextInput } from './ui';

type Event = components['schemas']['Event'];
type Option = components['schemas']['TrainingOption'];
type Training = components['schemas']['CrewTraining'];

/** Courses at Ujuzi, to book a trained crew for one of the organiser's events. */
export function TrainCrew({ event }: { event: Event }) {
  const [category, setCategory] = useState('');
  const [options, setOptions] = useState<Option[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [courseId, setCourseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Training | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setLoadError(null);
    setCourseId('');
    void api<Option[]>(`/api/training-options${category ? `?category=${category}` : ''}`).then((res) => {
      if (cancelled) return;
      if (res.ok) setOptions(res.data);
      else setLoadError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [category]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const preferredStart = eatInputToUtcIso(String(form.get('preferredStart')));
    if (!courseId) return setError('Choose a course first.');
    if (!preferredStart) return setError('Enter a valid date and time for the training to start.');
    setBusy(true);
    setError(null);
    const res = await api<Training>('/api/crew-trainings', {
      method: 'POST',
      body: { eventId: event.id, courseId, crewSize: Number(form.get('crewSize')), preferredStart },
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setBooked(res.data);
  }

  if (booked) {
    return (
      <Notice kind="success">
        Booked. The training centre will confirm it; follow it on <Link href="/training" className="font-semibold underline">your training page</Link>.
        Status: {booked.status}.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-700">
        Courses are run by Ujuzi training centres. Book one before the event starts ({formatEat(event.startsAt)}).
      </p>
      <div className="max-w-xs">
        <Field label="Kind of work">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {loadError && <Notice kind="error">{loadError}</Notice>}
      {!loadError && options === null && <Loading>Loading courses from Ujuzi...</Loading>}
      {options && options.length === 0 && <Notice>No courses match. Try another kind of work.</Notice>}
      {options && options.length > 0 && (
        <form onSubmit={submit} className="space-y-4" noValidate aria-label="Book crew training">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-stone-800">Course</legend>
            {options.map((o) => (
              <label key={o.courseId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 p-3 has-[:checked]:border-brand has-[:checked]:bg-orange-50">
                <input type="radio" name="course" value={o.courseId} checked={courseId === o.courseId} onChange={() => setCourseId(o.courseId)} className="mt-1" />
                <span className="text-sm">
                  <span className="block font-semibold">{o.title}</span>
                  <span className="block text-stone-600">
                    {o.centreName}, {o.area}, {o.county} &middot; {o.durationWeeks} week{o.durationWeeks === 1 ? '' : 's'} &middot; {money(o.feeKes)} per trainee &middot; {o.certificateLevel}
                  </span>
                  <span className="block text-stone-500">Next course starts {formatEat(o.nextStart)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How many people to train" hint="1 to 40.">
              <TextInput name="crewSize" type="number" min={1} max={40} defaultValue={4} required />
            </Field>
            <Field label="Preferred start" hint="Nairobi time, before the event.">
              <TextInput name="preferredStart" type="datetime-local" min={nowAsEatInput()} required />
            </Field>
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Booking...' : 'Book training'}
          </Button>
        </form>
      )}
    </div>
  );
}
