# Career Hub — design notes

A calm, editorial productivity tool. Warm paper-like surfaces, deep charcoal text, one navy-indigo accent, restrained semantic colour. Content first; whitespace and thin borders group things instead of stacking cards.

## Tokens (`renderer/src/styles.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#faf8f4` | `#131417` | app background |
| `surface` | `#ffffff` | `#1b1c20` | panels, inputs |
| `surface2` | `#f4f1ea` | `#23242a` | wells, hover, chips |
| `line` / `line-strong` | `#e4dfd3` / `#cfc8b8` | `#2c2d34` / `#3b3d47` | 1px borders |
| `ink` / `muted` / `faint` | `#1c1b19` / `#66625a` / `#8d887d` | `#ecebe6` / `#a3a097` / `#7b7870` | text |
| `primary` | `#27367d` | `#8da0f2` | actions, active state, focus ring |
| `ok` / `warn` / `bad` / `info` (+ `-bg`) | green / amber / red / indigo | tuned for dark | status only |

Theme: *System* (default), *Light*, *Dark* via `data-theme`. Both dark blocks define the same tokens; light is the base.

## Type & spacing

* Inter → Geist → Segoe UI Variable → system sans (no web fonts are bundled; nothing is fetched).
* Body 14.5 px / 1.5, page title 24 px semibold, section titles 16 px semibold, labels 13 px medium, meta 12 px. Tabular numerals for all figures.
* 4 px base grid; page gutters 16 px (mobile) / 32 px (desktop); max content width 1280 px; cards use 16–20 px padding.
* Radius: 8 px controls, 12 px panels, full pill for chips. One shadow style (a 1 px line) except dialogs and toasts.

## Components (`renderer/src/ui.tsx`)

`Button` (primary / secondary / ghost / danger; sm, md; busy state), `Chip` (tone + icon/text — **never colour alone**), `Toggle` (checkbox semantics), `Field`/`Input`/`Textarea`/`Select`, `Modal` (focus trap, Esc, focus restore), `Tabs` (roving tabindex, arrow keys), `Accordion`, `Banner`, `Empty`, `Spinner`, `Progress`, `ToastHost` (`aria-live`).

Navigation: five destinations only — Home, Applications, Companies, My Profile, Settings — plus one persistent primary action, *New application*. Application detail has four tabs: Overview, Documents, Email, Timeline; deep analysis sits in accordions inside Overview.

## Motion

* 120–220 ms opacity/translate only: page change (`fade-up`), tab panels (`fade`), toasts (`slide-in`), dialogs, accordion content. Hover/focus colour transitions 150 ms.
* No parallax, orbs, 3D, video or large page transitions. No motion library is used — CSS is enough.
* `prefers-reduced-motion: reduce` collapses all animation/transition durations (verified in the e2e test).
* The A4 preview and document layout are never animated.

## Accessibility rules applied

* Status is always icon + text (✓ △ ? ✕), plus colour.
* Visible focus ring on every interactive element; skip link; dialogs trap focus; tabs, menus and the board have keyboard paths (the board offers a *Move to…* select as the keyboard alternative to drag-and-drop).
* Form fields have labels; errors use `role="alert"`; progress uses `role="progressbar"`.
* Tables are CSS-grid lists that collapse to stacked rows below 1024 px; no horizontal page scroll at 390 px (checked by e2e).

## What was deliberately not used

The resource inventory lists many libraries. This app intentionally ships none of Magic UI, Aceternity, React Bits, Motion Primitives, GSAP, Lottie, Three.js, Spline, Remotion or Blender: they add weight and visual noise to a document-heavy workflow. shadcn/Radix were not adopted either; a small set of purpose-built primitives avoids copy-paste sprawl. No design skills/MCP servers were available in this environment, so visual QA was done with Playwright screenshots at 1440 / 1024 / 390 px.


---

## Career Hub 3.0 viewer (current): the reading-room ledger

### Audit of the first viewer build (screenshots in `test-output/before`)

Why it read as generated:

1. Every section was the same rounded card with the same shadow and equal weight, so nothing led.
2. Chips carried status, sector, class and evidence at once; one row could show five pills.
3. Five equal bordered copy buttons in a row, plus a copy icon on every data row.
4. Tracked all-caps eyebrows above titles, a gradient wash behind the dossier header, and a tile logo with a letter.
5. The deciding facts (allowance, evidence, contact) sat in the third card, below company metadata.
6. Instrument Serif was used for list titles at a size where its tight spacing failed.
7. Profile picker: two identical avatar cards floating in a gradient.

### Direction (written before editing, per the unslop and frontend-design workflows)

- **Product:** a private research library for two students to read employer evidence, copy details and draft an enquiry.
- **Character:** exact, quiet, bookish.
- **World:** a reading-room catalogue: index entries, ruled ledgers, field notes.
- **Moments:** the allowance figure, and the profile picker as a title page.
- **Signature:** the *evidence mark*, used consistently in place of badges. Solid square = verified, half = probable, dashed = unverified claim, hollow = unknown, bar = confirmed none. It always sits beside a word, so meaning never rests on shape or colour alone.

