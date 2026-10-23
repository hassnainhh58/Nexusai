import { Component } from "react";

/** Catches render errors so a single bad message cannot blank the app. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled UI error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="fatal-error-screen" role="alert">
        <div className="fatal-error-card">
          <div className="fatal-error-icon">◈</div>
          <h1>Something went wrong</h1>
          <p>
            The interface hit an unexpected error. Your conversations are stored
            on the server and are safe.
          </p>
          <button
            type="button"
            className="fatal-error-button"
            onClick={() => window.location.reload()}
          >
            Reload NexusAI
          </button>
        </div>
      </div>
    );
  }
}
