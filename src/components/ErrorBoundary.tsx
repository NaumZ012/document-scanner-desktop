import type { ReactNode } from "react";
import { Component } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: undefined,
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    void error;
    void errorInfo;
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: "0.75rem",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.35rem", fontWeight: 600 }}>
            Нешто тргна наопаку во апликацијата.
          </h1>
          <p style={{ maxWidth: 520, opacity: 0.8, fontSize: "0.9rem" }}>
            Затвори го прозорецот или кликни на копчето подолу за да се обидеш повторно.
          </p>
          {this.state.message && (
            <pre
              style={{
                maxWidth: 520,
                maxHeight: 140,
                overflow: "auto",
                background: "rgba(0,0,0,0.05)",
                borderRadius: 8,
                padding: "0.5rem 0.75rem",
                fontSize: "0.75rem",
              }}
            >
              {this.state.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              marginTop: "0.5rem",
              padding: "0.4rem 0.9rem",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: 500,
            }}
          >
            Рестартирај прозорец
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

