# MillSuite Design Codex

*The anti-template style guide for the marketing site redesign. This doc says HOW the site must look and sound. `MILLSUITE-DESIGN-BRIEF.md` says WHAT MillSuite is; read both before building. Researched 2026-09-13 (competitor audit of 9 shop-software sites + best-in-class reference study). Direction locked with Andrew: warm workshop editorial with modern-craft-SaaS polish, light ground, built around real photography from Built LLC.*

---

## 1. The two findings that drive everything

**Finding 1: The dark AI template is already taken in our niche.** Allmoxy shipped it: near-black `#0a0c12`, `border-white/[0.08]`, glassmorphism nav, blur blobs, Satoshi + Inter, fade-up-on-scroll everywhere. Our current site uses the same grammar (dark `#0d0d0f`, `white/[0.06]` borders, glass nav, DM Sans, icon-chip cards, browser-dot mockup). Shipping anything in this family now reads as an Allmoxy clone, not just as generic.

**Finding 2: "Built by a shop owner" is a burned headline.** Innergy, Microvellum, Mozaik, and Cabinetshop Maestro all run "by woodworkers, for woodworkers" or "built by a cabinetmaker, for cabinetmakers" verbatim. Factory.app runs the same play for fab shops. The claim is true for us, but as a slogan it's dead. We don't say it. We show it, with specifics nobody can copy: Built LLC, Tampa, 14 years, real photos, real job numbers.

**The unoccupied quadrant** in this category is: strong-voiced AND genuinely designed. Light, editorial, materially honest, typographically distinctive, fast and quiet, with real numbers shown instead of claimed. Nobody has it. That's the site.

---

## 2. Never-do list

Every item below appears on 3+ competitor sites or is a known AI-template tell. Each one is banned. Several are on our current `app/(marketing)/page.tsx`, noted so we know what we're deleting.

**Visual bans:**
- Dark background as the default theme *(current site)*
- White-at-low-opacity borders, glassmorphism, backdrop-blur nav *(current site)*
- Gradient blur blobs, glow effects
- Centered symmetric hero with a pill badge + status dot ("Now in early access") *(current site)*
- Icon-in-tinted-rounded-square feature card grids, Lucide or otherwise *(current site)*
- Fake browser chrome with three traffic-light dots *(current site)*
- Fade-up-on-scroll on every section; blanket framer-motion
- Testimonial carousel with circular headshots
- Review-badge walls and vanity stat bands
- Stock photography of any kind. Real or nothing.
- Popups, gated demos, exit-intent anything

**Type bans:** Inter, DM Sans *(current site)*, Poppins, Roboto, Satoshi, Clash Display, Space Grotesk, Playfair Display. These are either category-saturated or the new AI-template tells.

**Copy bans:**
- Em dashes. Anywhere. (Already a brand rule; also an AI tell.)
- Three-beat imperative parallelism: "Grow faster. Work smarter. Build bigger."
- "X won't save you. Y will." contrast-flip headlines *(our current H1 is this shape)*
- These saturated phrases, used by 3+ competitors: "know your numbers" as a headline (JobTread, Buildertrend, Innergy), "all-in-one / everything in one place", "from quote to paid / estimate to install", "by woodworkers for woodworkers" and variants, "built for how you actually work"
- The banned-words list in `voice-and-tone` (leverage, optimize, game-changing, revolutionary, etc.)
- Any sentence that could appear on a competitor's site unchanged. The test: swap in their logo. If it still works, cut it.

Note: "know your numbers" stays alive as Andrew's spoken POV and in body copy where it's his voice. It just can't be the headline; three competitors already shout it. The distinctive version of the POV is the sharper one: **"More sales at a loss kills a business twice as fast."**

---

## 3. Always-do principles

