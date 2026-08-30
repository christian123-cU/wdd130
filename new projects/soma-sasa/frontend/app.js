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

// Level ordering for the two FLN subjects, used for sorting and placement.
const LITERACY_LEVELS = ["beginner", "word", "paragraph", "story"];
const LITERACY_LEVEL_LABELS = {
  beginner: "Beginner",
  word: "Word Level",
  paragraph: "Paragraph Level",
  story: "Story Level",
};
const NUMERACY_LEVELS = ["1digit", "2digit", "3digit", "multiplication", "division"];
const NUMERACY_LEVEL_LABELS = {
  "1digit": "Number Sense (1-digit)",
  "2digit": "2-Digit Numbers",
  "3digit": "3-Digit Numbers",
  multiplication: "Multiplication",
  division: "Division",
};

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
// Mascot lookup: literacy/numeracy courses are guided by one mascot each
// ==========================================================================
function getMascotForCourse(course) {
  if (course.subcategory === "literacy") return getMascot("herufi");
  if (course.subcategory === "numeracy") return getMascot("nambari");
  return null;
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

  const literacyCourses = sortByLevel(courses.filter((c) => c.subcategory === "literacy"), LITERACY_LEVELS);
  const numeracyCourses = sortByLevel(courses.filter((c) => c.subcategory === "numeracy"), NUMERACY_LEVELS);

  if (literacyCourses.length === 0 && numeracyCourses.length === 0) {
    grid.innerHTML = "<p class='empty-state'>No lessons loaded yet. Please sync when online.</p>";
    return;
  }

  grid.appendChild(renderSubjectSection("📖 Literacy", "literacy", literacyCourses, LITERACY_LEVEL_LABELS));
  grid.appendChild(renderSubjectSection("🔢 Numeracy", "numeracy", numeracyCourses, NUMERACY_LEVEL_LABELS));

  renderBadgeShelf(courses.filter((c) => c.category === "fln"), profile);
}

function sortByLevel(list, levelOrder) {
  return [...list].sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level));
}

