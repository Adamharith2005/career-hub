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
