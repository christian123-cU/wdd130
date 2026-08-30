// ==========================================================================
// Soma Sasa — Progressive Engine & Synchronization Controller
// ==========================================================================
// REST contract this file talks to (see backend/server.js):
//   GET  /api/health
//   GET  /api/courses
//   GET  /api/students/:deviceId/progress
//   POST /api/students/:deviceId/progress   { courseId, completed, attempts }
//   GET  /api/students/:deviceId/profile
//   POST /api/students/:deviceId/profile    { totalStars, streak, lastActiveDate, badges }
//   GET  /api/cohorts
//   POST /api/cohorts                       { id, name }
//   POST /api/cohorts/:id/increment
//   GET  /api/stats
//
// If the API is unreachable (no server running, or genuinely offline),
// every read falls back to a local cache and every write is queued in
// localStorage until connectivity returns.
// ==========================================================================

const API_BASE_URL = "http://localhost:3001/api";
const HEALTH_TIMEOUT_MS = 2500;

// ---- Global platform state ----
let courses = [];
let isServerReachable = false;
let currentQuizAttempts = 0;   // wrong tries in the lesson modal currently open
let currentStudentMode = null; // 'young' | 'skills' | null (chooser)

// ---- Device identity (anonymous, persists per-browser) ----
function getDeviceId() {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `device_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    localStorage.setItem("device_id", id);
  }
  return id;
}
const DEVICE_ID = getDeviceId();

// ---- Local storage fallbacks initialization ----
if (!localStorage.getItem("cohorts")) {
  localStorage.setItem("cohorts", JSON.stringify([
    { id: "cohort_seed_1", name: "Nairobi East Peer Circle", count: 12, completed: 3 },
    { id: "cohort_seed_2", name: "Kisumu Tech Club", count: 8, completed: 1 }
  ]));
}
if (!localStorage.getItem("student_progress")) {
  // shape: { [courseId]: { completed: bool, attempts: number } }
  localStorage.setItem("student_progress", JSON.stringify({}));
}
if (!localStorage.getItem("learner_profile")) {
  // stars/streak/badges are only meaningful in Young Learner mode
  localStorage.setItem("learner_profile", JSON.stringify({
    totalStars: 0, streak: 0, lastActiveDate: null, badges: []
  }));
}
if (!localStorage.getItem("sync_queue")) {
  localStorage.setItem("sync_queue", JSON.stringify([]));
}

// ==========================================================================
// Bootstrap
// ==========================================================================
document.addEventListener("DOMContentLoaded", async () => {
  window.addEventListener("online", refreshConnectionState);
  window.addEventListener("offline", refreshConnectionState);

  await refreshConnectionState();
  await loadCourseDB();
  await loadProgressFromServer();
  await loadProfileFromServer();
  await refreshCohorts();
  await refreshStats();
  showModeChooser();
});

// ==========================================================================
// Connectivity: browser flag + an actual reachability check against /api/health
// ==========================================================================
async function checkServerReachable() {
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch (err) {
    return false;
  }
}

async function refreshConnectionState() {
  isServerReachable = await checkServerReachable();
  updateConnectionBadge();
  if (isServerReachable) {
    await syncPendingWrites();
  }
  updateSyncQueueBadge();
}

function updateConnectionBadge() {
  const indicator = document.getElementById("connection-status");
  const syncMessage = document.getElementById("sync-message");

  if (isServerReachable) {
    indicator.innerText = "Online — Synced";
    indicator.className = "badge online";
    syncMessage.innerText = "Connected to sync server.";
  } else if (navigator.onLine) {
    indicator.innerText = "Online — Server unreachable";
    indicator.className = "badge error";
    syncMessage.innerText = "Internet is on, but the sync server can't be reached. Working from local storage.";
  } else {
    indicator.innerText = "Offline Mode";
    indicator.className = "badge offline";
    syncMessage.innerText = "Offline mode active. Progress saved to this device.";
  }
}

// ==========================================================================
// Courses: server is authoritative when reachable, else static file, else cache
// ==========================================================================
async function loadCourseDB() {
  if (isServerReachable) {
    try {
      const res = await fetch(`${API_BASE_URL}/courses`);
      if (!res.ok) throw new Error("Bad response");
      courses = await res.json();
      localStorage.setItem("cached_courses", JSON.stringify(courses));
      return;
    } catch (err) {
      console.warn("Server course fetch failed, falling back.", err);
    }
  }

  try {
    const response = await fetch("courses.json");
    courses = await response.json();
    localStorage.setItem("cached_courses", JSON.stringify(courses));
  } catch (error) {
    console.warn("Serving learning assets from offline disk storage.");
    courses = JSON.parse(localStorage.getItem("cached_courses")) || [];
  }
}

// ==========================================================================
// Top-level view switching (Student Portal <-> Teacher Facilitator)
// ==========================================================================
function switchView(target) {
  document.querySelectorAll(".view-pane").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((el) => el.classList.remove("active"));
  document.getElementById(`${target}-view`).classList.add("active");
  document.getElementById(`btn-${target}-view`).classList.add("active");

  if (target === "teacher") {
    refreshCohorts();
    refreshStats();
  }
}

// ==========================================================================
// Student mode switching: chooser <-> young <-> skills
// ==========================================================================
function showModeChooser() {
  currentStudentMode = null;
  document.getElementById("mode-chooser").classList.remove("hidden");
  document.getElementById("young-mode").classList.add("hidden");
  document.getElementById("skills-mode").classList.add("hidden");
}

function switchStudentMode(mode) {
  currentStudentMode = mode;
  document.getElementById("mode-chooser").classList.add("hidden");
  document.getElementById("young-mode").classList.toggle("hidden", mode !== "young");
  document.getElementById("skills-mode").classList.toggle("hidden", mode !== "skills");

  if (mode === "young") renderYoungMode();
  if (mode === "skills") renderSkillsMode();
}

// ==========================================================================
// YOUNG LEARNER MODE — mascot-guided FLN courses, stars, streaks, badges
// ==========================================================================
function renderYoungMode() {
  const profile = getLearnerProfile();
  document.getElementById("young-stars").innerText = profile.totalStars;
  document.getElementById("young-streak").innerText = profile.streak;

  const grid = document.getElementById("young-course-grid");
  grid.innerHTML = "";

  const flnCourses = courses.filter((c) => c.category === "fln");
  if (flnCourses.length === 0) {
    grid.innerHTML = "<p class='empty-state'>No lessons loaded yet. Please sync when online.</p>";
    return;
  }

  flnCourses.forEach((course) => {
    const mascot = getMascot(course.mascotId);
    const completed = getCourseProgress(course.id).completed;
    const card = document.createElement("div");
    card.className = "mascot-card";
    card.innerHTML = `
      <div class="mascot-card-top">
        <div class="mascot-avatar">${mascot ? mascot.svg : ""}</div>
        <div class="mascot-name-role">
          <h3>${escapeHtml(mascot ? mascot.name : "")}</h3>
          <span>${escapeHtml(mascot ? mascot.role : "")}</span>
        </div>
      </div>
      <div class="mascot-course-title">${escapeHtml(course.title)}</div>
      <div class="mascot-speech-bubble">"${escapeHtml(mascot ? mascot.greeting : "")}"</div>
      <div class="course-status-row">
        <span class="badge ${completed ? "online" : "offline"}">
          ${completed ? "Completed ✓" : "Incomplete"}
        </span>
      </div>
      <button class="action-btn" onclick="startLesson('${course.id}')">
        ${completed ? "Review with " + escapeHtml(mascot ? mascot.name : "buddy") : "Start with " + escapeHtml(mascot ? mascot.name : "buddy")}
      </button>
    `;
    grid.appendChild(card);
  });

  renderBadgeShelf(flnCourses, profile);
}

function renderBadgeShelf(flnCourses, profile) {
  const shelf = document.getElementById("badge-shelf-list");
  shelf.innerHTML = "";
  flnCourses.forEach((course) => {
    const unlocked = profile.badges.includes(course.id);
    const mascot = getMascot(course.mascotId);
    const item = document.createElement("div");
    item.className = `badge-item ${unlocked ? "unlocked" : ""}`;
    item.innerHTML = `
      <span class="badge-icon">${unlocked ? "🏅" : "🔒"}</span>
      ${escapeHtml(mascot ? mascot.name + "'s Badge" : "Badge")}
    `;
    shelf.appendChild(item);
  });
}

// ==========================================================================
// SKILLS MODE — clean, mastery-driven professional/life-skills track
// ==========================================================================
function renderSkillsMode() {
  const professionalCourses = courses.filter((c) => c.category === "professional");
  const total = professionalCourses.length;
  const completed = professionalCourses.filter((c) => getCourseProgress(c.id).completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById("mastery-text").innerText = `${completed} of ${total} modules mastered`;
  document.getElementById("mastery-percent").innerText = `${pct}%`;
  document.getElementById("mastery-fill").style.width = `${pct}%`;

  renderRecommendation(professionalCourses);

  const grid = document.getElementById("skills-course-grid");
  grid.innerHTML = "";

  if (professionalCourses.length === 0) {
    grid.innerHTML = "<p class='empty-state'>No modules loaded yet. Please sync when online.</p>";
    return;
  }

  professionalCourses.forEach((course) => {
    const progress = getCourseProgress(course.id);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="course-card-body">
        <h3>${escapeHtml(course.title)}</h3>
        <p>${escapeHtml(course.desc)}</p>
        <div class="course-status-row">
          <span class="badge ${progress.completed ? "online" : "offline"}">
            ${progress.completed ? "Mastered ✓" : "Not started"}
          </span>
          ${progress.attempts > 0 ? `<span class="badge offline">${progress.attempts} past miss${progress.attempts > 1 ? "es" : ""}</span>` : ""}
        </div>
      </div>
      <button class="action-btn" onclick="startLesson('${course.id}')">
        ${progress.completed ? "Review Module" : "Start Module"}
      </button>
    `;
    grid.appendChild(card);
  });
}

