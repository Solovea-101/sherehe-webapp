/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { TrainingManager } from '@/components/TrainingManager';
import { installFetch, sampleUser } from './helpers';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
  usePathname: () => '/training',
  useSearchParams: () => new URLSearchParams(),
}));

const training = { id: 'trn_5001', eventId: 'evt_2001', courseId: 'crs_501', crewSize: 6, preferredStart: '2026-11-28T05:00:00Z', status: 'pending', createdAt: '2026-11-20T07:00:00Z' } as const;
const course = { courseId: 'crs_501', title: 'Food hygiene and event service', category: 'catering', centreName: 'Westlands Skills Centre', county: 'Nairobi', area: 'Westlands', durationWeeks: 2, feeKes: 3500, nextStart: '2026-11-23T04:00:00Z', certificateLevel: 'short-course' } as const;
const show = () => render(h(AuthProvider, null, h(TrainingManager)));

let trainings: unknown[];
const base = () => ({
  'GET /api/me': () => ({ body: sampleUser }),
  'GET /api/crew-trainings': () => ({ body: trainings }),
  'GET /api/training-options': () => ({ body: [course] }),
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('sherehe.token', 'tok');
  mockReplace.mockClear();
  trainings = [training];
});

describe('the training page', () => {
  it('lists the organiser’s bookings with their status, and the courses on offer', async () => {
    installFetch(base());
    show();
    expect(await screen.findByText(/Crew of 6/)).toBeInTheDocument();
    expect(screen.getByText('Waiting for the training centre')).toBeInTheDocument();
    expect(screen.getByText(/starts Sat 28 Nov 2026, 08:00 EAT/)).toBeInTheDocument();
    expect(await screen.findByText('Food hygiene and event service')).toBeInTheDocument();
    expect(screen.getByText(/KES 3,500 per trainee/)).toBeInTheDocument();
  });

  it.each([
    ['confirmed', 'Confirmed'],
    ['declined', 'Declined'],
  ] as const)('shows a %s booking without the change and cancel buttons', async (status, label) => {
    trainings = [{ ...training, status }];
    installFetch(base());
    show();
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });

  it('says when there are no bookings yet', async () => {
    trainings = [];
    installFetch(base());
    show();
    expect(await screen.findByText('You have not booked any training yet.')).toBeInTheDocument();
  });

  it('changes a pending booking: sends crew size and the start as UTC', async () => {
    const { calls } = installFetch({
      ...base(),
      'PUT /api/crew-trainings/trn_5001': () => {
        trainings = [{ ...training, crewSize: 9, preferredStart: '2026-11-29T05:00:00Z' }];
        return { body: trainings[0] };
      },
    });
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    const form = within(screen.getByRole('form', { name: 'Change booking' }));
    expect(form.getByLabelText(/^Preferred start/)).toHaveValue('2026-11-28T08:00'); // shown back in Nairobi time
    await user.clear(form.getByLabelText(/^Crew size/));
    await user.type(form.getByLabelText(/^Crew size/), '9');
    fireEvent.change(form.getByLabelText(/^Preferred start/), { target: { value: '2026-11-29T08:00' } });
    await user.click(form.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Crew of 9/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/crew-trainings/trn_5001', body: { crewSize: 9, preferredStart: '2026-11-29T05:00:00Z' },
    });
  });

  it('shows the reason when a change is refused, and keeps the form open', async () => {
    installFetch({ ...base(), 'PUT /api/crew-trainings/trn_5001': () => ({ status: 409, body: { message: 'Crew training trn_5001 is now confirmed; only pending crew trainings can be changed' } }) });
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('is now confirmed');
    expect(screen.getByRole('form', { name: 'Change booking' })).toBeInTheDocument();
  });

  it('asks before cancelling, and only cancels when told twice', async () => {
    const { calls } = installFetch({
      ...base(),
      'DELETE /api/crew-trainings/trn_5001': () => {
        trainings = [];
        return { status: 204 };
      },
    });
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel booking' }));
    expect(screen.getByText('Cancel this booking at the training centre?')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false); // nothing happens on the first click

    await user.click(screen.getByRole('button', { name: 'No, keep it' }));
    expect(screen.queryByText('Cancel this booking at the training centre?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    expect(await screen.findByText('You have not booked any training yet.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('tells the person plainly when Ujuzi cannot be reached, without breaking the rest of the page', async () => {
    installFetch({
      ...base(),
      'GET /api/training-options': () => ({ status: 502, body: { message: 'Ujuzi is not responding right now. Try again in a minute.' } }),
      'DELETE /api/crew-trainings/trn_5001': () => ({ status: 502, body: { message: 'Ujuzi is not responding right now. Try again in a minute.' } }),
    });
    show();
    expect(await screen.findByText(/Crew of 6/)).toBeInTheDocument(); // bookings come from our own database
    expect(await screen.findByText('Ujuzi is not responding right now. Try again in a minute.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(screen.getAllByText('Ujuzi is not responding right now. Try again in a minute.').length).toBe(2));
    expect(screen.getByText(/Crew of 6/)).toBeInTheDocument(); // still there
  });

  it('filters the courses by kind of work and county', async () => {
    const { calls } = installFetch(base());
    show();
    const user = userEvent.setup();
    await screen.findByText('Food hygiene and event service');
    await user.selectOptions(screen.getByLabelText('Kind of work'), 'security');
    await user.selectOptions(screen.getByLabelText('County'), 'Nairobi');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/training-options?category=security&county=Nairobi')).toBe(true));
  });

  it('sends a logged-out visitor to the login page', async () => {
    window.localStorage.clear();
    installFetch({});
    show();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?next=%2Ftraining'));
  });
});
