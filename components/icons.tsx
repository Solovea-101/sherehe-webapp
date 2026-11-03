import type { ReactNode } from 'react';

// Small line icons, drawn here as plain SVG so they cost no network request. All are decorative: the
// text next to them says the same thing, so they are hidden from screen readers.

function Svg({ children, size = 18, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

/** The Sherehe mark: three pennants on a line of bunting. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24">
      <path d="M2 5.5c6 3 14 3 20 0" fill="none" stroke="#181512" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3.4 6.8 7.2 15l3.4-7.2z" fill="#b8332a" />
      <path d="M9.6 8 13.2 17 16.6 8.4z" fill="#d97706" />
      <path d="M15.6 7.6 19.4 15l1.6-7.9z" fill="#b8332a" />
    </svg>
  );
}

export type NavIconName = 'events' | 'post' | 'training' | 'certificates' | 'docs';

export function NavIcon({ name, size = 20 }: { name: NavIconName; size?: number }) {
  switch (name) {
    case 'events':
      return (
        <Svg size={size}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </Svg>
      );
    case 'post':
      return (
        <Svg size={size}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v8M8 12h8" />
        </Svg>
      );
    case 'training':
      return (
        <Svg size={size}>
          <path d="M2.5 9.5 12 5l9.5 4.5L12 14 2.5 9.5z" />
          <path d="M6.5 11.8V16c0 1.3 2.5 2.5 5.5 2.5s5.5-1.2 5.5-2.5v-4.2" />
        </Svg>
      );
    case 'certificates':
      return (
        <Svg size={size}>
          <path d="M12 3l7.5 3v5.5c0 4.5-3 7.8-7.5 9.5-4.5-1.7-7.5-5-7.5-9.5V6L12 3z" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </Svg>
      );
    case 'docs':
      return (
        <Svg size={size}>
          <path d="M8.5 7 4 12l4.5 5M15.5 7 20 12l-4.5 5M13.5 5l-3 14" />
        </Svg>
      );
  }
}

type EventType = 'wedding' | 'conference' | 'concert' | 'corporate' | 'other';

export function EventTypeIcon({ type, size = 20, className }: { type: EventType; size?: number; className?: string }) {
  switch (type) {
    case 'wedding':
      return (
        <Svg size={size} className={className}>
          <circle cx="9" cy="14.5" r="5" />
          <circle cx="15" cy="14.5" r="5" />
          <path d="m12 3.5 1.5 2.2L12 7.6l-1.5-1.9z" />
        </Svg>
      );
    case 'conference':
      return (
        <Svg size={size} className={className}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
        </Svg>
      );
    case 'concert':
      return (
        <Svg size={size} className={className}>
          <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
        </Svg>
      );
    case 'corporate':
      return (
        <Svg size={size} className={className}>
          <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
          <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 13h17" />
        </Svg>
      );
    case 'other':
      return (
        <Svg size={size} className={className}>
          <path d="M3 20 12 4l9 16z" />
          <path d="M12 4v16M8 20l4-8 4 8" />
        </Svg>
      );
  }
}

type Category = 'accommodation' | 'campus' | 'catering' | 'cleaning' | 'electrical' | 'events' | 'plumbing' | 'security' | 'tutoring';

export function CategoryIcon({ category, size = 18, className }: { category: Category; size?: number; className?: string }) {
  switch (category) {
    case 'accommodation':
      return (
        <Svg size={size} className={className}>
          <path d="M3 18v-8M3 14h18v4M21 18v-4a3 3 0 0 0-3-3h-7v3" />
          <circle cx="7" cy="9" r="1.7" />
        </Svg>
      );
    case 'campus':
      return (
        <Svg size={size} className={className}>
          <path d="M5 21V4M5 5h13l-3 4 3 4H5" />
        </Svg>
      );
    case 'catering':
      return (
        <Svg size={size} className={className}>
          <path d="M3 17h18M5 17a7 7 0 0 1 14 0M12 8V6M10.5 6h3M2 20h20" />
        </Svg>
      );
    case 'cleaning':
      return (
        <Svg size={size} className={className}>
          <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
          <path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
        </Svg>
      );
    case 'electrical':
      return (
        <Svg size={size} className={className}>
          <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z" />
        </Svg>
      );
    case 'events':
      return (
        <Svg size={size} className={className}>
          <path d="M3 8.5a2 2 0 0 1 0 0V6h18v2.5a2 2 0 0 0 0 7V18H3v-2.5a2 2 0 0 0 0-7z" />
          <path d="M14 6v2.5M14 11v2M14 15.5V18" />
        </Svg>
      );
    case 'plumbing':
      return (
        <Svg size={size} className={className}>
          <path d="M14.5 6.5a4 4 0 0 0 4.8 4.8l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0 .7-1.8z" />
        </Svg>
      );
    case 'security':
      return (
        <Svg size={size} className={className}>
          <path d="M12 3l7.5 3v5.5c0 4.5-3 7.8-7.5 9.5-4.5-1.7-7.5-5-7.5-9.5V6L12 3z" />
        </Svg>
      );
    case 'tutoring':
      return (
        <Svg size={size} className={className}>
          <path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14" />
        </Svg>
      );
  }
}

/** A seal for a valid certificate and a warning triangle for a revoked one. */
export function VerdictIcon({ valid, size = 28 }: { valid: boolean; size?: number }) {
  return valid ? (
    <Svg size={size}>
      <path d="M12 3l7.5 3v5.5c0 4.5-3 7.8-7.5 9.5-4.5-1.7-7.5-5-7.5-9.5V6L12 3z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </Svg>
  ) : (
    <Svg size={size}>
      <path d="M12 3.5 22 20H2L12 3.5z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </Svg>
  );
}
