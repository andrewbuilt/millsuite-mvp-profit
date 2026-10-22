import { redirect } from 'next/navigation'

// The lost list merged into THE archive (Andrew 2026-10-22: one archive page,
// reached from Manage and from the kanban). Old links and bookmarks land there.
export default function LostArchiveRedirect() {
  redirect('/archive')
}
