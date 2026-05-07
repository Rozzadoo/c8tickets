import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('App error:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0c0a07', color: '#f0e9da', fontFamily: 'sans-serif', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#c8922a', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 16 }}>C8Tickets</div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Something went wrong.</div>
          <div style={{ fontSize: 13, color: '#7a6c54', marginBottom: 24 }}>Please refresh the page. If the problem continues, contact support@c8tickets.com</div>
          <button onClick={() => window.location.reload()} style={{ background: '#c8922a', color: '#0c0a07', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
