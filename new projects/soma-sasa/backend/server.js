/**
 * Soma Sasa — Sync API
 * ---------------------------------------------------------------
 * A small Express server that plays the role of the "central server"
 * the frontend (app.js) talks to when it has connectivity. Data is
 * persisted to a flat JSON file (data/db.json) so the demo survives
 * restarts without needing a real database.
 *
 * REST contract (also mirrored in frontend/app.js as API_BASE_URL):
 *   GET    /api/health
 *   GET    /api/courses                          (professional/skills modules)
 *   GET    /api/curriculum                        (FLN literacy+numeracy curriculum)
 *   GET    /api/students                          (roster for teacher dashboard)
 *   GET    /api/students/:deviceId
 *   POST   /api/students/:deviceId                { name, isAnonymous, literacyLevel,
 *                                                    numeracyLevel, literacyAssessed,
 *                                                    numeracyAssessed, literacyProgress,
 *                                                    numeracyProgress, totalStars, streak,
 *                                                    lastActiveDate, badges }
 *   GET    /api/students/:deviceId/progress        (professional/skills module progress)
 *   POST   /api/students/:deviceId/progress        { courseId, completed, attempts }
 *   GET    /api/cohorts
 *   POST   /api/cohorts                            { id, name }
 *   POST   /api/cohorts/:id/increment
 *   GET    /api/stats
 * ---------------------------------------------------------------
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");

const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, "data", "db.json");
const COURSES_PATH = path.join(__dirname, "..", "frontend", "courses.json");
const CURRICULUM_PATH = path.join(__dirname, "..", "frontend", "fln_curriculum.json");

const app = express();
app.use(cors());
app.use(express.json());

// ---- Tiny write queue so concurrent requests can't corrupt db.json ----
let writeChain = Promise.resolve();
function readDB() {
  return fs.readFile(DB_PATH, "utf-8").then((raw) => JSON.parse(raw));
}
function writeDB(data) {
  writeChain = writeChain.then(() =>
    fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), "utf-8")
  );
  return writeChain;
}

function emptyStudent() {
  return {
    name: null,
    isAnonymous: true,
    literacyLevel: null,
    numeracyLevel: null,
    literacyAssessed: false,
    numeracyAssessed: false,
    literacyProgress: {},
    numeracyProgress: {},
    totalStars: 0,
    streak: 0,
    lastActiveDate: null,
    badges: [],
  };
}

// ---- Health check (used by the frontend to detect a reachable server) ----
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: Date.now() });
});

// ---- Professional/skills course catalog ----
app.get("/api/courses", async (req, res) => {
  try {
    const raw = await fs.readFile(COURSES_PATH, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: "Could not load course catalog." });
  }
});

// ---- FLN literacy + numeracy curriculum ----
app.get("/api/curriculum", async (req, res) => {
  try {
    const raw = await fs.readFile(CURRICULUM_PATH, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: "Could not load curriculum." });
  }
});

// ---- Students: full record (identity, assessed levels, lesson/test progress) ----
app.get("/api/students", async (req, res) => {
  const db = await readDB();
  const roster = Object.entries(db.students || {}).map(([deviceId, student]) => ({
    deviceId,
    ...student,
  }));
  res.json(roster);
});

app.get("/api/students/:deviceId", async (req, res) => {
  const db = await readDB();
  const student = (db.students || {})[req.params.deviceId] || emptyStudent();
  res.json(student);
});

app.post("/api/students/:deviceId", async (req, res) => {
  const db = await readDB();
  if (!db.students) db.students = {};
  const { deviceId } = req.params;
  const existing = db.students[deviceId] || emptyStudent();
  const body = req.body || {};
  db.students[deviceId] = {
    name: body.name !== undefined ? body.name : existing.name,
    isAnonymous: body.isAnonymous !== undefined ? body.isAnonymous : existing.isAnonymous,
    literacyLevel: body.literacyLevel !== undefined ? body.literacyLevel : existing.literacyLevel,
    numeracyLevel: body.numeracyLevel !== undefined ? body.numeracyLevel : existing.numeracyLevel,
    literacyAssessed: body.literacyAssessed !== undefined ? body.literacyAssessed : existing.literacyAssessed,
    numeracyAssessed: body.numeracyAssessed !== undefined ? body.numeracyAssessed : existing.numeracyAssessed,
    literacyProgress: body.literacyProgress !== undefined ? body.literacyProgress : existing.literacyProgress,
    numeracyProgress: body.numeracyProgress !== undefined ? body.numeracyProgress : existing.numeracyProgress,
    totalStars: body.totalStars !== undefined ? body.totalStars : existing.totalStars,
    streak: body.streak !== undefined ? body.streak : existing.streak,
    lastActiveDate: body.lastActiveDate !== undefined ? body.lastActiveDate : existing.lastActiveDate,
    badges: body.badges !== undefined ? body.badges : existing.badges,
  };
  await writeDB(db);
  res.json(db.students[deviceId]);
});

// ---- Professional/skills module progress: { [courseId]: { completed, attempts } } ----
app.get("/api/students/:deviceId/progress", async (req, res) => {
  const db = await readDB();
  const progress = (db.progress || {})[req.params.deviceId] || {};
  res.json(progress);
});

app.post("/api/students/:deviceId/progress", async (req, res) => {
  const { courseId, completed, attempts } = req.body || {};
  if (!courseId) {
    return res.status(400).json({ error: "courseId is required." });
  }
  const db = await readDB();
  if (!db.progress) db.progress = {};
  const { deviceId } = req.params;
  if (!db.progress[deviceId]) db.progress[deviceId] = {};
  const existing = db.progress[deviceId][courseId] || { completed: false, attempts: 0 };
  db.progress[deviceId][courseId] = {
    completed: completed !== undefined ? !!completed : existing.completed,
    attempts: attempts !== undefined ? attempts : existing.attempts,
  };
  await writeDB(db);
  res.json(db.progress[deviceId]);
});

// ---- Cohorts ----
app.get("/api/cohorts", async (req, res) => {
  const db = await readDB();
  res.json(db.cohorts);
});

app.post("/api/cohorts", async (req, res) => {
  const { id, name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required." });
  }
  const db = await readDB();
  const cohort = {
    id: id || `cohort_${Date.now()}`,
    name: name.trim(),
    count: 0,
    completed: 0,
  };
  db.cohorts.push(cohort);
  await writeDB(db);
  res.status(201).json(cohort);
});

app.post("/api/cohorts/:id/increment", async (req, res) => {
  const db = await readDB();
  const cohort = db.cohorts.find((c) => c.id === req.params.id);
  if (!cohort) return res.status(404).json({ error: "Cohort not found." });
  cohort.completed += 1;
  await writeDB(db);
  res.json(cohort);
});

// ---- Aggregate stats for the teacher dashboard ----
app.get("/api/stats", async (req, res) => {
  const db = await readDB();
  const totalGroups = db.cohorts.length;
  const totalLearners = db.cohorts.reduce((sum, c) => sum + c.count, 0);
  const totalCompletions = db.cohorts.reduce((sum, c) => sum + c.completed, 0);
  const completionRate = totalLearners > 0
    ? Math.round((totalCompletions / totalLearners) * 100)
    : 0;
  res.json({ totalGroups, totalLearners, totalCompletions, completionRate });
});

app.listen(PORT, () => {
  console.log(`Soma Sasa sync API listening on http://localhost:${PORT}`);
});
