# Base Cabinet Walkthrough

**Canonical UX:** [`mockups/cabinet-tour-mockup.html`](../../mockups/cabinet-tour-mockup.html) (and the clickable mirror [`specs/base-cabinet-walkthrough/index.html`](index.html)).

**What it is.** 9 operations across 9 screens for an 8' run of base cabinets with veneer slab doors and clear matte finish. Opener → how-it-works → 9 op screens → summary (editable table).

**Output.** Four per-LF dept hours on the org's "Base cabinet" `rate_book_item` (`base_labor_hours_eng / cnc / assembly / finish`). The 9 ops fold into 4 dept buckets; each bucket divided by 8 to land at per-LF.

**Implementation truth:** [`components/walkthroughs/BaseCabinetWalkthrough.tsx`](../../components/walkthroughs/BaseCabinetWalkthrough.tsx). The `OPERATIONS` array + `toPerLfByDept` mapping are the source of truth for the math; the component mirrors the mockup's prompts verbatim.

No separate "machining" operation — every op in the 9-screen flow is a real shop step.