1. **Paper, not terminal.** Warm ivory ground, brown-charcoal ink. The page should feel like a well-printed shop drawing or a Field Notes cover, not a code editor.
2. **Real over rendered.** Andrew has 14 years of shop photography. It is the single asset no competitor and no AI can fake. The photography IS the brand; the UI screenshots are supporting cast.
3. **Show the numbers, don't claim them.** Nobody in the category shows a real job's estimate vs actual. We put a real (anonymized if needed) job on the homepage: bid, actual hours, actual material, the margin. This is our category whitespace and our product in one image.
4. **Editorial grammar.** Asymmetric grid, numbered sections, ruled lines, big serif pull quotes, small-caps captions under images, margin annotations. The visual language of a spec sheet and a good magazine, which is native to people who read shop drawings all day.
5. **Fast and quiet.** Static-first, near-zero scroll animation, no popups, instant load. In a category of loud sites, calm is a statement. One or two obsessively tuned micro-interactions beat twenty fade-ups.
6. **A person is present.** First-person copy from Andrew, his photo in context (on the floor, not a LinkedIn headshot), real prospect quotes with names. Studio Neat / Postmark energy: you can tell humans made this.

---

## 4. Type system

Escape route from DM Sans, chosen for "workshop editorial" with zero font budget, with a paid upgrade path.

**Free stack (build with this):**
- **Display / headlines: Fraunces** (Google Fonts, variable). Warm old-style serif with real character, optical-size axis, reads "craft" without reading "wedding invitation."
- **Body / UI: Cabinet Grotesk** (Fontshare) or **General Sans** (Fontshare). Softened, friendly grotesque. Cabinet Grotesk is literally named for us; verify it doesn't clash with Fraunces at small sizes, fall back to General Sans if it does.
- **Data / dimensions / captions: IBM Plex Mono or JetBrains Mono**, sparingly, small caps or uppercase tracking for image captions and spec callouts only. Keep DM Mono out; it ties back to the old identity.

**Paid upgrade path (when revenue justifies it):** Tiempos Text + Styrene B (the Anthropic pairing, the proven "warm paper tech" combo) or Signifier + Söhne. Swap is a CSS variable change if we build with the roles above.

**Rules:** serif for headlines and pull quotes, grotesque for everything functional, mono only for numbers and captions. Never more than these three families. Real reading sizes for body (17 to 19px), generous leading.

---

## 5. Color system

- **Ground:** warm ivory / paper, NOT pure white. Around `#FAF7F2` family. Sections can step to a deeper kraft tone for contrast, never to black.
- **Ink:** brown-charcoal, NOT pure black. Around `#2A2520` family.
- **Material tones:** sawdust tan, kraft brown, wood amber. These come from the photography, not from painted UI chrome. Keep the chrome paper-and-ink.
- **One accent, loud and ownable:** carpenter-pencil red or lumber-crayon orange. The current terracotta `#D4956A` can evolve into this but must get more saturated to work on a light ground; a muddy accent on ivory reads dated. Test against the photography before locking.
- **Rule of one:** a single chromatic accent, ruthlessly enforced (the Mercury/Postmark lesson). Screenshots of the product supply any additional color.

---

## 6. Layout grammar

- Asymmetric editorial grid. Nothing important is centered by default.
- Numbered chapters as structure (01 The problem, 02 The loop, 03 The proof...). Oversized numerals as graphic objects.
- Ruled horizontal lines as section dividers, like a cut list.
- The closed loop (see design brief section 5) drawn as an actual diagram in the brand's hand: shop-drawing style, dimension-line arrows, mono labels. This is the centerpiece graphic and no competitor has anything like it.
- Photography full-bleed or under slight rotation with a caption in mono small caps: `BUILT LLC, TAMPA. JOB 214, WALNUT STOREFRONT.` Library-card energy.
- Hand-drawn annotation layer used sparingly: an arrow, an underline, a circled number on a screenshot. Two or three per page maximum; past that it becomes a theme park.
- Pull quotes from real prospects set big in the serif, with real names: "The most tailored option we've seen." Sean McKusick, McKusick & Co.

