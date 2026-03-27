import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OfflineBanner } from '../shared/OfflineBanner'
import { useAppStore } from '../../stores/app-store'

describe('OfflineBanner', () => {
  beforeEach(() => {
    useAppStore.setState({ isOnline: true })
  })

  it('returns null when isOnline is true', () => {
    const { container } = render(<OfflineBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows banner when isOnline is false', () => {
    useAppStore.setState({ isOnline: false })
    render(<OfflineBanner />)

    expect(screen.getByText(/you're offline/i)).toBeInTheDocument()
  })

  it('contains correct offline message text', () => {
    useAppStore.setState({ isOnline: false })
    render(<OfflineBanner />)

    expect(screen.getByText(/your assistant is paused/i)).toBeInTheDocument()
  })
})
