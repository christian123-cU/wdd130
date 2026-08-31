# Soma Sasa — Micro-Learning Platform

An offline-first micro-learning platform, launching in Kenya with East Africa,
Africa, and global reach in mind: a fully leveled, assessment-gated Young
Learner Zone (literacy + numeracy) built on Teaching at the Right Level
(TaRL) principles, an interactive Skills & Work Zone for professional/life
skills, and a password-gated teacher facilitator dashboard — backed by a
real sync API.

## Project structure

```
soma-sasa/
├── frontend/
│   ├── index.html          # App shell — registration, mode chooser, both zones, teacher view
│   ├── styles.css          # Styling (forest-green palette, AA-contrast checked)
│   ├── app.js               # State machine, assessment engine, lesson viewer, sync queue
│   ├── mascots.js           # Inline-SVG mascot art + English voice lines
│   ├── fln_curriculum.json  # Young Learner Zone: 10 levels × 7 lessons + assessments
│   └── courses.json         # Skills & Work Zone: quizzes, templates, checklists
└── backend/
    ├── server.js            # Express sync API
    ├── package.json
    └── data/db.json         # Flat-file "database" (cohorts + student records + progress)
```

## Running it

**1. Start the backend (sync API):**
```bash
cd backend
npm install
npm start
```
Runs at `http://localhost:3001`.

**2. Open the frontend:**
```bash
cd frontend
python3 -m http.server 8080
# then visit http://localhost:8080
```
Or just open `frontend/index.html` directly in a browser.

The frontend looks for the API at `http://localhost:3001/api` (see
`API_BASE_URL` in `app.js`) — change that constant if you deploy the
backend elsewhere.

## How a learner moves through the Young Learner Zone

1. **Registration** — enter a name, or continue anonymously. One-time, on
   first visit.
2. **Choose a subject** — Literacy or Numeracy. No lesson opens without an
   assessment first.
3. **Placement assessment**:
   - **Literacy** (adaptive, stops at first failure): 10 letters → pick 5 →
     verified via recognition checks (need 4/5) → 10 words → pick 5 →
     verified (need 4/5) → one of 2 short paragraphs → comprehension
     checks (need both correct) → a story → 2 comprehension questions.
     Failing a step records the learner at the level *below* that step;
     passing the story records **Story**, the ceiling level.
   - **Numeracy** (always runs to completion): 5 number-recognition items →
     2 addition → 2 subtraction → 2 multiplication → 2 division → 2 word
     problems (addition- and subtraction-flavored). The level is recorded
     at the *first* section with a mistake; zero mistakes anywhere places
     the learner at **Division**, the ceiling level.
   - **Adaptation note**: this is a self-serve web app with no audio input,
     so "reads correctly" is approximated with recognition/comprehension
     multiple-choice checks rather than literally listening to a learner
     read aloud. The stop/continue logic and level outcomes match the
     original design; the verification mechanism is the digital substitute.
4. **Level roadmap** — 5 levels per subject, shown as a vertical roadmap.
   Levels below the assessed starting point are marked "Already Know This"
   (skippable); the assessed level is current and unlocked; levels above
   are locked until the previous level's test is passed.
