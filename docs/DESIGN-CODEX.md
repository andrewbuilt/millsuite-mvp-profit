# MillSuite Design Codex

*The anti-template style guide for the marketing site redesign. This doc says HOW the site must look and sound. `MILLSUITE-DESIGN-BRIEF.md` says WHAT MillSuite is; read both before building. Originally researched 2026-09-13 (competitor audit of 9 shop-software sites + best-in-class reference study). Revised 2026-09-14: Andrew rejected the warm-paper-editorial direction below as "not what I have in mind" and also rejected the dark AI-template look. The direction he's actually building toward is Option C in the Claude Design project: light, clean, premium, not over-the-top or lifeless, and specifically must not read as AI-generated the way most new SaaS sites do. Sections 4, 5, and part of 6 have been rewritten to match Option C, grounded in the actual CSS/fonts pulled from that build rather than guessed. Everything else (the never-do list, the anti-AI-template posture, proof plays, photography rules) still holds; it was never specific to the paper aesthetic.*

---

## 1. The two findings that drive everything

**Finding 1: The dark AI template is already taken in our niche.** Allmoxy shipped it: near-black `#0a0c12`, `border-white/[0.08]`, glassmorphism nav, blur blobs, Satoshi + Inter, fade-up-on-scroll everywhere. Shipping anything in this family reads as an Allmoxy clone, not just as generic. Still true, and it's also why the answer isn't "go dark and moody" — it's "go light and quiet instead."

**Finding 2: "Built by a shop owner" is a burned headline.** Innergy, Microvellum, Mozaik, and Cabinetshop Maestro all run "by woodworkers, for woodworkers" or "built by a cabinetmaker, for cabinetmakers" verbatim. The claim is true for us, but as a slogan it's dead. We don't say it. We show it, with specifics nobody can copy: Built LLC, Tampa, 14 years, real photos, real job numbers (see the open question on the proof-section format in the site audit, since "real job numbers" is itself being reconsidered).

**The unoccupied quadrant** is: strong-voiced AND genuinely designed, but restrained rather than editorial. Light, clean, confident, typographically simple (not a three-typeface system), fast and quiet, premium without performing craft. Nobody in this category has that combination either polished-corporate or trying-too-hard-artisanal. That's the site.

---

## 2. Never-do list

Every item below appears on 3+ competitor sites or is a known AI-template tell. Each one is banned.

**Visual bans:**
- Dark background as the default theme
- White-at-low-opacity borders, glassmorphism, backdrop-blur nav
- Gradient blur blobs, glow effects
- Centered symmetric hero with a pill badge + status dot ("Now in early access")
- Icon-in-tinted-rounded-square feature card grids, Lucide or otherwise
- Fake browser chrome with three traffic-light dots
- Fade-up-on-scroll on every section; blanket framer-motion
- Testimonial carousel with circular headshots
- Review-badge walls and vanity stat bands
- Stock photography of any kind. Real or nothing.
- Popups, gated demos, exit-intent anything
- Overwrought "craft" signifiers (kraft-paper textures, hand-drawn arrows, twine-and-parchment styling) that read as costume rather than substance. This is the specific trap the original warm-paper direction risked; Option C avoids it by staying restrained.

**Type bans:** Inter, DM Sans, Poppins, Roboto, Satoshi, Clash Display, Space Grotesk, Playfair Display. Category-saturated or AI-template tells.

**Copy bans:**
- Em dashes. Anywhere. (Already a brand rule; also an AI tell.)
- Three-beat imperative parallelism: "Grow faster. Work smarter. Build bigger."
- "X won't save you. Y will." contrast-flip headlines
- Saturated phrases used by 3+ competitors: "know your numbers" as a headline, "all-in-one / everything in one place", "from quote to paid / estimate to install", "by woodworkers for woodworkers" and variants, "built for how you actually work"
- The banned-words list in `voice-and-tone` (leverage, optimize, game-changing, revolutionary, etc.)
- Any claim about a training dataset size or an accuracy percentage for the rate book. Confirmed false by Andrew 2026-09-14; the product ships pre-populated with starter rates and self-corrects from each shop's own numbers, not from a proprietary dataset. See `MILLSUITE-DESIGN-BRIEF.md` §4.
- Any sentence that could appear on a competitor's site unchanged. The test: swap in their logo. If it still works, cut it.