---

## 7. Photography rules

- Documentary, not staged. Sawdust stays in frame.
- Real work from Built LLC: machines, hands, grain, installs, the floor. Andrew in context.
- Imperfect is correct: phone shots with honest light beat polished stock. Consistent treatment (slight warm grade) unifies mixed sources.
- Every photo gets a mono caption naming something real (job, material, year). Specificity is the trust signal.
- No AI-generated imagery. Ever. One detected fake poisons the entire premise of the site.

---

## 8. Copy rules

All of `voice-and-tone` applies. Additions specific to the site:

- Headline leads with the sharp POV, not the saturated one. Candidates to test: "More sales at a loss kills a shop twice as fast." / "You sold $2M in cabinets. Which jobs made money?" / "The bid said profit. The bank account disagrees."
- First person is allowed and encouraged. Andrew signs the story section with his name.
- Every claim carries a number: 14 years, 14-person shop, Tampa, $1.9M of project data, 97 to 99% accuracy. (Resolve the $10M vs $1.9M discrepancy flagged in the design brief before publishing.)
- Objections get answered on the page in plain language, including the scary one ("what if you're small and you disappear": data export guarantee, say it straight).
- Short sentences. Contractions. Write like the reader is standing at a table saw with 90 seconds.
- The "swap their logo in" test applies to every section.

---

## 9. Proof plays (the whitespace, in order of punch)

1. **A real job, real numbers, on the homepage.** Estimate vs actual vs margin, presented as a beautiful spec-sheet graphic. Nobody in the category shows this.
2. **The loop diagram** drawn as a shop drawing (section 6). Our differentiator, rendered in our visual language.
3. **The founder section as evidence, not slogan.** Photos of Built LLC + first-person story + the real dataset. Show, never say "by a shop owner for shop owners."
4. **Verifiable testimonials.** Real names, real companies, linkable where possible (the Postmark move). McKusick and Zook quotes exist and are cleared for use per audience-intelligence.
5. **The free shop-rate calculator (tools.millsuite.com) as the hero CTA companion.** Low-friction entry is validated; a useful free tool is itself an anti-hype trust signal.

---

## 10. Behavior and performance

- Static generation for all marketing routes. Target instant paint.
- No scroll-jacking, no autoplay video with sound, no chat widget, no cookie theater beyond the legal minimum.
- Mobile gets the same editorial care, not a stacked-card fallback.
- Respect `prefers-reduced-motion`; the site should barely notice.

---

## 11. References (what good looks like)

Anthropic.com (warm paper + serif done by a tech company) · Field Notes (kraft, spec-sheet romance, documentary film) · Lie-Nielsen (materials named, heritage voice) · Postmark (one loud color, physical-object logo metaphor, verifiable testimonials) · 37signals (numbered manifesto, all-type confidence) · Stripe Press (product as loved object, library captions) · Studio Neat (founder-forward) · Tennr (serif + photography as trust posture for risk-averse buyers) · Cash App brand (type as graphic object). Counter-reference: Mercury (right discipline, wrong palette for us). Anti-references: Allmoxy (our template, occupied), Cabinetshop Maestro (right voice, weak shell; watch messaging collision, they own "cabinetmaker for cabinetmakers" and the pain-quote style).

---

## 12. Next steps

1. Andrew gathers 20 to 40 best photos from Built LLC (floor, hands, installs, himself working). Raw is fine.
2. Cowork builds 2 static HTML direction mockups from this codex (same structure, different type/accent/photography intensity) for a side-by-side pick.
3. Pick one, extract tokens (fonts, colors, spacing) into a spec in STATE.md, then Claude Code rebuilds `app/(marketing)/` on main.
4. Resolve before publish: $10M vs $1.9M dataset figure; testimonial name clearance; accent color tested against real photos.
