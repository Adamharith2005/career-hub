# Career Hub

A private, local-first desktop app for Computer Science / IT students and early-career applicants (Cyberjaya, Malaysia first).

> **Choose role(s) once → import your master CV once → paste a vacancy or pick a company → honest fit check → truthful ATS-friendly resume + cover letter → ready-to-use email with the real files attached → track what *you* confirm you sent.**

Everything is stored on your computer. There is no account, no cloud database and no automatic sending. AI is optional.

---

## Quick start

Requirements: **Node.js 22+** (developed on 24) and npm. Windows is the tested platform.

```bash
npm install
npm run build        # bundles the Electron main process and the React UI
npm start            # builds, then launches the app
```

Other scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (HMR) + Electron |
| `npm test` | 53 unit/domain tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | typecheck + tests |
| `npm run e2e` | drives the **real Electron app** with Playwright (22 steps, screenshots → `test-output/screens`). Run `npm run build` first |
| `npm run package` | builds an unpacked desktop app in `release/` (`@electron/packager`) |
| `npm run smoke:packaged` | boots the **packaged** executable and runs import → export → `.eml` |

> If you launch Electron yourself from VS Code or another Electron-based tool, `ELECTRON_RUN_AS_NODE` may be set in that shell and Electron then behaves like plain Node. `npm start` / `npm run dev` clear it for you.

## Using it

1. **Onboarding (3 steps).** Pick one or more roles (Software, Frontend, Backend, AI/ML, Data, Cybersecurity, Cloud/DevOps, QA, IT Support, Other) and Internship and/or Graduate. Drop your CV (PDF or DOCX). Review what was found and confirm it. Choose where files are saved.
2. **New application.** Paste a job description, paste a URL (public pages only; if blocked you are asked to paste the text), or choose one of the 78 Cyberjaya companies for a clearly-labelled *speculative enquiry*.
3. **Overview.** Decision (Apply now / Apply with caveats / Hold & investigate / Skip), a 0–100 **explainable heuristic** (not an ATS score) with confidence, eligibility checks, matched/unproven/missing skills with the exact facts used, and a separate allowance/salary card that says **Not verified** unless the ad states a figure.
4. **Documents.** One-page A4 resume and a cover letter, built only from your confirmed facts. Edit, diff against your master, revert bullets, regenerate a section. Preview is the *actual exported PDF*. Export checks run on the real files.
5. **Email.** Subject, recipient (only addresses you entered or that seed research recorded — never guessed), body, and attachment chips for the real files. **Save Draft .eml** produces a MIME file with the PDFs embedded. Copy buttons and manual steps are provided because `mailto:` cannot carry attachments.
6. **Timeline.** *Mark as applied* needs an explicit confirmation, date and method. Only then does it count as Submitted. Follow-ups, responses, notes and status changes are recorded.

Generating documents or saving an `.eml` **never** marks anything as applied or sent.

## Where your data lives

| What | Where |
|---|---|
| Database (profiles, facts, applications, history) | `%APPDATA%\Career Hub\careerhub.db` (SQLite, WAL) |
| Original CV uploads (untouched copies) | `%APPDATA%\Career Hub\profiles\<name>__<id>\originals\` |
| API keys | OS credential store via Electron `safeStorage` (DPAPI / Keychain / libsecret) — never in the database |
| Your documents | The folder you choose, under `Career Hub\` (below) |

```
Career Hub/
  Company-Data/cyberjaya-seed-source.tsv
  Profiles/<name>__<profile-id>/
    Master/originals/            copies of your CV
    Master/fact-bank.json
    Applications/<company>__<role>__<application-id>/
      job-description.txt  assessment.json  notes.md
      Resume_<name>_<company>_v01.pdf / .docx
      CoverLetter_<name>_<company>_v01.pdf / .docx
      email_apply_v01.eml
  Backups/
