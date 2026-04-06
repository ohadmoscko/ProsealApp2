import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await signIn(email, password);
    if (err) {
      setError(err.message);
      setLoading(false);
    }
    // On success, auth listener unmounts this component — no setState needed
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-(--color-surface-dim) px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl bg-(--color-surface) p-8 shadow-lg border border-(--color-border)"
      >
        <h1 className="mb-1 text-2xl font-bold text-(--color-text)">Proseal Brain</h1>
        <p className="mb-8 text-sm text-(--color-text-secondary)">המוח השני שלך</p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <label className="mb-1 block text-sm font-medium text-(--color-text-secondary)">
          אימייל
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent) transition-colors"
          dir="ltr"
          required
          autoFocus
        />

        <label className="mb-1 block text-sm font-medium text-(--color-text-secondary)">
          סיסמה
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent) transition-colors"
          dir="ltr"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className={cn(
            'w-full rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity',
            loading ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90',
          )}
        >
          {loading ? 'מתחבר...' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