function renderSubjectSection(title, subject, subjectCourses, levelLabels) {
  const section = document.createElement("div");
  section.className = "subject-section";

  const recommendedId = getRecommendedCourseId(subject, subjectCourses);

  const header = document.createElement("div");
  header.className = "subject-section-header";
  header.innerHTML = `
    <h3>${title}</h3>
    <button class="mode-back-btn" onclick="openPlacementQuiz('${subject}')">🎯 Find My Level</button>
  `;
  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "grid-layout young-grid";

  subjectCourses.forEach((course) => {
    const mascot = getMascotForCourse(course);
    const completed = getCourseProgress(course.id).completed;
    const isRecommended = course.id === recommendedId && !completed;
    const card = document.createElement("div");
    card.className = "mascot-card";
    card.innerHTML = `
      ${isRecommended ? `<span class="start-here-ribbon">⭐ Start Here</span>` : ""}
      <div class="mascot-card-top">
        <div class="mascot-avatar">${mascot ? mascot.svg : ""}</div>
        <div class="mascot-name-role">
          <h3>${escapeHtml(mascot ? mascot.name : "")}</h3>
          <span>${escapeHtml(mascot ? mascot.role : "")}</span>
        </div>
      </div>
      <span class="level-badge">${escapeHtml(levelLabels[course.level] || course.level || "")}</span>
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

  section.appendChild(grid);
  return section;
}

function renderBadgeShelf(flnCourses, profile) {
  const shelf = document.getElementById("badge-shelf-list");
  shelf.innerHTML = "";
  flnCourses.forEach((course) => {
    const unlocked = profile.badges.includes(course.id);
    const mascot = getMascotForCourse(course);
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
// "Find My Level" placement quiz — self-reported starting level
// ==========================================================================
const PLACEMENT_OPTIONS = {
  literacy: [
    { label: "I don't know letters yet", level: "beginner" },
    { label: "I can read some words", level: "word" },
    { label: "I can read a short paragraph", level: "paragraph" },
    { label: "I can read a whole story", level: "story" },
  ],
  numeracy: [
    { label: "I'm still learning numbers", level: "1digit" },
    { label: "I know 2-digit numbers (10-99)", level: "2digit" },
    { label: "I know 3-digit numbers (100-999)", level: "3digit" },
    { label: "I can subtract, ready for multiplication", level: "multiplication" },
    { label: "I can multiply, ready for division", level: "division" },
  ],
};

function openPlacementQuiz(subject) {
  const options = PLACEMENT_OPTIONS[subject];
  const payload = document.getElementById("placement-payload");
  payload.innerHTML = `
    <h2>Find your ${subject === "literacy" ? "reading" : "number"} level</h2>
    <p class="lesson-content">Pick what feels true right now — you can always change this later.</p>
    <div class="placement-options">
      ${options.map((opt) => `
        <button class="action-btn placement-option-btn" onclick="setPlacementLevel('${subject}', '${opt.level}')">
          ${escapeHtml(opt.label)}
        </button>
      `).join("")}
    </div>
  `;
  document.getElementById("placement-modal").classList.remove("hidden");
}

function closePlacementQuiz() {
  document.getElementById("placement-modal").classList.add("hidden");
}

function setPlacementLevel(subject, level) {
  localStorage.setItem(`${subject}_level`, level);
  closePlacementQuiz();
  renderYoungMode();
}

function getRecommendedCourseId(subject, subjectCourses) {
  const savedLevel = localStorage.getItem(`${subject}_level`);
  if (!savedLevel) return null;
  const match = subjectCourses.find((c) => c.level === savedLevel && !getCourseProgress(c.id).completed);
  return match ? match.id : null;
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
    const typeLabel = { quiz: "Quiz Module", template: "Interactive Template", linkedin: "Message Builder", checklist: "Self-Check" }[course.type] || "Module";
    const actionLabel = {
      quiz: progress.completed ? "Review Module" : "Start Module",
      template: progress.completed ? "Edit Template" : "Fill In Template",
      linkedin: progress.completed ? "Edit Messages" : "Build Messages",
      checklist: progress.completed ? "Review Checklist" : "Start Checklist",
    }[course.type] || "Open";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="course-card-body">
        <span class="level-badge">${typeLabel}</span>
        <h3>${escapeHtml(course.title)}</h3>
        <p>${escapeHtml(course.desc)}</p>
        <div class="course-status-row">
          <span class="badge ${progress.completed ? "online" : "offline"}">
            ${progress.completed ? "Done ✓" : "Not started"}
          </span>
          ${progress.attempts > 0 ? `<span class="badge offline">${progress.attempts} past miss${progress.attempts > 1 ? "es" : ""}</span>` : ""}
        </div>
      </div>
      <button class="action-btn" onclick="startLesson('${course.id}')">${actionLabel}</button>
    `;
    grid.appendChild(card);
  });
}

