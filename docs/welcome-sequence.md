# MillSuite welcome email sequence

5 emails, branched by tier after email 2. Built for Klaviyo. Trigger: org `plan_status` flips to `active` (i.e. they paid). Tone: Andrew, first person, no corporate newsletter formatting, no em dashes.

## Sequence map

```
Day 0  → Email 1: Welcome + founder story (universal)
Day 2  → Email 2: Schedule a walkthrough (universal)
Day 5  → Email 3: Best practices (Profit vs Pro/Pro+ branches)
Day 9  → Email 4: Underused features (Profit vs Pro/Pro+ branches)
Day 14 → Email 5: Final walkthrough nudge (conditional — only if no booking yet)
```

Klaviyo flow shape:

```
[Trigger: plan_status = active]
    │
    ├── Email 1 (universal) — wait 2 days
    ├── Email 2 (universal) — wait 3 days
    │
    ├── Conditional split: profile.plan
    │     ├── starter → Email 3 (Profit), wait 4, Email 4 (Profit), wait 5
    │     └── pro OR pro-ai → Email 3 (Pro), wait 4, Email 4 (Pro), wait 5
    │
    └── Conditional split: booked_walkthrough property
          ├── false → Email 5 (final nudge)
          └── true → end
```

The `booked_walkthrough` property gets set when someone books on Calendly (or whatever you use). Klaviyo's Calendly integration handles that natively.

---

## Email 1 — Welcome + founder story (universal)

**Trigger:** Day 0, immediately after plan activation
**From:** Andrew at MillSuite
**Subject:** Real quick, before you start
**Preview:** I'm Andrew. I built this in my own shop. Here's why.

---

Hey {{ first_name|default:"there" }},

Andrew here. I built MillSuite in my own millwork shop because I was tired of running jobs and not knowing if I made money until the year-end tax bill landed.

Twelve years running Built Things. I'd come home some Fridays after a $40k revenue week and wonder why my checking account looked like it always did. Margin was a guess. The schedule was in my head. Project profit was a feeling, not a number.

I tried a bunch of software. None of it fit. Most was built by people who'd never cut a sheet. Pricing was per "user" with no idea what a shop actually pays for. Scheduling assumed I had a project manager. Reports were either too thin or so complex they took a full day to set up.

So I built my own. Just for me, at first. Now you have it.

You're on {{ event.plan_label|default:"MillSuite" }}. Three things to do first:

1. **Settings → Shop rate setup.** The walkthrough gets your real shop rate in 5 minutes.
2. **Settings → Business info.** Fill in your address and email so invoices look right.
3. **Projects → New project.** Drop one active job in and watch the margin track.

That's it for today. The rest can wait until tomorrow.

Andrew

P.S. I read every reply. If you've got a question or a feature request, hit reply.

---

## Email 2 — Schedule a walkthrough (universal)

**Trigger:** Day 2
**Subject:** Want me to walk you through it?
**Preview:** 30 minutes, free, no upsell. Just me showing you the moves.

---

{{ first_name|default:"Hey" }},

While you're getting set up, want me to walk you through it?

30 minutes. Just us. I'll share my screen, show you how I'd use MillSuite if I were running your shop, and answer whatever's on your mind.

No upsell. You already pay me. This is just so you actually get the value.

**Book a time: [your Calendly link]**

If you'd rather dig in solo, that's also fine. I'll send a few more emails over the next two weeks with practical stuff you can use right away.

Andrew

---

## Email 3 — Best practices (TIER-AWARE)

**Trigger:** Day 5

### Profit branch — for `plan = starter`

**Subject:** The 3 things to track every job
**Preview:** Boring, repeatable, profitable.

---

{{ first_name|default:"Hey" }},

Three habits separate shops that know their margin from shops that don't.

**1. Estimate the hours before you bid.** Even rough. Write it down in MillSuite when you create the project. You're not committing to anything. You're creating a baseline you can compare against later.

**2. Clock the time. Every job, every hour.** The /time page works on your phone for shop floor use. If hours aren't tracked, the whole system is a guess.

**3. Mark projects complete the same week they ship.** Don't let them sit. The outcomes page only gets useful when there's data in it. /reports shows the picture.

Three habits. Five minutes a day. That's the whole game.

Andrew

P.S. Still happy to walk through this on a call: [your Calendly link]

---

### Pro / Pro+ branch — for `plan = pro` OR `plan = pro-ai`

**Subject:** How I run a shop in MillSuite
**Preview:** The 5 daily moves, in order.

---

{{ first_name|default:"Hey" }},

