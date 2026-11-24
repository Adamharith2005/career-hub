import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/geist-mono'
import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div role="alert" className="m-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-muted">Your data is safe on disk. Reload the window to continue.</p>
        <pre className="mt-4 overflow-auto rounded-lg bg-surface2 p-3 text-left text-xs">{this.state.err.message}</pre>
        <button className="mt-4 rounded-lg bg-primary px-4 py-2 text-on-primary" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}
createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>)
