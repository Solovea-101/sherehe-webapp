import { COUNTIES, findCounty, parseEventsQuery } from '@/lib/validation';

const query = (qs: string) => parseEventsQuery(new URLSearchParams(qs));

describe('COUNTIES', () => {
  it('has Kenya’s 47 counties, no duplicates, in title case', () => {
    expect(COUNTIES).toHaveLength(47);
    expect(new Set(COUNTIES).size).toBe(47);
    for (const county of COUNTIES) {
      expect(county).toMatch(/^[A-Z][a-z']*([ -][A-Z][a-z']*)*$/);
    }
  });

  it('includes every county the seed data and Kazi’s areas use', () => {
    expect(COUNTIES).toEqual(expect.arrayContaining(['Nairobi', 'Kiambu', 'Mombasa', 'Kisumu', 'Nakuru']));
  });
});

describe('findCounty', () => {
  it('returns the official spelling whatever the letter case', () => {
    expect(findCounty('nairobi')).toBe('Nairobi');
    expect(findCounty('NAIROBI')).toBe('Nairobi');
    expect(findCounty('  homa bay ')).toBe('Homa Bay');
    expect(findCounty("MURANG'A")).toBe("Murang'a");
    expect(findCounty('TRANS-NZOIA')).toBe('Trans-Nzoia');
  });

  it('returns undefined for anything that is not a county', () => {
    expect(findCounty('Narnia')).toBeUndefined();
    expect(findCounty('')).toBeUndefined();
    expect(findCounty('Nairobi County')).toBeUndefined();
    expect(findCounty('Trans Nzoia')).toBeUndefined(); // spelling must match, only case is forgiven
  });
});

describe('parseEventsQuery', () => {
  it('accepts status=upcoming alone', () => {
    expect(query('status=upcoming')).toEqual({ ok: true, value: { status: 'upcoming' } });
  });

  it('adds the county in its official spelling', () => {
    expect(query('status=upcoming&county=nairobi')).toEqual({ ok: true, value: { status: 'upcoming', county: 'Nairobi' } });
    expect(query('status=upcoming&county=%20Uasin%20Gishu%20')).toEqual({
      ok: true,
      value: { status: 'upcoming', county: 'Uasin Gishu' },
    });
  });

  it('treats a blank county as no filter', () => {
    expect(query('status=upcoming&county=')).toEqual({ ok: true, value: { status: 'upcoming' } });
    expect(query('status=upcoming&county=%20')).toEqual({ ok: true, value: { status: 'upcoming' } });
  });

  it('ignores unknown parameters', () => {
    expect(query('status=upcoming&page=3')).toEqual({ ok: true, value: { status: 'upcoming' } });
  });

  it.each([
    ['', 'status is required'],
    ['county=Nairobi', 'status is required'],
    ['status=', 'status is required'],
    ['status=completed', 'status must be upcoming'],
    ['status=cancelled', 'status must be upcoming'],
    ['status=UPCOMING', 'status must be upcoming'],
    ['status=upcoming&status=upcoming', 'only once'],
    ['status=upcoming&county=Narnia', '47 counties'],
    ['status=upcoming&county=Nairobi&county=Kiambu', 'only once'],
  ])('rejects "%s"', (qs, text) => {
    const result = query(qs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(text);
  });
});
