'use client'

// ============================================================================
// /pm — THE HOME PAGE. Personal to whoever is signed in.
// ============================================================================
// Andrew: "a project manager dashboard for Kaylin — we'll add more here later."
// Then, 2026-09-12: "delete the dash that is linked to the logo and make that
// the my day page." /dashboard is now a redirect; this is where the logo, the
// login, the PWA and the setup wizard all land.
//
// Built GENERIC, not Kaylin-specific: everything on it is scoped to the signed-
// in viewer, so it's the same page for any manager. She's just the first user.
//
// ⛔ ROLE GATING IS ALREADY DONE, AND DELIBERATELY NOT REPEATED HERE. RoleGate
// confines `member` to /me, so any route that isn't /me is owner/admin by
// construction. (There IS no manager role in this app — it's owner / admin /
// member. Kaylin is an admin.) Adding a second check would be a second thing
// to keep in step.
//
// ⛔ THIS IS ALSO A FIRST-RUN SCREEN NOW, which is a different job from being
// a daily driver, and the two pull in opposite directions. A brand-new shop
// has no tasks, no payments, no projects and no roster — so every card says
// "nothing", and anything that reads as a WARNING in that state (see
// `showUnlinkedNotice`) lands on someone who has done nothing wrong yet.
// Before adding a card, ask what it says on day one.
//
// Cards, room to grow:
//   · Getting set up — owner-only checklist, moved with the rest of onboarding
//   · Today — the viewer's own Today bucket, using the real TaskRow so it can't
//     drift from /tasks and the drawer.
//   · Watch list — jobs over budget or over hours (was "Projects at risk")
//   · Money in — this month's scheduled draws vs cash received
//   · Invoiced — AR aging, reconciled against the ledger. NOT the same number
//     as Money in, deliberately: one is the plan, the other is what's been
//     billed. See the header of components/pm/ReceivablesCard.
//   · Quick upload — the invoice parser
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, CheckCircle2, Receipt } from 'lucide-react'
import PlanGate from '@/components/plan-gate'
import InvoiceParser from '@/components/invoice-parser'
import SetupChecklist from '@/components/onboarding/SetupChecklist'
import { WELCOME_TOAST_EVENT, WELCOME_TOAST_KEY } from '@/lib/welcome-toast'
import FirstProjectPrompt from '@/components/pm/FirstProjectPrompt'
import ProjectsAtRiskCard from '@/components/pm/ProjectsAtRiskCard'
import ReceivablesCard from '@/components/pm/ReceivablesCard'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import { useTasks } from '@/components/tasks/TasksProvider'
import { TaskRow } from '@/components/tasks/TaskRow'
import { BUCKET_LABEL, TASK_TAG_COLORS, type Task } from '@/lib/tasks'
import {
  buildPaymentsView,
  currentMonth,
  loadOrgLedger,
  loadOrgPayments,
  monthLabel,
  parseLocalDate,
  reconcileAll,
  type DerivedDraw,
} from '@/lib/payments'

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

/** How many draw cards the money box shows before deferring to /payments. */
const PREVIEW_DRAWS = 4

export default function PmPage() {
  const { user, org } = useAuth()
  // The money card links to /payments, which is gated on 'invoices' in the
  // nav. Showing it to a plan that can't open that page would be an invitation
  // to a dead end, so it follows the same gate.
  const canSeePayments = hasAccess(org?.plan || 'starter', 'invoices')

  return (
    <PlanGate requires="projects">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#111]">
          {user?.name ? `${user.name.trim().split(/\s+/)[0]}’s day` : 'Your day'}
        </h1>
        <p className="text-xs text-[#6B7280] mt-1 mb-5 sm:mb-6">
          What you owe today, what the shop is owed this month, and somewhere to
          drop an invoice.
        </p>

        {/* ⛔ ONBOARDING LIVES HERE NOW. A fresh owner is sent to this page
            straight out of the setup wizard; if the checklist and the welcome
            toast hadn't come with it, they'd land on an empty task list with
            no idea what to do next. Bam's onboarding runs through this. */}
        <WelcomeToast />
        <SetupChecklist />
        <FirstProjectPrompt orgId={org?.id} plan={org?.plan} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 space-y-4">
            <TodayCard />
            <ProjectsAtRiskCard orgId={org?.id} shopRate={org?.shop_rate ?? 0} />
          </div>
          <div className="space-y-4">
            {canSeePayments && <MoneyInCard orgId={org?.id} />}
            {canSeePayments && <ReceivablesCard orgId={org?.id} />}
            <QuickUploadCard />
          </div>
        </div>
      </div>
    </PlanGate>
  )
}

// ── Welcome toast ───────────────────────────────────────────────────────────

