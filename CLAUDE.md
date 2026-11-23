# CLAUDE.md — Personal Agenda

`SPEC.md` is the source of truth. Read the relevant section before working on a feature. This file is a summary of the rules that must never be broken.

## Hard rules

- **No AI, no paid APIs, no backend, no accounts.** Every "smart" behaviour is deterministic rules that run in the browser. No network calls for app features.
- **Target: iPad Safari, installed to the Home Screen as a PWA.** Touch-first: big tap targets (≥44px), no hover-only UI, light + dark mode. Landscape = sidebar + main view, portrait = bottom tab bar. Respect safe-area insets.
- **Fully offline.** All data lives on the device in IndexedDB (Dexie). The service worker (vite-plugin-pwa) precaches the whole app. Never add a runtime dependency on a CDN or remote asset.
- **Data safety.** Call `navigator.storage.persist()` on first launch. Settings has JSON export/import; remind the user if there's been no backup in 14 days.
- **The fixed program is never modified by the planner** — only by explicit user edits on its edit screen.
- **iOS has no vibration and no local notifications.** Feedback = animation/sound. (The `.ics` export with VALARM reminders, step 15, was skipped — there are no reminders outside the app for now.)

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
6. Planner v1 (pure) + tests  ← done
7. Today / Week / Month views  ← done
8. Session actions  ← done
9. Focus Mode (timestamp timer) + tests  ← done
10. Topics & spaced review + tests  ← done
11. Progress & streaks  ← done
12. Activity log, check-in, backlog lists  ← done
13. Learning from the log  ← done
14. Weekly review  ← done (incl. the “+ Add” polish and one-off tasks)
15. ~~Apple Calendar `.ics` export~~  ← skipped at the user's request (the stored `calendarAlertMin` setting is kept but hidden in Settings)
16. Quick add parser + tests  ← done
17. Year in review  ← done
18. Polish  ← done

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
- Always save `normalizeGoal(draft)`. The edit screen (`GoalEditScreen`) is reused by onboarding at `/onboarding/goal/:id`; the goal detail screen is `/goals/:id` (form at `/goals/:id/edit`, new at `/goals/new`).

## Planner (src/domain/planner.ts, src/db/planStore.ts)

- `plan(state, today, { from })` → `{ from, to, sessions, warnings }`. Horizon = from → max(latest deadline/book date, +42 days). Output sessions are complete days: goal, review, meal and travel sessions with deterministic ids (`plan:<date>:<kind>:<key>:<n>`, never reusing a stored id).
- Order: kept sessions (done/partial/skipped/frozen) occupy time → reviews reserved → deadline goals by urgency × priority with a 1.0→1.5 ramp over days that have room (carry-forward, then a fill pass) → recurring (best Mon–Sun subset: most spread, best score; rest rule includes Sun→Mon) → ongoing/book daily or weekly fill.
- Scoring: energy match, preferred time (+2), same goal within 60 min (−2), travel (−t/15), day load (recurring). Hard limits: daily goal cap, demanding cap, category rules. Review sessions are extra (not part of `totalHours`). Skipped minutes return to the pool; past planned sessions count as missed.
- Warnings: `deadlineShortfall` (options: add free time, reduce hours, pause the goal that took the time, accept), `reviewNotPlaced`, `recurringShortfall` (grouped per goal), `ongoingShortfall`, `goalTravelUnknown`, grouped `setup`.
- `replan(now, { includeToday })` (planStore.ts) is the only impure part: today stays frozen once it has a plan unless `includeToday`; deletes stale planned sessions ≥ from and saves the new ones + warnings (meta `planWarnings`). Acceptance scenario fixtures: `src/test/scenario.ts`.

## Plan views (src/domain/agenda.ts, src/screens/plan, src/app/usePlanKeeper.ts)

- `usePlanKeeper` (in App) re-plans automatically: on launch / resume / every minute if the last plan was made on another day, and 400 ms after any change to plan inputs (settings minus `lastBackupAt`/`onboardingDone`, goals, fixed blocks, availability, overrides, meals, places, travel, rules). Re-plans are serialized (`enqueueReplan`). Today is frozen once it has goal work (planStore).
- `agenda.ts` (pure, tested): `dayTimeline` (fixed program + saved sessions), `nowAndNext`, `dayProgress`, `weekDates` (Mon-first), `hourRange`, `monthGrid`, `dayLoad`, `deadlineMarkers`.
- Routes: `/today`, `/day/:date`, `/week[/:date]`, `/month[/:yyyy-MM]`. Week/Month headers link to each other (portrait tab bar has no Month tab). Warnings banner (Today only) reads meta `planWarnings`; dismissals in meta `dismissedWarnings`.
- `useNow()` re-renders every 30 s for display only — never for measuring time.

