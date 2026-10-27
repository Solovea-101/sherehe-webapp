/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { NewEventForm } from '@/components/NewEventForm';
import { installFetch, sampleEvent, sampleUser } from './helpers';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/events/new',
  useSearchParams: () => new URLSearchParams(),
}));

const show = () => render(h(AuthProvider, null, h(NewEventForm)));

async function fillIn(user: ReturnType<typeof userEvent.setup>, opts: { start?: string; end?: string } = {}) {
  await user.type(await screen.findByLabelText(/^Event name/), 'Njeri and Kamau wedding');
  await user.type(screen.getByLabelText(/^Area/), 'Kilimani');
  await user.type(screen.getByLabelText(/^Venue/), 'Kilimani Gardens');
  fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: opts.start ?? '2027-01-16T17:00' } });
  fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: opts.end ?? '2027-01-17T01:00' } });
}

beforeEach(() => {
  window.localStorage.clear();
  mockPush.mockClear();
  mockReplace.mockClear();
});

describe('posting an event', () => {
  beforeEach(() => window.localStorage.setItem('sherehe.token', 'tok'));

  it('sends Nairobi times to the API as UTC and goes to the new event', async () => {
    const { calls } = installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'POST /api/events': () => ({ status: 201, body: { ...sampleEvent, id: 'evt_2008' } }),
    });
    show();
    const user = userEvent.setup();
    await fillIn(user);
    await user.selectOptions(screen.getByLabelText(/^County/), 'Mombasa');
    await user.click(screen.getByRole('button', { name: 'Post event' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/events/evt_2008'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.authorization).toBe('Bearer tok');
    expect(post?.body).toEqual({
      name: 'Njeri and Kamau wedding', type: 'wedding', county: 'Mombasa', area: 'Kilimani', venue: 'Kilimani Gardens',
      startsAt: '2027-01-16T14:00:00Z', // 17:00 in Nairobi
      endsAt: '2027-01-16T22:00:00Z', // 01:00 the next day in Nairobi
      expectedGuests: 100, // a number, not "100"
    });
  });

  it('offers all 47 counties and every event type', async () => {
    installFetch({ 'GET /api/me': () => ({ body: sampleUser }) });
    show();
    const county = await screen.findByLabelText(/^County/);
    expect(county.querySelectorAll('option')).toHaveLength(47);
    expect(screen.getByLabelText(/^Type of event/).querySelectorAll('option')).toHaveLength(5);
  });

  it('does not call the API when a time is missing or impossible, and says which', async () => {
    const { calls } = installFetch({ 'GET /api/me': () => ({ body: sampleUser }) });
    show();
    const user = userEvent.setup();
    await fillIn(user, { start: '', end: '2027-01-17T01:00' });
    await user.click(screen.getByRole('button', { name: 'Post event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid start date and time.');

    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: '2027-01-16T17:00' } });
    fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Post event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid end date and time.');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('shows the API’s reason when it refuses the event, and lets the person correct it', async () => {
    installFetch({
      'GET /api/me': () => ({ body: sampleUser }),
      'POST /api/events': () => ({ status: 400, body: { message: 'endsAt must be after startsAt' } }),
    });
    show();
    const user = userEvent.setup();
    await fillIn(user, { start: '2027-01-17T17:00', end: '2027-01-16T17:00' });
    await user.click(screen.getByRole('button', { name: 'Post event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('endsAt must be after startsAt');
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Post event' })).toBeEnabled();
  });
});

describe('when nobody is logged in', () => {
  it('sends the person to the login page and brings them back afterwards', async () => {
    installFetch({});
    show();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?next=%2Fevents%2Fnew'));
    expect(screen.queryByLabelText(/^Event name/)).not.toBeInTheDocument();
  });

  it('does the same when the saved login has expired', async () => {
    window.localStorage.setItem('sherehe.token', 'expired');
    installFetch({ 'GET /api/me': () => ({ status: 401, body: { message: 'Your login is not valid or has expired. Log in again.' } }) });
    show();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?next=%2Fevents%2Fnew'));
    expect(window.localStorage.getItem('sherehe.token')).toBeNull();
  });
});
