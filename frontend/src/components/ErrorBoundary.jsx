import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            maxWidth: 560,
            margin: '40px auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
          }}
        >
          <h2 style={{ color: '#ff6b6b', marginBottom: 12 }}>Something went wrong</h2>
          <pre
            style={{
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: 'var(--green)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
