/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { CertificateChecker } from '@/components/CertificateChecker';
import { installFetch, sampleUser } from './helpers';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
  usePathname: () => '/certificates',
  useSearchParams: () => new URLSearchParams(),
}));

const valid = { id: 'chk_7001', certificateNo: 'UJZ-2026-00123', valid: true, courseTitle: 'Food hygiene and event service', level: 'short-course', issuedOn: '2026-08-14', holder: 'Achieng O.', checkedAt: '2026-11-20T07:05:00Z' } as const;
const revoked = { ...valid, id: 'chk_7002', certificateNo: 'UJZ-2026-00124', valid: false, holder: 'Brian K.' } as const;
const show = () => render(h(AuthProvider, null, h(CertificateChecker)));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('sherehe.token', 'tok');
  mockReplace.mockClear();
});

describe('checking a certificate', () => {
  it('shows a valid certificate with who holds it, and clears the box for the next one', async () => {
    const { calls } = installFetch({ 'GET /api/me': () => ({ body: sampleUser }), 'POST /api/certificate-checks': () => ({ status: 201, body: valid }) });
    show();
    const user = userEvent.setup();
    const box = await screen.findByLabelText(/^Certificate number/);
    await user.type(box, 'UJZ-2026-00123');
    await user.click(screen.getByRole('button', { name: 'Check certificate' }));

    expect(await screen.findByText('Valid')).toBeInTheDocument();
    expect(screen.getByText('UJZ-2026-00123')).toBeInTheDocument();
    expect(screen.getByText(/Achieng O\. · Food hygiene and event service · short-course/)).toBeInTheDocument();
    expect(box).toHaveValue('');
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/certificate-checks', body: { certificateNo: 'UJZ-2026-00123' }, authorization: 'Bearer tok' });
  });

  it('warns clearly about a revoked certificate, and keeps earlier results below the newest', async () => {
    const answers = [valid, revoked];
    installFetch({ 'GET /api/me': () => ({ body: sampleUser }), 'POST /api/certificate-checks': () => ({ status: 201, body: answers.shift() }) });
    show();
    const user = userEvent.setup();
    const box = await screen.findByLabelText(/^Certificate number/);
    await user.type(box, 'UJZ-2026-00123');
    await user.click(screen.getByRole('button', { name: 'Check certificate' }));
    await screen.findByText('Valid');
    await user.type(box, 'UJZ-2026-00124');
    await user.click(screen.getByRole('button', { name: 'Check certificate' }));

    expect(await screen.findByText('Revoked: do not rely on it')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('UJZ-2026-00124'); // newest first
    expect(items[1]).toHaveTextContent('UJZ-2026-00123');
  });

  it.each([
    [404, 'Certificate UJZ-1999-00000 not found'],
    [400, 'certificateNo must look like UJZ-2026-00123'],
    [502, 'Ujuzi is not responding right now. Try again in a minute.'],
  ])('shows the API’s message for a %s and no result card', async (status, message) => {
    installFetch({ 'GET /api/me': () => ({ body: sampleUser }), 'POST /api/certificate-checks': () => ({ status, body: { message } }) });
    show();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Certificate number/), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Check certificate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
    expect(screen.queryByText('Checked in this visit')).not.toBeInTheDocument();
  });

  it('sends a logged-out visitor to the login page', async () => {
    window.localStorage.clear();
    installFetch({});
    show();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login?next=%2Fcertificates'));
  });
});