Here's the actual rhythm I use to run a shop in MillSuite. Five moves, in order.

**1. Morning, /sales.** Check the kanban. Any leads at 90% I can push to sold? Any 50/50s that need a follow-up call this week?

**2. Mid-morning, /capacity** (or /schedule on Pro+)**.** Look at what each department is doing this week. Anyone falling behind? Anyone underloaded?

**3. When a new bid is signed, /projects → pre-production.** Walk through approval items with the client. Catch the door style or finish gotchas before CNC starts cutting.

**4. Friday afternoon, /reports.** Did completed projects this week hit margin? On Pro+, click into the diagnostics drawer to see the waterfall. On Pro, the outcomes table tells you the same story.

**5. End of month, /reports → outlook.** Look at the next 8 months. Hire signals start showing up here.

That's the loop. None of it takes long once it's a habit.

Andrew

P.S. Want me to walk through this on your shop's data? [your Calendly link]

---

## Email 4 — Underused features (TIER-AWARE)

**Trigger:** Day 9

### Profit branch — for `plan = starter`

**Subject:** 4 things you might be missing
**Preview:** Most Profit shops use 60% of what's there. Here's the other 40%.

---

{{ first_name|default:"Hey" }},

Quick tour of the parts of MillSuite that Profit shops tend to underuse:

**1. Shop rate calculator** (Settings → Shop rate setup). If your number is still 65 an hour because that's what your guys cost, it's wrong. Run the walkthrough. Most shops are charging 20-30% less than they should be.

**2. Project outcomes** (/reports → Shop Grade). Letter grade A-F based on margin and utilization. A quick health check that updates every time you mark a project complete.

**3. AI shop report** (/dashboard). Click "Generate report." Claude reads your data and tells you what's working and what isn't. You get one per month on Profit.

**4. Invoice parsing** (/invoices). Drag a vendor PDF onto an estimate line and it pulls the cost. Saves typing.

If any of those four sound new, that's where to spend 15 minutes this week.

Andrew

---

### Pro / Pro+ branch — for `plan = pro` OR `plan = pro-ai`

**Subject:** 4 features you probably haven't tried yet
**Preview:** Most Pro shops live in 3 pages. There are 9 more.

---

{{ first_name|default:"Hey" }},

Quick tour of the parts most Pro shops underuse:

**1. Rate book** (/rate-book). Standardized work types with slot pricing. The composer pulls from this. Calibrate it once and estimates get fast.

**2. Learning loop** (/suggestions). After jobs close, MillSuite proposes rate book adjustments based on actual vs estimated hours. Accept or dismiss. Your rate book gets smarter every job.

**3. Pre-production approvals** (/projects → pre-production tab). Once a project is sold, walk through door styles, finishes, materials with the client. Catches gotchas before CNC.

**4. Capacity calendar** (/capacity). 12-month view, drag projects across months, mark PTO and holidays. The "hire signal" pops up when you're under-capacity for a month.

{% if plan == "pro-ai" %}On Pro+, you've also got the drawing parser (/sales, drop a PDF, AI extracts the bid) and the department schedule with AI assistant chat. Worth 15 minutes on each.{% endif %}

Pick one this week. Spend 15 minutes.

Andrew

P.S. The walkthrough offer is still open: [your Calendly link]

---

## Email 5 — Final walkthrough nudge (conditional)

**Trigger:** Day 14, only if `profile.booked_walkthrough != true`
**Subject:** Last nudge on the walkthrough
**Preview:** I'm still offering. Just easier when it's set up right.

---

{{ first_name|default:"Hey" }},

I've sent four emails so far. You haven't booked the walkthrough yet.

Maybe you're killing it on your own. If so, ignore this and we're good.

But if MillSuite isn't quite clicking yet — the shop rate seems off, you're not sure if you're hitting margin, the schedule is still in your head — 30 minutes with me would fix most of it.

I've done this with every customer who's asked. It's always the difference between "the software" and "their software."

Last offer: [your Calendly link]

After this I'll only email when something materially changes (new features, pricing, etc.). You won't hear from me weekly.

Andrew

---

## Two things you need to provide

1. **Calendly (or other booking) link.** Replace `[your Calendly link]` placeholder in every email. If you don't have one yet, set up a free Calendly with a 30-minute "MillSuite Walkthrough" event type.

2. **Profile property for tier.** Klaviyo needs to know the customer's plan to branch. Our `/api/stripe-webhook` will push `plan` (starter / pro / pro-ai) and `plan_label` (Profit / Pro / Pro+) to the Klaviyo profile. See the code-side work below.
