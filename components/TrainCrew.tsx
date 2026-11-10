'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { components } from '@/types/api';
import { CATEGORIES } from '@/lib/validation';
import { api } from './api';
import { CategoryIcon } from './icons';
import { money } from './RolesTable';
import { eatInputToUtcIso, formatEat, nowAsEatInput } from './time';
import { Button, EmptyState, Field, isPartnerMessage, Loading, Notice, PartnerDegraded, SavedDataNotice, Select, TextInput } from './ui';

type Event = components['schemas']['Event'];
type Option = components['schemas']['TrainingOption'];
type Training = components['schemas']['CrewTraining'];

/** "short-course" as "Short course". */
export const levelLabel = (level: string) => {
  const spaced = level.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Courses at Ujuzi, to book a trained crew for one of the organiser's events. */
export function TrainCrew({ event }: { event: Event }) {
  const [category, setCategory] = useState('');
  const [options, setOptions] = useState<Option[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedAsOf, setSavedAsOf] = useState<string | null>(null);
  const [courseId, setCourseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Training | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    setLoadError(null);
    setSavedAsOf(null);
    setCourseId('');
    void api<Option[]>(`/api/training-options${category ? `?category=${category}` : ''}`).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setOptions(res.data);
        setSavedAsOf(res.stale?.asOf ?? null);
      } else setLoadError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [category, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

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
      <p className="text-sm text-ink-secondary">
        Courses are run by Ujuzi training centres. Book one before the event starts ({formatEat(event.startsAt)}).
      </p>
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
      {loadError && (isPartnerMessage(loadError) ? <PartnerDegraded message={loadError} onRetry={retry} /> : <Notice kind="error">{loadError}</Notice>)}
      {savedAsOf && <SavedDataNotice asOf={savedAsOf} />}
      {!loadError && options === null && <Loading skeletons={2}>Loading courses from Ujuzi...</Loading>}
      {options && options.length === 0 && <EmptyState>No courses match. Try another kind of work.</EmptyState>}
      {options && options.length > 0 && (
        <form onSubmit={submit} className="space-y-4" noValidate aria-label="Book crew training">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">Course</legend>
            <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
              {options.map((o) => (
                <label
                  key={o.courseId}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-line-strong bg-surface p-3 has-[:checked]:border-2 has-[:checked]:border-brand has-[:checked]:bg-brand-subtle"
                >
                  <input type="radio" name="course" value={o.courseId} checked={courseId === o.courseId} onChange={() => setCourseId(o.courseId)} className="mt-1 size-4 accent-brand" />
                  <span className="min-w-0 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-brand">
                        <CategoryIcon category={o.category} size={16} />
                      </span>
                      <span className="font-bold">{o.title}</span>
                    </span>
                    <span className="mt-0.5 block text-ink-secondary">
                      {o.centreName}, {o.area}, {o.county}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-ink-secondary">
                      {money(o.feeKes)} per trainee &middot; {o.durationWeeks} week{o.durationWeeks === 1 ? '' : 's'} &middot; {levelLabel(o.certificateLevel)}
                    </span>
                    <span className="block font-mono text-xs text-ink-muted">Next course starts {formatEat(o.nextStart)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {/* Once a course is chosen this panel stays in reach at the bottom of a phone screen. */}
          <div
            className={
              'space-y-3 rounded-md border-2 border-line-strong bg-surface-warm p-3 ' +
              (courseId ? 'sticky bottom-[4.5rem] z-10 shadow-tactile-sm md:static' : '')
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="How many people to train" hint="1 to 40.">
                <TextInput name="crewSize" type="number" min={1} max={40} defaultValue={4} required />
              </Field>
              <Field label="Preferred start" hint="Nairobi time, before the event.">
                <TextInput name="preferredStart" type="datetime-local" min={nowAsEatInput()} required />
              </Field>
            </div>
            {error && <Notice kind="error">{error}</Notice>}
            <Button type="submit" disabled={busy} className="w-full sm:w-auto">
              {busy ? 'Booking...' : 'Book training'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
