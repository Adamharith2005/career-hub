# Implementation plan & log

## Architecture decision (made once, early)

Tauri v2 + Python sidecar was the suggested stack. Environment check: **no Rust/cargo**, Python 3.14. → Electron + Node-only core (node:sqlite, pdf.js, pdfkit, docx, mammoth). One language, no sidecar to package, fully testable under Vitest without a browser. UI and core are separated so a Tauri shell could replace `electron/` later.

## Inputs found / missing

| Input | Status |
|---|---|
| Master execution prompt | read |
| `master_deep_research_report-2.txt` | read; used as direction (schema, rules, formula). Benchmarks treated as *unsourced* |
| `Cyberjaya Companies` | **`.xlsx` not on disk**; the tab-separated text export was provided inline → saved as `data/cyberjaya-seed.tsv` (78 rows, rank 24 absent, rank 25 twice). `.xlsx` import path implemented and tested with a generated workbook |
| Resource inventory | read; deliberately used very little (see DESIGN.md) |
| Three reference screenshots | **not supplied**; UI designed from the written brief |
| Applicant CV | **not supplied**; tests use a fictional fixture (“Alex Tester”) that exists only in `tests/` |
| Installed skills / MCP | none relevant to UI in this environment |

## Milestones

- [x] Repo baseline, dependencies, scripts (`dev`, `build`, `start`, `test`, `typecheck`, `e2e`, `package`)
- [x] SQLite schema + migrations; `profile_id` on every personal table
- [x] Profiles (create / switch / delete), per-profile settings, secrets, folders
- [x] 78-company import (TSV + XLSX), idempotent, flags, A/B/C/D enums, search/filter
- [x] CV import (PDF/DOCX) → unconfirmed facts with source anchors → confirm/edit UI; duplicate + near-duplicate detection; re-import never overwrites confirmed facts
- [x] Job intake: paste / URL (SSRF-guarded, paste fallback) / company; local keyword analysis; optional AI with strict schema
- [x] Explainable fit heuristic, hard gates, scam/stale/unknown-pay warnings, allowance vs salary separation
- [x] Resume AST → PDF + DOCX; cover letter; fact-check gate; export QA on the real files; versions; diff; revert; regenerate section
- [x] Email: 4 contexts × EN/BM, lint, attachment chips from real files, MIME `.eml`, copy fallbacks
- [x] Tracker: status machine, confirmed-only “Applied”, events, metrics, follow-ups, board with validated drag-and-drop
- [x] UI: onboarding, Home, Applications (table/board), Detail (4 tabs), Companies, Profile, Settings; light/dark; reduced motion; responsive
- [x] Tests: 53 unit/domain + 22-step Electron e2e + packaged-app smoke test
- [x] Visual QA with screenshots; defects found and fixed (see below)
- [x] Packaging: Windows x64 unpacked app in `release/`

## Defects found by visual/e2e QA and fixed

* Cover-letter editor crashed for one render when switching from Resume (stale AST) → guarded.
* Detail header selects stretched to full width (lost `\s` in a regex) → fixed and measured (167 px).
* Tab strip showed a stray vertical scrollbar → replaced negative-margin underline with an inset line.
* Board overflowed the window at 1440 px → columns now share width.
* Education heading repeated as a bullet; “Languages” listed twice; dangling `|` in contact line → fixed in builder/parser.
* “Cybersecurity … Intern Internship”, “a Bachelor of … student” in letters/emails → grammatical phrase helpers.
* Deleted output files weren't noticed until reload → file state re-checked on tab change.
* Email attachments could name arbitrary paths → restricted to the profile's own documents.

## Not done (see README “Honest limitations”)

macOS/Linux packaging, OCR, live-AI verification, demo mode, UI weights editor, BM interface, signed installer.
