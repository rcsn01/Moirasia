import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RotateCcw } from '@moirasia/ui-react/lib/icons'
import { Alert, AlertDescription, AlertTitle } from '@moirasia/ui-react/components/alert'
import { Button } from '@moirasia/ui-react/components/button'
import { DesktopPage } from '@moirasia/desktop-shell/react'

interface FeatureErrorBoundaryProps {
  name: string
  children: ReactNode
}

interface FeatureErrorBoundaryState {
  error: unknown | null
}

/**
 * Keeps one broken feature from taking down the whole shell. A rejected
 * React.lazy import or a render error inside a panel replaces only that
 * panel with an inline alert; the sidebar and other routes stay alive.
 *
 * The recovery action reloads the window instead of resetting state because
 * React.lazy caches a rejected import on the component object: re-rendering
 * would replay the cached rejection, while a reload re-attempts the fetch
 * (and in dev, Vite assigns fresh module URLs after edits).
 */
export class FeatureErrorBoundary extends Component<FeatureErrorBoundaryProps, FeatureErrorBoundaryState> {
  state: FeatureErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): FeatureErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[shell] ${this.props.name} failed to render:`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const message = error instanceof Error ? error.message : String(error)
    return (
      <DesktopPage width="standard" className="controller-main">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{this.props.name} failed to load</AlertTitle>
          <AlertDescription>
            {message}
            <br />
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RotateCcw aria-hidden="true" /> Reload Moirasia
            </Button>
          </AlertDescription>
        </Alert>
      </DesktopPage>
    )
  }
}