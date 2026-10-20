import {
  COUNTIES, dateTime, findCounty, futureDateTime, oneOf, parseCredentials, parseEventsQuery, parseNewAccount,
  readFields, text, whole,
} from '@/lib/validation';

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

describe('readFields', () => {
  it('accepts a plain object with listed fields only', () => {
    expect(readFields({ a: 1 }, ['a', 'b'])).toEqual({ ok: true, value: { a: 1 } });
    expect(readFields({}, ['a'])).toEqual({ ok: true, value: {} });
  });

  it.each([[null], [[]], ['text'], [42], [true], [undefined]])('rejects %p as a body', (body) => {
    const result = readFields(body, ['a']);
    expect(result).toEqual({ ok: false, message: 'The request body must be a JSON object' });
  });

  it('names an unknown field and lists the allowed ones', () => {
    expect(readFields({ a: 1, extra: 2 }, ['a', 'b'])).toEqual({
      ok: false,
      message: 'Unknown field "extra"; allowed fields are a, b',
    });
  });

  it('does not treat inherited property names as fields, and keeps the message short', () => {
    expect(readFields(JSON.parse('{"__proto__": 1}'), ['a']).ok).toBe(false);
    const long = readFields({ ['x'.repeat(500)]: 1 }, ['a']);
    expect(long.ok === false && long.message.length).toBeLessThan(120);
  });
});

describe('text', () => {
  it('trims by default, and reads the value as typed when trim is off', () => {
    expect(text({ n: '  hi  ' }, 'n', { max: 10 })).toEqual({ ok: true, value: 'hi' });
    expect(text({ n: '  hi  ' }, 'n', { max: 10, trim: false })).toEqual({ ok: true, value: '  hi  ' });
  });

  it('refuses missing, null, non-text, blank, too short and too long values', () => {
    const msg = (fields: Record<string, unknown>, opts = { max: 5 } as { max: number; min?: number }) => {
      const r = text(fields, 'n', opts);
      return r.ok ? 'ok' : r.message;
    };
    expect(msg({})).toBe('n is required');
    expect(msg({ n: null })).toBe('n is required');
    expect(msg({ n: 5 })).toBe('n must be text');
    expect(msg({ n: ['a'] })).toBe('n must be text');
    expect(msg({ n: '   ' })).toBe('n cannot be empty');
    expect(msg({ n: 'abc' }, { max: 5, min: 4 })).toBe('n must be at least 4 characters');
    expect(msg({ n: 'abcdef' })).toBe('n must be at most 5 characters');
    expect(msg({ n: 'abcde' })).toBe('ok');
  });
});

describe('whole', () => {
  const msg = (value: unknown) => {
    const r = whole({ n: value }, 'n', { min: 1, max: 40 });
    return r.ok ? r.value : r.message;
  };
  it('accepts only JSON integers in range, ends included', () => {
    expect(msg(1)).toBe(1);
    expect(msg(40)).toBe(40);
    for (const bad of [0, 41, -3, 6.5, '6', null, undefined, NaN, Infinity, true, [6], {}]) {
      expect(msg(bad)).toMatch(/^n (is required|must be a whole number from 1 to 40)$/);
    }
  });
});

describe('oneOf', () => {
  it('accepts a listed value and names the choices otherwise', () => {
    expect(oneOf({ t: 'wedding' }, 't', ['wedding', 'concert'] as const)).toEqual({ ok: true, value: 'wedding' });
    expect(oneOf({ t: 'Wedding' }, 't', ['wedding', 'concert'] as const)).toEqual({
      ok: false,
      message: 't must be one of wedding, concert',
    });
    expect(oneOf({ t: 7 }, 't', ['wedding'] as const).ok).toBe(false);
    expect(oneOf({}, 't', ['wedding'] as const)).toEqual({ ok: false, message: 't is required' });
  });
});

describe('dateTime / futureDateTime', () => {
  const read = (value: unknown) => dateTime({ d: value }, 'd');
  it('accepts ISO 8601 UTC with a Z and no milliseconds', () => {
    const r = read('2026-11-28T08:00:00Z');
    expect(r.ok && r.value.toISOString()).toBe('2026-11-28T08:00:00.000Z');
  });

  it.each([
    ['milliseconds', '2026-11-28T08:00:00.000Z'],
    ['an offset', '2026-11-28T11:00:00+03:00'],
    ['no zone', '2026-11-28T08:00:00'],
    ['a date only', '2026-11-28'],
    ['a space instead of T', '2026-11-28 08:00:00Z'],
    ['an impossible day', '2026-02-31T08:00:00Z'],
    ['month 13', '2026-13-01T08:00:00Z'],
    ['hour 25', '2026-11-28T25:00:00Z'],
    ['a number', 1796000000000],
    ['an empty string', ''],
    ['text', 'tomorrow'],
  ])('refuses %s with an example in the message', (_label, value) => {
    const r = read(value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('d must be an ISO 8601 UTC date-time such as 2026-11-28T08:00:00Z');
  });

  it('knows leap days', () => {
    expect(read('2028-02-29T00:00:00Z').ok).toBe(true);
    expect(read('2027-02-29T00:00:00Z').ok).toBe(false);
  });

  it('requires the moment to be ahead of now', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    const f = (v: string) => futureDateTime({ d: v }, 'd', now);
    expect(f('2026-11-01T10:00:01Z').ok).toBe(true);
    for (const past of ['2026-11-01T10:00:00Z', '2026-10-31T10:00:00Z']) {
      const r = f(past);
      expect(r.ok === false && r.message).toContain('d must be in the future');
    }
    expect(f('nonsense')).toMatchObject({ ok: false, message: expect.stringContaining('ISO 8601') });
  });
});

describe('parseNewAccount', () => {
  const valid = { email: ' Njeri@Example.com ', name: ' Njeri ', password: 'long enough pw' };
  it('normalises the email and name and keeps the password as typed', () => {
    expect(parseNewAccount(valid)).toEqual({
      ok: true,
      value: { email: 'njeri@example.com', name: 'Njeri', password: 'long enough pw' },
    });
  });
  it('reports the first problem in field order: email, name, password', () => {
    expect(parseNewAccount({ email: 'bad', name: '', password: 'x' })).toMatchObject({ message: expect.stringContaining('email') });
    expect(parseNewAccount({ ...valid, name: '', password: 'x' })).toMatchObject({ message: expect.stringContaining('name') });
    expect(parseNewAccount({ ...valid, password: 'x' })).toMatchObject({ message: expect.stringContaining('password') });
  });
});

describe('parseCredentials', () => {
  it('needs an email and any non-empty password, with no length rules to leak', () => {
    expect(parseCredentials({ email: 'a@b.co', password: 'x' }).ok).toBe(true);
    expect(parseCredentials({ email: 'a@b.co', password: '' }).ok).toBe(false);
  });
});
