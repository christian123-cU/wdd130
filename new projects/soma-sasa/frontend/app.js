// ==========================================================================
// Soma Sasa — Progressive Engine & Synchronization Controller
// ==========================================================================
// Two content systems:
//   - Young Learner Zone (literacy + numeracy): driven by fln_curriculum.json,
//     a fully leveled, assessment-gated curriculum (see below).
//   - Skills & Work Zone (professional): driven by courses.json, unchanged
//     quiz/template/linkedin/checklist lesson types from before.
//
// REST contract (see backend/server.js):
//   GET  /api/health
//   GET  /api/courses                        (professional/skills modules)
//   GET  /api/curriculum                     (FLN literacy+numeracy curriculum)
//   GET  /api/students                       (roster, for teacher dashboard)
//   GET  /api/students/:deviceId
//   POST /api/students/:deviceId             (name, levels, progress, stars/streak/badges)
//   GET  /api/students/:deviceId/progress    (professional module progress)
//   POST /api/students/:deviceId/progress    { courseId, completed, attempts }
//   GET  /api/cohorts, POST /api/cohorts, POST /api/cohorts/:id/increment, GET /api/stats
// ==========================================================================

const API_BASE_URL = "http://localhost:3001/api";
const HEALTH_TIMEOUT_MS = 2500;
const TEACHER_PASSWORD = "SomaSasa@123"; // stub password, for now

const LITERACY_LEVELS = ["beginner", "letter", "word", "paragraph", "story"];
const NUMERACY_LEVELS = ["numberRecognition", "addition", "subtraction", "multiplication", "division"];
const LEVEL_LABELS = {
  beginner: "Beginner", letter: "Letter", word: "Word", paragraph: "Paragraph", story: "Story",
  numberRecognition: "Number Recognition", addition: "Addition", subtraction: "Subtraction",
  multiplication: "Multiplication", division: "Division",
};

// ---- Global platform state ----
let courses = [];              // Skills & Work Zone (professional) content
let curriculum = null;         // Young Learner Zone (literacy + numeracy) content
let isServerReachable = false;
let currentQuizAttempts = 0;   // Skills Zone quiz retry counter
let currentStudentMode = null; // 'young' | 'skills' | null

let activeSubject = null;      // 'literacy' | 'numeracy'
let activeLevelId = null;
let activeLessonIndex = 0;
let assessmentState = null;    // transient state during an assessment run

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
if (!localStorage.getItem("student_progress")) localStorage.setItem("student_progress", JSON.stringify({}));
if (!localStorage.getItem("learner_profile")) {
  localStorage.setItem("learner_profile", JSON.stringify({ totalStars: 0, streak: 0, lastActiveDate: null, badges: [] }));
}
if (!localStorage.getItem("sync_queue")) localStorage.setItem("sync_queue", JSON.stringify([]));
if (!localStorage.getItem("literacy_progress")) localStorage.setItem("literacy_progress", JSON.stringify({}));
if (!localStorage.getItem("numeracy_progress")) localStorage.setItem("numeracy_progress", JSON.stringify({}));

// ==========================================================================
// Bootstrap
// ==========================================================================
document.addEventListener("DOMContentLoaded", async () => {
  window.addEventListener("online", refreshConnectionState);
  window.addEventListener("offline", refreshConnectionState);

  await refreshConnectionState();
  await loadCourseDB();
  await loadCurriculum();
  await loadProgressFromServer();
  await loadStudentFromServer();
  await refreshCohorts();
  await refreshStats();

  if (localStorage.getItem("registration_done") === "true") {
    finishBootAfterRegistration();
  } else {
    activatePane("registration-screen");
  }
});

function finishBootAfterRegistration() {
  activatePane("student-view");
  const name = localStorage.getItem("student_name");
  document.getElementById("mode-chooser-greeting").innerText = name
    ? `Karibu, ${name}! Which path are you on today?`
    : "Which path are you on today?";
  showModeChooser();
}