Note: "know your numbers" stays alive as Andrew's spoken POV and in body copy where it's his voice. It just can't be the headline. The distinctive version is the sharper one: **"More sales at a loss kills a business twice as fast."**

---

## 3. Always-do principles

1. **Clean and quiet, not loud in either direction.** Not terminal-black, and not costume-craft either. White-to-near-white ground, near-black ink, restrained use of color. The page should feel considered and premium, the way a well-built product's own UI feels, not like a themed landing page.
2. **Real over rendered.** Andrew has 14 years of shop photography. It is the single asset no competitor and no AI can fake. The photography IS the brand; the UI screenshots are supporting cast.
3. **Show the numbers, don't claim them, where the numbers are actually true.** This principle still holds, but its current application (the Job 214 bid-vs-actual case study) is under review, see the site audit's open question. Whatever replaces it should keep this spirit: proof over adjectives, using something that's actually real.
4. **Editorial structure without editorial costume.** Numbered chapters as structure (01 The problem, 02 The loop, 03 The proof...) and ruled dividers are confirmed in the current build and worth keeping. What's dropped is the heavier "spec sheet / shop drawing" visual metaphor, hand-drawn annotation layers, and kraft-paper material references, those belonged to the warm-paper direction Andrew moved away from.
5. **Fast and quiet.** Static-first, near-zero scroll animation, no popups, instant load. One or two obsessively tuned micro-interactions beat twenty fade-ups.
6. **A person is present.** First-person copy from Andrew, his photo in context (on the floor, not a LinkedIn headshot), real prospect quotes with names, once those quotes are actually cleared for use (neither current one is, as of 2026-09-14).

---

## 4. Type system

**Confirmed from the current build (Option C), not a proposal:** a single typeface, **Instrument Sans** (variable), used for everything, headlines, body, UI labels, captions. No serif, no separate mono family. This is a deliberate departure from the original three-family editorial system (Fraunces + Cabinet Grotesk + mono) proposed in the first version of this codex; Andrew's direction is simpler and more restrained than that called for.

**Rules:** one typeface family. Let weight and size carry the hierarchy (the current hero headline runs `clamp(40px, 6.4vw, 88px)`, weight 500, tight letter-spacing `-0.035em`, line-height ~1.02). Mono labels are reserved narrowly (data readouts, keyboard-shortcut badges), not used decoratively. Real reading sizes for body copy, generous leading.

If a second family gets introduced later for genuine differentiation, it should be tested against this constraint first: does the single-family version already feel premium enough that adding a second family is decoration, not necessity? Current answer, per Andrew, is that the single-family version is the direction.

---

## 5. Color system

**Confirmed tokens from the current build:**
- **Ground:** `#FFFFFF`, near-white. Not warm ivory, not kraft.
- **Ink:** `#111111`, near-black text.
- **Grayscale (borders, secondary text, dividers):** `#6B7280`, `#9CA3AF`, `#E5E7EB`, `#F3F4F6`, `#8A8A87`, `#6F6F6C`.
- **Accent, loud and ownable:** `#C2452F`, a saturated red-orange. This is the evolved, more-saturated version of the old muddy terracotta `#D4956A` the original codex called for, already resolved in the current build.
- **Semantic data colors, reused from the actual product UI** (per `MILLSUITE-DESIGN-BRIEF.md` §12, the app already uses green/yellow/red for margin health, carry that straight into marketing): green `#15803D` for on-target/good, amber `#B45309` / `#F59E0B` for caution/drifting, red `#B91C1C` for over-budget/urgent.
- **Rule of one:** a single chromatic accent for brand use (`#C2452F`), ruthlessly enforced. The semantic greens/ambers/reds are functional data-state colors, not brand decoration, keep that distinction clear so the page doesn't read as multicolored.

---

## 6. Layout grammar

- Numbered chapters as structure (01, 02, 03...), confirmed present in the current build. Oversized numerals as graphic objects, still good.
- Ruled horizontal lines as section dividers. Likely still applicable, confirm visually against the current build before leaning on it further.
- The closed loop drawn as an actual diagram remains the centerpiece graphic concept, this is real product differentiation regardless of visual theme. Execution should match the clean/restrained direction (simple line diagram, not shop-drawing dimension-line styling).
- Photography full-bleed or in a defined frame with a small caption naming something real: `BUILT LLC, TAMPA. JOB 214, WALNUT STOREFRONT.` Specificity is still the trust signal, keep this regardless of theme.
- Dropped from the original codex: hand-drawn annotation layers (arrows, circled numbers, twine/kraft material references). Those were part of the warm-paper costume and don't fit the cleaner direction.
- Pull quotes from real prospects, set large, with real names, once cleared. Neither current quote (McKusick, Zook) is cleared as of 2026-09-14, don't build final layouts around unapproved text.

