import { Component } from "react";

// A scanned mesh is the one asset in this project that comes from outside the
// codebase, so it is the one most likely to be missing, malformed or the
// wrong format on demo morning. Every model in the scene is wrapped in this:
// if it throws for any reason, the built-in geometry is drawn instead and the
// rest of the twin is untouched.
//
// Error boundaries have to be class components — there is no hook equivalent.
export default class ModelFallback extends Component {
  constructor(props) {
    super(props);
    this.state = { hasFailed: false };
  }

  static getDerivedStateFromError() {
    return { hasFailed: true };
  }

  componentDidCatch(error) {
    // Worth one line in the console: a silently absent room scan is
    // confusing when you are standing there wondering why it did not load.
    console.warn("EchoTwin: falling back to built-in geometry —", error.message);
  }

  render() {
    if (this.state.hasFailed) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
