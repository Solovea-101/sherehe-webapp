import type { components } from '@/types/api';
import { formatEat } from './time';
import { Badge } from './ui';

type Role = components['schemas']['Role'];

export const money = (kes: number) => `KES ${kes.toLocaleString('en-KE')}`;

/** The staff an event needs, and how many of each are already confirmed. */
export function RolesTable({ roles }: { roles: Role[] }) {
  if (roles.length === 0) return <p className="text-sm text-stone-600">No staff roles have been added yet.</p>;
  return (
    <ul className="divide-y divide-stone-200">
      {roles.map((role) => {
        const open = role.headcount - role.filled;
        return (
          <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-semibold">
                {role.title} <span className="font-normal text-stone-500">({role.category})</span>
              </p>
              <p className="text-sm text-stone-600">
                {formatEat(role.shiftStart)} to {formatEat(role.shiftEnd)} &middot; {money(role.payPerShift)} per shift
              </p>
            </div>
            <div className="text-right text-sm">
              <p>
                {role.filled} of {role.headcount} confirmed
              </p>
              {open === 0 ? <Badge tone="good">Full</Badge> : <Badge tone="warn">{open} open</Badge>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