// Ethio IQ-style rule-based "what to review next" suggestion.
function computeRecommendation(professionalCourses) {
  const notStarted = professionalCourses.filter((c) => !getCourseProgress(c.id).completed);
  if (notStarted.length > 0) {
    // Prioritise a course that's never been attempted at all.
    const fresh = notStarted.find((c) => getCourseProgress(c.id).attempts === 0);
    const target = fresh || notStarted[0];
    const reason = fresh
      ? "You haven't started this one yet."
      : "You started this earlier but haven't finished — pick it back up.";
    return { course: target, reason };
  }

  // Everything is complete: suggest a review of whatever was hardest.
  const struggled = [...professionalCourses].sort(
    (a, b) => getCourseProgress(b.id).attempts - getCourseProgress(a.id).attempts
  )[0];
  if (struggled && getCourseProgress(struggled.id).attempts > 0) {
    return { course: struggled, reason: "You found this tricky earlier — a quick review will lock it in." };
  }
  return null; // aced everything, nothing to recommend
}

function renderRecommendation(professionalCourses) {
  const card = document.getElementById("recommendation-card");
  const rec = computeRecommendation(professionalCourses);

  if (!rec) {
    card.classList.add("hidden");
    return;
  }

  card.classList.remove("hidden");
  document.getElementById("recommendation-title").innerText = rec.course.title;
  document.getElementById("recommendation-reason").innerText = rec.reason;
  const btn = document.getElementById("recommendation-btn");
  btn.onclick = () => startLesson(rec.course.id);
}

