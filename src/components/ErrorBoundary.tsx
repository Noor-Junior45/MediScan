import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong. Please try again.";
      
      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.operationType) {
            errorMessage = `Database error during ${parsed.operationType}. You might not have permission to perform this action.`;
          }
        }
      } catch (e) {}

      return (
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6 text-white font-sans">
          <div className="max-w-md w-full bg-[#1a1a1a] border border-white/10 rounded-[40px] p-10 text-center space-y-6 shadow-2xl">
            <div className="w-20 h-20 bg-red-500/10 rounded-full mx-auto flex items-center justify-center">
              <AlertTriangle className="text-red-500" size={40} />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Application Error</h2>
              <p className="text-white/60 text-sm leading-relaxed">
                {errorMessage}
              </p>
            </div>
            <button
              onClick={this.handleReset}
              className="w-full py-4 bg-white text-black rounded-full font-bold flex items-center justify-center gap-2 hover:bg-white/90 transition-all"
            >
              <RefreshCw size={20} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
