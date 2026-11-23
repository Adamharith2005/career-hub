# V2 architecture assessment (written before the V2 changes)

Scope: profile-first onboarding, Cyberjaya-only company workspace, explainable target fit, company-specific drafts, UI/UX polish. Manual drafts only — no Gmail/OAuth/sending/inbox.

## What exists (audited, not assumed)

| Area | Reality |
|---|---|
| Stack | Electron 45 + React 19 + Tailwind 4 renderer; Node-only core (`node:sqlite`, pdfkit, docx, pdf.js, mammoth). `core/api.ts` is one handler table called over IPC; `core/*` is unit-testable without Electron. |
| Data | SQLite, `PRAGMA user_version` migrations (1 so far), `profile_id` on every personal table, `ON DELETE CASCADE`. Seed companies have `profile_id IS NULL`. |
| Profile model | `profiles` (identity/prefs/roles JSON) + a **`facts`** table with a category enum (EDUCATION, SKILL, PROJECT, EXPERIENCE, LEADERSHIP, CERTIFICATION, AWARD, LANGUAGE, LINK). Structured at the row level already, but one free-text `claim_text` per row and no per-category fields (project type, role, URL, CGPA scale, level…). |
| Onboarding | 3 steps: role → **upload master CV** → folder. Upload is the main path; "skip" exists but the whole UX assumes a CV. |
| Companies | 78 seed rows, stable `cj-<slug>` ids (rank is *not* the key; both rank-25 rows kept). List of near-identical cards, 6 equal-weight filters, blank right panel until selection. **No per-profile score.** `suitability_score` (research "prestige") is stored but must not drive fit. |
| Fit | `core/fit.ts` scores a *job spec* (vacancy fit) from confirmed facts, with gates. Reasonable and kept as "Vacancy fit". There is no company-level target fit. |
| Documents | Resume/letter AST → PDF + DOCX, fact-check gate, export QA, versions, per-company folders. Solid. Tailoring is weak for speculative applications because the generated spec has empty `required/preferred`, so every company gets the same ordering and wording. |
| Email | Draft + `.eml` only. No send, no OAuth. Kept manual. |
| Tests | 53 Vitest tests + Electron e2e script. |

## Root causes of the garbage output seen in earlier screenshots

Reproduced against `parseCvText`:

```
SKILL | Skills | ["ACTIVITIES & INVOLVEMENT"]     <- heading not in HEADINGS, so it never ends the SKILL section
SKILL | Procurement | ["Sourcing Lead"]             <- first line after it matches "Label: items"
SKILL | Skills | ["Jan 2023 - Dec 2023"]            <- date line treated as a skill item
SKILL | Skills | [" Led a team of 5"]               <- PDF bullet glyph U+F0B7 is not in the BULLET regex ("?" bullets)
```

1. `headingOf` only recognises an allow-list; an unknown heading silently *extends the previous section*.
2. The SKILL branch accepts any line/item with no validation (dates, headings, sentences).
3. `BULLET` omits private-use/replacement glyphs that PDF extraction emits, so they surface as literal `?`.
4. Nothing downstream validates category boundaries before documents are built.

## Decisions

* **Keep the architecture** (Electron + core + facts table). Add migration 2 rather than a new model: extra structured columns (`details_json`, `updated_at`) on `facts`, so existing facts are preserved untouched.
* **Backups before migration**: copy the DB file to `*.pre-v<N>.bak` before any pending migration runs.
* **Category integrity layer** (`core/integrity.ts`): used by the parser (reject at source), by manual entry (reject on save) and by the document builders (defence in depth, never deletes stored data).
* **Company target fit** (`core/target.ts`): new, separate from vacancy fit and from readiness. Weights documented in code and tested. Ignores `suitability_score`.
* **Tailoring**: speculative applications derive a company context (role families + technologies named in the directory record) so selection/order/wording differ per company, grounded only in the profile's confirmed facts.
* **UI**: keep the primitives in `ui.tsx`; update tokens (indigo/periwinkle accent, editorial serif display face using system fonts only), rebuild Companies, onboarding and My Profile. CSS-only motion; no new animation library.

## Prioritised checklist

- [x] P0 Audit + this document
- [x] P0 Fix parser/category contamination + tests
- [x] P0 Migration 2 + pre-migration backup + tests
- [x] P0 Profile-first 4-step onboarding (no upload), autosave
- [x] P0 Company target fit + Cyberjaya location states + tests
- [x] P0 Companies redesign with detail pane and Prepare flow
- [x] P1 Company-specific tailoring + tests (data vs cloud vs software)
- [x] P1 My Career Profile page (sections, completion, optional import)
- [x] P2 Visual tokens, motion, reduced motion
- [x] P2 e2e + screenshots; typecheck/test/build

## Status after implementation

All items above are implemented and covered by tests (see README "V2"). Not done: resizable list/detail split, per-skill self-assessed proficiency, Detailed-CV variant, macOS verification, live-AI verification, a lint script (the repo has none; typecheck is the static gate).
