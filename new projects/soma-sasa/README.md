# Soma Sasa — Micro-Learning Platform

An offline-first micro-learning platform for Kenya: a self-paced student portal
(foundational literacy/numeracy + work & life skills) and a teacher facilitator
dashboard, backed by a real sync API.

## Project structure

```
soma-sasa/
├── frontend/
│   ├── index.html       # App shell (mode chooser + Young Learner / Skills zones + teacher view)
│   ├── styles.css       # Styling (forest-green palette, AA-contrast checked)
│   ├── app.js           # State machine, offline sync queue, quiz engine, gamification
│   ├── mascots.js        # Inline-SVG mascot art + character voice lines
│   └── courses.json     # Local/offline course cache
└── backend/
    ├── server.js        # Express sync API
    ├── package.json
    └── data/db.json     # Flat-file "database" (cohorts + student progress)
```

## Running it

**1. Start the backend (sync API):**
```bash
cd backend
npm install
npm start
```
This runs the API at `http://localhost:3001`.

**2. Open the frontend:**
Just open `frontend/index.html` directly in a browser, or serve it with any
static file server, e.g.:
```bash
cd frontend
python3 -m http.server 8080
# then visit http://localhost:8080
```

The frontend is hard-coded to look for the API at `http://localhost:3001/api`
(see `API_BASE_URL` at the top of `app.js`) — change that constant if you
deploy the backend somewhere else.

## How the offline-first sync works

- On load, and whenever the browser's online/offline state changes, the app
  pings `GET /api/health`. If that fails — no internet, or the server just
  isn't running — the UI drops into **Offline Mode** and every read/write
  falls back to `localStorage`.
- Student progress and teacher cohort actions (register group, add
  completion) are always written to `localStorage` immediately, so the UI
  never blocks on the network.
- If the server was unreachable at the time, that write is pushed onto a
  `sync_queue` in `localStorage`. The footer shows a "N pending" badge.
- When connectivity returns (or the person taps **Sync Now**), the queue is
  replayed against the API in order, and cohorts/stats are refreshed from
  the server.

## REST API contract

| Method | Endpoint                              | Body                          | Notes |
|--------|----------------------------------------|--------------------------------|-------|
| GET    | `/api/health`                          | —                               | Reachability check |
| GET    | `/api/courses`                         | —                               | Server-authoritative course catalog |
| GET    | `/api/students/:deviceId/progress`     | —                               | Per-device progress map `{ [courseId]: { completed, attempts } }` |
| POST   | `/api/students/:deviceId/progress`     | `{ courseId, completed, attempts }` | Upserts one course's completion/attempt count |
| GET    | `/api/students/:deviceId/profile`      | —                               | Stars/streak/badges for Young Learner mode |
| POST   | `/api/students/:deviceId/profile`      | `{ totalStars, streak, lastActiveDate, badges }` | Upserts the learner profile |
| GET    | `/api/cohorts`                         | —                               | All registered peer groups |
| POST   | `/api/cohorts`                         | `{ id, name }`                  | Registers a new group |
| POST   | `/api/cohorts/:id/increment`           | —                               | +1 completed module for a group |
| GET    | `/api/stats`                           | —                               | Aggregate dashboard stats |

Data persists to `backend/data/db.json` between restarts. There's no
authentication layer — devices are identified by an anonymous UUID generated
on first load and stored in `localStorage` (`device_id`), which is enough
for this prototype but would need real auth before a public rollout.

## What changed from the original spec

- **Retry-able quizzes**: wrong answers are marked and locked out, but the
  quiz stays open for another attempt; after 2 wrong tries a hint appears.
- **Teacher stats**: dashboard shows total groups, learners, completions,
  and completion rate, computed server-side (`/api/stats`) or locally as a
  fallback.
- **Real backend**: an Express API + flat-file store, with the frontend
  wired to call it over HTTP and gracefully degrade to local storage.
- **Contrast fixes**: several button/badge combinations in the original
  stylesheet fell below WCAG AA (e.g. white text on the mid-tone accent
  green, ~3.4:1). Text/background pairings were adjusted to hit ~4.5:1+
  while keeping the same forest-green palette.

## Two learning zones

The Student Portal now opens on a chooser instead of one undifferentiated
course grid — informed by a few real-world ed-tech patterns:

**🐘🦜 Young Learner Zone** (FLN courses)
- Each lesson is guided by an inline-SVG mascot (`frontend/mascots.js`) —
  **Nambari** the elephant for numeracy, **Herufi** the parrot for
  literacy — with their own greeting, retry, and success lines. All art is
  hand-drawn SVG shapes with zero external image requests, so it doesn't
  cost any of the "zero data waste" budget the original spec called for.
- **Stars**: 2 stars for a first-try correct answer, 1 star if it took
  retries. Only awarded the first time a course is completed.
- **Streaks**: a day-based streak counter (`learner_profile.streak` in
  localStorage, synced via `/api/students/:deviceId/profile`) that
  increments once per calendar day of activity.
- **Badges**: a badge shelf shows one collectible badge per FLN course,
  unlocked on first completion.

**📊 Skills & Work Zone** (Professional/life-skills courses)
- A clean, no-mascot mastery dashboard: "X of Y modules mastered" with a
  progress bar.
- **Recommended next** card: a lightweight, rule-based version. 
  It recommends an unstarted module first; once
  everything is complete, it recommends revisiting whichever module had
  the most wrong attempts (`student_progress[courseId].attempts`), so
  practice time goes where it's actually needed.

Progress, attempts, and the learner profile all sync to the backend the
same offline-first way as before — optimistic local write, then either an
immediate POST (if the server is reachable) or a queued retry.