// Ethio IQ-style rule-based "what to review next" suggestion.
function computeRecommendation(professionalCourses) {
  const notStarted = professionalCourses.filter((c) => !getCourseProgress(c.id).completed);
  if (notStarted.length > 0) {
    const fresh = notStarted.find((c) => getCourseProgress(c.id).attempts === 0);
    const target = fresh || notStarted[0];
    const reason = fresh
      ? "You haven't started this one yet."
      : "You started this earlier but haven't finished — pick it back up.";
    return { course: target, reason };
  }

  const quizCourses = professionalCourses.filter((c) => (c.type || "quiz") === "quiz");
  const struggled = [...quizCourses].sort(
    (a, b) => getCourseProgress(b.id).attempts - getCourseProgress(a.id).attempts
  )[0];
  if (struggled && getCourseProgress(struggled.id).attempts > 0) {
    return { course: struggled, reason: "You found this tricky earlier — a quick review will lock it in." };
  }
  return null;
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
// Lesson modal — dispatches by course.type: quiz | template | linkedin | checklist
// ==========================================================================
function startLesson(id) {
  const course = courses.find((c) => c.id === id);
  if (!course) return;
  const type = course.type || "quiz";

  if (type === "template") return startTemplateLesson(course);
  if (type === "linkedin") return startLinkedInLesson(course);
  if (type === "checklist") return startChecklistLesson(course);
  return startQuizLesson(course);
}

function closeLesson() {
  document.getElementById("lesson-modal").classList.add("hidden");
}

// ---- Quiz lessons (FLN + simple professional courses) ----
function startQuizLesson(course) {
  currentQuizAttempts = 0;
  const mascot = getMascotForCourse(course);
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

function evaluateAnswer(courseId, selectedIndex, correctIndex) {
  const course = courses.find((c) => c.id === courseId);
  const mascot = getMascotForCourse(course);
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

// ---- Template lessons (fill-in resume/cover letter/worksheets) ----
function getTemplateData(courseId) {
  return JSON.parse(localStorage.getItem(`template_data_${courseId}`)) || {};
}

function saveTemplateData(courseId, data) {
  localStorage.setItem(`template_data_${courseId}`, JSON.stringify(data));
}

function startTemplateLesson(course) {
  const saved = getTemplateData(course.id);
  const payload = document.getElementById("lesson-payload");
  payload.innerHTML = `
    <h2 id="lesson-title">${escapeHtml(course.title)}</h2>
    <p class="lesson-content">${escapeHtml(course.desc)}</p>
    <div class="template-form">
      ${course.templateFields.map((field) => `
        <label for="tf_${field.id}">${escapeHtml(field.label)}</label>
        ${field.multiline
          ? `<textarea id="tf_${field.id}" rows="3" placeholder="${escapeHtml(field.placeholder || "")}" oninput="updateTemplatePreview('${course.id}')">${escapeHtml(saved[field.id] || "")}</textarea>`
          : `<input type="text" id="tf_${field.id}" placeholder="${escapeHtml(field.placeholder || "")}" value="${escapeHtml(saved[field.id] || "")}" oninput="updateTemplatePreview('${course.id}')">`
        }
      `).join("")}
    </div>
    <h3 class="template-preview-heading">Preview</h3>
    <div id="template-preview" class="template-preview"></div>
    <div class="template-actions">
      <button class="action-btn secondary" onclick="copyTemplateOutput()">Copy</button>
      <button class="action-btn secondary" onclick="downloadTemplateOutput('${course.id}')">Download .txt</button>
      <button class="action-btn" onclick="completeTemplateLesson('${course.id}')">Save & Mark Complete</button>
    </div>
  `;
  document.getElementById("lesson-modal").classList.remove("hidden");
  updateTemplatePreview(course.id);
}

function updateTemplatePreview(courseId) {
  const course = courses.find((c) => c.id === courseId);
  const data = {};
  course.templateFields.forEach((field) => {
    const el = document.getElementById(`tf_${field.id}`);
    data[field.id] = el ? el.value : "";
  });
  saveTemplateData(courseId, data);

  let output = course.templateOutput;
  course.templateFields.forEach((field) => {
    const value = data[field.id] && data[field.id].trim() ? data[field.id] : `[${field.label}]`;
    output = output.split(`{{${field.id}}}`).join(value);
  });

  const preview = document.getElementById("template-preview");
  if (preview) preview.textContent = output;
}

function copyTemplateOutput() {
  const text = document.getElementById("template-preview").textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

function downloadTemplateOutput(courseId) {
  const text = document.getElementById("template-preview").textContent;
  const blob = new Blob([text], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${courseId}.txt`;
  link.click();
}

async function completeTemplateLesson(courseId) {
  await markComplete(courseId);
  closeLesson();
  if (currentStudentMode === "skills") renderSkillsMode();
}

// ---- LinkedIn message builder (special-cased: scenario picker + free editor) ----
function startLinkedInLesson(course) {
  const savedText = localStorage.getItem(`linkedin_editor_${course.id}`) || "";
  const payload = document.getElementById("lesson-payload");
  payload.innerHTML = `
    <h2 id="lesson-title">${escapeHtml(course.title)}</h2>
    <p class="lesson-content">${escapeHtml(course.desc)}</p>
    <div class="linkedin-scenarios">
      ${course.scenarios.map((s, i) => `
        <button class="filter-btn" onclick="loadLinkedInScenario('${course.id}', ${i})">${escapeHtml(s.label)}</button>
      `).join("")}
    </div>
    <label for="linkedin-editor" style="display:block; margin-top:14px; font-size:13px; font-weight:600; color:var(--primary-color);">Your message (fill in the brackets):</label>
    <textarea id="linkedin-editor" rows="6" oninput="saveLinkedInEditor('${course.id}')">${escapeHtml(savedText)}</textarea>
    <div class="template-actions">
      <button class="action-btn secondary" onclick="copyLinkedInEditor()">Copy</button>
      <button class="action-btn" onclick="completeTemplateLesson('${course.id}')">Save & Mark Complete</button>
    </div>
  `;
  document.getElementById("lesson-modal").classList.remove("hidden");
}

function loadLinkedInScenario(courseId, index) {
  const course = courses.find((c) => c.id === courseId);
  const scenario = course.scenarios[index];
  const editor = document.getElementById("linkedin-editor");
  editor.value = scenario.text;
  saveLinkedInEditor(courseId);
}

function saveLinkedInEditor(courseId) {
  const editor = document.getElementById("linkedin-editor");
  localStorage.setItem(`linkedin_editor_${courseId}`, editor.value);
}

function copyLinkedInEditor() {
  const text = document.getElementById("linkedin-editor").value;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

// ---- Checklist lessons (self-check + facilitator rubric criteria) ----
function getChecklistState(courseId) {
  return JSON.parse(localStorage.getItem(`checklist_state_${courseId}`)) || {};
}

function saveChecklistState(courseId, state) {
  localStorage.setItem(`checklist_state_${courseId}`, JSON.stringify(state));
}

function startChecklistLesson(course) {
  const state = getChecklistState(course.id);
  const payload = document.getElementById("lesson-payload");
  payload.innerHTML = `
    <h2 id="lesson-title">${escapeHtml(course.title)}</h2>
    <p class="lesson-content">${escapeHtml(course.desc)}</p>
    <div class="checklist-list">
      ${course.checklistItems.map((item) => `
        <label class="checklist-item">
          <input type="checkbox" id="cl_${item.id}" ${state[item.id] ? "checked" : ""}
            onchange="toggleChecklistItem('${course.id}', '${item.id}')">
          <span>${escapeHtml(item.label)}</span>
        </label>
      `).join("")}
    </div>
    <p id="checklist-progress" class="quiz-attempts"></p>
  `;
  document.getElementById("lesson-modal").classList.remove("hidden");
  updateChecklistProgress(course.id);
}

function toggleChecklistItem(courseId, itemId) {
  const state = getChecklistState(courseId);
  const checkbox = document.getElementById(`cl_${itemId}`);
  state[itemId] = checkbox.checked;
  saveChecklistState(courseId, state);
  updateChecklistProgress(courseId);
}

async function updateChecklistProgress(courseId) {
  const course = courses.find((c) => c.id === courseId);
  const state = getChecklistState(courseId);
  const checkedCount = course.checklistItems.filter((item) => state[item.id]).length;
  const total = course.checklistItems.length;
  const progressEl = document.getElementById("checklist-progress");
  if (progressEl) progressEl.innerText = `${checkedCount} of ${total} checked`;

  if (checkedCount === total && !getCourseProgress(courseId).completed) {
    await markComplete(courseId);
    if (currentStudentMode === "skills") renderSkillsMode();
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
  if (profile.lastActiveDate === today) return;

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
// Offline SMS / print pack generator (courses)
// ==========================================================================
function exportSMSPack() {
  let smsText = "--- SOMA SASA COHORT SMS PACK ---\n";
  courses.forEach((c) => {
    if (c.type && c.type !== "quiz") return; // only quiz-style lessons fit the SMS format
    smsText += `\n[REF:${c.id}]\nQ: ${c.title}\nLesson: ${c.lessonContent.substring(0, 100)}...\nQuiz: ${c.quiz.question}\nOptions: ${c.quiz.options.join(" | ")}\n`;
  });
  downloadText(smsText, "somasasa_offline_sms_kit.txt");
}

// ==========================================================================
// Facilitator Activity Guide — curated TaRL activities (numeracy + literacy)
// These are in-person, group-led activities that don't map to app quizzes,
// so they're exported as a reference guide for facilitators instead.
// ==========================================================================
function exportActivityGuide() {
  const text = `--- SOMA SASA FACILITATOR ACTIVITY GUIDE ---
Based on the Teaching at the Right Level (TaRL) approach.

======================
NUMERACY — Level Groups
======================
Group 1 (Beginner + 1-digit): Numbers with Bundle & Sticks, Number Chart Reading, Number Wheel, Clap & Snap
Group 2 (2-digit + 3-digit): Expansion Chart Reading, Numbers with Play Money, Number Wheel (3 circles)
Group 3 (Subtraction + Division): Oral Addition & Subtraction, Multiplication Box Method, Division with Sticks

KEY ACTIVITY — Numbers with Bundle & Sticks
Objective: Recognize numbers 1-99 and understand place value (ones/tens).
Materials: Sticks, rubber bands, chalk, 1-100 number chart.
1. Pick up a handful of sticks; learners guess the count, then count aloud together.
2. Introduce the rule: 10 sticks = 1 bundle = 10 (tens).
3. Draw a place-value frame (Bundles | Sticks); fill it in and read the number.
4. Small groups quiz each other: "In 36, how many bundles and sticks?"

KEY ACTIVITY — Solving Word Problems (The Four Questions)
Whenever you introduce a word problem, walk learners through:
  1. What information is given?
  2. What is being asked?
  3. What do I need to do?
  4. Why?
Then solve step-by-step together using sticks or play money, and write the answer as a full sentence.

KEY ACTIVITY — Clap & Snap
Objective: Recognize place value in 2- or 3-digit numbers, no materials needed.
1 clap = 10 (tens), 1 snap = 1 (one). Demonstrate a number (e.g. 2 claps + 3 snaps = 23), then reverse the
game: say a number and have a learner clap/snap it correctly.

======================
LITERACY — Level Groups
======================
Group 1 (Beginner + Letter): Jolly Phonics sound groups, Word Diary, Letter Jump, Picture Card Reading
Group 2 (Word + Paragraph): Sentence Diary, Rhyming Words, Paragraph Booklet Reading, Matching Words & Pictures
Group 3 (Story): Story Booklet Reading, Re-telling a Story, Picture Card Story Building

KEY ACTIVITY — Jolly Phonics Sound Groups (teach in this order, not all at once)
  1. s, a, t, p, i, n        5. z, w, ng, v, oo
  2. ck, e, h, r, m, d        6. y, x, ch, sh, th
  3. g, o, u, l, f, b         7. qu, ou, oi, ue, er, ar
  4. ai, j, oa, ie, ee, or
Read the sounds first, read them together with learners, then let learners read on their own.

KEY ACTIVITY — Word Diary / Sentence Diary
Fold five sheets of paper in half, staple the spine to make a booklet, then snip the pages into
thirds (Word Diary) or halves (Sentence Diary) so each strip reveals part of a word or sentence.
Open one strip at a time and read the new word/sentence it makes — a simple, reusable reveal format.

KEY ACTIVITY — Story Booklet Reading (whole class, daily)
1. Discuss the title and let learners predict the plot.
2. Read the story aloud, pointing at each word, while learners follow with a finger.
3. Invite learners to read it back, a few sentences each.
4. Ask 1-2 comprehension questions and discuss what the story teaches.

======================
CLASSROOM SETUP NOTES
======================
- Seat learners in a semicircle or U-shape so everyone can see demonstrations.
- Whole-class activities first, then break into level groups, then individual practice.
- Session rules: listen carefully, raise your hand, answer in full sentences.
- Assess every 10 days and re-group learners as they progress — never lock a learner into
  a level permanently.
`;
  downloadText(text, "soma_sasa_facilitator_activity_guide.txt");
}

// ==========================================================================
// Facilitator Assessment Rubric — mirrors the learner self-check criteria
// ==========================================================================
function exportRubric() {
  const checklistCourse = courses.find((c) => c.id === "prof_checklist");
  const items = checklistCourse ? checklistCourse.checklistItems : [];
  let text = "--- SOMA SASA APPLICATION ASSESSMENT RUBRIC (Facilitator Copy) ---\n";
  text += "Use this to score a learner's resume, cover letter, and LinkedIn profile.\n\n";
  items.forEach((item, i) => {
    text += `[ ] ${i + 1}. ${item.label}\n`;
  });
  text += "\nScore: ___ / " + items.length + "\nNotes:\n";
  downloadText(text, "soma_sasa_facilitator_assessment_rubric.txt");
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
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
