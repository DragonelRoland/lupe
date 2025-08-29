"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"
import { useEffect } from "react"

interface PostHogProviderProps {
  children: React.ReactNode
}

export function PostHogProvider({ children }: PostHogProviderProps) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com"

    // Do not initialize analytics in development to avoid noisy network errors
    if (!key || process.env.NODE_ENV !== "production") {
      return
    }

    posthog.init(key, {
      api_host: host,
      ui_host: host,
      capture_exceptions: true,
      debug: false,
      // Silence transient network errors so they don't spam the console overlay
      on_request_error: () => {},
    })
  }, [])

  return (
    <PHProvider client={posthog}>
      {children}
    </PHProvider>
  )
}