### What changed

- **Structure:** cards removed from the dossier. It is a document: header, a three-column at-a-glance strip (allowance, internship, contact) divided by rules, then chapters with a margin label and facts beside it.
- **Allowance figure:** monospace numerals at 2.6 rem when a verified amount exists. A policy rate is set muted with a dashed underline ("RM5 per hour") and says it is not this organisation's confirmed pay. Unknown reads "Not confirmed" in serif, never a number. Confirmed none reads "None paid".
- **List:** ledger rows, a 2 px left rule for selection, two evidence-mark lines instead of chips. Names are Geist 600 at 15 px; Instrument Serif is limited to titles of 28 px and above (page titles, dossier title, picker, wordmark, glance headings).
- **Copy:** one primary action ("Copy company details"), the rest ghost. Row copy icons appear on hover or keyboard focus. The button itself confirms ("Copied", check pop); the duplicate toast was removed.
- **Chrome:** sidebar is text with a left rule, no tile, no filled pill; the profile is a ruled block with "Switch profile". Below 1180 px it collapses to initials and icons.
- **Location switch:** underlined text tabs with a rule that draws in. Filters are real checkboxes in four columns, with counts; empty options are disabled.
- **Eyebrows:** `.eyebrow` is now sentence case, no tracking.
- **Profile picker:** a title page. The question in large serif on the left, the two profiles as index entries on the right; a rule grows on hover or focus.
- **Email:** a letter. To and Subject as ruled rows above a 15 px / 1.75 body, 68ch measure, one primary copy action.
- **Profile / resumes:** ruled lists instead of cards, project status as text, skills as a plain list, a quiet left-rule note instead of an amber box, file state as an evidence mark.

### Tokens and rules

- Neutral ramp limestone to graphite (`styles.css`); one accent (forest green) used only for selection, the primary action, links and verified evidence. No hue gradients anywhere in the viewer.
- Three text roles: ink, muted, faint. Hairlines at the line token; no decorative shadows.
- Sizes: 12.5 / 13.5 / 15 for text, 2.4 rem dossier title, 2.15 rem page titles, 2.6 rem allowance figure. Weights 400, 500, 600.
- Radii: controls 6 to 8 px; no rounded containers around content.
- Figures use `.figure` (Geist Mono, tabular, tight tracking, 500).
- Motion (all opacity or transform, 120 to 300 ms, one easing): dossier reveal on selection, profile swap, location rule drawing in, filter panel fade, copy check pop, picker rule. Nothing loops. Reduced motion (OS or Settings) drops all of it.

### Skill workflow record

| Skill | Role | Outcome |
|---|---|---|
| Anthropic frontend-design | Direction and plan | Reading-room ledger concept; plan reviewed against the generic tells (cream + terracotta, caps eyebrows, card kit) and revised: no terracotta, no eyebrows, no cards |
| heydamir unslop | Audit and passes | Applied its spacing, colour, copy, type, layout, detail and motion passes: chips and glows removed, sentence-case labels, one accent, no entrance on every block |
| pbakaus impeccable | Critique | Fixed: glance strip stacking too early at 1024 px, duplicated "Not confirmed" copy, heavy amber note, clipped select, picker dead space |
| erkamyaman unslopovich | Second audit | **Not run.** `erkamyaman/unslopovich` no longer exists; the author moved it to `erkamyaman/unslop-anything`, and installing that different repository was not approved |

### Kept from the earlier version

Accessibility rules (labels on icon buttons, `aria-pressed` tabs, `aria-current` selection, focus-trapping modals), reduced-motion support, and dark theme tokens.

---

## Career Hub 4.0 design update

**Direction.** Warm paper and deep-ocean ink, with one accent family per person set on `<html data-profile>`: Adam (Data Science) cobalt and cyan, Akif (Information Systems) coral and teal. Dark mode uses a navy base with lighter tints of the same accents. Category dots (government, GLC, MNC, SME, private) use fixed hues and always sit beside a text label.

**Type.** Plus Jakarta Sans (UI, tabular figures) and Fraunces (display headings). Geist Mono stays for emails and URLs. All three are self-hosted and licensed OFL-1.1.

**Signature component.** The match ring (`viewer/Meter.tsx`). The percentage is always printed, the tier is always written, and diamonds repeat the tier without colour. Provisional scores are labelled as such.

**Motion.** CSS only: ring and bar fills, count-up, a sliding location pill, staggered card entry. All of it honours the OS reduced-motion setting and the in-app Motion setting.

**Where the score comes from.** `core/viewer/suitability.ts`. Weights: skills 30, projects 25, organisation technical fit 20, academic 10, internship evidence 10, evidence confidence 5. Allowance never affects it. Source-reported scores in the research workbook are kept as history and never used.
