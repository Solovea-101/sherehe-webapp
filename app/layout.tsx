import type { Metadata } from 'next';
import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { Nav } from '@/components/Nav';
import './globals.css';

// Three families, fetched once at build time and served from our own address (no request to Google
// weights makes Turbopack's font loader fail: "queries have exactly one entry".)
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'Sherehe',
  description: 'Post your event, staff it with trained crew, and check their certificates.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${fraunces.variable} ${jakarta.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <AuthProvider>
          <Nav />
          {/* Room at the bottom for the phone's tab bar (4rem) */}
          <main className="mx-auto max-w-5xl px-4 pb-24 pt-5 md:px-6 md:py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
