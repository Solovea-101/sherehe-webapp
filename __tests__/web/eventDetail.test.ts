/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { EventDetail } from '@/components/EventDetail';
import { installFetch, sampleEvent, sampleRole, sampleUser } from './helpers';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/events/evt_2001',
  useSearchParams: () => new URLSearchParams(),
}));

const pendingOffer = { id: 'ofr_4001', roleId: 'rol_3001', eventId: 'evt_2001', workersOffered: 4, note: 'Four trained caterers', status: 'pending', createdAt: '2026-11-20T09:15:00Z' } as const;
const show = () => render(h(AuthProvider, null, h(EventDetail, { eventId: 'evt_2001' })));

const common = {
  'GET /api/events/evt_2001': () => ({ body: sampleEvent }),
  'GET /api/events/evt_2001/roles': () => ({ body: [sampleRole] }),
  'GET /api/training-options': () => ({ body: [] }),
};

beforeEach(() => window.localStorage.clear());

describe('someone who is not logged in', () => {
  it('sees the event and its roles, no organiser tools, and a way to log in', async () => {
    const { calls } = installFetch(common);
    show();
    expect(await screen.findByRole('heading', { name: sampleEvent.name })).toBeInTheDocument();
    // 14:00 to 22:00 UTC is 17:00 to 01:00 the next morning in Nairobi
    expect(screen.getByText('Sat 5 Dec 2026, 17:00 EAT to Sun 6 Dec 2026, 01:00 EAT')).toBeInTheDocument();
    expect(screen.getByText('Waiters')).toBeInTheDocument();
    expect(screen.getByText('2 of 6 confirmed')).toBeInTheDocument();
    expect(screen.getByText('4 open')).toBeInTheDocument();
    expect(screen.queryByText('Add a staff role')).not.toBeInTheDocument();
    expect(screen.queryByText('Offers from Kazi Connect')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login?next=/events/evt_2001');
    expect(calls.some((c) => c.path.endsWith('/offers'))).toBe(false); // nobody to ask for offers on behalf of
  });

  it('shows "Full" for a role with no places left', async () => {
    installFetch({ ...common, 'GET /api/events/evt_2001/roles': () => ({ body: [{ ...sampleRole, filled: 6 }] }) });
    show();
    expect(await screen.findByText('Full')).toBeInTheDocument();
  });

  it('says so when the event does not exist', async () => {
    installFetch({ 'GET /api/events/evt_2001': () => ({ status: 404, body: { message: 'Event evt_2001 not found' } }), 'GET /api/events/evt_2001/roles': () => ({ status: 404, body: { message: 'x' } }) });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that event.');
    expect(screen.getByRole('link', { name: 'Back to all events' })).toBeInTheDocument();
  });
});

describe('a logged-in organiser who does not own the event', () => {
  it('sees the roles but not the organiser’s tools', async () => {
    window.localStorage.setItem('sherehe.token', 'tok');
    installFetch({
      ...common,
      'GET /api/me': () => ({ body: sampleUser }),
      'GET /api/events/evt_2001/offers': () => ({ status: 403, body: { message: 'You can only see the offers on events you created.' } }),
    });
    show();
    expect(await screen.findByText('Only the organiser can add roles and decide on offers.')).toBeInTheDocument();
    expect(screen.queryByText('Add a staff role')).not.toBeInTheDocument();
    expect(screen.queryByText('This is your event.')).not.toBeInTheDocument();
  });
});

describe('the organiser of the event', () => {
  let offers: unknown[];
  beforeEach(() => {
    window.localStorage.setItem('sherehe.token', 'tok');
    offers = [pendingOffer];
  });
  const owner = () => ({
    ...common,
    'GET /api/me': () => ({ body: sampleUser }),
    'GET /api/events/evt_2001/offers': () => ({ body: offers }),
  });

  it('sees their tools: add a role, the offers from Kazi, and training', async () => {
    installFetch(owner());
    show();
    expect(await screen.findByText('This is your event.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add a staff role' })).toBeInTheDocument();
    expect(screen.getByText('Offers from Kazi Connect')).toBeInTheDocument();
    expect(screen.getByText('Train your crew')).toBeInTheDocument();
    expect(screen.getByText('4 workers for Waiters')).toBeInTheDocument();
    expect(screen.getByText(/Four trained caterers/)).toBeInTheDocument();
  });

  it('shows the saved list of courses with a notice when Ujuzi is not answering', async () => {
    installFetch({
      ...owner(),
      'GET /api/training-options': () => ({
        body: [{ courseId: 'crs_501', title: 'Food hygiene and event service', category: 'catering', centreName: 'Westlands Skills Centre', county: 'Nairobi', area: 'Westlands', durationWeeks: 2, feeKes: 3500, nextStart: '2026-11-23T07:00:00Z', certificateLevel: 'short-course' }],
        headers: { 'X-Data-Stale': 'true', 'X-Data-As-Of': '2026-11-05T14:24:11Z' },
      }),
    });
    show();
    expect(await screen.findByText('Showing the courses saved at Thu 5 Nov 2026, 17:24 EAT')).toBeInTheDocument();
    expect(screen.getByText(/Food hygiene and event service/)).toBeInTheDocument();
  });

  it('accepts an offer: sends the decision, then shows the new state', async () => {
    const { calls } = installFetch({
      ...owner(),
      'PATCH /api/offers/ofr_4001': () => {
        offers = [{ ...pendingOffer, status: 'accepted' }];
        return { body: { ...pendingOffer, status: 'accepted' } };
      },
    });
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/api/offers/ofr_4001', body: { status: 'accepted' }, authorization: 'Bearer tok' });
    expect(screen.getByText('accepted')).toBeInTheDocument(); // a badge now, with no buttons
  });

  it('declines an offer', async () => {
    const { calls } = installFetch({ ...owner(), 'PATCH /api/offers/ofr_4001': () => ({ body: { ...pendingOffer, status: 'declined' } }) });
    show();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'declined' });
  });

  it('shows the API’s reason when an offer cannot be accepted, and keeps the buttons', async () => {
    installFetch({
      ...owner(),
      'PATCH /api/offers/ofr_4001': () => ({ status: 409, body: { message: 'Role rol_3001 has 2 open places, fewer than the 4 offered' } }),
    });
    show();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Role rol_3001 has 2 open places, fewer than the 4 offered');
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('has no buttons on an offer that is already decided', async () => {
    offers = [{ ...pendingOffer, status: 'declined' }];
    installFetch(owner());
    show();
    expect(await screen.findByText('declined')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('says what to expect when there are no offers yet', async () => {
    offers = [];
    installFetch(owner());
    show();
    expect(await screen.findByText(/No offers yet/)).toBeInTheDocument();
  });

  it('adds a role, sending Nairobi times as UTC, then shows the updated list', async () => {
    const roles: unknown[] = [sampleRole];
    const { calls } = installFetch({
      ...owner(),
      'GET /api/events/evt_2001/roles': () => ({ body: roles }),
      'POST /api/events/evt_2001/roles': () => {
        roles.push({ ...sampleRole, id: 'rol_3012', title: 'Security guards', category: 'security', headcount: 3, filled: 0, payPerShift: 1800 });
        return { status: 201, body: roles[1] };
      },
    });
    show();
    const user = userEvent.setup();
    const form = within(await screen.findByRole('form', { name: 'Add a staff role' }));
    await user.type(form.getByLabelText(/^Role/), 'Security guards');
    await user.selectOptions(form.getByLabelText(/^Kind of work/), 'security');
    await user.clear(form.getByLabelText(/^How many people/));
    await user.type(form.getByLabelText(/^How many people/), '3');
    await user.clear(form.getByLabelText(/^Pay per shift/));
    await user.type(form.getByLabelText(/^Pay per shift/), '1800');
    fireEvent.change(form.getByLabelText(/^Shift starts/), { target: { value: '2026-12-05T16:00' } });
    fireEvent.change(form.getByLabelText(/^Shift ends/), { target: { value: '2026-12-06T02:00' } });
    await user.click(form.getByRole('button', { name: 'Add role' }));

    expect(await screen.findByText('Security guards')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      title: 'Security guards', category: 'security', headcount: 3,
      shiftStart: '2026-12-05T13:00:00Z', shiftEnd: '2026-12-05T23:00:00Z', payPerShift: 1800,
    });
  });

  it('shows the API’s reason when a role is refused', async () => {
    installFetch({ ...owner(), 'POST /api/events/evt_2001/roles': () => ({ status: 400, body: { message: 'shiftEnd must be after shiftStart' } }) });
    show();
    const user = userEvent.setup();
    const form = within(await screen.findByRole('form', { name: 'Add a staff role' }));
    await user.type(form.getByLabelText(/^Role/), 'Ushers');
    fireEvent.change(form.getByLabelText(/^Shift starts/), { target: { value: '2026-12-05T16:00' } });
    fireEvent.change(form.getByLabelText(/^Shift ends/), { target: { value: '2026-12-05T10:00' } });
    await user.click(form.getByRole('button', { name: 'Add role' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('shiftEnd must be after shiftStart');
  });

  it('hides the tools for an event that is no longer upcoming', async () => {
    installFetch({ ...owner(), 'GET /api/events/evt_2001': () => ({ body: { ...sampleEvent, status: 'completed' } }) });
    show();
    expect(await screen.findByText('This is your event.')).toBeInTheDocument();
    expect(screen.queryByText('Add a staff role')).not.toBeInTheDocument();
    expect(screen.queryByText('Train your crew')).not.toBeInTheDocument();
    expect(screen.getByText('Offers from Kazi Connect')).toBeInTheDocument(); // history is still readable
  });
});