// ==========================================================================
// Lesson modal + quiz with retry handling (shared by both modes)
// ==========================================================================
function startLesson(id) {
  const course = courses.find((c) => c.id === id);
  if (!course) return;

  currentQuizAttempts = 0;
  const mascot = getMascot(course.mascotId);
  const payload = document.getElementById("lesson-payload");
  payload.innerHTML = `
    ${mascot ? `<div class="mascot-card-top" style="margin-bottom:10px;">
      <div class="mascot-avatar">${mascot.svg}</div>
      <div class="mascot-name-role"><h3 style="margin:0;">${escapeHtml(mascot.name)}</h3></div>
    </div>` : ""}
    <h2 id="lesson-title">${escapeHtml(course.title)}</h2>
    <p class="lesson-content">${escapeHtml(course.lessonContent)}</p>
    <div class="interactive-quiz">
      <p class="quiz-question">${escapeHtml(course.quiz.question)}</p>
      <div id="quiz-options">
        ${course.quiz.options.map((opt, index) => `
          <button class="quiz-option" data-index="${index}"
            onclick="evaluateAnswer('${course.id}', ${index}, ${course.quiz.correctIndex})">
            ${escapeHtml(opt)}
          </button>
        `).join("")}
      </div>
      <div id="quiz-attempts" class="quiz-attempts"></div>
      <div id="quiz-hint" class="quiz-hint hidden"></div>
    </div>
    <div id="quiz-feedback" class="quiz-feedback"></div>
  `;
  document.getElementById("lesson-modal").classList.remove("hidden");
}

function closeLesson() {
  document.getElementById("lesson-modal").classList.add("hidden");
}

