import { createFileRoute, redirect } from '@tanstack/react-router'

// The search page was folded into the Dashboard (spec §3). This route exists
// only so old /search bookmarks land on the Dashboard; it renders nothing.
export const Route = createFileRoute('/search')({
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})
