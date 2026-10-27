import { eatInputToUtcIso, formatEat, nowAsEatInput, utcIsoToEatInput } from '@/components/time';

describe('Nairobi time in, UTC out', () => {
  it('reads what a datetime-local field gives as Nairobi time (UTC+3) and answers UTC with a Z', () => {
    expect(eatInputToUtcIso('2026-12-05T17:00')).toBe('2026-12-05T14:00:00Z');
    expect(eatInputToUtcIso('2026-12-05T08:30')).toBe('2026-12-05T05:30:00Z');
  });

  it('crosses midnight and month and year boundaries correctly', () => {
    expect(eatInputToUtcIso('2026-12-05T01:30')).toBe('2026-12-04T22:30:00Z');
    expect(eatInputToUtcIso('2026-12-01T02:00')).toBe('2026-11-30T23:00:00Z');
    expect(eatInputToUtcIso('2027-01-01T00:00')).toBe('2026-12-31T21:00:00Z');
  });

  it('knows leap days', () => {
    expect(eatInputToUtcIso('2028-02-29T12:00')).toBe('2028-02-29T09:00:00Z');
    expect(eatInputToUtcIso('2027-02-29T12:00')).toBeNull();
  });

  it.each([
    [''], ['tomorrow'], ['2026-12-05'], ['2026-12-05 17:00'], ['2026-12-05T17:00:00'], ['2026-13-05T17:00'],
    ['2026-02-31T10:00'], ['2026-12-05T25:00'], ['2026-12-05T17:61'],
  ])('refuses %p', (value) => {
    expect(eatInputToUtcIso(value)).toBeNull();
  });

  it('gives the API exactly the format it demands: ISO 8601 UTC, a Z, no milliseconds', () => {
    expect(eatInputToUtcIso('2026-12-05T17:00')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('formatEat', () => {
  it('shows a UTC time as Nairobi time, with the zone named', () => {
    expect(formatEat('2026-12-05T14:00:00Z')).toBe('Sat 5 Dec 2026, 17:00 EAT');
  });
  it('rolls over to the next day when Nairobi is already there', () => {
    expect(formatEat('2026-12-05T21:30:00Z')).toBe('Sun 6 Dec 2026, 00:30 EAT');
  });
  it('shows an unreadable value as it is rather than "Invalid Date"', () => {
    expect(formatEat('not a date')).toBe('not a date');
  });
});

describe('utcIsoToEatInput and nowAsEatInput', () => {
  it('turns a UTC time back into what a datetime-local field wants, and round-trips', () => {
    expect(utcIsoToEatInput('2026-12-05T14:00:00Z')).toBe('2026-12-05T17:00');
    expect(eatInputToUtcIso(utcIsoToEatInput('2026-12-05T21:30:00Z'))).toBe('2026-12-05T21:30:00Z');
  });
  it('gives "now" in Nairobi time for a field’s minimum', () => {
    expect(nowAsEatInput(new Date('2026-12-05T14:07:45Z'))).toBe('2026-12-05T17:07');
  });
  it('returns an empty value for a time it cannot read', () => {
    expect(utcIsoToEatInput('nonsense')).toBe('');
  });
});