function activatePane(id) {
  document.querySelectorAll(".view-pane").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ==========================================================================
// Registration
// ==========================================================================
async function completeRegistration(anonymous) {
  const nameInput = document.getElementById("registration-name");
  const name = anonymous ? null : (nameInput.value.trim() || null);
  localStorage.setItem("registration_done", "true");
  localStorage.setItem("student_name", name || "");
  localStorage.setItem("is_anonymous", (!name).toString());
  await syncStudentRecord();
  finishBootAfterRegistration();
}

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
  if (isServerReachable) await syncPendingWrites();
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
// Content loading: server is authoritative when reachable, else static file
// ==========================================================================
async function loadCourseDB() {
  if (isServerReachable) {
    try {
      const res = await fetch(`${API_BASE_URL}/courses`);
      if (!res.ok) throw new Error("Bad response");
      courses = await res.json();
      localStorage.setItem("cached_courses", JSON.stringify(courses));
      return;
    } catch (err) { console.warn("Server course fetch failed, falling back.", err); }
  }
  try {
    const response = await fetch("courses.json");
    courses = await response.json();
    localStorage.setItem("cached_courses", JSON.stringify(courses));
  } catch (error) {
    courses = JSON.parse(localStorage.getItem("cached_courses")) || [];
  }
}

async function loadCurriculum() {
  if (isServerReachable) {
    try {
      const res = await fetch(`${API_BASE_URL}/curriculum`);
      if (!res.ok) throw new Error("Bad response");
      curriculum = await res.json();
      localStorage.setItem("cached_curriculum", JSON.stringify(curriculum));
      return;
    } catch (err) { console.warn("Server curriculum fetch failed, falling back.", err); }
  }
  try {
    const response = await fetch("fln_curriculum.json");
    curriculum = await response.json();
    localStorage.setItem("cached_curriculum", JSON.stringify(curriculum));
  } catch (error) {
    curriculum = JSON.parse(localStorage.getItem("cached_curriculum")) || { literacy: { levels: [] }, numeracy: { levels: [] } };
  }
}

// ==========================================================================
// Top-level view switching (Student Portal <-> Teacher Facilitator)
// ==========================================================================
function switchView(target) {
  if (localStorage.getItem("registration_done") !== "true") return; // gate until registered
  activatePane(`${target}-view`);
  document.querySelectorAll(".nav-btn").forEach((el) => el.classList.remove("active"));
  document.getElementById(`btn-${target}-view`).classList.add("active");
  if (target === "teacher") enterTeacherView();
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
  if (mode === "young") showSubjectChooser();
  if (mode === "skills") renderSkillsMode();
}

function getMascotForSubject(subject) {
  return getMascot(subject === "literacy" ? "herufi" : "nambari");
}

// ==========================================================================
// YOUNG LEARNER ZONE — screen switching helper
// ==========================================================================
function showYoungScreen(id) {
  document.querySelectorAll(".young-screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function refreshYoungStatsHeader() {
  const profile = getLearnerProfile();
  document.getElementById("young-stars").innerText = profile.totalStars;
  document.getElementById("young-streak").innerText = profile.streak;
}

// ==========================================================================
// SUBJECT CHOOSER
// ==========================================================================
function showSubjectChooser() {
  refreshYoungStatsHeader();
  showYoungScreen("subject-chooser");
  renderSubjectCards();
}

function renderSubjectCards() {
  const container = document.getElementById("subject-cards");
  container.innerHTML = "";
  ["literacy", "numeracy"].forEach((subject) => {
    const mascot = getMascotForSubject(subject);
    const assessed = localStorage.getItem(`${subject}_assessed`) === "true";
    const level = localStorage.getItem(`${subject}_level`);
    const card = document.createElement("button");
    card.className = `mode-card ${subject === "literacy" ? "mode-card-young" : "mode-card-skills"}`;
    card.onclick = () => (assessed ? openLevelRoadmap(subject) : startAssessmentIntro(subject));
    card.innerHTML = `
      <span class="mode-card-emoji" aria-hidden="true">${subject === "literacy" ? "📖" : "🔢"}</span>
      <h3>${subject === "literacy" ? "Literacy" : "Numeracy"}</h3>
      ${assessed
        ? `<p>Placed at: <strong>${escapeHtml(LEVEL_LABELS[level] || level)}</strong> — tap to continue learning.</p>`
        : `<p>Take a short placement quiz with ${escapeHtml(mascot.name)} to find your starting level.</p>`}
    `;
    container.appendChild(card);
  });
}

// ==========================================================================
// ASSESSMENT ENGINE
// ==========================================================================
function startAssessmentIntro(subject) {
  activeSubject = subject;
  showYoungScreen("assessment-flow");
  const mascot = getMascotForSubject(subject);
  const payload = document.getElementById("assessment-payload");
  payload.innerHTML = `
    <div class="mascot-card-top" style="margin-bottom:10px;">
      <div class="mascot-avatar">${mascot.svg}</div>
      <div class="mascot-name-role"><h3 style="margin:0;">${escapeHtml(mascot.name)}</h3></div>
    </div>
    <h2>Let's find your ${subject === "literacy" ? "reading" : "number"} level</h2>
    <p class="lesson-content">
      ${subject === "literacy"
        ? "You'll be shown letters, then words, then a paragraph, then a story — each step gets a little harder. We'll stop as soon as we find your comfortable level."
        : "You'll work through numbers, addition, subtraction, multiplication, division, and two word problems. Just do your best on every question — this helps us find exactly where to start."}
    </p>
    <button class="action-btn" onclick="${subject === "literacy" ? "runLiteracyAssessmentStep('letters')" : "beginNumeracyAssessment()"}">Begin Assessment</button>
  `;
}

// ---- Literacy assessment (adaptive, stops at first failure) ----
function runLiteracyAssessmentStep(step) {
  const bank = curriculum.literacy.assessment;
  const payload = document.getElementById("assessment-payload");

  if (step === "letters" || step === "words") {
    const items = bank[step];
    assessmentState = { step, selected: [] };
    payload.innerHTML = `
      <h2>${step === "letters" ? "Pick 5 letters you can read" : "Pick 5 words you can read"}</h2>
      <p class="lesson-content">Tap the ${step === "letters" ? "letters" : "words"} you feel confident about.</p>
      <div class="assessment-chip-grid" id="assessment-chip-grid">
        ${items.map((item, i) => `
          <button class="assessment-chip" data-index="${i}" onclick="toggleAssessmentChip(${i})">${escapeHtml(step === "letters" ? item.letter : item.word)}</button>
        `).join("")}
      </div>
      <p id="assessment-chip-count" class="quiz-attempts">0 of 5 selected</p>
      <button class="action-btn hidden" id="assessment-chip-continue" onclick="verifyLiteracySelection('${step}')">Continue</button>
    `;
    return;
  }

  if (step === "paragraphs") {
    payload.innerHTML = `
      <h2>Pick one paragraph to read</h2>
      <div class="grid-layout">
        ${bank.paragraphs.map((p, i) => `
          <div class="card">
            <p style="font-size:13px;">${escapeHtml(p.text)}</p>
            <button class="action-btn" onclick="readLiteracyParagraph(${i})">I'll read this one</button>
          </div>
        `).join("")}
      </div>
    `;
    return;
  }

  if (step === "story") {
    const story = bank.story;
    assessmentState = { step: "story", answers: {} };
    payload.innerHTML = `
      <h2>Read the story, then answer</h2>
      <p class="lesson-content">${escapeHtml(story.text)}</p>
      <div id="assessment-questions">
        ${story.questions.map((q, i) => renderAssessmentQuestion(q, i)).join("")}
      </div>
      <button class="action-btn" onclick="submitLiteracyComprehension('story')">Submit Answers</button>
    `;
  }
}

function toggleAssessmentChip(index) {
  const btn = document.querySelector(`.assessment-chip[data-index="${index}"]`);
  const alreadySelected = assessmentState.selected.includes(index);
  if (alreadySelected) {
    assessmentState.selected = assessmentState.selected.filter((i) => i !== index);
    btn.classList.remove("selected");
  } else if (assessmentState.selected.length < 5) {
    assessmentState.selected.push(index);
    btn.classList.add("selected");
  }
  document.getElementById("assessment-chip-count").innerText = `${assessmentState.selected.length} of 5 selected`;
  document.getElementById("assessment-chip-continue").classList.toggle("hidden", assessmentState.selected.length !== 5);
}

function verifyLiteracySelection(step) {
  const bank = curriculum.literacy.assessment;
  const items = bank[step];
  const selectedItems = assessmentState.selected.map((i) => items[i]);
  assessmentState = { step, verifyItems: selectedItems, answers: {} };
  const payload = document.getElementById("assessment-payload");
  payload.innerHTML = `
    <h2>Quick check</h2>
    <p class="lesson-content">Answer these to confirm you can read the ${step} you picked.</p>
    <div id="assessment-questions">
      ${selectedItems.map((item, i) => renderAssessmentQuestion(item.check, i)).join("")}
    </div>
    <button class="action-btn" onclick="submitLiteracyVerification('${step}')">Submit</button>
  `;
}

function renderAssessmentQuestion(q, index) {
  return `
    <div class="interactive-quiz" style="margin-bottom:12px;">
      <p class="quiz-question">${escapeHtml(q.question)}</p>
      ${q.options.map((opt, oi) => `
        <button class="quiz-option" onclick="selectAssessmentAnswer(${index}, ${oi}, this)">${escapeHtml(opt)}</button>
      `).join("")}
    </div>
  `;
}

function selectAssessmentAnswer(questionIndex, optionIndex, btn) {
  assessmentState.answers[questionIndex] = optionIndex;
  btn.parentElement.querySelectorAll(".quiz-option").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
}

function submitLiteracyVerification(step) {
  const items = assessmentState.verifyItems;
  let correct = 0;
  items.forEach((item, i) => {
    if (assessmentState.answers[i] === item.check.correctIndex) correct += 1;
  });
  const passed = correct >= 4;
  if (step === "letters") {
    if (passed) runLiteracyAssessmentStep("words");
    else finalizeLiteracyAssessment("beginner");
  } else if (step === "words") {
    if (passed) runLiteracyAssessmentStep("paragraphs");
    else finalizeLiteracyAssessment("letter");
  }
}

let selectedParagraphIndex = 0;
function readLiteracyParagraph(index) {
  selectedParagraphIndex = index;
  const p = curriculum.literacy.assessment.paragraphs[index];
  assessmentState = { step: "paragraph", answers: {} };
  const payload = document.getElementById("assessment-payload");
  payload.innerHTML = `
    <h2>Answer these questions</h2>
    <p class="lesson-content">${escapeHtml(p.text)}</p>
    <div id="assessment-questions">
      ${p.questions.map((q, i) => renderAssessmentQuestion(q, i)).join("")}
    </div>
    <button class="action-btn" onclick="submitLiteracyComprehension('paragraph')">Submit Answers</button>
  `;
}

function submitLiteracyComprehension(step) {
  const questions = step === "paragraph"
    ? curriculum.literacy.assessment.paragraphs[selectedParagraphIndex].questions
    : curriculum.literacy.assessment.story.questions;
  let correct = 0;
  questions.forEach((q, i) => { if (assessmentState.answers[i] === q.correctIndex) correct += 1; });
  const passed = correct === questions.length;
  if (step === "paragraph") {
    if (passed) runLiteracyAssessmentStep("story");
    else finalizeLiteracyAssessment("word");
  } else {
    finalizeLiteracyAssessment(passed ? "story" : "paragraph");
  }
}

async function finalizeLiteracyAssessment(level) {
  localStorage.setItem("literacy_assessed", "true");
  localStorage.setItem("literacy_level", level);
  await syncStudentRecord();
  showAssessmentResult("literacy", level);
}

// ---- Numeracy assessment (continues through all sections; level = first mistake) ----
function beginNumeracyAssessment() {
  const bank = curriculum.numeracy.assessment;
  const items = [
    ...bank.numberRecognition.map((q) => ({ section: "numberRecognition", q })),
    ...bank.addition.map((q) => ({ section: "addition", q })),
    ...bank.subtraction.map((q) => ({ section: "subtraction", q })),
    ...bank.multiplication.map((q) => ({ section: "multiplication", q })),
    ...bank.division.map((q) => ({ section: "division", q })),
    ...bank.wordProblems.map((wp) => ({ section: wp.section, q: wp.check })),
  ];
  assessmentState = { items, index: 0, sectionMistakes: {} };
  renderNumeracyAssessmentItem();
}

function renderNumeracyAssessmentItem() {
  const { items, index } = assessmentState;
  const payload = document.getElementById("assessment-payload");
  if (index >= items.length) return finalizeNumeracyAssessment();

  const current = items[index];
  payload.innerHTML = `
    <p class="quiz-attempts">Question ${index + 1} of ${items.length}</p>
    <div class="interactive-quiz">
      <p class="quiz-question">${escapeHtml(current.q.question)}</p>
      ${current.q.options.map((opt, oi) => `
        <button class="quiz-option" onclick="answerNumeracyAssessmentItem(${oi})">${escapeHtml(opt)}</button>
      `).join("")}
    </div>
  `;
}

function answerNumeracyAssessmentItem(optionIndex) {
  const { items, index, sectionMistakes } = assessmentState;
  const current = items[index];
  if (optionIndex !== current.q.correctIndex) sectionMistakes[current.section] = true;
  assessmentState.index += 1;
  renderNumeracyAssessmentItem();
}

async function finalizeNumeracyAssessment() {
  const { sectionMistakes } = assessmentState;
  let level = NUMERACY_LEVELS.find((lvl) => sectionMistakes[lvl]);
  if (!level) level = "division"; // ceiling: zero mistakes anywhere
  localStorage.setItem("numeracy_assessed", "true");
  localStorage.setItem("numeracy_level", level);
  await syncStudentRecord();
  showAssessmentResult("numeracy", level);
}

function showAssessmentResult(subject, level) {
  const mascot = getMascotForSubject(subject);
  const levelObj = curriculum[subject].levels.find((l) => l.id === level);
  const payload = document.getElementById("assessment-payload");
  payload.innerHTML = `
    <div class="mascot-card-top" style="margin-bottom:10px;">
      <div class="mascot-avatar">${mascot.svg}</div>
      <div class="mascot-name-role"><h3 style="margin:0;">${escapeHtml(mascot.name)}</h3></div>
    </div>
    <h2>You've been placed at: ${escapeHtml(LEVEL_LABELS[level] || level)}</h2>
    <p class="lesson-content">${escapeHtml(levelObj ? levelObj.description : "")}</p>
    <button class="action-btn" onclick="openLevelRoadmap('${subject}')">Start Learning</button>
  `;
}

// ==========================================================================
// LEVEL ROADMAP
// ==========================================================================
function openLevelRoadmap(subject) {
  activeSubject = subject;
  showYoungScreen("level-roadmap");
  refreshYoungStatsHeader();
  document.getElementById("roadmap-title").innerText = subject === "literacy" ? "📖 Literacy Levels" : "🔢 Numeracy Levels";
  renderRoadmap(subject);
  renderBadgeShelf();
}

function getSubjectProgress(subject) {
  return JSON.parse(localStorage.getItem(`${subject}_progress`)) || {};
}

function saveSubjectProgress(subject, progress) {
  localStorage.setItem(`${subject}_progress`, JSON.stringify(progress));
}

function isLevelUnlocked(subject, levelOrder, index) {
  const assessedLevel = localStorage.getItem(`${subject}_level`);
  const assessedIndex = levelOrder.indexOf(assessedLevel);
  if (index <= assessedIndex) return true;
  const progress = getSubjectProgress(subject);
  const prevLevelId = levelOrder[index - 1];
  return !!(progress[prevLevelId] && progress[prevLevelId].testPassed);
}

function renderRoadmap(subject) {
  const levelOrder = subject === "literacy" ? LITERACY_LEVELS : NUMERACY_LEVELS;
  const levels = curriculum[subject].levels;
  const progress = getSubjectProgress(subject);
  const assessedLevel = localStorage.getItem(`${subject}_level`);
  const assessedIndex = levelOrder.indexOf(assessedLevel);

  const container = document.getElementById("roadmap-cards");
  container.innerHTML = "";

  levelOrder.forEach((levelId, index) => {
    const level = levels.find((l) => l.id === levelId);
    if (!level) return;
    const unlocked = isLevelUnlocked(subject, levelOrder, index);
    const testPassed = !!(progress[levelId] && progress[levelId].testPassed);
    const alreadyKnown = index < assessedIndex;

    let statusLabel, statusClass, actionLabel, disabled = false;
    if (alreadyKnown) { statusLabel = "Already Know This ✓"; statusClass = "mastered"; actionLabel = "Review (optional)"; }
    else if (testPassed) { statusLabel = "Completed ✓"; statusClass = "completed"; actionLabel = "Review"; }
    else if (unlocked) { statusLabel = "Current Level"; statusClass = "current"; actionLabel = "Start Studying"; }
    else { statusLabel = "🔒 Locked"; statusClass = "locked"; actionLabel = "Locked"; disabled = true; }

    const lessonsCompleted = (progress[levelId] && progress[levelId].lessonsCompleted) || [];
    if (unlocked && !testPassed && !alreadyKnown && lessonsCompleted.length > 0) actionLabel = "Continue Studying";

    const card = document.createElement("div");
    card.className = `roadmap-card roadmap-${statusClass}`;
    card.innerHTML = `
      <div class="roadmap-card-header">
        <span class="roadmap-level-number">${index + 1}</span>
        <div>
          <h3>${escapeHtml(level.name)}</h3>
          <span class="level-badge">${statusLabel}</span>
        </div>
      </div>
      <p>${escapeHtml(level.description)}</p>
      <button class="action-btn" ${disabled ? "disabled" : ""} onclick="openLevelLessons('${subject}', '${levelId}')">${actionLabel}</button>
    `;
    container.appendChild(card);
  });
}

function renderBadgeShelf() {
  const profile = getLearnerProfile();
  const shelf = document.getElementById("badge-shelf-list");
  shelf.innerHTML = "";
  [["literacy", LITERACY_LEVELS], ["numeracy", NUMERACY_LEVELS]].forEach(([subject, levels]) => {
    const mascot = getMascotForSubject(subject);
    levels.forEach((levelId) => {
      const badgeKey = `${subject}_${levelId}`;
      const unlocked = profile.badges.includes(badgeKey);
      const item = document.createElement("div");
      item.className = `badge-item ${unlocked ? "unlocked" : ""}`;
      item.innerHTML = `<span class="badge-icon">${unlocked ? "🏅" : "🔒"}</span>${escapeHtml(LEVEL_LABELS[levelId])} (${escapeHtml(mascot.name)})`;
      shelf.appendChild(item);
    });
  });
}

// ==========================================================================
// LESSON VIEWER
// ==========================================================================
function openLevelLessons(subject, levelId) {
  activeSubject = subject;
  activeLevelId = levelId;
  const progress = getSubjectProgress(subject);
  const lessonsCompleted = (progress[levelId] && progress[levelId].lessonsCompleted) || [];
  activeLessonIndex = Math.min(lessonsCompleted.length, 6);
  showYoungScreen("lesson-viewer");
  renderLessonViewer();
}

function exitLessonViewer() {
  showYoungScreen("level-roadmap");
  renderRoadmap(activeSubject);
}

function currentLevel() {
  return curriculum[activeSubject].levels.find((l) => l.id === activeLevelId);
}

function renderLessonViewer() {
  const level = currentLevel();
  const lesson = level.lessons[activeLessonIndex];
  document.getElementById("lesson-progress-label").innerText = `Lesson ${activeLessonIndex + 1} of ${level.lessons.length}`;
  renderLessonIntro(lesson);
}

function renderLessonIntro(lesson) {
  const mascot = getMascotForSubject(activeSubject);
  const payload = document.getElementById("lesson-viewer-payload");
  let hookHtml = "";

  if (lesson.introType === "letter_reveal") {
    hookHtml = `<div class="intro-pop-row">${lesson.data.letters.map((l, i) =>
      `<span class="intro-pop-chip" style="animation-delay:${i * 0.12}s">${escapeHtml(l)}</span>`).join("")}</div>`;
  } else if (lesson.introType === "word_build_hook") {
    const word = lesson.data.words[0];
    hookHtml = `<div class="intro-pop-row">${word.split("").map((ch, i) =>
      `<span class="intro-pop-chip" style="animation-delay:${i * 0.15}s">${escapeHtml(ch)}</span>`).join("")}</div>`;
  } else if (lesson.introType === "number_reveal") {
    const nums = (lesson.data.numbers || []).slice(0, 6);
    hookHtml = `<div class="intro-pop-row">${nums.map((n, i) =>
      `<span class="intro-pop-chip" style="animation-delay:${i * 0.15}s">${escapeHtml(String(n))}</span>`).join("")}</div>`;
  } else if (lesson.introType === "segment_hook") {
    hookHtml = `<p class="intro-teaser">${escapeHtml(lesson.data.teaser || "")}</p>`;
  }

  payload.innerHTML = `
    <div class="mascot-card-top" style="margin-bottom:10px;">
      <div class="mascot-avatar">${mascot.svg}</div>
      <div class="mascot-name-role"><h3 style="margin:0;">${escapeHtml(mascot.name)}</h3></div>
    </div>
    <h2>${escapeHtml(lesson.title)}</h2>
    <div class="lesson-intro-hook">${hookHtml}</div>
    <button class="action-btn" onclick="renderLessonContent()">Start Studying →</button>
  `;
}

function renderLessonContent() {
  const level = currentLevel();
  const lesson = level.lessons[activeLessonIndex];
  const payload = document.getElementById("lesson-viewer-payload");
  let contentHtml = "";

  if (lesson.activityType === "letter_intro") contentHtml = renderLetterIntro(lesson.data);
  else if (lesson.activityType === "word_ladder") contentHtml = renderWordLadder(lesson.data);
  else if (lesson.activityType === "passage_reader") contentHtml = renderPassageReader(lesson.data);
  else if (lesson.activityType === "number_blocks") contentHtml = renderNumberBlocks(lesson.data);
  else if (lesson.activityType === "operation_steps") contentHtml = renderOperationSteps(lesson.data);

  const isLastLesson = activeLessonIndex === level.lessons.length - 1;
  payload.innerHTML = `
    <h2>${escapeHtml(lesson.title)}</h2>
    ${contentHtml}
    <button class="action-btn" style="margin-top:16px;" onclick="advanceLesson()">
      ${isLastLesson ? "I've Studied This — Take the Level Test" : "Mark as Studied — Next Lesson"}
    </button>
  `;
}

// ---- Activity renderers ----
function renderLetterIntro(data) {
  return `
    <div class="intro-pop-row" style="margin-bottom:16px;">
      ${data.letters.map((l) => `<span class="letter-card-big">${escapeHtml(l)}</span>`).join("")}
    </div>
    <h4>Blending Practice</h4>
    <div class="blend-list">
      ${data.blends.map((b) => `<div class="blend-item">${escapeHtml(b.parts.join(" + "))} = <strong>${escapeHtml(b.result)}</strong></div>`).join("")}
    </div>
    <h4>Practice Words</h4>
    <div class="intro-pop-row">
      ${data.practiceWords.map((w) => `<span class="practice-word-chip">${escapeHtml(w)}</span>`).join("")}
    </div>
  `;
}

function renderWordLadder(data) {
  return `
    <p class="lesson-content">${escapeHtml(data.instruction)}</p>
    <div class="word-ladder-list">
      ${data.words.map((word) => `
        <div class="word-ladder-item">
          ${word.split("").map((ch, i) => `<span class="word-ladder-letter" style="animation-delay:${i * 0.1}s">${escapeHtml(ch)}</span>`).join("")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderPassageReader(data) {
  return `
    <p class="lesson-content">${escapeHtml(data.text)}</p>
    ${data.vocab && data.vocab.length ? `
      <div class="vocab-list">
        ${data.vocab.map((v) => `<div class="vocab-item"><strong>${escapeHtml(v.word)}</strong>: ${escapeHtml(v.meaning)}</div>`).join("")}
      </div>` : ""}
    ${data.questions && data.questions.length ? `
      <h4>Check Yourself</h4>
      ${data.questions.map((q) => `
        <div class="op-practice-item">
          <p>${escapeHtml(q.question)}</p>
          <ul class="reveal-options">${q.options.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ul>
          <button class="action-btn secondary" onclick="this.nextElementSibling.classList.remove('hidden'); this.style.display='none';">Show Answer</button>
          <p class="hidden op-answer">Answer: ${escapeHtml(q.options[q.correctIndex])}</p>
        </div>
      `).join("")}` : ""}
  `;
}

function renderNumberBlocks(data) {
  return `
    <p class="lesson-content">${escapeHtml(data.explanation)}</p>
    <div class="intro-pop-row" style="margin: 12px 0;">
      ${data.numbers.slice(0, 8).map((n) => placeValueBlockHTML(n)).join("")}
    </div>
    <p class="quiz-hint">${escapeHtml(data.practicePrompt)}</p>
  `;
}

function placeValueBlockHTML(number) {
  const n = typeof number === "number" ? number : parseInt(number, 10);
  if (isNaN(n) || n > 99) return `<span class="letter-card-big">${escapeHtml(String(number))}</span>`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `
    <div class="place-value-block">
      <div class="pv-bars">
        ${Array.from({ length: tens }).map(() => `<span class="pv-ten-bar"></span>`).join("")}
        ${Array.from({ length: ones }).map(() => `<span class="pv-one-dot"></span>`).join("")}
      </div>
      <span class="pv-number-label">${n}</span>
    </div>
  `;
}

function renderOperationSteps(data) {
  window.currentOperationSteps = data.steps;
  operationStepIndex = 0;
  return `
    <div class="op-problem">${escapeHtml(data.problem)}</div>
    <div id="op-steps-list"></div>
    <button class="action-btn secondary" id="op-next-btn" onclick="nextOperationStep()">Show Step 1</button>
    <div class="op-practice hidden" id="op-practice-section">
      <h4>Now You Try</h4>
      ${data.practiceProblems.map((p) => `
        <div class="op-practice-item">
          <p>${escapeHtml(p.text)}</p>
          <button class="action-btn secondary" onclick="this.nextElementSibling.classList.remove('hidden'); this.style.display='none';">Show Answer</button>
          <p class="hidden op-answer">Answer: ${escapeHtml(p.answer)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

let operationStepIndex = 0;
function nextOperationStep() {
  const steps = window.currentOperationSteps;
  const list = document.getElementById("op-steps-list");
  const btn = document.getElementById("op-next-btn");
  if (operationStepIndex < steps.length) {
    const line = document.createElement("p");
    line.className = "op-step-line";
    line.innerText = `${operationStepIndex + 1}. ${steps[operationStepIndex]}`;
    list.appendChild(line);
    operationStepIndex += 1;
  }
  if (operationStepIndex >= steps.length) {
    btn.classList.add("hidden");
    document.getElementById("op-practice-section").classList.remove("hidden");
  } else {
    btn.innerText = `Show Step ${operationStepIndex + 1}`;
  }
}

// ---- Lesson progression ----
async function advanceLesson() {
  const level = currentLevel();
  const lesson = level.lessons[activeLessonIndex];
  const progress = getSubjectProgress(activeSubject);
  if (!progress[activeLevelId]) progress[activeLevelId] = { lessonsCompleted: [], testPassed: false };
  if (!progress[activeLevelId].lessonsCompleted.includes(lesson.id)) {
    progress[activeLevelId].lessonsCompleted.push(lesson.id);
    awardStars(1);
    bumpStreak();
  }
  saveSubjectProgress(activeSubject, progress);
  await syncStudentRecord();

  if (activeLessonIndex < level.lessons.length - 1) {
    activeLessonIndex += 1;
    renderLessonViewer();
  } else {
    showYoungScreen("level-test-screen");
    renderLevelTest();
  }
}

// ==========================================================================
// LEVEL TEST
// ==========================================================================
let levelTestAnswers = {};
function renderLevelTestQuestion(q, index) {
  return `
    <div class="interactive-quiz" style="margin-bottom:12px;">
      <p class="quiz-question">${escapeHtml(q.question)}</p>
      ${q.options.map((opt, oi) => `
        <button class="quiz-option" onclick="selectLevelTestAnswer(${index}, ${oi}, this)">${escapeHtml(opt)}</button>
      `).join("")}
    </div>
  `;
}

function selectLevelTestAnswer(questionIndex, optionIndex, btn) {
  levelTestAnswers[questionIndex] = optionIndex;
  btn.parentElement.querySelectorAll(".quiz-option").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");
}

function renderLevelTest() {
  levelTestAnswers = {};
  const level = currentLevel();
  const payload = document.getElementById("level-test-payload");
  payload.innerHTML = `
    <h2>${escapeHtml(level.name)} Level Test</h2>
    <p class="lesson-content">Answer all 3 questions. You need to get all 3 correct to unlock the next level.</p>
    ${level.test.questions.map((q, i) => renderLevelTestQuestion(q, i)).join("")}
    <button class="action-btn" onclick="submitLevelTest()">Submit Test</button>
  `;
}

async function submitLevelTest() {
  const level = currentLevel();
  let correct = 0;
  level.test.questions.forEach((q, i) => { if (levelTestAnswers[i] === q.correctIndex) correct += 1; });

  if (correct === level.test.questions.length) {
    await markLevelTestPassed();
    showLevelPassedCelebration();
  } else {
    const payload = document.getElementById("level-test-payload");
    payload.innerHTML = `
      <h2>${correct} of ${level.test.questions.length} correct</h2>
      <p class="lesson-content">Not quite full mastery yet — let's go through the lessons in this level again before retaking the test.</p>
      <button class="action-btn" onclick="restudyLevel()">Restudy This Level</button>
    `;
  }
}

function restudyLevel() {
  const progress = getSubjectProgress(activeSubject);
  progress[activeLevelId] = { lessonsCompleted: [], testPassed: false };
  saveSubjectProgress(activeSubject, progress);
  activeLessonIndex = 0;
  showYoungScreen("lesson-viewer");
  renderLessonViewer();
}

async function markLevelTestPassed() {
  const progress = getSubjectProgress(activeSubject);
  const wasAlreadyPassed = !!(progress[activeLevelId] && progress[activeLevelId].testPassed);
  if (!progress[activeLevelId]) progress[activeLevelId] = { lessonsCompleted: [], testPassed: false };
  progress[activeLevelId].testPassed = true;
  saveSubjectProgress(activeSubject, progress);
  if (!wasAlreadyPassed) {
    awardStars(5);
    awardBadge(`${activeSubject}_${activeLevelId}`);
    bumpStreak();
  }
  await syncStudentRecord();
}

// ==========================================================================
// CELEBRATION
// ==========================================================================
function showLevelPassedCelebration() {
  const level = currentLevel();
  const overlay = document.getElementById("celebration-overlay");
  const field = document.getElementById("confetti-field");
  field.innerHTML = "";
  const colors = ["#1D9E75", "#FFA726", "#0D3B2E", "#5DCAA5"];
  for (let i = 0; i < 40; i += 1) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.background = colors[i % colors.length];
    field.appendChild(piece);
  }
  document.getElementById("celebration-message").innerText = `You've mastered the ${level.name} level!`;
  document.getElementById("celebration-choices").classList.remove("hidden");
  overlay.classList.remove("hidden");
  setTimeout(() => { field.innerHTML = ""; }, 4000);
}

function hideCelebration() {
  document.getElementById("celebration-overlay").classList.add("hidden");
}

function revisitCurrentLevel() {
  hideCelebration();
  activeLessonIndex = 0;
  showYoungScreen("lesson-viewer");
  renderLessonViewer();
}

function continueToNextLevel() {
  hideCelebration();
  const levelOrder = activeSubject === "literacy" ? LITERACY_LEVELS : NUMERACY_LEVELS;
  const currentIndex = levelOrder.indexOf(activeLevelId);
  if (currentIndex < levelOrder.length - 1) {
    activeLevelId = levelOrder[currentIndex + 1];
    activeLessonIndex = 0;
    showYoungScreen("lesson-viewer");
    renderLessonViewer();
  } else {
    showYoungScreen("level-roadmap");
    renderRoadmap(activeSubject);
  }
}

// ==========================================================================
// Learner profile: stars, streaks, badges
// ==========================================================================
function getLearnerProfile() {
  return JSON.parse(localStorage.getItem("learner_profile")) || { totalStars: 0, streak: 0, lastActiveDate: null, badges: [] };
}
function saveLearnerProfile(profile) { localStorage.setItem("learner_profile", JSON.stringify(profile)); }

function awardStars(n) {
  const profile = getLearnerProfile();
  profile.totalStars += n;
  saveLearnerProfile(profile);
  refreshYoungStatsHeader();
}

function awardBadge(badgeKey) {
  const profile = getLearnerProfile();
  if (!profile.badges.includes(badgeKey)) profile.badges.push(badgeKey);
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
  refreshYoungStatsHeader();
}

// ==========================================================================
// Student record sync (identity + assessed levels + progress + gamification)
// ==========================================================================
async function syncStudentRecord() {
  const profile = getLearnerProfile();
  const payload = {
    name: localStorage.getItem("student_name") || null,
    isAnonymous: localStorage.getItem("is_anonymous") === "true",
    literacyLevel: localStorage.getItem("literacy_level") || null,
    numeracyLevel: localStorage.getItem("numeracy_level") || null,
    literacyAssessed: localStorage.getItem("literacy_assessed") === "true",
    numeracyAssessed: localStorage.getItem("numeracy_assessed") === "true",
    literacyProgress: getSubjectProgress("literacy"),
    numeracyProgress: getSubjectProgress("numeracy"),
    totalStars: profile.totalStars,
    streak: profile.streak,
    lastActiveDate: profile.lastActiveDate,
    badges: profile.badges,
  };
  if (isServerReachable) {
    const ok = await postJSON(`/students/${DEVICE_ID}`, payload);
    if (!ok) enqueueSync({ type: "student", payload });
  } else {
    enqueueSync({ type: "student", payload });
  }
  updateSyncQueueBadge();
}

async function loadStudentFromServer() {
  if (!isServerReachable) return;
  try {
    const res = await fetch(`${API_BASE_URL}/students/${DEVICE_ID}`);
    if (!res.ok) throw new Error("Bad response");
    const student = await res.json();
    if (student && student.literacyAssessed !== undefined) {
      if (localStorage.getItem("literacy_assessed") !== "true" && student.literacyAssessed) {
        localStorage.setItem("literacy_assessed", "true");
        localStorage.setItem("literacy_level", student.literacyLevel || "");
        saveSubjectProgress("literacy", student.literacyProgress || {});
      }
      if (localStorage.getItem("numeracy_assessed") !== "true" && student.numeracyAssessed) {
        localStorage.setItem("numeracy_assessed", "true");
        localStorage.setItem("numeracy_level", student.numeracyLevel || "");
        saveSubjectProgress("numeracy", student.numeracyProgress || {});
      }
    }
  } catch (err) { console.warn("Could not load student record from server.", err); }
}

// ==========================================================================
// SKILLS MODE — professional/life-skills track (unchanged from before)
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
          <span class="badge ${progress.completed ? "online" : "offline"}">${progress.completed ? "Done ✓" : "Not started"}</span>
          ${progress.attempts > 0 ? `<span class="badge offline">${progress.attempts} past miss${progress.attempts > 1 ? "es" : ""}</span>` : ""}
        </div>
      </div>
      <button class="action-btn" onclick="startLesson('${course.id}')">${actionLabel}</button>
    `;
    grid.appendChild(card);
  });
}

function computeRecommendation(professionalCourses) {
  const notStarted = professionalCourses.filter((c) => !getCourseProgress(c.id).completed);
  if (notStarted.length > 0) {
    const fresh = notStarted.find((c) => getCourseProgress(c.id).attempts === 0);
    const target = fresh || notStarted[0];
    const reason = fresh ? "You haven't started this one yet." : "You started this earlier but haven't finished — pick it back up.";
    return { course: target, reason };
  }
  const quizCourses = professionalCourses.filter((c) => (c.type || "quiz") === "quiz");
  const struggled = [...quizCourses].sort((a, b) => getCourseProgress(b.id).attempts - getCourseProgress(a.id).attempts)[0];
  if (struggled && getCourseProgress(struggled.id).attempts > 0) {
    return { course: struggled, reason: "You found this tricky earlier — a quick review will lock it in." };
  }
  return null;
}

function renderRecommendation(professionalCourses) {
  const card = document.getElementById("recommendation-card");
  const rec = computeRecommendation(professionalCourses);
  if (!rec) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  document.getElementById("recommendation-title").innerText = rec.course.title;
  document.getElementById("recommendation-reason").innerText = rec.reason;
  document.getElementById("recommendation-btn").onclick = () => startLesson(rec.course.id);
}

function startLesson(id) {
  const course = courses.find((c) => c.id === id);
  if (!course) return;
  const type = course.type || "quiz";
  if (type === "template") return startTemplateLesson(course);
  if (type === "linkedin") return startLinkedInLesson(course);
  if (type === "checklist") return startChecklistLesson(course);
  return startQuizLesson(course);
}

function closeLesson() { document.getElementById("lesson-modal").classList.add("hidden"); }

function startQuizLesson(course) {
  currentQuizAttempts = 0;
  const payload = document.getElementById("lesson-payload");
  payload.innerHTML = `
    <h2 id="lesson-title">${escapeHtml(course.title)}</h2>
    <p class="lesson-content">${escapeHtml(course.lessonContent)}</p>
    <div class="interactive-quiz">
      <p class="quiz-question">${escapeHtml(course.quiz.question)}</p>
      <div id="quiz-options">
        ${course.quiz.options.map((opt, index) => `
          <button class="quiz-option" data-index="${index}" onclick="evaluateAnswer('${course.id}', ${index}, ${course.quiz.correctIndex})">${escapeHtml(opt)}</button>
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
  const feedback = document.getElementById("quiz-feedback");
  const attemptsEl = document.getElementById("quiz-attempts");
  const hintEl = document.getElementById("quiz-hint");
  const buttons = document.querySelectorAll("#quiz-options .quiz-option");
  const selectedBtn = buttons[selectedIndex];

  if (selectedIndex === correctIndex) {
    buttons.forEach((btn, i) => { btn.disabled = true; if (i === correctIndex) btn.classList.add("correct"); });
    feedback.className = "quiz-feedback success";
    feedback.innerText = "Correct — module completed!";
    markComplete(courseId);
    setTimeout(() => { closeLesson(); if (currentStudentMode === "skills") renderSkillsMode(); }, 1500);
    return;
  }
  currentQuizAttempts += 1;
  recordAttempt(courseId);
  selectedBtn.classList.add("wrong");
  selectedBtn.disabled = true;
  feedback.className = "quiz-feedback error";
  feedback.innerText = "Not quite — try again!";
  attemptsEl.innerText = `Attempts: ${currentQuizAttempts}`;
  if (currentQuizAttempts >= 2 && course?.quiz?.hint) {
    hintEl.innerText = `Hint: ${course.quiz.hint}`;
    hintEl.classList.remove("hidden");
  }
}

function getTemplateData(courseId) { return JSON.parse(localStorage.getItem(`template_data_${courseId}`)) || {}; }
function saveTemplateData(courseId, data) { localStorage.setItem(`template_data_${courseId}`, JSON.stringify(data)); }

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
          : `<input type="text" id="tf_${field.id}" placeholder="${escapeHtml(field.placeholder || "")}" value="${escapeHtml(saved[field.id] || "")}" oninput="updateTemplatePreview('${course.id}')">`}
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
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

function downloadTemplateOutput(courseId) {
  const text = document.getElementById("template-preview").textContent;
  downloadText(text, `${courseId}.txt`);
}

async function completeTemplateLesson(courseId) {
  await markComplete(courseId);
  closeLesson();
  if (currentStudentMode === "skills") renderSkillsMode();
}

function startLinkedInLesson(course) {
  const savedText = localStorage.getItem(`linkedin_editor_${course.id}`) || "";
  const payload = document.getElementById("lesson-payload");
  payload.innerHTML = `
    <h2 id="lesson-title">${escapeHtml(course.title)}</h2>
    <p class="lesson-content">${escapeHtml(course.desc)}</p>
    <div class="linkedin-scenarios">
      ${course.scenarios.map((s, i) => `<button class="filter-btn" onclick="loadLinkedInScenario('${course.id}', ${i})">${escapeHtml(s.label)}</button>`).join("")}
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
  const editor = document.getElementById("linkedin-editor");
  editor.value = course.scenarios[index].text;
  saveLinkedInEditor(courseId);
}
function saveLinkedInEditor(courseId) { localStorage.setItem(`linkedin_editor_${courseId}`, document.getElementById("linkedin-editor").value); }
function copyLinkedInEditor() {
  const text = document.getElementById("linkedin-editor").value;
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

function getChecklistState(courseId) { return JSON.parse(localStorage.getItem(`checklist_state_${courseId}`)) || {}; }
function saveChecklistState(courseId, state) { localStorage.setItem(`checklist_state_${courseId}`, JSON.stringify(state)); }

function startChecklistLesson(course) {
  const state = getChecklistState(course.id);
  const payload = document.getElementById("lesson-payload");
  payload.innerHTML = `
    <h2 id="lesson-title">${escapeHtml(course.title)}</h2>
    <p class="lesson-content">${escapeHtml(course.desc)}</p>
    <div class="checklist-list">
      ${course.checklistItems.map((item) => `
        <label class="checklist-item">
          <input type="checkbox" id="cl_${item.id}" ${state[item.id] ? "checked" : ""} onchange="toggleChecklistItem('${course.id}', '${item.id}')">
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
  state[itemId] = document.getElementById(`cl_${itemId}`).checked;
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
  const entry = progress[courseId] || { completed: false, attempts: 0 };
  entry.completed = true;
  progress[courseId] = entry;
  localStorage.setItem("student_progress", JSON.stringify(progress));
  const payload = { courseId, completed: true, attempts: entry.attempts };
  if (isServerReachable) {
    const ok = await postJSON(`/students/${DEVICE_ID}/progress`, payload);
    if (!ok) enqueueSync({ type: "progress", payload });
  } else {
    enqueueSync({ type: "progress", payload });
  }
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
      merged[id] = { completed: s.completed || l.completed, attempts: Math.max(s.attempts || 0, l.attempts || 0) };
    });
    localStorage.setItem("student_progress", JSON.stringify(merged));
  } catch (err) { console.warn("Could not load progress from server.", err); }
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
    if (item.type === "progress") ok = await postJSON(`/students/${DEVICE_ID}/progress`, item.payload);
    else if (item.type === "student") ok = await postJSON(`/students/${DEVICE_ID}`, item.payload);
    else if (item.type === "cohort_create") ok = await postJSON(`/cohorts`, item.payload);
    else if (item.type === "cohort_increment") ok = await postJSON(`/cohorts/${item.payload.id}/increment`, {});
    if (!ok) remaining.push(item);
  }
  localStorage.setItem("sync_queue", JSON.stringify(remaining));
  updateSyncQueueBadge();
  const syncMessage = document.getElementById("sync-message");
  syncMessage.innerText = remaining.length === 0
    ? "All offline progress successfully synced!"
    : `Synced some items — ${remaining.length} still pending.`;
  await refreshCohorts();
  await refreshStats();
}

function updateSyncQueueBadge() {
  const queue = JSON.parse(localStorage.getItem("sync_queue")) || [];
  const badge = document.getElementById("sync-queue-badge");
  if (queue.length > 0) { badge.innerText = `${queue.length} pending`; badge.classList.remove("hidden"); }
  else badge.classList.add("hidden");
}

async function triggerManualSync() {
  await refreshConnectionState();
  await loadCourseDB();
  await loadCurriculum();
  await loadProgressFromServer();
  await loadStudentFromServer();
  if (currentStudentMode === "skills") renderSkillsMode();
}

// ==========================================================================
// TEACHER DASHBOARD — password gate, cohorts, stats, roster
// ==========================================================================
function enterTeacherView() {
  const authed = localStorage.getItem("teacher_authenticated") === "true";
  document.getElementById("teacher-gate").classList.toggle("hidden", authed);
  document.getElementById("teacher-dashboard-content").classList.toggle("hidden", !authed);
  if (authed) {
    refreshCohorts();
    refreshStats();
    refreshRoster();
  }
}

function attemptTeacherLogin() {
  const input = document.getElementById("teacher-password").value;
  if (input === TEACHER_PASSWORD) {
    localStorage.setItem("teacher_authenticated", "true");
    document.getElementById("teacher-gate-error").classList.add("hidden");
    enterTeacherView();
  } else {
    document.getElementById("teacher-gate-error").classList.remove("hidden");
  }
}

async function refreshRoster() {
  let roster = [];
  if (isServerReachable) {
    try {
      const res = await fetch(`${API_BASE_URL}/students`);
      if (res.ok) roster = await res.json();
    } catch (err) { console.warn("Could not load roster from server.", err); }
  }
  if (roster.length === 0) {
    // Fall back to at least showing this device's own record.
    roster = [{
      deviceId: DEVICE_ID,
      name: localStorage.getItem("student_name") || null,
      isAnonymous: localStorage.getItem("is_anonymous") === "true",
      literacyLevel: localStorage.getItem("literacy_level"),
      numeracyLevel: localStorage.getItem("numeracy_level"),
    }];
  }
  const list = document.getElementById("roster-list");
  list.innerHTML = "";
  roster.forEach((student) => {
    const displayName = student.name && student.name.trim() ? student.name : `Anonymous ${student.deviceId.slice(0, 6)}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(displayName)}</strong></td>
      <td>${escapeHtml(LEVEL_LABELS[student.literacyLevel] || "Not assessed")}</td>
      <td>${escapeHtml(LEVEL_LABELS[student.numeracyLevel] || "Not assessed")}</td>
    `;
    list.appendChild(tr);
  });
}

async function refreshCohorts() {
  if (isServerReachable) {
    try {
      const res = await fetch(`${API_BASE_URL}/cohorts`);
      if (!res.ok) throw new Error("Bad response");
      const cohorts = await res.json();
      localStorage.setItem("cohorts", JSON.stringify(cohorts));
      renderCohorts(cohorts);
      return;
    } catch (err) { console.warn("Could not load cohorts from server.", err); }
  }
  renderCohorts(JSON.parse(localStorage.getItem("cohorts")) || []);
}

function renderCohorts(cohorts) {
  const list = document.getElementById("cohorts-list");
  list.innerHTML = "";
  if (cohorts.length === 0) { list.innerHTML = `<tr><td colspan="5" class="empty-state">No groups registered yet.</td></tr>`; return; }
  cohorts.forEach((c) => {
    const rate = c.count > 0 ? Math.round((c.completed / c.count) * 100) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${c.count} Learners</td>
      <td>${c.completed}</td>
      <td>${rate}%</td>
      <td><button class="action-btn" style="padding:4px 8px; font-size:11px;" onclick="incrementCohortProgress('${c.id}')">Add Completion</button></td>
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
  } else enqueueSync({ type: "cohort_create", payload });
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
  } else enqueueSync({ type: "cohort_increment", payload: { id } });
  updateSyncQueueBadge();
  await refreshStats();
}

async function refreshStats() {
  if (isServerReachable) {
    try {
      const res = await fetch(`${API_BASE_URL}/stats`);
      if (!res.ok) throw new Error("Bad response");
      renderStats(await res.json());
      return;
    } catch (err) { console.warn("Could not load stats from server.", err); }
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
// Offline SMS pack (Skills Zone quiz courses only)
// ==========================================================================
function exportSMSPack() {
  let smsText = "--- SOMA SASA COHORT SMS PACK ---\n";
  courses.forEach((c) => {
    if (c.type && c.type !== "quiz") return;
    smsText += `\n[REF:${c.id}]\nQ: ${c.title}\nLesson: ${c.lessonContent.substring(0, 100)}...\nQuiz: ${c.quiz.question}\nOptions: ${c.quiz.options.join(" | ")}\n`;
  });
  downloadText(smsText, "somasasa_offline_sms_kit.txt");
}

// ==========================================================================
// Facilitator Activity Guide — curated TaRL activities (numeracy + literacy)
// ==========================================================================
function exportActivityGuide() {
  const text = `--- SOMA SASA FACILITATOR ACTIVITY GUIDE ---
Based on the Teaching at the Right Level (TaRL) approach.

======================
NUMERACY — Level Groups
======================
Number Recognition: Numbers with Bundle & Sticks, Number Chart Reading, Number Wheel, Clap & Snap
Addition + Subtraction: Expansion Chart Reading, Numbers with Play Money, Oral Addition & Subtraction
Multiplication + Division: Multiplication Box Method, Division with Sticks, Multiplication Table Recitation

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
1 clap = 10 (tens), 1 snap = 1 (one). Demonstrate a number (e.g. 2 claps + 3 snaps = 23), then reverse
the game: say a number and have a learner clap/snap it correctly.

======================
LITERACY — Level Groups
======================
Beginner + Letter: Jolly Phonics sound groups, Word Diary, Letter Jump, Picture Card Reading
Word + Paragraph: Sentence Diary, Rhyming Words, Paragraph Booklet Reading, Matching Words & Pictures
Story: Story Booklet Reading, Re-telling a Story, Picture Card Story Building

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

function exportRubric() {
  const checklistCourse = courses.find((c) => c.id === "prof_checklist");
  const items = checklistCourse ? checklistCourse.checklistItems : [];
  let text = "--- SOMA SASA APPLICATION ASSESSMENT RUBRIC (Facilitator Copy) ---\n";
  text += "Use this to score a learner's resume, cover letter, and LinkedIn profile.\n\n";
  items.forEach((item, i) => { text += `[ ] ${i + 1}. ${item.label}\n`; });
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
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) { return false; }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}
