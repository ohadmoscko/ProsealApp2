import { useAuth } from '@/lib/auth';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-(--color-surface)">
        <div className="text-sm text-(--color-text-secondary)">טוען...</div>
      </div>
    );
  }

  if (!user) return <Login />;

  return <Dashboard />;
}