---

## 7. Photography rules

- Documentary, not staged. Sawdust stays in frame.
- Real work from Built LLC: machines, hands, grain, installs, the floor. Andrew in context.
- Imperfect is correct: phone shots with honest light beat polished stock. Consistent treatment unifies mixed sources, keep the grade neutral/clean rather than warm, to match the lighter overall palette.
- Every photo gets a small caption naming something real (job, material, year). Specificity is the trust signal.
- No AI-generated imagery. Ever. One detected fake poisons the entire premise of the site.

---

## 8. Copy rules

All of `voice-and-tone` applies. Additions specific to the site:

- Headline leads with the sharp POV, not the saturated one. Confirmed live: "More sales at a loss kills a shop twice as fast."
- First person is allowed and encouraged. Andrew signs the story section with his name.
- Claims should carry real, checkable numbers: 14 years, 14-person shop, Tampa. **Do not** cite a training-dataset size or an accuracy percentage for the rate book, that claim was confirmed false and removed (see §2).
- Be careful with "14 years": true as Andrew's shop-floor experience, false if it reads as MillSuite-the-software having a 14-year track record. Word it so it's clearly about his experience, not the product's age.
- Objections get answered on the page in plain language, including the scary one ("what if you're small and you disappear": data export guarantee, say it straight).
- Short sentences. Contractions. Write like the reader is standing at a table saw with 90 seconds.
- Don't display specific pricing figures right now, pricing is being reworked. Use "pricing coming soon" language instead.
- The "swap their logo in" test applies to every section.

---

## 9. Proof plays (in order of punch, with current status noted)

1. **A real job, real numbers, on the homepage.** Format under review, Andrew flagged that a straightforward bid-vs-actual for a job that ran over isn't obviously good proof ("why would someone care that we undersold a project"). Options being weighed: a case study that shows the loop catching a problem early (a save, not a loss), or replacing the single-job format with a live product walkthrough of the loop instead. Don't finalize this section's content until that's settled.
2. **The loop diagram**, our differentiator, rendered cleanly (see §6). Still the strongest, most confirmed asset.
3. **The founder section as evidence, not slogan.** Photos of Built LLC + first-person story. Show, never say "by a shop owner for shop owners."
4. **Verifiable testimonials.** Real names, real companies, linkable where possible. Neither the McKusick nor the Zook quote is cleared yet, Andrew needs to ask before either can be used. Don't build the final version of this section around unapproved text.
5. **The free shop-rate calculator (tools.millsuite.com) as the hero CTA companion.** Low-friction entry is validated; a useful free tool is itself an anti-hype trust signal.

---

## 10. Behavior and performance

- Static generation for all marketing routes. Target instant paint.
- No scroll-jacking, no autoplay video with sound, no chat widget, no cookie theater beyond the legal minimum.
- Mobile gets the same care, not a stacked-card fallback.
- Respect `prefers-reduced-motion`; the site should barely notice.

---

## 11. References (what good looks like)

Revised for the light/clean/premium direction. The original list leaned heavily on warm-paper/editorial references (Field Notes, Lie-Nielsen, Anthropic's serif warmth) that fit the direction Andrew moved away from. Keeping what still applies, trimming the rest:

Postmark (one loud color, physical-object logo metaphor, verifiable testimonials) · 37signals (numbered structure, all-type confidence, restraint) · Stripe Press (product as loved object, small honest captions) · Studio Neat (founder-forward, unpretentious). This list should get revisited directly against Option C and whatever else Andrew points to as "premium, not lifeless", it hasn't been re-grounded in his actual references yet, only reverse-engineered from what's already built.

---

## 12. Next steps

1. Confirm this rewrite matches Option C's actual intent, the tokens in §4/§5 were pulled from the live build's CSS, but the overall framing (principles, references) is my interpretation of "light, premium, not lifeless, not AI-slop" and should get a direct yes/no from Andrew.
2. Resolve the open items flagged throughout: proof-section format (§9.1), testimonial clearance (§9.4), pricing display (§8).
3. Once settled, extract final tokens into a spec in `STATE.md`, then Claude Code rebuilds `app/(marketing)/` on main.
