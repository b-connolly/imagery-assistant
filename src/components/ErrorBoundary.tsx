import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <calcite-icon icon="exclamation-mark-triangle" scale="l" />
          <h2>Something went wrong</h2>
          <p className="error-boundary-message">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <div className="error-boundary-actions">
            <calcite-button appearance="solid" onClick={this.handleReload}>
              Reload App
            </calcite-button>
            <calcite-button appearance="outline" onClick={this.handleDismiss}>
              Try to Continue
            </calcite-button>
          </div>
        </div>
      </div>
    );
  }
}