function evaluateAnswer(courseId, selectedIndex, correctIndex) {
  const course = courses.find((c) => c.id === courseId);
  const mascot = getMascot(course?.mascotId);
  const feedback = document.getElementById("quiz-feedback");
  const attemptsEl = document.getElementById("quiz-attempts");
  const hintEl = document.getElementById("quiz-hint");
  const buttons = document.querySelectorAll("#quiz-options .quiz-option");
  const selectedBtn = buttons[selectedIndex];

  if (selectedIndex === correctIndex) {
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === correctIndex) btn.classList.add("correct");
    });
    feedback.className = "quiz-feedback success";
    feedback.innerText = mascot ? mascot.success : "Safi sana! Correct answer — module completed!";
    markComplete(courseId);
    setTimeout(() => {
      closeLesson();
      if (currentStudentMode === "young") renderYoungMode();
      if (currentStudentMode === "skills") renderSkillsMode();
    }, 1500);
    return;
  }

  // Wrong answer: lock that option out, let them retry the rest
  currentQuizAttempts += 1;
  recordAttempt(courseId);
  selectedBtn.classList.add("wrong");
  selectedBtn.disabled = true;
  feedback.className = "quiz-feedback error";
  feedback.innerText = mascot ? mascot.retry : "Not quite — try again!";
  attemptsEl.innerText = `Attempts: ${currentQuizAttempts}`;

  if (currentQuizAttempts >= 2 && course?.quiz?.hint) {
    hintEl.innerText = `Hint: ${course.quiz.hint}`;
    hintEl.classList.remove("hidden");
  }
}

// ==========================================================================
// Progress persistence (optimistic local write + server sync)
// shape: { [courseId]: { completed: bool, attempts: number } }
// ==========================================================================
function getCourseProgress(courseId) {
  const progress = JSON.parse(localStorage.getItem("student_progress")) || {};
  return progress[courseId] || { completed: false, attempts: 0 };
}

function recordAttempt(courseId) {
  const progress = JSON.parse(localStorage.getItem("student_progress")) || {};
  const entry = progress[courseId] || { completed: false, attempts: 0 };
  entry.attempts += 1;
  progress[courseId] = entry;
  localStorage.setItem("student_progress", JSON.stringify(progress));
}

async function markComplete(courseId) {
  const progress = JSON.parse(localStorage.getItem("student_progress")) || {};
  const wasAlreadyComplete = !!(progress[courseId] && progress[courseId].completed);
  const entry = progress[courseId] || { completed: false, attempts: 0 };
  entry.completed = true;
  progress[courseId] = entry;
  localStorage.setItem("student_progress", JSON.stringify(progress));

  // Gamification: only reward stars/badges/streak on first-ever completion
  if (!wasAlreadyComplete) {
    const starsEarned = currentQuizAttempts === 0 ? 2 : 1;
    awardStarsAndBadge(courseId, starsEarned);
    bumpStreak();
  }

  const payload = { courseId, completed: true, attempts: entry.attempts };
  if (isServerReachable) {
    const ok = await postJSON(`/students/${DEVICE_ID}/progress`, payload);
    if (!ok) enqueueSync({ type: "progress", payload });
  } else {
    enqueueSync({ type: "progress", payload });
  }
  await pushProfileToServer();
  updateSyncQueueBadge();
}

async function loadProgressFromServer() {
  if (!isServerReachable) return;
  try {
    const res = await fetch(`${API_BASE_URL}/students/${DEVICE_ID}/progress`);
    if (!res.ok) throw new Error("Bad response");
    const serverProgress = await res.json();
    const localProgress = JSON.parse(localStorage.getItem("student_progress")) || {};
    // Merge: completed wins, attempts take the max seen on either side
    const merged = { ...serverProgress };
    Object.keys(localProgress).forEach((id) => {
      const s = serverProgress[id] || { completed: false, attempts: 0 };
      const l = localProgress[id];
      merged[id] = {
        completed: s.completed || l.completed,
        attempts: Math.max(s.attempts || 0, l.attempts || 0),
      };
    });
    localStorage.setItem("student_progress", JSON.stringify(merged));
  } catch (err) {
    console.warn("Could not load progress from server, using local cache.", err);
  }
}

// ==========================================================================
// Learner profile: stars, streaks, badges (Young Learner mode only)
// ==========================================================================
function getLearnerProfile() {
  return JSON.parse(localStorage.getItem("learner_profile")) || {
    totalStars: 0, streak: 0, lastActiveDate: null, badges: []
  };
}

