import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export function PageTitle({ children, intro }: { children: ReactNode; intro?: ReactNode }) {
  return (
    <header className="mb-6">
      <div aria-hidden="true" className="mb-2 h-1 w-8 rounded-xs bg-brand" />
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{children}</h1>
      {intro && <p className="mt-1.5 max-w-2xl text-sm text-ink-secondary sm:text-base">{intro}</p>}
    </header>
  );
}

type CardVariant = 'default' | 'featured' | 'passbook' | 'valid' | 'revoked';
const CARD: { [variant in CardVariant]: string } = {
  default: 'rounded-md border border-line bg-surface p-4 shadow-card sm:p-5',
  // The organiser's own event and a pending offer: warm paper, a heavy frame and a hard offset shadow.
  featured: 'rounded-md border-2 border-line-strong bg-surface-warm p-4 shadow-tactile-sm sm:p-5',
  // Sign-in and register: a centred passbook.
  passbook: 'rounded-md border-2 border-line-strong bg-surface p-5 shadow-tactile sm:p-6',
  // A certificate check: a single green frame for valid, a heavy double red frame for revoked.
  valid: 'rounded-md border-2 border-good-text bg-good-bg/40 p-4 shadow-card sm:p-5',
  revoked: 'rounded-md border-4 border-double border-bad-text bg-bad-bg/40 p-4 shadow-card sm:p-5',
};

export function Card({ children, className, variant = 'default' }: { children: ReactNode; className?: string; variant?: CardVariant }) {
  return <section className={cx(CARD[variant], className)}>{children}</section>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' };
export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const styles = {
    primary: 'border border-line-strong bg-brand text-white shadow-tactile-sm hover:bg-brand-dark',
    secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-subtle',
    danger: 'border border-bad-border bg-surface text-bad-text hover:bg-bad-bg',
  };
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex h-11 items-center justify-center rounded-sm px-4 text-sm font-semibold transition-transform active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
        styles[variant],
        className,
      )}
    />
  );
}

/** A link that looks like a button, for "Log in", "Post an event" and the like. */
export const linkButtonClass = {
  primary:
    'inline-flex h-11 items-center justify-center rounded-sm border border-line-strong bg-brand px-4 text-sm font-semibold text-white shadow-tactile-sm hover:bg-brand-dark',
  secondary:
    'inline-flex h-11 items-center justify-center rounded-sm border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-subtle',
};

// 16px text on phones stops the browser zooming in when a field is tapped.
export const inputClass =
  'mt-1.5 block h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base text-ink focus:border-brand focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:bg-surface-subtle sm:text-sm';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-ink">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-ink-muted">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, props.className)} />;
}

/** A message for the person: errors are announced to screen readers, the rest are polite. */
export function Notice({ kind = 'info', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-bad-border border-l-bad-text bg-bad-bg text-bad-text',
    success: 'border-good-border border-l-good-text bg-good-bg text-good-text',
    info: 'border-line border-l-accent bg-surface-subtle text-ink',
  };
  const glyph = { error: '!', success: '✓', info: 'i' };
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-md border border-l-4 p-3.5 text-sm font-medium', styles[kind])}>
      <span aria-hidden="true" className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">
        {glyph[kind]}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type BadgeTone = 'good' | 'warn' | 'bad' | 'neutral' | 'accent';
const BADGE: { [tone in BadgeTone]: string } = {
  good: 'border-good-border bg-good-bg text-good-text',
  warn: 'border-warn-border bg-warn-bg text-warn-text',
  bad: 'border-bad-border bg-bad-bg text-bad-text',
  neutral: 'border-neutral-border bg-neutral-bg text-neutral-text',
  accent: 'border-accent bg-accent-subtle text-warn-text',
};

/**
 * A status in three ways at once (colour, border and a leading symbol), so it reads in grayscale and in
 * bright sun. The symbol sits in its own element: the badge's own text stays exactly the status.
 */
export function Badge({ tone, glyph, className, children }: { tone: BadgeTone; glyph?: string; className?: string; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-xs border px-2 py-0.5 font-mono text-xs font-semibold', BADGE[tone], className)}>
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {children}
    </span>
  );
}

/** The wording stays as plain text for screen readers; the skeletons are only for the eye. */
export function Loading({ children = 'Loading...', skeletons = 0 }: { children?: ReactNode; skeletons?: number }) {
  return (
    <div>
      <p role="status" className="inline-flex items-center gap-2 rounded-xs border border-line bg-surface px-2.5 py-1 font-mono text-xs text-ink-secondary">
        <span aria-hidden="true" className="size-2 rounded-full bg-accent motion-safe:animate-pulse" />
        {children}
      </p>
      {skeletons > 0 && (
        <div aria-hidden="true" className="mt-3 grid gap-3 md:grid-cols-2">
          {Array.from({ length: skeletons }, (_, i) => (
            <div key={i} className="h-28 rounded-md border border-dashed border-line bg-surface-subtle/70 motion-safe:animate-pulse" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Nothing here yet: a dashed frame instead of a bare line of grey text. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-ink-muted/50 bg-surface px-4 py-5 text-sm text-ink-secondary">{children}</div>;
}

/**
 * Another system (Ujuzi) did not answer. A calm card, not an error box: the rest of the page still works.
 * The message is the API's own words, shown as they came.
 */
export function PartnerDegraded({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="status" className="rounded-md border-2 border-warn-border bg-warn-bg p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-warn-text">
        <span aria-hidden="true">◷</span>
        Ujuzi is not available at the moment
      </p>
      <p className="mt-1 text-sm text-warn-text">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Shown while a page needs the saved login to be checked. */
export function isPartnerMessage(message: string): boolean {
  return /^Ujuzi /.test(message);
}
