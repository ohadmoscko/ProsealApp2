import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/lib/theme';
import { ToastProvider } from '@/lib/toast';
import { AuthProvider } from '@/lib/auth';
import { QueryProvider } from '@/lib/query';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <QueryProvider>
              <App />
            </QueryProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
