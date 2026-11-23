# Personal Agenda — Spec

A personal planner web app for iPad. The user enters goals (deadline goals, recurring habits, ongoing learning), a fixed program, and realistic daily constraints (sleep, meals, transport). The app automatically builds a day-by-day plan and shows it as Today / Week / Month views, then adapts as the user logs what they actually did.

**Hard constraints**
- No AI / no paid APIs. All "smartness" is deterministic rules running in the browser.
- iPad only (Safari, installed to Home Screen as a PWA). No backend, no accounts.
- Works fully offline. All data stored on-device.
- The fixed program is never modified by the planner — only by explicit user edits.

---

## 1. Tech stack

- **Vite + React + TypeScript**
- **Dexie (IndexedDB)** for storage
- **vite-plugin-pwa** — manifest, icons, service worker, offline cache
- **date-fns** for date math
- Plain CSS or Tailwind; touch-first, large tap targets, light + dark mode
- **Vitest** for unit tests (the planner must be heavily tested)
- Hosting: any free static host (GitHub Pages / Netlify / Cloudflare Pages) so the iPad has a URL to install from

Storage safety (data lives only on the iPad):
- Call `navigator.storage.persist()` on first launch.
- Settings → **Export / Import JSON backup**. Show a gentle reminder if no backup in 14 days.

---

## 2. Core concepts

### 2.1 Goal types
| Type | Example | Inputs |
|---|---|---|
| **Deadline** | Abstract algebra midterm, Dec 12 | deadline date, total hours, review days before deadline (default 1) |
| **Recurring** | Workout 4×/week | sessions per week, session length, rest rule (e.g. no consecutive days) |
| **Ongoing** | Read 30 min/day, learn a language | target minutes per day or per week, optional end date |
| **Book** (template of Ongoing/Deadline) | Read *X*, 320 pages | total pages, target date → pages/day; progress logged in pages |

**Topics (deadline goals):** a deadline goal can have an ordered list of topics (e.g. midterm → Groups, Subgroups, Rings, Homomorphisms), each with an optional weight (relative effort, default 1). See 3.6.

Common goal fields: name, category (Study / Fitness / Reading / Learning / Other), color/icon, priority (1–3), focus level (**demanding / light**), min & max session length, preferred time of day (optional), location (optional — e.g. gym), active/paused.

### 2.2 Fixed program (locked)
Recurring or one-off blocks the planner must treat as immovable: classes, work, commitments. Fields: title, days/rule, start/end, location, locked = true. Displayed with a lock icon. Only editable via an explicit edit screen.

### 2.3 Realism constraints (so the plan is physically possible)
- **Sleep window** (e.g. 00:00–08:00) — never scheduled.
- **Meals** — breakfast / lunch / dinner as flexible windows with duration (e.g. lunch 30–45 min somewhere in 12:00–14:30). The planner places meals first, inside their windows.
- **Locations & travel time** — user defines places (Home, Campus, Gym, Library) and a simple travel-time table between them (minutes). Whenever two consecutive items are at different locations, the planner inserts a **travel block** between them. Goals with a location (workout → Gym) pull travel time with them.
- **Buffers** — default 10 min between sessions; configurable.
- **Daily load cap** — max planned goal hours per day (e.g. 6h on weekdays, 4h weekends) and max demanding hours per day.
- **Hard rules** — e.g. "no study after 23:00", "Sunday mornings free". Stored as simple rule objects the planner checks.

### 2.4 Availability
Weekly template of free windows per weekday, each tagged with energy: **high / normal / low**. Plus one-off overrides ("busy all Saturday", "free Friday afternoon").

**Free time = availability − sleep − fixed program − meals − travel − buffers.**

---

## 3. The planner (rule-based)

Runs on: app open (if date changed), any goal/rule/availability edit, and when a session is marked missed. Planning horizon: today → max(latest deadline, +6 weeks).

### 3.1 Stability
- **Today is frozen** once the day starts (only changes if the user taps "Re-plan today").
- Completed and in-progress sessions are never moved.
- Only future days are regenerated.

### 3.2 Algorithm outline
1. **Build free slots** per day for the horizon (section 2.4), including travel/meal placement.
2. **Deadline goals first.** For each, compute `remainingHours` and the usable free hours before `deadline − reviewDays`.
   - **Urgency** = remainingHours / usableFreeHours.
   - Distribute hours across days with a gentle **ramp** (slightly more as the deadline nears; e.g. linear weights 1.0 → 1.5), respecting min/max session length and daily caps.
   - Reserve the review day(s) for a "Review" session of that goal.
   - Process deadline goals in order of urgency; when two compete for the same slot, higher urgency × priority wins.
