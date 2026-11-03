import { EventsBrowser } from '@/components/EventsBrowser';
import { HomeIntro } from '@/components/HomeIntro';
import { PageTitle } from '@/components/ui';

export default function HomePage() {
  return (
    <>
      <HomeIntro />
      <PageTitle
        intro="Post your event, list the casual staff it needs, decide on the offers that come in, and train your crew before the day."
      >
        Upcoming events
      </PageTitle>
      <EventsBrowser />
    </>
  );
}
