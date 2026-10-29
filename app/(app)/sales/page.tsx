import { redirect } from 'next/navigation'

// The /sales dashboard was retired (Andrew 2026-10-29): most of it was on the
// kanban already, and the nav's Sales click now lands on the kanban like
// Projects does. Old links and bookmarks land there too.
//
// ⚠️ The dashboard was the drawing-PDF PARSER's only door (drop a bid PDF →
// createParsedLeadProject). lib/pdf-parser and the create helpers in lib/sales
// are untouched; the page itself is in git history (last version before
// this commit) when the parser gets a new home.
export default function SalesRedirect() {
  redirect('/sales/kanban')
}