/**
 * One-shot "you're set up" toast, set by WelcomeOverlay on the final
 * walkthrough save and cleared as it renders so a later visit doesn't re-show
 * it. Moved from /dashboard with the rest of onboarding.
 */
function WelcomeToast() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = () => {
      if (window.localStorage.getItem(WELCOME_TOAST_KEY) !== '1') return
      window.localStorage.removeItem(WELCOME_TOAST_KEY)
      setVisible(true)
      timer = setTimeout(() => setVisible(false), 6000)
    }

    check()
    // ⛔ THE MOUNT CHECK ALONE NEVER FIRED FOR THE PERSON IT'S FOR. Signup
    // lands on /pm, the overlay finishes ON TOP of an already-mounted /pm and
    // calls router.push('/pm') — same route segment, so React re-renders
    // rather than remounting and a []-deps effect never runs again. The toast
    // then ambushed them on some later navigation instead. The overlay now
    // announces, and we listen. (The old /dashboard had the identical bug.)
    window.addEventListener(WELCOME_TOAST_EVENT, check)
    return () => {
      window.removeEventListener(WELCOME_TOAST_EVENT, check)
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!visible) return null
  return (
    <div className="mb-4 flex items-start gap-2.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl px-4 py-3">
      <CheckCircle2 className="w-4 h-4 text-[#059669] flex-shrink-0 mt-0.5" />
      <div className="text-[12.5px] text-[#065F46] leading-snug flex-1">
        <strong>You’re set up.</strong> This is your home from here on — what’s
        due today, what’s owed, and anything running hot.
      </div>
      <button
        onClick={() => setVisible(false)}
        className="text-[#065F46] hover:text-[#064E3B] text-xs flex-shrink-0"
      >
        Dismiss
      </button>
    </div>
  )
}

// ── Today ───────────────────────────────────────────────────────────────────

/**
 * The viewer's own Today bucket.
 *
 * ⛔ Uses the real `TaskRow`, not a lookalike. A task that renders one way here
 * and another on /tasks is how "why does it say something different over there"
 * starts — the same reason /tasks and the drawer already share it. Drag is
 * wired to no-ops: there's nothing to reorder on a single-bucket list.
 */