function saveLearnerProfile(profile) {
  localStorage.setItem("learner_profile", JSON.stringify(profile));
}

function awardStarsAndBadge(courseId, starsEarned) {
  const profile = getLearnerProfile();
  profile.totalStars += starsEarned;
  if (!profile.badges.includes(courseId)) profile.badges.push(courseId);
  saveLearnerProfile(profile);
}

function bumpStreak() {
  const profile = getLearnerProfile();
  const today = new Date().toISOString().slice(0, 10);
  if (profile.lastActiveDate === today) return; // already counted today

  if (profile.lastActiveDate) {
    const prev = new Date(profile.lastActiveDate);
    const diffDays = Math.round((new Date(today) - prev) / (1000 * 60 * 60 * 24));
    profile.streak = diffDays === 1 ? profile.streak + 1 : 1;
  } else {
    profile.streak = 1;
  }
  profile.lastActiveDate = today;
  saveLearnerProfile(profile);
}

async function pushProfileToServer() {
  const profile = getLearnerProfile();
  if (isServerReachable) {
    const ok = await postJSON(`/students/${DEVICE_ID}/profile`, profile);
    if (!ok) enqueueSync({ type: "profile", payload: profile });
  } else {
    enqueueSync({ type: "profile", payload: profile });
  }
}

async function loadProfileFromServer() {
  if (!isServerReachable) return;
  try {
    const res = await fetch(`${API_BASE_URL}/students/${DEVICE_ID}/profile`);
    if (!res.ok) throw new Error("Bad response");
    const serverProfile = await res.json();
    if (serverProfile && Object.keys(serverProfile).length > 0) {
      const local = getLearnerProfile();
      // Take whichever side has more progress; avoids clobbering local gains.
      const merged = serverProfile.totalStars >= local.totalStars ? serverProfile : local;
      saveLearnerProfile(merged);
    }
  } catch (err) {
    console.warn("Could not load learner profile from server, using local cache.", err);
  }
}

// ==========================================================================
// Sync queue — used for any write attempted while the server is unreachable
// ==========================================================================
function enqueueSync(item) {
  const queue = JSON.parse(localStorage.getItem("sync_queue")) || [];
  queue.push({ ...item, timestamp: Date.now() });
  localStorage.setItem("sync_queue", JSON.stringify(queue));
  updateSyncQueueBadge();
}

async function syncPendingWrites() {
  let queue = JSON.parse(localStorage.getItem("sync_queue")) || [];
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    let ok = false;
    if (item.type === "progress") {
      ok = await postJSON(`/students/${DEVICE_ID}/progress`, item.payload);
    } else if (item.type === "profile") {
      ok = await postJSON(`/students/${DEVICE_ID}/profile`, item.payload);
    } else if (item.type === "cohort_create") {
      ok = await postJSON(`/cohorts`, item.payload);
    } else if (item.type === "cohort_increment") {
      ok = await postJSON(`/cohorts/${item.payload.id}/increment`, {});
    }
    if (!ok) remaining.push(item);
  }

  localStorage.setItem("sync_queue", JSON.stringify(remaining));
  updateSyncQueueBadge();

  const syncMessage = document.getElementById("sync-message");
  if (remaining.length === 0) {
    syncMessage.innerText = "All offline progress successfully synced!";
  } else {
    syncMessage.innerText = `Synced some items — ${remaining.length} still pending.`;
  }

  await refreshCohorts();
  await refreshStats();
}

