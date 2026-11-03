/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { EventDetail } from '@/components/EventDetail';
import { EventsBrowser } from '@/components/EventsBrowser';
import { HomeIntro } from '@/components/HomeIntro';
import { Nav } from '@/components/Nav';
import { TrainingManager } from '@/components/TrainingManager';
import { readMyEvents, rememberMyEvent, type RememberedEvent } from '@/lib/myEventsMemory';
import { installFetch, sampleEvent, sampleRole, sampleUser } from './helpers';

// The look of the site changed; these cover what the change added: what this device remembers, the
// welcome and returning views, one navigation landmark, course names on bookings, offers in order, and
// the "try again" for a partner that did not answer.

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const wedding: RememberedEvent = {
  id: 'evt_2001', name: 'Wanjiku and Otieno wedding', startsAt: '2026-12-05T14:00:00Z', venue: 'Sarit Expo Centre', county: 'Nairobi', type: 'wedding',
};
const login = () => window.localStorage.setItem('sherehe.token', 'tok');

beforeEach(() => window.localStorage.clear());

describe('what this device remembers about an organiser’s events', () => {
  it('keeps the newest first, one entry per event, for one account only', () => {
    rememberMyEvent('usr_1', wedding);
    rememberMyEvent('usr_1', { ...wedding, id: 'evt_2002', name: 'Second' });
    rememberMyEvent('usr_1', { ...wedding, name: 'Renamed' }); // the same event again moves to the front
    expect(readMyEvents('usr_1').map((e) => [e.id, e.name])).toEqual([['evt_2001', 'Renamed'], ['evt_2002', 'Second']]);
    expect(readMyEvents('usr_2')).toEqual([]);
  });

  it('remembers at most 20', () => {
    for (let i = 0; i < 25; i += 1) rememberMyEvent('usr_1', { ...wedding, id: `evt_${3000 + i}` });
    const kept = readMyEvents('usr_1');
    expect(kept).toHaveLength(20);
    expect(kept[0].id).toBe('evt_3024');
  });

  it('ignores damaged storage and a blocked store instead of failing', () => {
    window.localStorage.setItem('sherehe_my_events_usr_1', '{not json');
    expect(readMyEvents('usr_1')).toEqual([]);
    window.localStorage.setItem('sherehe_my_events_usr_1', JSON.stringify([{ id: 5 }, wedding, 'x']));
    expect(readMyEvents('usr_1')).toEqual([wedding]);
    const blocked = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberMyEvent('usr_1', wedding)).not.toThrow();
    blocked.mockRestore();
  });
});

describe('the home page marks the organiser’s own events', () => {
  it('stamps a remembered event and lists it on a shelf', async () => {
    login();
    rememberMyEvent(sampleUser.id, wedding);
    installFetch({ 'GET /api/me': () => ({ body: sampleUser }), 'GET /api/events?status=upcoming': () => ({ body: [sampleEvent] }) });
    render(h(AuthProvider, null, h(EventsBrowser)));
    expect(await screen.findByText('Your event')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your events on this device' })).toBeInTheDocument();
  });

  it('shows neither for an event this device does not know', async () => {
    login();
    installFetch({ 'GET /api/me': () => ({ body: sampleUser }), 'GET /api/events?status=upcoming': () => ({ body: [sampleEvent] }) });
    render(h(AuthProvider, null, h(EventsBrowser)));
    await screen.findByRole('link', { name: sampleEvent.name });
    expect(screen.queryByText('Your event')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your events on this device' })).not.toBeInTheDocument();
  });

  it('remembers an event when its organiser opens it', async () => {
    login();
    installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/events/evt_2001': () => ({ body: sampleEvent }),
      'GET /api/events/evt_2001/roles': () => ({ body: [sampleRole] }),
      'GET /api/events/evt_2001/offers': () => ({ body: [] }),
      'GET /api/training-options': () => ({ body: [] }),
    });
    render(h(AuthProvider, null, h(EventDetail, { eventId: 'evt_2001' })));
    await screen.findByText('This is your event.');
    await waitFor(() => expect(readMyEvents(sampleUser.id).map((e) => e.id)).toEqual(['evt_2001']));
  });
});