function TodayCard() {
  const { user } = useAuth()
  const {
    enabled,
    tasks,
    assignees,
    projects,
    loading,
    refresh,
    myAssigneeId,
    nameByUserId,
    taskTags,
    saveTags,
    extrasAvailable,
  } = useTasks()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickable = useMemo(() => assignees.filter((a) => a.tasksEnabled), [assignees])
  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignees) m.set(a.id, a.name)
    return m
  }, [assignees])
  const projectById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const p of projects) m.set(p.id, p)
    return m
  }, [projects])

  /**
   * ⛔ THE VIEWER'S LOGIN ISN'T ON THE ROSTER, so nothing can be "theirs".
   *
   * `myAssigneeId` bridges login → `orgs.team_members` row, and it's only
   * written when someone links that person on /team. Until then the fallback
   * below shows EVERYONE — deliberately, because a permanent empty list on a
   * page called "your day" is undiagnosable.
   *
   * ⚠️ But the fallback has to SAY SO. It didn't, and Andrew reasonably read
   * a list of Kaylin's and Hunter's work under his own name as a bug. A
   * silent fallback is only defensible while it's visible.
   *
   * ⛔ EXCEPT ON DAY ONE. A brand-new shop has an EMPTY ROSTER — building it
   * is item 4 of the setup checklist — so `myAssigneeId` is null for every
   * fresh owner by definition. Since /pm became the page they land on out of
   * the setup wizard, an unconditional warning meant their very first screen
   * opened with "your login isn't linked to a team member yet" sitting under
   * "Four things to make it yours", for a shop with no team and no tasks.
   * With nobody on the roster there is nothing to link TO, so the notice
   * isn't actionable — it's just alarming. It appears once a roster exists.
   */
  const showUnlinkedNotice = !myAssigneeId && assignees.length > 0

  /** Mine — or everyone, when this login isn't on the roster (see above). */
  const mine = useCallback(
    (t: Task) => (myAssigneeId ? t.assignee_ids.includes(myAssigneeId) : true),
    [myAssigneeId],
  )

  const today = useMemo(
    () => tasks.filter((t) => t.bucket === 'today' && mine(t)),
    [tasks, mine],
  )
  const weekCount = useMemo(
    () => tasks.filter((t) => t.bucket === 'this_week' && mine(t)).length,
    [tasks, mine],
  )

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  /** ⚠️ Must match TasksPanel and /tasks: the registry is ORG-WIDE, so a tag
   *  created here with a hardcoded colour would be gray everywhere, forever. */
  const addTag = useCallback(
    async (name: string) => {
      if (taskTags.some((t) => t.name.toLowerCase() === name.toLowerCase())) return
      const used = new Set(taskTags.map((t) => t.color))
      const color = TASK_TAG_COLORS.find((c) => !used.has(c.key))?.key ?? 'gray'
      await saveTags([...taskTags, { name, color }])
    },
    [taskTags, saveTags],
  )

  if (!enabled) return null

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-[#F3F4F6] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-[#2563EB] flex-shrink-0" />
          <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
            {BUCKET_LABEL.today}
          </span>
          <span className="text-xs text-[#D1D5DB]">{today.length}</span>
          {showUnlinkedNotice && (
            <span className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FFFBEB] text-[#92400E] whitespace-nowrap">
              everyone
            </span>
          )}
        </div>
        <Link href="/tasks" className="text-[11px] text-[#2563EB] hover:underline whitespace-nowrap">
          View all →
        </Link>
      </div>

      {/* ⛔ Never let the fallback pass for "your tasks". */}
      {showUnlinkedNotice && !loading && (
        <div className="mx-4 mt-3 text-[11.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2 leading-snug">
          Showing <strong>everyone’s</strong> tasks — your login isn’t linked to
          a team member yet, so nothing can be assigned to you.{' '}
          <Link href="/team" className="underline hover:text-[#111]">
            Link it on Team
          </Link>{' '}
          and this becomes just yours.
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="px-2 sm:px-3 py-2">
        {loading ? (
          <div className="text-[12px] text-[#9CA3AF] italic px-2 py-6">Loading tasks…</div>
        ) : today.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <div className="text-sm text-[#374151] font-medium">
              {showUnlinkedNotice ? 'Nothing in Today.' : 'Nothing due today.'}
            </div>
            <div className="text-xs text-[#9CA3AF] mt-1">
              {weekCount > 0
                ? `${weekCount} waiting in This week.`
                : 'Nothing in This week either.'}
            </div>
          </div>
        ) : (
          today.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              project={t.project_id ? projectById.get(t.project_id) ?? null : null}
              projects={projects}
              assignees={pickable}
              nameById={nameById}
              nameByUserId={nameByUserId}
              taskTags={taskTags}
              onAddTag={addTag}
              extrasAvailable={extrasAvailable}
              expanded={expandedId === t.id}
              onToggleExpand={() => setExpandedId((id) => (id === t.id ? null : t.id))}
              onRun={run}
              busy={busy}
              orgId={user?.org_id}
              userId={user?.id ?? null}
              // Nothing to reorder on a single-bucket list.
              onDragStart={() => {}}
              onDragEnd={() => {}}
              isDragging={false}
            />
          ))
        )}
      </div>

      {today.length > 0 && weekCount > 0 && (
        <div className="px-4 sm:px-5 py-2.5 border-t border-[#F3F4F6] text-[11px] text-[#9CA3AF]">
          {weekCount} more in {BUCKET_LABEL.this_week.toLowerCase()}.
        </div>
      )}
    </section>
  )
}

// ── Money in ────────────────────────────────────────────────────────────────

/**
 * This month's cash: needed vs received, plus the next few draws.
 *
 * Reads the /payments data layer rather than its own queries, so the two can't
 * disagree about what's owed. A summary that quietly differs from the page it
 * links to is worse than no summary.
 */
type PreviewKind = 'overdue' | 'month' | 'undated'
interface PreviewRow {
  draw: DerivedDraw
  kind: PreviewKind
}

