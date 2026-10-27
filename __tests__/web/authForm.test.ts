/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { AuthForm, safeNext } from '@/components/AuthForm';
import { AuthProvider } from '@/components/AuthProvider';
import { TOKEN_KEY } from '@/components/api';
import { installFetch, sampleUser } from './helpers';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => '/login',
}));

const result = { token: 'tok_new', expiresAt: '2026-12-01T00:00:00Z', user: sampleUser };
const show = (mode: 'login' | 'register', next?: string) => render(h(AuthProvider, null, h(AuthForm, { mode, next })));

beforeEach(() => {
  window.localStorage.clear();
  mockPush.mockClear();
});

describe('safeNext', () => {
  it.each([
    ['/events/new', '/events/new'],
    ['/training', '/training'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example/steal', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['events/new', '/'],
  ])('%p goes to %p', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('the register page', () => {
  it('creates the account, remembers the login and goes to the home page', async () => {
    const { calls } = installFetch({ 'POST /api/auth/register': () => ({ status: 201, body: result }), 'GET /api/me': () => ({ body: sampleUser }) });
    show('register');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Your name/), 'Njeri Kamau');
    await user.type(screen.getByLabelText(/^Email/), 'njeri@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/api/auth/register',
      body: { email: 'njeri@example.com', name: 'Njeri Kamau', password: 'correct horse battery' },
      authorization: null, // registering sends no old login
    });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('tok_new');
  });

  it('shows the API’s message when the email is taken, and stays on the page', async () => {
    installFetch({ 'POST /api/auth/register': () => ({ status: 409, body: { message: 'An account with that email already exists. Log in instead.' } }) });
    show('register');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Your name/), 'N');
    await user.type(screen.getByLabelText(/^Email/), 'taken@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'long enough pw');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An account with that email already exists. Log in instead.');
    expect(mockPush).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled(); // can try again
  });

  it('asks for a name; the login page does not', () => {
    installFetch({});
    const { unmount } = show('register');
    expect(screen.getByLabelText(/^Your name/)).toBeInTheDocument();
    unmount();
    show('login');
    expect(screen.queryByLabelText(/^Your name/)).not.toBeInTheDocument();
  });
});

describe('the login page', () => {
  it('logs in and returns to the page the person came from', async () => {
    const { calls } = installFetch({ 'POST /api/auth/login': () => ({ body: result }), 'GET /api/me': () => ({ body: sampleUser }) });
    show('login', '/events/new');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Email/), 'njeri@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'secret');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/events/new'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'njeri@example.com', password: 'secret' });
  });

  it('never sends the person to another site, whatever "next" says', async () => {
    installFetch({ 'POST /api/auth/login': () => ({ body: result }), 'GET /api/me': () => ({ body: sampleUser }) });
    show('login', 'https://evil.example/phish');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Email/), 'a@b.co');
    await user.type(screen.getByLabelText(/^Password/), 'x');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
  });

  it('says the same thing for a wrong password as the API does', async () => {
    installFetch({ 'POST /api/auth/login': () => ({ status: 401, body: { message: 'Email or password is incorrect' } }) });
    show('login');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Email/), 'a@b.co');
    await user.type(screen.getByLabelText(/^Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('keeps the password hidden and tells the browser which kind of field it is', () => {
    installFetch({});
    show('login');
    const password = screen.getByLabelText(/^Password/);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });
});
