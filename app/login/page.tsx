import { AuthForm } from '@/components/AuthForm';

// The "?next=" query comes in as a prop, so the form is rendered on the server and arrives complete.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="login" next={Array.isArray(next) ? next[0] : next} />;
}
