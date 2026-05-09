import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  routeName: string;
};

type State = {
  error?: Error;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Dashboard route crashed: ${this.props.routeName}`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="page-content">
          <div className="global-error">
            This dashboard page hit a display error, but the rest of the bot is still running. Route: {this.props.routeName}. Error: {this.state.error.message}
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
