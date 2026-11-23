# CLAUDE.md — Personal Agenda

`SPEC.md` is the source of truth. Read the relevant section before working on a feature. This file is a summary of the rules that must never be broken.

## Hard rules

- **No AI, no paid APIs, no backend, no accounts.** Every "smart" behaviour is deterministic rules that run in the browser. No network calls for app features.
- **Target: iPad Safari, installed to the Home Screen as a PWA.** Touch-first: big tap targets (≥44px), no hover-only UI, light + dark mode. Landscape = sidebar + main view, portrait = bottom tab bar. Respect safe-area insets.
- **Fully offline.** All data lives on the device in IndexedDB (Dexie). The service worker (vite-plugin-pwa) precaches the whole app. Never add a runtime dependency on a CDN or remote asset.
- **Data safety.** Call `navigator.storage.persist()` on first launch. Settings has JSON export/import; remind the user if there's been no backup in 14 days.
- **The fixed program is never modified by the planner** — only by explicit user edits on its edit screen.
- **iOS has no vibration and no local notifications.** Feedback = animation/sound. Reminders = `.ics` export with VALARM.

## The planner must be a pure, tested function

- `plan(state, today) → { sessions[], warnings[] }`. No UI, no Dexie, no `Date.now()`, no randomness inside — everything comes in through arguments.
- Same for the free-slot builder and other scheduling helpers: pure functions in their own modules, covered by Vitest unit tests.
- Stability: today is frozen once it starts (unless the user taps "Re-plan today"); done/in-progress sessions never move; only future days are regenerated.
- Test against the acceptance scenario at the end of `SPEC.md` §7.

## Timers are timestamp-based

- Safari suspends JS in the background / on screen lock. Focus Mode stores start/end timestamps and **computes** remaining time on every render/resume. Never count elapsed time with `setInterval` ticks.
- Active timer state is persisted in IndexedDB (`ActiveTimer`) so it survives the app being closed. Request a Screen Wake Lock where supported.
- Work **and** break minutes count toward goal time (stored separately in `FocusInterval`).
- The timer state machine is a pure module with unit tests.

## Build order

Follow `SPEC.md` §7 strictly, one step at a time. Don't start a later step's features early, and stop after the requested step.

