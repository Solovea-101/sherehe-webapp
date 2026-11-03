import type { components } from '@/types/api';
import { CategoryIcon } from './icons';
import { formatEat } from './time';
import { Badge, EmptyState } from './ui';

type Role = components['schemas']['Role'];

export const money = (kes: number) => `KES ${kes.toLocaleString('en-KE')}`;

/** The staff an event needs, and how many of each are already confirmed. */
export function RolesTable({ roles }: { roles: Role[] }) {
  if (roles.length === 0) return <EmptyState>No staff roles have been added yet.</EmptyState>;
  return (
    <ul className="divide-y divide-line">
      {roles.map((role) => {
        const open = role.headcount - role.filled;
        const share = role.headcount > 0 ? Math.min(100, Math.round((role.filled / role.headcount) * 100)) : 0;
        return (
          <li key={role.id} className="space-y-2 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 text-brand">
                <CategoryIcon category={role.category} size={20} />
              </span>
              <div className="min-w-0">
                <p className="font-bold">
                  {role.title} <span className="font-normal text-ink-muted">({role.category})</span>
                </p>
                <p className="font-mono text-xs text-ink-secondary">{formatEat(role.shiftStart)} to {formatEat(role.shiftEnd)}</p>
                <p className="font-mono text-xs text-ink-secondary">{money(role.payPerShift)} per shift</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-8">
              <p className="font-mono text-xs">
                {role.filled} of {role.headcount} confirmed
              </p>
              <div aria-hidden="true" className="h-1.5 w-28 overflow-hidden rounded-xs bg-surface-subtle">
                <div className="h-full bg-good-border" style={{ width: `${share}%` }} />
              </div>
              {open === 0 ? (
                <Badge tone="good" glyph="●">
                  Full
                </Badge>
              ) : (
                <Badge tone="warn" glyph="◔" className="border-dashed">
                  {open} open
                </Badge>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