describe('the welcome on the home page', () => {
  it('welcomes a visitor with the three steps and a way in', async () => {
    installFetch({});
    render(h(AuthProvider, null, h(HomeIntro)));
    expect(await screen.findByRole('heading', { name: 'Staff and train your event crew across Kenya' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your account' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows a signed-in organiser one short line instead', async () => {
    login();
    installFetch({ 'GET /api/me': () => ({ body: sampleUser }) });
    render(h(AuthProvider, null, h(HomeIntro)));
    expect(await screen.findByRole('link', { name: 'Post an event' })).toHaveAttribute('href', '/events/new');
    expect(screen.queryByRole('heading', { name: /Staff and train/ })).not.toBeInTheDocument();
  });
});

describe('the navigation', () => {
  it('is one landmark with the five links, each named exactly', async () => {
    installFetch({});
    render(h(AuthProvider, null, h(Nav)));
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Events', '/'], ['Post an event', '/events/new'], ['Training', '/training'], ['Certificates', '/certificates'], ['API docs', '/docs'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page'); // on the home page
  });

  it('offers a visitor Log in and Register, and a signed-in organiser their name and Log out', async () => {
    installFetch({});
    const first = render(h(AuthProvider, null, h(Nav)));
    expect(await screen.findByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register');
    first.unmount();
    login();
    installFetch({ 'GET /api/me': () => ({ body: sampleUser }) });
    render(h(AuthProvider, null, h(Nav)));
    expect(await screen.findByText('Njeri Kamau')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });
});

describe('training bookings show the course by name', () => {
  const training = { id: 'trn_5001', eventId: 'evt_2001', courseId: 'crs_501', crewSize: 6, preferredStart: '2026-11-28T05:00:00Z', status: 'pending', createdAt: '2026-11-20T07:00:00Z' };
  const course = { courseId: 'crs_501', title: 'Food hygiene and event service', category: 'catering', centreName: 'Westlands Skills Centre', county: 'Nairobi', area: 'Westlands', durationWeeks: 2, feeKes: 3500, nextStart: '2026-11-23T04:00:00Z', certificateLevel: 'short-course' };

  it('adds the course title and centre, keeps the course id, and names an event this device knows', async () => {
    login();
    rememberMyEvent(sampleUser.id, wedding);
    installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/crew-trainings': () => ({ body: [training] }),
      'GET /api/training-options': () => ({ body: [course] }),
    });
    render(h(AuthProvider, null, h(TrainingManager)));
    expect(await screen.findByText('Food hygiene and event service (crs_501)')).toBeInTheDocument();
    expect(screen.getByText(/Course crs_501/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wanjiku and Otieno wedding' })).toHaveAttribute('href', '/events/evt_2001');
  });

  it('still shows the ids when Ujuzi cannot say what the courses are', async () => {
    login();
    installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/crew-trainings': () => ({ body: [training] }),
      'GET /api/training-options': () => ({ status: 502, body: { message: 'Ujuzi is not responding right now. Try again in a minute.' } }),
    });
    render(h(AuthProvider, null, h(TrainingManager)));
    expect(await screen.findByText(/Crew of 6/)).toBeInTheDocument();
    expect(await screen.findByText(/Course crs_501/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'event evt_2001' })).toBeInTheDocument();
  });

  it('shows a calm card with Try again when Ujuzi does not answer, and recovers when it does', async () => {
    login();
    let up = false;
    const { calls } = installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/crew-trainings': () => ({ body: [] }),
      'GET /api/training-options': () => (up ? { body: [course] } : { status: 502, body: { message: 'Ujuzi is not responding right now. Try again in a minute.' } }),
    });
    render(h(AuthProvider, null, h(TrainingManager)));
    expect(await screen.findByText('Ujuzi is not responding right now. Try again in a minute.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // not an error box
    up = true;
    const before = calls.length;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Food hygiene and event service')).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(before);
    expect(screen.queryByText('Ujuzi is not responding right now. Try again in a minute.')).not.toBeInTheDocument();
  });
});

describe('offers on an event', () => {
  const offer = (id: string, status: string, createdAt: string, note: string) => ({ id, roleId: 'rol_3001', eventId: 'evt_2001', workersOffered: 2, note, status, createdAt });

  it('lists waiting offers first (newest first), says the decision is final, and shows decided ones as plain badges', async () => {
    login();
    installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/events/evt_2001': () => ({ body: sampleEvent }),
      'GET /api/events/evt_2001/roles': () => ({ body: [sampleRole] }),
      // the API's own order is oldest first; the panel must put the waiting ones on top
      'GET /api/events/evt_2001/offers': () => ({
        body: [
          offer('ofr_1', 'declined', '2026-11-18T09:00:00Z', 'Old and declined'),
          offer('ofr_2', 'pending', '2026-11-19T09:00:00Z', 'Older waiting'),
          offer('ofr_3', 'pending', '2026-11-21T09:00:00Z', 'Newest waiting'),
        ],
      }),
      'GET /api/training-options': () => ({ body: [] }),
    });
    render(h(AuthProvider, null, h(EventDetail, { eventId: 'evt_2001' })));
    const region = await screen.findByRole('region', { name: 'Offers from Kazi Connect' });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Newest waiting');
    expect(items[1]).toHaveTextContent('Older waiting');
    expect(items[2]).toHaveTextContent('Old and declined');
    expect(items[0]).toHaveTextContent(/Decisions are final/);
    expect(within(items[0]).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(within(items[2]).queryByRole('button')).not.toBeInTheDocument();
    expect(within(region).getByText('declined')).toBeInTheDocument();
    expect(within(region).getByText('2 pending')).toBeInTheDocument();
  });

  it('keeps the status wording exact: the symbol is its own hidden element', async () => {
    login();
    installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/events/evt_2001': () => ({ body: sampleEvent }),
      'GET /api/events/evt_2001/roles': () => ({ body: [sampleRole] }),
      'GET /api/events/evt_2001/offers': () => ({ body: [offer('ofr_1', 'accepted', '2026-11-20T09:00:00Z', 'Done')] }),
      'GET /api/training-options': () => ({ body: [] }),
    });
    render(h(AuthProvider, null, h(EventDetail, { eventId: 'evt_2001' })));
    const badge = await screen.findByText('accepted');
    expect(badge.querySelector('[aria-hidden="true"]')?.textContent).toBe('✓');
    expect(screen.getByText('4 open').querySelector('[aria-hidden="true"]')?.textContent).toBe('◔');
  });

  it('shows the readiness bar to the organiser of an upcoming event only', async () => {
    login();
    installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/events/evt_2001': () => ({ body: sampleEvent }),
      'GET /api/events/evt_2001/roles': () => ({ body: [sampleRole] }),
      'GET /api/events/evt_2001/offers': () => ({ body: [offer('ofr_2', 'pending', '2026-11-20T09:00:00Z', 'x')] }),
      'GET /api/training-options': () => ({ body: [] }),
    });
    render(h(AuthProvider, null, h(EventDetail, { eventId: 'evt_2001' })));
    const bar = await screen.findByRole('navigation', { name: 'On this event' });
    expect(within(bar).getByRole('link', { name: /Staff roles/ })).toHaveAttribute('href', '#roles-heading');
    expect(within(bar).getByRole('link', { name: /Offers/ })).toHaveTextContent('1 pending');
    expect(within(bar).getByRole('link', { name: /Training/ })).toHaveAttribute('href', '#train-heading');
  });
});