## Session actions (src/domain/sessions.ts, src/screens/plan)

- Pure transforms: `complete` (actualMinutes = planned), `partial(minutes)` (≥ planned → done), `skip`, `undo` (keeps note), `withNote`; `canComplete` only on/after the session's day, `canSkip` any day; past `planned` work = missed (counts 0). `lastNoteBefore` / `notesOf` for notes.
- Every status change saves and calls `enqueueReplan()` (today stays frozen). Notes save without re-planning.
- Planner rules added here: a goal skipped on a day gets nothing new that day; ramp shares subtract work already kept on that day; `notBefore` (minutes) keeps "Re-plan today" after now, and `replan(..., { includeToday })` freezes today's already-started planned sessions first.
- UI: big ✓ (`.check`), `SwipeRow` (right = done, left = Part/Skip or Undo; gesture distance kept in a ref, the click ending a swipe is swallowed), `SessionSheet` (modes actions / part / note), `playChime` (Web Audio, called inside the tap) when `settings.completionSound`, `Burst` confetti, "Re-plan the rest of today" on Today, session notes on the goal page.

## One-off additions (“+ Add” on a day; src/domain/oneOff.ts, AddToDaySheet)

- **Event** → a locked one-off `FixedBlock` (`rule.kind = 'once'`); travel comes from the free-slot builder.
- **Goal session** → a stored session with `frozen: true, pinned: true` (id `pin:<uuid>`); the planner keeps it and counts it toward the goal; removable from its sheet (📌).
- **Extra free time** → one `AvailabilityOverride` (kind `free`) per day with `energy` and optional `boostGoalIds` (“use it for”). Planner: deadline goals pull work into the boosted windows first (fair share of the day's cap among boosted goals; those days leave the ramp), ongoing/book goals fill the windows beyond their target after their normal fill. Caps still apply.
- **Task** (one-off goal, e.g. homework): `taskToGoal` → deadline goal with `oneOff: true`, `deadline` = day after "do it by", `reviewDays` 0, sessions ≤ 2 h, icon 📋. `finishTask` sets `completedAt`, marks the session done and deletes the task's other planned sessions; the planner skips goals with `completedAt`. Tasks have their own section on Goals, `TaskEditCard` on the detail screen (not the goal form), are excluded from learning/streaks.
- Multi-day extra free time / busy days share `groupId` and are listed, edited and deleted as one (`groupOverrides`, `OverridesSection`, which also takes an optional date range).
- Day view: tapping a 🔒 block opens `FixedSheet` (edit; one-offs can be deleted); 📌 sessions can "Change time".
- Saving re-plans; anything that touches today re-plans today too (`includeToday`).
- `Field` has a `group` mode — use it for any field holding several buttons (segmented, chips, weekday picker, swatches); a `<label>` around buttons gets tied to the first one.

## Focus Mode (src/domain/focusTimer.ts, src/db/focusStore.ts, src/screens/focus)

- Pure state machine on timestamps: `startTimer`, `advance(t, now)` (catches up every phase that ended while away; next phase starts exactly when the last ended; a run finishes by itself after a long break and is parked as a zero-length phase so re-syncing logs nothing twice), `pause`/`resume` (resume shifts `phaseStartedAt` by the paused time), `skipBreak`, `endTimer`, `trackedMinutes`, `cycleDots`. Work + break minutes both count.
- `ActiveTimer` (single row, survives app close) snapshots `config` (goal override or defaults), `runStartedAt` and `targets` (today's open sessions of the goal, the one Focus started from first, with prior partial minutes).
- Progress stays session-based: `allocate(targets, sessions, tracked)` → fully covered done, next partial, extra on the last one. `syncFocus` only flips sessions to done when the planned amount is reached (auto-complete); `endFocus` settles minutes, or — with nothing planned today — records a done session for the focused time. FocusIntervals are the detailed log (work vs break).
- UI: `useFocus` re-renders 4×/s for display only and syncs every 5 s, at phase end and on return to the app; bells via `playBell` after `unlockAudio()` in the Start tap; `useWakeLock` while running; full-screen `/focus` (fixed overlay), `FocusPill` elsewhere; summary + note prompt at the end; "◷ Focus" in the session sheet.

## Topics & spaced review (src/domain/topics.ts, planner, TopicsSection)

- Effective weight = weight × 1.5 if weak. `assignTopics` labels the goal's planned study sessions in time order, filling open topics in list order; each needs its share of `totalHours` minus minutes already worked (`workedByTopic`), scaled to the planned minutes; done topics get nothing new; a topic is only named on a session if it covers ≥ 10 min of it.
- Planner: labels are a final pass (`topicIds` on `goal` sessions); final review sessions get all topics weak-first (`finalReviewOrder`); a topic marked done gets 20 (min 15) min `review` sessions with `spacedReview: true` at doneDate +2/+5/+10 days (missed ones move to the first possible day, done ones aren't repeated, a full day shifts up to +2), only before the first final review day. `PlanState.topics` is optional.
- Topics are a plan input (`usePlanKeeper` signature, `loadPlanState`). Timeline titles: "Goal: Topic", spaced "Review: Goal — Topic", final review lists topics in the subtitle. Session sheet toggles topics done; Focus records the session's first topic (`ActiveTimer.topicId`, intervals). Goal cards show "x / y topics done".

## Progress & streaks (src/domain/progress.ts, GoalDetailScreen, GoalProgress, WeeklyChart)

- All derived from sessions (done → actual or planned minutes, partial → actual). `deadlineProgress`: expected-by-now follows the planner's 1.0→1.5 ramp from the goal's start to the review day; slack max(30 min, 10%); statuses done / ahead (+60) / onTrack / behind (gap) / atRisk (the last plan's `deadlineShortfall` for the goal, read from meta `planWarnings`). Reviews count as time invested, not toward `totalHours`.
- `streak`: weekly (recurring, ongoing per week) or daily (ongoing/book per day). Periods with nothing planned are neutral; the current period is neutral until met; the target is capped by what was planned in that period.
- Books: `logPages` keeps a per-day `pageLog` (also from the book session's note prompt); pace = pages since the earliest entry in the last 14 days ÷ days to today; finish date and on-track vs the target date.
- `/goals/:id` detail: progress card by type, streak, stats (total time, completion rate, this week), `WeeklyChart` (dataviz specs: ≤24px columns, 4px rounded tops, hairline grid, tap/focus tooltip — on touch only a mouse hides it on leave, table view; bar colour = goal colour 85% + black in light, 70% + white in dark, validated ≥ 3:1), topics, notes. Cards show a compact bar/badge/streak.

## Activity log, check-in, backlog (src/domain/log.ts, src/screens/log, src/screens/lists)

- A `LogEntry` linked to a goal counts toward it WITHOUT becoming a session (no time slot): `loggedMinutes` is added in the planner's `committedMinutes` (deadline remaining, ongoing per-day/week) and in progress (deadline done, streaks, weekly history, total); for recurring goals an entry with minutes counts as one session that week and its day needs rest after. `PlanState.logs`; logs are a plan input (signature + `loadPlanState`). Adding an entry with pages to a book goal moves `pagesDone` (via `logPages`) — editing/deleting doesn't revert pages.
- Check-in: one per day (`checkIns` keyed by date). `shouldPromptCheckIn`: Today shows "How was today?" once the last non-travel item of the day ended (or from 20:00 with nothing planned); "Not now" sets meta `checkInDismissed:<date>`. Also on the Log screen.
- Backlog: `finishBacklogItem` → status finished + rating + note and a `LogEntry` ("watched"/"read", note "★★★★☆ — …"). Books in Want to read: "Make it a book goal" → `/goals/new?template=book&name=…` (GoalEditScreen reads `name`) and the item goes in progress. Links must be http(s) and open with `rel="noopener noreferrer"`.

## Learning (src/domain/learning.ts, src/screens/learning)

- Derived on the fly from the last 28 days (the `Stats` table stays unused — a cache could go stale). `credit`: done 1, partial actual/planned, skipped/missed 0. `completionByBucket` per goal per morning/afternoon/evening; planner adds `bucketBonus` = (bucket rate − goal's overall rate) × 4, clamped ±2, only with ≥ 3 attempts in the bucket and ≥ 6 overall.
- Suggestions (user confirms; dismissals in meta `dismissedSuggestions` by key): `energySuggestions` groups windows by start/end/energy (e.g. Sat+Sun → "on weekends"), needs ≥ 14 days of history and ≥ 4 sessions; ≥ 85% done → high (unless check-ins avg < 3), high with ≤ 45% → normal, ≤ 30% and check-ins ≤ 2 → low. `sessionLengthSuggestions`: ≥ 5 recent sessions with real minutes, median ratio ≤ 0.75 or ≥ 1.25 → `applySessionLength`. `estimateHint` (new deadline goals): finished same-category deadline goals' actual/planned (sessions + logs), shown when off by ≥ 15%; once used or kept it stays hidden for that form (it would otherwise re-multiply).
- UI: `SuggestionsCard` on Today (below the timeline) and on the goal page (session length for that goal); `EstimateHintCard` under the deadline hours in the new-goal form. Applying changes plan inputs → re-plan happens by itself.

## Weekly review (src/domain/review.ts, src/screens/review)

- `reviewWeek(today)`: Sunday → the coming week, otherwise the current one. `ReviewBanner` on Today until that week has a `WeeklyReview` (or "Not now", meta `reviewDismissed`).
- `lastWeekSummary`: time per goal/category (sessions + linked logs), sessions done/partial/skipped/missed of planned, streak changes (after = as of the review week's Monday; before = as of last week's Monday for weekly streaks, the Sunday before for daily ones), deadline goals behind / at risk, average check-in energy/mood. `nextWeekPreview`: planned minutes per day, deadlines/tasks in the next two weeks.
- `streak()` only counts sessions/logs up to its `today` (needed for "as of" questions) but caps weekly targets by everything planned that week.
- `/review`: quick adjustments save immediately (priority, pause/resume, deadline hours, busy/free time in that week) and are recorded as plain notes in `WeeklyReview.adjustments`; "Confirm week" stores the review and goes to Today.

## Quick add (src/domain/quickAdd.ts, src/screens/goals/QuickAdd.tsx)

- `parseQuickAdd(text, today, locations)` → `{ kind, name, date, minutes, perWeek, per, pages, locationId, category, missing }`. Tokens are taken out of the text in order (date → pages → "N× week" → duration → daily/weekly → place, "at <place>" preferred); what's left is the name. Dates: ISO, "Dec 12", "12 December", today/tomorrow, weekday names (a bare weekday on that weekday = next week); month/day without a year = next occurrence.
- Kind: pages or leading "book" → book; N× a week → recurring; daily / a week → ongoing; task words (homework, assignment, task…) or due today/tomorrow → one-off task; a date (or ≥ 2 h) → deadline; else unknown.
- UI: field at the top of Goals with a live `describeQuick` preview; Continue → `/goals/new?quick=…` (GoalEditScreen parses with `quickToDraft` and shows what still needs filling), tasks → `AddToDaySheet` with `initialTask` (`quickToTask`), unknown → template picker keeping the name (`?name=`).

## Year in review (src/domain/yearReview.ts, src/screens/review)

- Pure, tested: `minutesByDay` (focused minutes = done/partial goal + review sessions via `countedMinutes`, plus log entries with minutes), `heatmapWeeks` (Monday-first week columns, padding cells have no `date`; levels 0 / <30 / <60 / <120 / ≥120 min), `yearTotals` (total, active days, longest run of consecutive days, sessions done, per goal / category), `bestStreaks` (`streak().best` as of year end or today; tasks excluded), `deadlinesMet` (deadlines in the year that have passed: done minutes before the deadline ≥ totalHours; tasks: `completedAt` before their deadline, shown as the "do it by" day), `watchedAndRead` (finished backlog items with rating + watched/read logs, minus the log entry finishing an item created), `moodByMonth`, `yearsWithData`.
- `/review/year` (`YearReviewScreen`); `ReviewTabs` switches between it and `/review`. Year picker when there's data in other years.
- Charts follow the dataviz rules: heatmap = sequential blue (`.heatmap --h1..4`, separate light/dark steps, validated), empty days neutral, tap/focus tooltip, Less→More legend, monthly table; energy/mood = two-series line chart with legend (`--c-energy`, `--c-mood` per mode), gaps for months without check-ins, table view.

## Polish (step 18)

- Backup reminder: `backupReminderDue` (src/domain/backupReminder.ts, tested) — 14 days since `lastBackupAt`, or since meta `firstLaunchAt` (set in main.tsx) if never backed up; only with data; "Later" snoozes 3 days (meta `backupSnoozedUntil`). `BackupReminder` banner on Today; `exportNow()` (screens/settings) is the one export path, also used by Settings.
- Portrait tab bar: Today, Week, Goals, Focus + **More** (`/more`, `MoreScreen`); `MORE_ITEMS` / `isUnderMore` in routes.ts keep the More tab highlighted on Month, Log, Lists, Review, Settings.
- Landscape ≥ 1100px: Today shows `WeekGlance` on the right (this week's days with goal time, done count, coloured dots; deadlines in the next two weeks). Hidden by CSS otherwise.
- Empty states: Today (no goals), Week / Month (`NoGoalsHint`), and every list screen has its own "nothing yet" line.
- Code splitting: every screen except Today and Focus is `React.lazy` (chunks are precached by the service worker, so offline still works); keep the main chunk under 500 kB.