3. **Recurring goals** — place N sessions per week, honoring rest rules (no back-to-back days if set), spreading across the week.
4. **Ongoing goals** — fill remaining capacity up to their daily/weekly target.
5. **Slot scoring** — when choosing a slot for a session, score each candidate:
   - + energy match (demanding goal ↔ high-energy slot; light ↔ low)
   - + preferred time of day match
   - + historical completion rate of that goal in that time-of-day bucket (section 3.4)
   - − same goal immediately before/after (variety)
   - − extra travel required
   - − exceeding soft daily load
6. **Feasibility check** — if a deadline goal can't fit, raise an **overload warning** with concrete options: add free time, reduce hours, pause/lower priority of another goal, or accept a shortfall.

Keep the planner a **pure function**: `plan(state, today) → sessions[] + warnings[]`. No UI or DB access inside. This makes it testable.

### 3.3 Missed sessions
Marking a session **skipped/missed** returns its minutes to the goal's remaining pool; the next re-plan redistributes them into future days. Recurring sessions missed in a week try to fit later that same week, otherwise they're dropped (streak logic in 4.2 applies).

### 3.4 Learning from the log (no AI)
- **Completion rate per goal per time bucket** (morning / afternoon / evening), rolling last ~4 weeks → feeds slot scoring.
- **Estimate correction**: for finished deadline goals, store `actualHours / plannedHours`. When creating a new goal of the same category, show "Your past exams took ~1.3× your estimate — use 20h instead of 15h?" (user decides).
- **Actual session length**: if the user regularly stops early/late, suggest adjusting the session length.

### 3.5 Quick add (rule-based parsing)
A single text field that parses patterns with regex/keywords, then opens a pre-filled form to confirm:
- `Algebra midterm Dec 12 15h` → Deadline, date, 15 hours
- `Workout 4x week 45m gym` → Recurring, 4/week, 45 min, location Gym
- `Read 30m daily` → Ongoing, 30 min/day
- `Book Dune 412 pages by Jan 31` → Book goal

### 3.6 Topic assignment & spaced review
- Hours of a deadline goal are split across its topics proportional to weight; sessions are labeled with the topic(s) they cover ("Tue 17:00 — Algebra: Rings, 60 min").
- Topics are planned in list order by default; the user can reorder or mark a topic "weak" (gets 1.5× weight).
- When a topic is marked **done**, the planner schedules short review sessions (15–20 min) at increasing intervals — e.g. +2, +5, +10 days — as long as they land before the deadline. The final review day(s) cover all topics, weak ones first.
- Topic progress shows on the goal card (e.g. "3 / 6 topics done").

---

## 4. Tracking, progress & feel