1. Scaffold + PWA + routing + layout + deploy  ← done
2. Data layer (Dexie schema, typed repos, export/import)  ← done
3. Setup screens + onboarding  ← done
4. Free-slot builder (pure) + tests  ← done
5. Goals CRUD  ← done (incl. onboarding's “first goal” step)
6. Planner v1 (pure) + tests  ← done (not yet triggered from the UI — step 7 wires replan into app open/edits)
7. Today / Week / Month views
8. Session actions
9. Focus Mode (timestamp timer) + tests
10. Topics & spaced review + tests
11. Progress & streaks
12. Activity log, check-in, backlog lists
13. Learning from the log
14. Weekly review
15. Apple Calendar `.ics` export
16. Quick add parser + tests
17. Year in review
18. Polish

Out of scope: XP/skill levels, AI, multi-device sync, push notifications.

## Tech & conventions

- Vite + React + TypeScript (strict), Dexie, vite-plugin-pwa, date-fns, react-router (HashRouter — works on GitHub Pages and in standalone mode without server rewrites), plain CSS with custom properties.
- Tests: Vitest (`npm test`). Typecheck + build: `npm run build`.
- Deploy: `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. The Vite `base` is `/agenda/` in production builds — keep all asset/manifest paths relative to it.
- Layout: `src/app` (shell, routes), `src/screens` (one folder/file per screen), `src/db` (Dexie), `src/domain` (pure logic: planner, slots, timer, parser — no React/Dexie imports).

## Data layer (src/db)

- `types.ts` — every entity from SPEC §6. Conventions: ids are UUID strings; calendar days are `'yyyy-MM-dd'` (local); times of day are `'HH:mm'`; `*At` fields are epoch ms; durations are minutes unless named `*Hours`.
- `schema.ts` — Dexie schema + `SCHEMA_VERSION`. **Never edit a published `db.version(n)`**: add `version(n+1)` with an upgrade and bump `SCHEMA_VERSION` (backups record it, `parseBackup` rejects newer ones). Booleans can't be IndexedDB index keys — filter them in memory.
- `repositories.ts` — `createRepos(db)`; the app uses the `repos` singleton, tests pass a fresh `createDb('test-…')`. UI code goes through repos, not raw tables. Cascades: deleting a goal removes its topics, stats and still-planned sessions but keeps history; deleting a location removes its travel times; travel times are stored in both directions.
- Backup: `backup.ts` is pure (format + validation), `backupDb.ts` does the I/O. Import REPLACES all data in one transaction (all or nothing). `meta` is device-only and never exported. `lastBackupAt` is only set after the file was actually shared/saved.
- Settings is a single row (`id: 'settings'`); `repos.settings.get()` always merges over `DEFAULT_SETTINGS`, so adding a new setting only needs a default.

## UI conventions (src/ui, src/screens)

- Read data with `useLiveQuery` (dexie-react-hooks) so screens update automatically; write through `repos`.
- Validation lives in pure functions in `src/domain` (e.g. `setupValidation.ts`, tested) returning `{ errors, warnings }`. Errors block saving; warnings only inform.
- `EditableList` is the standard list → inline form (Save / Cancel / Delete) pattern. Settings-backed fields auto-save via `useSettingsDraft` when valid.
- Fixed blocks are only edited on their own screen (`FixedBlockEditScreen`), per SPEC 2.2.
- Setup sections are defined once in `screens/setup/sections.tsx` and reused by Settings and onboarding (`ONBOARDING_ORDER` follows SPEC §5).
- Inputs use native iOS controls (`type="time"`, `type="date"`, `inputMode` numeric) at ≥16px font so Safari doesn't zoom.
- First-run redirect to onboarding is decided once at launch in `App.tsx` (not reactively — that caused a bounce-back bug).

## Free-slot builder (src/domain/freeSlots.ts)

- `buildDay(input, date)` / `buildDays(input, from, count)` → `DayLayout { blocks, free, freeMinutes, warnings }`. Times are minutes since midnight, half-open `[start, end)`; interval maths is in `ranges.ts`.
- Order: fixed program (never moved) → meals (earliest spot in window that doesn't make travel worse) → travel between consecutive located items (day starts/ends at Home; travel *to* something is as late as possible, travel home is right after) → free = availability (template + overrides) − sleep − blocks − goal-independent rules, minus `bufferMin` only where a slot touches a fixed/meal/travel block.
- Each free slot carries its `energy` and `locationId` (where you are then) for the planner's scoring and "goals pull travel with them".
- Category-specific rules (`noGoalAfter`/`noGoalBefore` with a category) are NOT applied here — the planner (step 6) applies them per goal.
- Problems become `warnings` with user-facing messages (overlapping fixed blocks, meal doesn't fit, missing/too-tight travel); impossible travel is still shown as a block.

## Goals (src/domain/goals.ts, src/screens/goals)

- Pure helpers: `blankGoal(type, today)`, `TEMPLATES`, `validateGoal(draft, today)`, `normalizeGoal` (drops other types' fields and empty optionals; recurring min/max session = session length; ongoing keeps exactly one of per-day/per-week), `previewGoal` / `describeGoal` (user-facing text), `studyDays(deadline, reviewDays, today)` (today included, review days excluded).
- Priority: 1 = Low, 2 = Medium, 3 = High (higher wins). Book goals store `totalPages`, `pagesDone`, optional target date in `deadline`, and reading time in `minutesPerDay` (what the planner schedules).
- Always save `normalizeGoal(draft)`. The edit screen (`GoalEditScreen`) is reused by onboarding at `/onboarding/goal/:id`; goal detail (topics, notes, history) comes in steps 10–11.

## Planner (src/domain/planner.ts, src/db/planStore.ts)

- `plan(state, today, { from })` → `{ from, to, sessions, warnings }`. Horizon = from → max(latest deadline/book date, +42 days). Output sessions are complete days: goal, review, meal and travel sessions with deterministic ids (`plan:<date>:<kind>:<key>:<n>`, never reusing a stored id).
- Order: kept sessions (done/partial/skipped/frozen) occupy time → reviews reserved → deadline goals by urgency × priority with a 1.0→1.5 ramp over days that have room (carry-forward, then a fill pass) → recurring (best Mon–Sun subset: most spread, best score; rest rule includes Sun→Mon) → ongoing/book daily or weekly fill.
- Scoring: energy match, preferred time (+2), same goal within 60 min (−2), travel (−t/15), day load (recurring). Hard limits: daily goal cap, demanding cap, category rules. Review sessions are extra (not part of `totalHours`). Skipped minutes return to the pool; past planned sessions count as missed.
- Warnings: `deadlineShortfall` (options: add free time, reduce hours, pause the goal that took the time, accept), `reviewNotPlaced`, `recurringShortfall` (grouped per goal), `ongoingShortfall`, `goalTravelUnknown`, grouped `setup`.
- `replan(now, { includeToday })` (planStore.ts) is the only impure part: today stays frozen once it has a plan unless `includeToday`; deletes stale planned sessions ≥ from and saves the new ones + warnings (meta `planWarnings`). Acceptance scenario fixtures: `src/test/scenario.ts`.
