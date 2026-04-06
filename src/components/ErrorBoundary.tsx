import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-(--color-surface) px-6 text-center">
        <h1 className="text-lg font-bold text-(--color-text)">משהו השתבש</h1>
        <p className="max-w-md text-sm text-(--color-text-secondary)">
          {this.state.error?.message ?? 'שגיאה לא צפויה'}
        </p>
        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          className="rounded-lg bg-(--color-accent) px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          נסה שוב
        </button>
      </div>
    );
  }
}