function updateSyncQueueBadge() {
  const queue = JSON.parse(localStorage.getItem("sync_queue")) || [];
  const badge = document.getElementById("sync-queue-badge");
  if (queue.length > 0) {
    badge.innerText = `${queue.length} pending`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

async function triggerManualSync() {
  await refreshConnectionState();
  await loadCourseDB();
  await loadProgressFromServer();
  await loadProfileFromServer();
  if (currentStudentMode === "young") renderYoungMode();
  if (currentStudentMode === "skills") renderSkillsMode();
}

// ==========================================================================
// Teacher: cohorts + aggregate stats
// ==========================================================================
async function refreshCohorts() {
  if (isServerReachable) {
    try {
      const res = await fetch(`${API_BASE_URL}/cohorts`);
      if (!res.ok) throw new Error("Bad response");
      const cohorts = await res.json();
      localStorage.setItem("cohorts", JSON.stringify(cohorts));
      renderCohorts(cohorts);
      return;
    } catch (err) {
      console.warn("Could not load cohorts from server, using local cache.", err);
    }
  }
  const cached = JSON.parse(localStorage.getItem("cohorts")) || [];
  renderCohorts(cached);
}

function renderCohorts(cohorts) {
  const list = document.getElementById("cohorts-list");
  list.innerHTML = "";

  if (cohorts.length === 0) {
    list.innerHTML = `<tr><td colspan="5" class="empty-state">No groups registered yet.</td></tr>`;
    return;
  }

  cohorts.forEach((c) => {
    const rate = c.count > 0 ? Math.round((c.completed / c.count) * 100) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${c.count} Learners</td>
      <td>${c.completed}</td>
      <td>${rate}%</td>
      <td>
        <button class="action-btn" style="padding:4px 8px; font-size:11px;"
          onclick="incrementCohortProgress('${c.id}')">Add Completion</button>
      </td>
    `;
    list.appendChild(tr);
  });
}

async function createCohort(e) {
  e.preventDefault();
  const nameInput = document.getElementById("cohort-name");
  const name = nameInput.value.trim();
  if (!name) return;

  const id = crypto.randomUUID ? crypto.randomUUID() : `cohort_${Date.now()}`;
  const cohorts = JSON.parse(localStorage.getItem("cohorts")) || [];
  cohorts.push({ id, name, count: 0, completed: 0 });
  localStorage.setItem("cohorts", JSON.stringify(cohorts));
  nameInput.value = "";
  renderCohorts(cohorts);

  const payload = { id, name };
  if (isServerReachable) {
    const ok = await postJSON(`/cohorts`, payload);
    if (!ok) enqueueSync({ type: "cohort_create", payload });
  } else {
    enqueueSync({ type: "cohort_create", payload });
  }
  updateSyncQueueBadge();
  await refreshStats();
}

async function incrementCohortProgress(id) {
  const cohorts = JSON.parse(localStorage.getItem("cohorts")) || [];
  const cohort = cohorts.find((c) => c.id === id);
  if (!cohort) return;
  cohort.completed += 1;
  localStorage.setItem("cohorts", JSON.stringify(cohorts));
  renderCohorts(cohorts);

  if (isServerReachable) {
    const ok = await postJSON(`/cohorts/${id}/increment`, {});
    if (!ok) enqueueSync({ type: "cohort_increment", payload: { id } });
  } else {
    enqueueSync({ type: "cohort_increment", payload: { id } });
  }
  updateSyncQueueBadge();
  await refreshStats();
}

async function refreshStats() {
  if (isServerReachable) {
    try {
      const res = await fetch(`${API_BASE_URL}/stats`);
      if (!res.ok) throw new Error("Bad response");
      const stats = await res.json();
      renderStats(stats);
      return;
    } catch (err) {
      console.warn("Could not load stats from server, computing locally.", err);
    }
  }
  const cohorts = JSON.parse(localStorage.getItem("cohorts")) || [];
  const totalGroups = cohorts.length;
  const totalLearners = cohorts.reduce((sum, c) => sum + c.count, 0);
  const totalCompletions = cohorts.reduce((sum, c) => sum + c.completed, 0);
  const completionRate = totalLearners > 0 ? Math.round((totalCompletions / totalLearners) * 100) : 0;
  renderStats({ totalGroups, totalLearners, totalCompletions, completionRate });
}

function renderStats(stats) {
  document.getElementById("stat-groups").innerText = stats.totalGroups;
  document.getElementById("stat-learners").innerText = stats.totalLearners;
  document.getElementById("stat-completions").innerText = stats.totalCompletions;
  document.getElementById("stat-rate").innerText = `${stats.completionRate}%`;
}

// ==========================================================================
// Offline SMS / print pack generator
// ==========================================================================
function exportSMSPack() {
  let smsText = "--- SOMA SASA COHORT SMS PACK ---\n";
  courses.forEach((c) => {
    smsText += `\n[REF:${c.id}]\nQ: ${c.title}\nLesson: ${c.lessonContent.substring(0, 100)}...\nQuiz: ${c.quiz.question}\nOptions: ${c.quiz.options.join(" | ")}\n`;
  });
  const blob = new Blob([smsText], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "somasasa_offline_sms_kit.txt";
  link.click();
}

// ==========================================================================
// Small helpers
// ==========================================================================
async function postJSON(path, body) {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}
