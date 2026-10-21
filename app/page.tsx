import Link from 'next/link';
import { EventsBrowser } from '@/components/EventsBrowser';
import { PageTitle } from '@/components/ui';

export default function HomePage() {
  return (
    <>
      <PageTitle
        intro="Post your event, list the casual staff it needs, decide on the offers that come in, and train your crew before the day."
      >
        Upcoming events
      </PageTitle>
      <p className="mb-6 text-sm text-stone-700">
        Organising something? <Link href="/events/new" className="font-semibold text-brand hover:underline">Post an event</Link>, or{' '}
        <Link href="/register" className="font-semibold text-brand hover:underline">create an account</Link> first.
      </p>
      <EventsBrowser />
    </>
  );
}