function MoneyInCard({ orgId }: { orgId: string | undefined }) {
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [received, setReceived] = useState(0)
  const [needed, setNeeded] = useState(0)
  const [pastDue, setPastDue] = useState(0)
  const [undated, setUndated] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [ledgerMissing, setLedgerMissing] = useState(false)
  const [month] = useState(() => currentMonth())

  useEffect(() => {
    if (!orgId) return
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const [sched, led] = await Promise.all([loadOrgPayments(orgId), loadOrgLedger(orgId)])
        if (!alive) return
        if (sched.error || led.error) {
          setFailed(true)
          return
        }
        setLedgerMissing(led.missing)
        const derived = reconcileAll(sched.rows, led.entries, sched.contractTotals)
        const view = buildPaymentsView(derived, led.entries, [month], month)
        const b = view.months[0]
        const sum = (list: DerivedDraw[]) => list.reduce((s, d) => s + d.outstanding, 0)

        // ⛔ KEPT SEPARATE, NOT SUMMED INTO ONE FIGURE. Folding past-due and
        // undated money into a number labelled "September" would make this card
        // disagree with /payments for the same month — and a summary that
        // quietly differs from the page it links to is worse than no summary.
        setNeeded(b.needed)
        setReceived(b.receivedTotal)
        setPastDue(sum(view.overdue))
        // ⛔ Undated draws are REAL money owed. buildPaymentsView routes them to
        // `unscheduled`, so reading only the month bucket drops them silently —
        // the exact failure that hid $426k of Leonard work from the payments
        // board. Counted and shown here.
        setUndated(sum(view.unscheduled))

        setPreview(
          [
            ...view.overdue.map((d) => ({ draw: d, kind: 'overdue' as const })),
            ...b.outstanding.map((d) => ({ draw: d, kind: 'month' as const })),
            ...view.unscheduled.map((d) => ({ draw: d, kind: 'undated' as const })),
          ].slice(0, PREVIEW_DRAWS),
        )
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [orgId, month])

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-[#F3F4F6] flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider truncate">
          {monthLabel(month)}
        </span>
        <Link
          href="/payments"
          className="text-[11px] text-[#2563EB] hover:underline inline-flex items-center gap-0.5 whitespace-nowrap"
        >
          Payments <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="px-4 sm:px-5 py-6 text-[12px] text-[#9CA3AF] italic">Loading…</div>
      ) : failed ? (
        <div className="px-4 sm:px-5 py-6 text-[12px] text-[#B91C1C]">
          Couldn’t load payments.
        </div>
      ) : (
        <>
          <div className="px-4 sm:px-5 py-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                Needed
              </div>
              <div className="text-[17px] font-semibold text-[#111] font-mono tabular-nums mt-0.5">
                {money(needed)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#059669] font-semibold">
                Received
              </div>
              <div className="text-[17px] font-semibold text-[#059669] font-mono tabular-nums mt-0.5">
                {ledgerMissing ? '—' : money(received)}
              </div>
            </div>
          </div>

          {/* Migration 099 absent ⇒ "Received $0" would be a lie, not a zero. */}
          {ledgerMissing && (
            <div className="px-4 sm:px-5 pb-2 text-[10.5px] text-[#92400E]">
              Payments aren’t recorded yet (migration 099).
            </div>
          )}

          {(pastDue > 0 || undated > 0) && (
            <div className="px-4 sm:px-5 pb-3 space-y-1">
              {pastDue > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10.5px] uppercase tracking-wider text-[#B91C1C] font-semibold">
                    Past due
                  </span>
                  <span className="text-[12.5px] font-semibold font-mono tabular-nums text-[#B91C1C]">
                    {money(pastDue)}
                  </span>
                </div>
              )}
              {undated > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10.5px] uppercase tracking-wider text-[#B45309] font-semibold">
                    No date set
                  </span>
                  <span className="text-[12.5px] font-semibold font-mono tabular-nums text-[#B45309]">
                    {money(undated)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-[#F3F4F6]">
            {preview.length === 0 ? (
              <div className="px-4 sm:px-5 py-4 text-[11.5px] text-[#9CA3AF] italic">
                Nothing outstanding.
              </div>
            ) : (
              preview.map(({ draw: d, kind }) => (
                <Link
                  key={d.row.id}
                  href={`/projects/${d.row.projectId}`}
                  className="flex items-center gap-2 px-4 sm:px-5 py-2 border-b border-[#F9FAFB] last:border-b-0 hover:bg-[#F9FAFB] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-[#111] truncate">{d.row.projectName}</div>
                    <div
                      className={`text-[10.5px] truncate ${
                        kind === 'overdue'
                          ? 'text-[#B91C1C]'
                          : kind === 'undated'
                            ? 'text-[#B45309]'
                            : 'text-[#9CA3AF]'
                      }`}
                    >
                      {/* The row has to SAY which it is — a plain gray date
                          gives a manager no way to tell late from upcoming. */}
                      {kind === 'overdue'
                        ? 'Past due · '
                        : kind === 'undated'
                          ? 'No date · '
                          : ''}
                      {d.row.label}
                      {kind === 'month' && d.row.expectedDate
                        ? ` · ${parseLocalDate(d.row.expectedDate)?.toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}`
                        : ''}
                    </div>
                  </div>
                  <div className="text-[12.5px] font-semibold font-mono tabular-nums text-[#111] flex-shrink-0">
                    {money(d.outstanding)}
                  </div>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </section>
  )
}

// ── Quick upload ────────────────────────────────────────────────────────────

/** The dashboard's parser, reused as-is. Open by default here: dropping an
 *  invoice is a reason someone opens this page, not a thing to hunt for. */
function QuickUploadCard() {
  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-[#F3F4F6] flex items-center gap-2">
        <Receipt className="w-4 h-4 text-[#2563EB] flex-shrink-0" />
        <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
          Quick upload
        </span>
        <span className="text-[10.5px] text-[#D1D5DB] ml-auto whitespace-nowrap">
          vendor invoice
        </span>
      </div>
      <div className="px-4 sm:px-5 py-4">
        <InvoiceParser />
      </div>
    </section>
  )
}