### 4.1 Completing sessions — make it satisfying
- Big tap target to complete; check animation + subtle confetti/pulse on the goal color; optional sound. (iOS Safari doesn't support vibration — rely on animation/sound.)
- Swipe actions: complete / skip / "did part of it" (enter minutes).
- Daily completion ring at the top of Today fills as sessions are done.
- **Session notes:** after completing (or partially completing) a session, an optional short note ("finished 4.2, stuck on quotient groups"). The next session of the same goal shows the last note at the top. All notes are listed on the goal detail screen.

### 4.1b Focus Mode (Pomodoro timer)
- Start from any session ("Focus") or freely by picking a goal.
- **Adjustable cycle:** work length, short break, long break, and cycles before a long break. Global defaults in Settings (e.g. 25/5, long break 15 after 4), with **per-goal overrides** (e.g. Algebra: 50 on / 10 off).
- Full-screen, distraction-free view: big countdown, goal + topic, cycle counter (●●○), pause / skip break / end. Soft sound at transitions.
- **Time tracking:** work intervals **and breaks** both count as time spent on the goal (and topic) — a full 50/10 cycle logs 60 min. These minutes feed all progress bars, totals and stats. (Store work and break minutes separately in `FocusInterval` so a "work only" view can be added later, but all totals use the combined time.)
- **Auto-complete:** when tracked minutes for that goal (work + breaks) reach the day's planned amount (e.g. 2 cycles of 50 on / 10 off = 120 min of Algebra planned today), the day's Algebra sessions are automatically marked **done**, with the completion animation. Ending early marks them **partial** with the real minutes; extra time beyond plan counts toward the goal's remaining hours.
- Shows the session note prompt when the focus session ends.
- **iOS reliability:** Safari pauses timers when the app is in the background or the screen locks, so the timer must be timestamp-based (store start/end times, compute remaining on resume), never interval-counting. Persist active timer state in IndexedDB so it survives the app being closed. Request a Screen Wake Lock where supported.

### 4.1c Evening check-in
- Prompted from Today after the last planned item (or manually): energy 1–5, mood 1–5, optional one-line note.
- **Feeds the planner:** combined with per-time-bucket completion rates and focus minutes, after ~2–3 weeks the app suggests energy-tag changes ("You focus best 10:00–13:00 on weekends — mark it high energy?"). The user confirms; nothing changes silently.

### 4.2 Progress & streaks
- **Deadline goals:** progress bar of hours done vs total, "on track / behind" badge, days left.
- **Recurring/ongoing goals:** **streaks** (current & best). For weekly-frequency goals, the streak counts **weeks where the target was met** (so rest days don't break it).
- **Book goals:** pages read bar + estimated finish date at current pace.
- Goal detail screen: history chart (minutes per week), completion rate, total time invested.

### 4.3 Activity log
Quick log for things outside the plan: "watched X", "read 40 pages", "went for a run". Fields: type, title, minutes/amount, optional note, optional link to a goal (counts toward its progress).

### 4.4 Weekly review screen
Shown on Sunday (or on first open of a new week), also available anytime:
- Last week: focused time per goal and category, sessions done vs planned, streaks kept/broken, goals that fell behind, average energy/mood.
- Next week: preview of the plan, upcoming deadlines, overload warnings.
- Quick adjustments before confirming next week: add one-off busy/free times, pause or reprioritize goals, change hours on a deadline goal. Then "Confirm week".

### 4.5 Backlog lists
Two lists: **Want to watch** and **Want to read** (books, articles, courses). Item fields: title, type (movie / series / book / article / course / other), optional link and note, added date.
- Move an item to "In progress" or mark it **finished** → asks for a rating (1–5) and a short note, then creates a log entry.
- A book from the reading backlog can be turned into a **Book goal** with one tap.

### 4.6 Year in review
- GitHub-style **activity heatmap** of the year (color = focused minutes per day).
- Totals: hours per goal and category, sessions completed, best streaks, deadlines met.
- Everything watched and read this year, with ratings.
- Average energy/mood by month.

### 4.7 Export to Apple Calendar
- Button on Week and Month views: export the chosen range (this week / next 2 weeks / custom) as an **.ics** file, using the iPad share sheet to open in Calendar.
- Each planned session becomes an event (title = goal + topic, location if set) with a **VALARM** alert (default 10 min before, configurable) — this is the reminder workaround, since a PWA can't send local notifications without a push server.
- Use stable event UIDs per session so re-exporting updates events instead of duplicating them where Calendar supports it; recommend exporting into a dedicated "Agenda" calendar.

---

## 5. Screens

1. **Today** — timeline of the day (fixed blocks, meals, travel, sessions), completion ring, current/next item highlighted, overload warnings banner.
2. **Week** — 7-column grid with colored blocks; tap a day to open it.
3. **Month** — calendar with per-day load indicator and deadline markers; tap for day view.
4. **Goals** — cards with progress bars/streaks/topic progress; add goal (quick add + full form); goal detail (topics, notes, history, totals).
5. **Focus** — full-screen Pomodoro timer.
6. **Log** — activity log + add entry; evening check-in.
7. **Lists** — Want to watch / Want to read backlogs.
8. **Review** — weekly review; Year in review.
9. **Setup / Settings** — availability template, energy tags, sleep, meals, locations & travel table, fixed program, hard rules, daily caps, buffer length, Pomodoro defaults, calendar alert default, backup export/import.

First-run onboarding walks through Setup in order: sleep → fixed program → meals → locations → availability → first goal.

iPad layout: landscape uses a sidebar + main view (e.g. Today on left, Week on right); portrait uses a tab bar.

---

## 6. Data model (Dexie tables)

```ts
Goal { id, type, name, category, color, priority, focus, minSession, maxSession,
       preferredTime?, locationId?, active,
       // deadline
       deadline?, totalHours?, reviewDays?,
       // recurring
       perWeek?, sessionLength?, noConsecutiveDays?,
       // ongoing
       minutesPerDay?, minutesPerWeek?, endDate?,
       // book
       totalPages?, pagesDone? ,
       // focus overrides
       pomodoroWork?, pomodoroBreak?, pomodoroLongBreak?, cyclesBeforeLong?,
       createdAt }
Topic { id, goalId, name, order, weight, weak, done, doneAt?, reviewsDone }
FixedBlock { id, title, rule /* weekdays or date */, start, end, locationId?, locked: true }
AvailabilityWindow { id, weekday, start, end, energy }
AvailabilityOverride { id, date, start?, end?, kind: 'busy' | 'free' }
MealRule { id, name, windowStart, windowEnd, duration, locationId? }
Location { id, name }
TravelTime { fromId, toId, minutes }
Rule { id, kind, params }           // e.g. { kind:'noGoalAfter', time:'23:00', category:'Study' }
Settings { sleepStart, sleepEnd, bufferMin, dailyCapWeekday, dailyCapWeekend,
           demandingCap, homeLocationId, lastBackupAt }
Session { id, goalId?, topicIds?, kind: 'goal'|'meal'|'travel'|'review', date, start, end,
          status: 'planned'|'done'|'partial'|'skipped', actualMinutes?, note?, frozen }
FocusInterval { id, goalId, topicId?, sessionId?, phase: 'work'|'break'|'longBreak',
                startedAt, endedAt, minutes }   // all phases count toward goal time
ActiveTimer { goalId, phase: 'work'|'break'|'longBreak', phaseStartedAt, phaseLength,
              cycle, pausedAt? }                     // single row, survives app close
LogEntry { id, date, type, title, minutes?, amount?, note?, goalId? }
CheckIn { date, energy, mood, note? }
BacklogItem { id, list: 'watch'|'read', title, type, link?, note?,
              status: 'todo'|'inProgress'|'finished', rating?, finishedAt?, addedAt }
WeeklyReview { weekStart, confirmedAt, adjustments }
Stats { goalId, bucket, attempts, completions, focusMinutes }   // for learning
// Settings also gains: pomodoroWork, pomodoroBreak, pomodoroLongBreak,
//   cyclesBeforeLong, calendarAlertMin
```

---

## 7. Build plan (in order)

1. **Scaffold**: Vite + React + TS, Dexie, PWA plugin, routing, tab/sidebar layout. Deploy a hello-world and confirm it installs to the iPad Home Screen and works offline.
2. **Data layer**: Dexie schema, typed repositories, export/import JSON.
3. **Setup screens + onboarding**: sleep, fixed program, meals, locations/travel, availability with energy, rules, caps.
4. **Free-slot builder** (pure function) + unit tests: subtract sleep/fixed/meals, insert travel and buffers.
5. **Goals**: CRUD, full form for all types, templates.
6. **Planner v1** (pure) + tests: deadline distribution with ramp + review days, recurring placement, ongoing fill, caps, feasibility warnings.
7. **Today / Week / Month views** reading planned sessions.
8. **Session actions**: complete / partial / skip, session notes, re-plan on miss, today freezing.
9. **Focus Mode**: timestamp-based Pomodoro timer, per-goal settings, focus-minute logging, auto-complete of the day's planned amount, persistence across app close, wake lock. Unit-test the timer state machine.
10. **Topics & spaced review**: topic CRUD on deadline goals, topic-labeled sessions, review scheduling + tests.
11. **Progress & streaks**: progress bars, streak logic, goal detail screen, completion animations.
12. **Activity log, evening check-in, backlog lists** (+ finish → rating → log entry, book → Book goal).
13. **Learning**: completion-rate & check-in stats in slot scoring, energy-tag suggestions, estimate-correction suggestions.
14. **Weekly review screen.**
15. **Apple Calendar export** (.ics with alerts) — test the file imports correctly on the iPad.
16. **Quick add parser** + tests.
17. **Year in review** (heatmap, totals, watched/read).
18. **Polish**: dark mode, landscape/portrait layouts, backup reminder, empty states.

**Out of scope for now:** skill levels / XP, AI features, multi-device sync, push notifications.

**Acceptance check (example scenario to test against):** weekday classes 09:00–15:00 on Campus, 20 min travel Campus↔Home, dinner 19:00–20:30 window, free 16:00–23:00 weekdays (16–19 high energy), midterm Dec 12 needing 15h, workout 4×/week 45m at Gym (15 min away), read 30m daily. The plan should hit 15h before Dec 11 with Dec 11 as review, increase study slightly toward the date, keep workouts on non-consecutive days with travel inserted, never schedule during class/dinner/sleep, and stay within daily caps.
