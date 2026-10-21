import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export function PageTitle({ children, intro }: { children: ReactNode; intro?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-3xl font-bold text-brand">{children}</h1>
      {intro && <p className="mt-2 max-w-2xl text-stone-700">{intro}</p>}
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-xl border border-stone-200 bg-white p-5 shadow-sm', className)}>{children}</section>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' };
export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const styles = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    secondary: 'border border-stone-300 bg-white text-ink hover:bg-stone-100',
    danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  };
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
    />
  );
}

export const inputClass =
  'mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:bg-stone-100';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-stone-800">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-stone-500">{hint}</span>}
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
    error: 'border-red-300 bg-red-50 text-red-800',
    success: 'border-green-300 bg-green-50 text-green-800',
    info: 'border-stone-300 bg-stone-50 text-stone-700',
  };
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('rounded-lg border px-4 py-3 text-sm', styles[kind])}>
      {children}
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  const styles = {
    good: 'bg-green-100 text-green-800',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-red-100 text-red-800',
    neutral: 'bg-stone-100 text-stone-700',
  };
  return <span className={cx('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', styles[tone])}>{children}</span>;
}

export function Loading({ children = 'Loading...' }: { children?: ReactNode }) {
  return (
    <p role="status" className="text-stone-500">
      {children}
    </p>
  );
}
