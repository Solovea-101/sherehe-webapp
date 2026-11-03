'use client';

import { useState, type FormEvent } from 'react';
import type { components } from '@/types/api';
import { api } from './api';
import { useRequireLogin } from './AuthProvider';
import { VerdictIcon } from './icons';
import { formatEat } from './time';
import { Badge, Button, Card, Field, Loading, Notice, PageTitle, TextInput } from './ui';

type Check = components['schemas']['CertificateCheckRecord'];

/**
 * One check as a stamped receipt. Valid and revoked must be unmistakable at a glance, in sun and in
 * grayscale: different border weight, a different symbol, and the words themselves.
 */
function Receipt({ check }: { check: Check }) {
  const valid = check.valid;
  return (
    <Card variant={valid ? 'valid' : 'revoked'} className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className={valid ? 'text-good-text' : 'text-bad-text'}>
          <VerdictIcon valid={valid} />
        </span>
        <strong className="font-mono text-base tracking-wide">{check.certificateNo}</strong>
        {valid ? (
          <Badge tone="good" glyph="✓">Valid</Badge>
        ) : (
          <Badge tone="bad" glyph="⚠">Revoked: do not rely on it</Badge>
        )}
      </div>
      <p>{check.holder} &middot; {check.courseTitle} &middot; {check.level}</p>
      <p className="font-mono text-xs text-ink-muted">Issued {check.issuedOn}. Checked {formatEat(check.checkedAt)}.</p>
    </Card>
  );
}

export function CertificateChecker() {
  const { user, ready } = useRequireLogin();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const certificateNo = String(new FormData(formElement).get('certificateNo'));
    setBusy(true);
    setError(null);
    const res = await api<Check>('/api/certificate-checks', { method: 'POST', body: { certificateNo } });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setChecks((previous) => [res.data, ...previous]);
    formElement.reset();
  }

  if (!ready || !user) return <Loading>Checking your login...</Loading>;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageTitle intro="Before you rely on a crew member, check their Ujuzi certificate. Every check is asked of Ujuzi right now, so a revoked certificate shows at once.">
        Check a certificate
      </PageTitle>
      <Card variant="featured">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Certificate number" hint="Looks like UJZ-2026-00123.">
            <TextInput name="certificateNo" required placeholder="UJZ-2026-00123" autoComplete="off" autoCapitalize="characters" spellCheck={false} className="font-mono uppercase tracking-wider" />
          </Field>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">
            {busy ? 'Checking...' : 'Check certificate'}
          </Button>
        </form>
      </Card>

      {checks.length > 0 && (
        <section aria-labelledby="results-heading">
          <h2 id="results-heading" className="mb-2 font-display text-xl font-semibold">Checked in this visit</h2>
          <ul className="space-y-3">
            {checks.map((c) => (
              <li key={c.id}>
                <Receipt check={c} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