```

Versions are immutable: regenerating or editing creates `v02`, `v03`… and a version marked as submitted is never overwritten. Files are written atomically, size-checked and SHA-256 recorded; if one is deleted or altered the app shows a recovery banner instead of failing.

**Backup / restore.** Settings → *Create backup now* writes a consistent SQLite snapshot (`VACUUM INTO`) to `Career Hub/Backups/`. To restore: quit the app, copy that file over `careerhub.db` in the app-data folder, start the app.

## Privacy & AI

* Without AI everything works: company browsing, local keyword analysis of ads, fit, documents, email drafts and tracking.
* AI is **opt-in per profile**. Providers: Anthropic (Claude), any OpenAI-compatible endpoint (OpenAI, Gemini's compatible endpoint, OpenRouter…) or a local model such as Ollama (http on `localhost` only).
* Before anything is sent you must tick consent naming the provider host. What is sent: the job text and the confirmed facts needed for the task. **Your name, email, phone and links are never sent.** An optional redaction toggle also masks emails/phones/links inside the text.
* A Claude Code or Claude subscription does **not** supply an API key for this app. With no key the AI features stay off — nothing is faked.
* AI output is parsed against strict Zod schemas and then **fact-checked** (tools, figures, years, skills must exist in your confirmed facts); a failing AI draft is rejected and the deterministic template is used, with the reason shown.
* Job ads and CVs are treated as untrusted data (delimited as such in prompts; the model has no tools, files or network access).
* URL fetching refuses non-http(s), credentials in URLs, localhost/private/link-local/metadata addresses (also after DNS and on every redirect), respects blocks/logins/CAPTCHAs, and reads one page with size and time limits.
* Profiles are a convenience boundary on a shared PC, **not** a security boundary. Use your OS account and disk encryption for that.
* Electron window: context isolation, sandbox, no Node in the renderer, CSP in the build, navigation and window-open blocked, all permission prompts denied, IPC accepted only from the app's own page.

## Architecture (and a deliberate deviation)

The brief suggested Tauri v2 and a Python sidecar. This machine has **no Rust toolchain** and Python 3.14, and a packaged Python sidecar is a fragile moving part, so the app uses a single-language stack that is simple to build and test:

* **Electron 45** shell + **React 19 / TypeScript / Vite / Tailwind 4**; custom accessible primitives (no extra component-library sprawl).
* **`core/`** – framework-free domain layer (also what the tests call): `db` (node:sqlite + migrations, `profile_id` on every personal table), `companies`, `cv` (pdf.js / mammoth + heuristic parser), `job` + `fit` (explainable heuristic), `resume` (AST + builders + fact-check gate), `render` (pdfkit PDF, `docx` Word, export QA), `email` (templates, lint, MIME), `ai` (provider adapters + Zod), `fetchjob` (SSRF-guarded fetch), `storage` (path safety, atomic versioned writes), `api` (the single surface the UI talks to).
* **PDF**: `pdfkit` with standard fonts → selectable text, real link annotations, single-column A4, ≥ 9.5 pt. **Word**: `docx` with paragraphs/tab-stops and no layout tables.
* The renderer talks to the main process only through one `careerHub.call(name, args)` bridge; there is no local web server.

## Tests

* `npm test` – 53 tests, including: 78-row import with both rank-25 rows kept, A/B/C/D mapping (12/29/3/34), real `.xlsx` import, profile isolation, no-facts → no documents, invented *Kubernetes* / *65%* blocked, evidence IDs on matches, AI no-key/quota/auth/network/garbage handling, applied-only-on-confirmation, Deriv→Experian leak check, PDF/DOCX extraction QA, `.eml` attachment bytes equal exported-file checksums, deleted-file recovery, role/setting persistence after reopening the DB, SSRF and path-traversal guards, API-key never in the database.
* `npm run e2e` – real Electron: onboarding → import → confirm → folder → analyse → generate (A4 canvas aspect checked) → blocked invented claim → `.eml` → mark applied → board drag → relaunch persistence → missing-file banner → dark theme / reduced motion → keyboard/focus trap → 1440 / 1024 / 390 px without horizontal scroll → second profile isolation.

Fixture people and companies (e.g. "Alex Tester", "Fixture Corp") exist only inside tests; the app ships with no demo data.

## Honest limitations

* **Platforms:** built, run and smoke-tested on **Windows x64** only. The packaged app is **unsigned** (SmartScreen will warn). macOS/Linux builds were not produced or tested; Tauri was not used.
* **AI path never ran against a live provider** (no key available here). It is tested against mocked HTTP responses, including malicious and invalid output.
* **CV parsing is heuristic.** Text-based single-column PDFs/DOCX work best; multi-column layouts may misparse; scanned PDFs are detected but **no OCR** is included. You always review and confirm.
* **Job URLs:** logic is unit-tested with mocked pages; no live career site was fetched, and JavaScript-rendered pages cannot be read (you get the paste fallback).
* **Salary/allowance:** there is no live data source. The only figures shown are ones in the ad (or you enter) and a clearly-labelled, *unsourced* reference range copied from the research report.
* **Fit heuristic:** weights (30/25/15/15/10/5) are code constants covered by tests, not editable in the UI. It is not an ATS score and not calibrated to employer outcomes.
* **ATS-safe** means the *file* passes structural checks (selectable text, standard headings in order, no tables/images, links, page count, no cross-company names). No claim is made about any vendor's ATS. The Word file was validated by parsing it, not by opening it in Microsoft Word.
* **Open in Mail** depends on your OS default handler for `.eml`; it was not tested with Outlook/Apple Mail. Gmail on the web cannot import `.eml` (use the copy + manual-attach steps).
* **Company seed:** the supplied `Cyberjaya Companies.xlsx` was not on disk; the 78 rows come from the tab-separated text export you provided (`data/cyberjaya-seed.tsv`). The `.xlsx` importer is tested with a generated workbook, not your original file. Priority tiers are derived by a simple rule and will not match the report's 14/21/17/26 split. All status codes are labelled *historical*.
* Not built: demo mode, Bahasa Malaysia *interface* (documents and emails do have a BM option), OCR, Ollama model management, automatic updates, Gmail/Outlook OAuth drafts (by design: no automatic sending).
* Accessibility: semantic roles, labels, focus management, keyboard alternatives and reduced-motion are implemented and spot-checked, but there has been no screen-reader audit.
* Default folder suggestion is *Documents*, which OneDrive may sync. Pick a non-synced folder if your CV must not leave the machine.

## Repository layout

```
core/        domain + persistence + document engine (no Electron imports)
electron/    main process, preload bridge
renderer/    React UI
data/        cyberjaya-seed.tsv (78 rows, as supplied)
tests/       Vitest suites + fixtures
scripts/     build, dev, start, e2e, packaging, smoke tests
DESIGN.md    colours, type, spacing, components, motion
```