5. **Lesson viewer** — each level has exactly 7 lessons. Every lesson opens
   on a short, self-paced animated **intro hook** (letters/words/numbers
   popping in) with a "Start Studying →" button — not a forced timer, since
   that would frustrate returning learners — then the main study content
   (5–8 minutes' worth, activity-type rendering described below).
6. **Level test** — after lesson 7, a 3-question test. 3/3 correct unlocks
   the next level and triggers a **confetti celebration** (~4 seconds),
   then a choice: **Revise this level** or **Continue to the next level**.
   Anything less than 3/3 resets all 7 lessons in that level as unstudied
   and sends the learner back to lesson 1 for full mastery.

Stars are awarded per lesson studied (+1, first time only) and per level
test passed (+5, first time only, plus a collectible badge). Day-streaks
work the same way as before.

## Curriculum content (`fln_curriculum.json`)

**Literacy — 5 levels × 7 lessons (35 lessons):**
- **Beginner** — the 7 Jolly Phonics sound groups (s-a-t-p-i-n through
  qu-ou-oi-ue-er-ar), taught in order with blending practice.
- **Letter** — full alphabet review, vowel sounds, consonant blends, word
  families (-at, -in, -og), rhyming words.
- **Word** — 2-, 3-, 4-, 5-letter word building, sight words, simple
  sentences.
- **Paragraph** — the 7 short paragraphs from the Level 1 reader (Cat and
  Rat, Koki's Stomach, My Sister Anna, Road Safety, A Sunny Place, My
  School, Market Day).
- **Story** — 7 longer stories drawn from the Level 2/3 readers (My
  Favorite Day, Atieno's Family, The Ant and the Grasshopper, A Lion and
  the Rat, Zeke the Zebra, The Magical Honey Pot, Peter's Fortune).

**Numeracy — 5 levels × 7 lessons (35 lessons):**
- **Number Recognition** — 1–10, 11–20, tens patterns to 100, place value,
  expanded form.
- **Addition** — 1-digit, 2-digit (with/without carrying), word problems,
  3-digit addition, mixed review.
- **Subtraction** — 1-digit, 2-digit (with/without borrowing), word
  problems, 3-digit subtraction, mixed review.
- **Multiplication** — the concept as repeated addition, times tables 2–5,
  the ×10 shortcut, the box method for 2-digit × 2-digit, word problems.
- **Division** — the concept as equal sharing, division via the
  multiplication table, remainders, word problems, larger-number division.

Each lesson has an `activityType` (`letter_intro`, `word_ladder`,
`passage_reader`, `number_blocks`, `operation_steps`) that `app.js` renders
generically, plus an `introType` that drives which animated hook plays
before the lesson content appears.

Per your direction, Swahili has been minimized in the actual learning
content and mascot dialogue (English throughout) as the platform scales
past Kenya — "Soma Sasa" stays as the brand name.

## Skills & Work Zone (unchanged from the previous build)

Quiz modules, fill-in templates (Resume, Cover Letter, Career Plan, Career
Exploration), the LinkedIn Connection Message Builder, and the Application
Quality Checklist — see `courses.json`. Mastery dashboard and "recommended
next" logic work exactly as before.

## Teacher Facilitator Dashboard

- **Password gate**: stub password `SomaSasa@123` (flagged in-app as
  temporary; swap `TEACHER_PASSWORD` in `app.js` for anything stronger
  before real deployment).
- **Learner Roster** — every registered learner (name or "Anonymous
  `<device-id-prefix>`"), with their assessed literacy and numeracy level,
  pulled from `GET /api/students`.
- **Cohorts, stats, SMS pack, Facilitator Activity Guide, and Assessment
  Rubric** — unchanged from before.

## REST API contract

| Method | Endpoint | Body | Notes |
|---|---|---|---|
| GET | `/api/health` | — | Reachability check |
| GET | `/api/courses` | — | Skills & Work Zone catalog |
| GET | `/api/curriculum` | — | Full FLN curriculum (literacy + numeracy) |
| GET | `/api/students` | — | Full roster, for the teacher dashboard |
| GET | `/api/students/:deviceId` | — | One student's full record |
| POST | `/api/students/:deviceId` | `{ name, isAnonymous, literacyLevel, numeracyLevel, literacyAssessed, numeracyAssessed, literacyProgress, numeracyProgress, totalStars, streak, lastActiveDate, badges }` | Upserts identity + assessed levels + lesson/test progress + gamification |
| GET | `/api/students/:deviceId/progress` | — | Skills & Work Zone module progress |
| POST | `/api/students/:deviceId/progress` | `{ courseId, completed, attempts }` | Upserts one module's completion |
| GET / POST | `/api/cohorts`, `/api/cohorts/:id/increment` | — | Peer groups |
| GET | `/api/stats` | — | Aggregate teacher-dashboard stats |

Offline-first sync is unchanged: every write goes to `localStorage`
immediately, then either POSTs right away (if the server is reachable) or
queues in `sync_queue` for the next successful sync.

## Contrast fixes

Several button/badge combinations in the original stylesheet fell below
WCAG AA (white text on the mid-tone accent green, ~3.4:1). Text/background
pairings were adjusted to hit ~4.5:1+ while keeping the same forest-green
palette.
