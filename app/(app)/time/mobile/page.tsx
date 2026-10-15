// /time/mobile — retired (October batch item 4). It ran a second, private
// localStorage timer that no other surface could see, which is exactly the
// "desktop and phone timers don't sync" bug. /time has its own phone layout
// and now reads the one truth (the open time_entries row), so this route just
// forwards there. Nothing in the app links here; kept only for old bookmarks.
import { redirect } from 'next/navigation'

export default function MobileTimerPage() {
  redirect('/time')
}
