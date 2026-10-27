/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { EventsBrowser } from '@/components/EventsBrowser';
import { EventDetail } from '@/components/EventDetail';
import { installFetch, sampleEvent, sampleRole, sampleUser } from './helpers';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const show = () => render(h(AuthProvider, null, h(EventsBrowser)));
const wedding = sampleEvent;
const nyali = { ...sampleEvent, id: 'evt_2006', name: 'Amina and Juma wedding', county: 'Mombasa', area: 'Nyali', venue: 'Nyali Beach Pavilion', startsAt: '2026-12-27T12:00:00Z', endsAt: '2026-12-27T20:00:00Z' };

beforeEach(() => window.localStorage.clear());

describe('the home page’s events', () => {
  it('lists upcoming events with where and when, each linking to its page', async () => {
    installFetch({ 'GET /api/events?status=upcoming': () => ({ body: [wedding, nyali] }) });
    show();
    expect(await screen.findByRole('link', { name: wedding.name })).toHaveAttribute('href', '/events/evt_2001');
    expect(screen.getByText(/Sarit Expo Centre, Westlands, Nairobi · about 300 guests/)).toBeInTheDocument();
    expect(screen.getByText('Sat 5 Dec 2026, 17:00 EAT')).toBeInTheDocument();
    expect(screen.getByText('Sun 27 Dec 2026, 15:00 EAT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: nyali.name })).toBeInTheDocument();
  });

  it('asks for one county when chosen, and says plainly when there is nothing', async () => {
    const { calls } = installFetch({
      'GET /api/events?status=upcoming': () => ({ body: [wedding, nyali] }),
      'GET /api/events?status=upcoming&county=Turkana': () => ({ body: [] }),
    });
    show();
    await screen.findByRole('link', { name: wedding.name });
    await userEvent.setup().selectOptions(screen.getByLabelText('County'), 'Turkana');
    expect(await screen.findByText('No upcoming events in Turkana yet.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/events?status=upcoming&county=Turkana')).toBe(true);
  });

  it('offers all 47 counties', async () => {
    installFetch({ 'GET /api/events?status=upcoming': () => ({ body: [] }) });
    show();
    const select = await screen.findByLabelText('County');
    expect(select.querySelectorAll('option')).toHaveLength(48); // 47 counties and "All counties"
  });

  it('invites a visitor to log in when events are protected by the partner key, rather than showing an error', async () => {
    installFetch({ 'GET /api/events?status=upcoming': () => ({ status: 401, body: { message: 'Send your partner key as X-API-Key' } }) });
    show();
    expect(await screen.findByText(/Log in to see the upcoming events/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'create an account' })).toHaveAttribute('href', '/register');
    expect(screen.queryByText(/partner key/i)).not.toBeInTheDocument(); // an internal detail for visitors
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows other failures as errors', async () => {
    installFetch({ 'GET /api/events?status=upcoming': () => ({ status: 500, body: { message: 'Something went wrong on our side. Please try again.' } }) });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side. Please try again.');
  });

  it('sends the saved login with the request, so a logged-in organiser sees events once keys are enforced', async () => {
    window.localStorage.setItem('sherehe.token', 'tok');
    const { calls } = installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/events?status=upcoming': (call) => (call.authorization === 'Bearer tok' ? { body: [wedding] } : { status: 401, body: { message: 'x' } }),
    });
    show();
    expect(await screen.findByRole('link', { name: wedding.name })).toBeInTheDocument();
    expect(calls.find((c) => c.path.startsWith('/api/events'))?.authorization).toBe('Bearer tok');
  });

  it('waits to know who is logged in before asking, so the first request is not sent without the login', async () => {
    window.localStorage.setItem('sherehe.token', 'tok');
    const { calls } = installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/events?status=upcoming': () => ({ body: [] }),
    });
    show();
    await waitFor(() => expect(calls.some((c) => c.path.startsWith('/api/events'))).toBe(true));
    expect(calls[0].path).toBe('/api/me'); // identity first, then the events
  });
});

describe('an event page for a visitor who is not logged in, when events are protected', () => {
  it('says to log in, with a link that comes back to this event afterwards', async () => {
    installFetch({
      'GET /api/events/evt_2001': () => ({ status: 401, body: { message: 'Send your partner key as X-API-Key' } }),
      'GET /api/events/evt_2001/roles': () => ({ status: 401, body: { message: 'Send your partner key as X-API-Key' } }),
    });
    render(h(AuthProvider, null, h(EventDetail, { eventId: 'evt_2001' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Log in to view this event.');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login?next=/events/evt_2001');
    void sampleRole;
  });
});
