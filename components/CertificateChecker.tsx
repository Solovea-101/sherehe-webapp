'use client';

import { useState, type FormEvent } from 'react';
import type { components } from '@/types/api';
import { api } from './api';
import { useRequireLogin } from './AuthProvider';
import { formatEat } from './time';
import { Badge, Button, Card, Field, Loading, Notice, PageTitle, TextInput } from './ui';

type Check = components['schemas']['CertificateCheckRecord'];

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
    <div className="mx-auto max-w-2xl space-y-6">
      <PageTitle intro="Before you rely on a crew member, check their Ujuzi certificate. Every check is asked of Ujuzi right now, so a revoked certificate shows at once.">
        Check a certificate
      </PageTitle>
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Certificate number" hint="Looks like UJZ-2026-00123.">
            <TextInput name="certificateNo" required placeholder="UJZ-2026-00123" autoComplete="off" />
          </Field>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Checking...' : 'Check certificate'}
          </Button>
        </form>
      </Card>

      {checks.length > 0 && (
        <section aria-labelledby="results-heading">
          <h2 id="results-heading" className="mb-2 text-xl font-semibold">Checked in this visit</h2>
          <ul className="space-y-3">
            {checks.map((c) => (
              <li key={c.id}>
                <Card className="space-y-1 text-sm">
                  <p className="flex items-center gap-2">
                    <strong>{c.certificateNo}</strong>
                    {c.valid ? <Badge tone="good">Valid</Badge> : <Badge tone="bad">Revoked: do not rely on it</Badge>}
                  </p>
                  <p>{c.holder} &middot; {c.courseTitle} &middot; {c.level}</p>
                  <p className="text-stone-500">Issued {c.issuedOn}. Checked {formatEat(c.checkedAt)}.</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
