(() => {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyCfDNiN8ecPvl8PdqoV2UkGWJ_YleB-NBo",
    authDomain: "englishwordtest-4a6d1.firebaseapp.com",
    databaseURL: "https://englishwordtest-4a6d1-default-rtdb.firebaseio.com",
    projectId: "englishwordtest-4a6d1",
    storageBucket: "englishwordtest-4a6d1.firebasestorage.app",
    messagingSenderId: "989075866396",
    appId: "1:989075866396:web:231c8135c642104f26f0d9",
    measurementId: "G-TRWK9F4Z6J",
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  const WORDS_PATH = "eng_word_list";
  const EXAMS_PATH = "english_exam_list";
  const ACCOUNT_PATH = "account";
  const ADMIN_NAME = "administrator";
  const DEFAULT_ADMIN_PASSWORD = "super1234!@#$";

  const EXAM_SIZE = 10;
  const WORDS_PER_PAGE = 10;
  const LEVELS = ["중학생", "고등학생", "대학생", "최상위"];

  const DEFAULT_WORDS = [
    { id: "1", word: "abandon", meanings: ["포기하다", "버리다"], level: "중학생" },
    { id: "2", word: "benefit", meanings: ["이익", "혜택"], level: "중학생" },
    { id: "3", word: "challenge", meanings: ["도전", "이의를 제기하다"], level: "고등학생" },
    { id: "4", word: "diligent", meanings: ["부지런한", "성실한"], level: "고등학생" },
    { id: "5", word: "essential", meanings: ["필수적인", "본질적인"], level: "대학생" },
    { id: "6", word: "frequent", meanings: ["빈번한", "자주 일어나는"], level: "고등학생" },
    { id: "7", word: "generate", meanings: ["생성하다", "발생시키다"], level: "고등학생" },
    { id: "8", word: "hesitate", meanings: ["망설이다", "주저하다"], level: "고등학생" },
    { id: "9", word: "indicate", meanings: ["나타내다", "가리키다"], level: "고등학생" },
    { id: "10", word: "justify", meanings: ["정당화하다", "옳음을 증명하다"], level: "고등학생" },
    { id: "11", word: "knowledge", meanings: ["지식", "아는 것"], level: "중학생" },
    { id: "12", word: "maintain", meanings: ["유지하다", "보수하다"], level: "고등학생" },
  ];

  let words = [];
  let records = [];
  let users = [];
  let adminPassword = DEFAULT_ADMIN_PASSWORD;
  let currentUser = null;
  let isAdminSession = false;
  let examQueue = [];
  let examIndex = 0;
  let examAnswers = [];
  let editingWordId = null;
  let editingUserId = null;
  let wordSortMode = "registered";
  let wordPage = 1;
  let examStartedAt = 0;
  let examElapsedMs = 0;
  let examTimerId = null;
  let firebaseReady = false;
  let accountReady = false;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeWord(entry, index = 0, total = 1) {
    const fromBank = findInBank(entry.word);
    return {
      id: entry.id || uid(),
      word: entry.word,
      meanings: Array.isArray(entry.meanings) ? entry.meanings.slice(0, 2) : [],
      level: LEVELS.includes(entry.level) ? entry.level : fromBank?.level || "중학생",
      createdAt: entry.createdAt || Date.now() - (total - index) * 1000,
      answerRate: entry.answerRate ?? null,
    };
  }

  function defaultWords() {
    return structuredClone(DEFAULT_WORDS).map((w, i, arr) =>
      normalizeWord(w, i, arr.length)
    );
  }

  function wordToFirebase(entry, answerRate) {
    return {
      english_word: entry.word,
      korean_mean_1: entry.meanings[0] || "",
      korean_mean_2: entry.meanings[1] || "",
      date: new Date(entry.createdAt || Date.now()).toISOString(),
      level: entry.level || "중학생",
      answer_rate: answerRate === null || answerRate === undefined ? null : answerRate,
    };
  }

  function wordFromFirebase(id, data, index = 0, total = 1) {
    const mean1 = data.korean_mean_1 || "";
    const mean2 = data.korean_mean_2 || data.korean_meam_2 || "";
    const meanings = mean2 ? [mean1, mean2] : mean1 ? [mean1] : [];
    const createdAt = data.date ? Date.parse(data.date) || Date.now() : Date.now() - (total - index) * 1000;
    return normalizeWord(
      {
        id,
        word: data.english_word || "",
        meanings,
        level: data.level,
        createdAt,
        answerRate: data.answer_rate ?? null,
      },
      index,
      total
    );
  }

  function examToFirebase(record) {
    return {
      date: record.date,
      duration: record.elapsedMs,
      test_result: (record.answers || []).map((a, i) => ({
        word_no: i + 1,
        english_word: a.word,
        korean_mean_1: a.meanings?.[0] || "",
        korean_mean_2: a.meanings?.[1] || "",
        level: a.level || "중학생",
        correct: !!a.correct,
      })),
    };
  }

  function examFromFirebase(id, data) {
    const answers = Array.isArray(data.test_result)
      ? data.test_result
      : Object.values(data.test_result || {});
    answers.sort((a, b) => (a.word_no || 0) - (b.word_no || 0));

    const mapped = answers.map((a) => {
      const mean1 = a.korean_mean_1 || "";
      const mean2 = a.korean_mean_2 || "";
      return {
        word: a.english_word || "",
        meanings: mean2 ? [mean1, mean2] : mean1 ? [mean1] : [],
        level: a.level || "중학생",
        correct: !!a.correct,
      };
    });

    const correctCount = mapped.filter((a) => a.correct).length;
    return {
      id,
      date: data.date || new Date().toISOString(),
      correctCount,
      wrongCount: mapped.length - correctCount,
      elapsedMs: typeof data.duration === "number" ? data.duration : 0,
      answers: mapped,
    };
  }

  async function saveWords() {
    const accuracyMap = getWordAccuracyMap();
    const payload = {};
    words.forEach((w) => {
      const rate = getAccuracyRate(w.word, accuracyMap);
      const answerRate =
        rate === null ? (w.answerRate ?? null) : Math.round(rate * 100);
      w.answerRate = answerRate;
      payload[w.id] = wordToFirebase(w, answerRate);
    });
    await db.ref(WORDS_PATH).set(payload);
  }

  async function saveExamRecord(record) {
    await db.ref(`${EXAMS_PATH}/${record.id}`).set(examToFirebase(record));
  }

  async function loadFromFirebase() {
    const [wordsSnap, examsSnap] = await Promise.all([
      db.ref(WORDS_PATH).once("value"),
      db.ref(EXAMS_PATH).once("value"),
    ]);

    const examsVal = examsSnap.val();
    if (examsVal && typeof examsVal === "object") {
      records = Object.entries(examsVal)
        .map(([id, data]) => examFromFirebase(id, data))
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    } else {
      records = [];
    }

    const wordsVal = wordsSnap.val();
    if (wordsVal && typeof wordsVal === "object") {
      const entries = Object.entries(wordsVal);
      words = entries.map(([id, data], i) => wordFromFirebase(id, data, i, entries.length));
    } else {
      words = defaultWords();
      await saveWords();
    }
  }

  /* ---------- 계정 / 로그인 ---------- */

  function userFromFirebase(id, data) {
    return {
      id,
      name: String(data.name || "").trim(),
      password: String(data.password || ""),
      createdAt: data.created_at || data.createdAt || new Date().toISOString(),
      loginCount: Number(data.login_count ?? data.loginCount ?? 0) || 0,
    };
  }

  function userToFirebase(user) {
    return {
      name: user.name,
      password: user.password,
      created_at: user.createdAt,
      login_count: user.loginCount,
    };
  }

  async function loadAccounts() {
    const snap = await db.ref(ACCOUNT_PATH).once("value");
    const val = snap.val();

    if (!val || !val.admin || !val.admin.password) {
      adminPassword = DEFAULT_ADMIN_PASSWORD;
      await db.ref(`${ACCOUNT_PATH}/admin`).set({ password: adminPassword });
    } else {
      adminPassword = String(val.admin.password);
    }

    const usersVal = val?.users;
    if (usersVal && typeof usersVal === "object") {
      users = Object.entries(usersVal)
        .map(([id, data]) => userFromFirebase(id, data))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    } else {
      users = [];
    }
    accountReady = true;
  }

  async function saveUsers() {
    const payload = {};
    users.forEach((u) => {
      payload[u.id] = userToFirebase(u);
    });
    await db.ref(`${ACCOUNT_PATH}/users`).set(Object.keys(payload).length ? payload : null);
  }

  async function saveAdminPassword(nextPassword) {
    adminPassword = nextPassword;
    await db.ref(`${ACCOUNT_PATH}/admin/password`).set(nextPassword);
  }

  function showLoginError(message) {
    const el = $("#login-error");
    if (!message) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function setSessionBar(visible, label = "") {
    const bar = $("#session-bar");
    if (!visible) {
      bar.classList.add("hidden");
      return;
    }
    $("#session-user").textContent = label;
    bar.classList.remove("hidden");
  }

  function showLoginScreen() {
    currentUser = null;
    isAdminSession = false;
    document.querySelector(".app").classList.remove("admin-mode");
    setSessionBar(false);
    closeUserModal();
    closeAdminLoginModal();
    closeImportResultModal();
    closeExamLevelModal();
    closeAddWordModal();
    closeModal();
    $("#login-form").reset();
    showLoginError("");
    showScreen("screen-login");
    $("#login-username").focus();
  }

  function enterAppAsUser(user) {
    currentUser = user;
    isAdminSession = false;
    document.querySelector(".app").classList.remove("admin-mode");
    setSessionBar(true, `${user.name} 님`);
    renderHomeStats();
    showScreen("screen-home");
  }

  function enterAdmin() {
    currentUser = null;
    isAdminSession = true;
    document.querySelector(".app").classList.add("admin-mode");
    setSessionBar(true, "관리자");
    $("#admin-password-form").reset();
    const msg = $("#admin-password-msg");
    msg.classList.add("hidden");
    msg.textContent = "";
    closeUserModal();
    closeAdminLoginModal();
    renderUsersTable();
    showScreen("screen-admin");
  }

  function openAdminLoginModal() {
    showLoginError("");
    $("#admin-login-form").reset();
    $("#admin-login-username").value = ADMIN_NAME;
    showAdminLoginError("");
    $("#admin-login-modal").classList.remove("hidden");
    $("#admin-login-password").focus();
  }

  function closeAdminLoginModal() {
    const modal = $("#admin-login-modal");
    if (modal) modal.classList.add("hidden");
    const form = $("#admin-login-form");
    if (form) form.reset();
    showAdminLoginError("");
  }

  function showAdminLoginError(message) {
    const el = $("#admin-login-error");
    if (!el) return;
    if (!message) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
  }

  async function handleAdminLogin(e) {
    e.preventDefault();
    if (!accountReady) {
      showAdminLoginError("계정 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    const username = $("#admin-login-username").value.trim();
    const password = $("#admin-login-password").value;

    if (username !== ADMIN_NAME) {
      showAdminLoginError("사용자 관리는 administrator 계정만 접근할 수 있습니다.");
      return;
    }

    if (password !== adminPassword) {
      showAdminLoginError("패스워드가 올바르지 않습니다.");
      return;
    }

    showAdminLoginError("");
    enterAdmin();
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!accountReady) {
      showLoginError("계정 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    const username = $("#login-username").value.trim();
    const password = $("#login-password").value;

    if (!username || !password) {
      showLoginError("사용자 이름과 패스워드를 입력해 주세요.");
      return;
    }

    if (username === ADMIN_NAME) {
      showLoginError("관리자 계정은 '사용자 관리' 버튼으로 접속해 주세요.");
      return;
    }

    const user = users.find((u) => u.name === username);
    if (!user || user.password !== password) {
      showLoginError("사용자 이름 또는 패스워드가 올바르지 않습니다.");
      return;
    }

    user.loginCount += 1;
    try {
      await db.ref(`${ACCOUNT_PATH}/users/${user.id}/login_count`).set(user.loginCount);
    } catch (err) {
      console.error(err);
      user.loginCount -= 1;
      showLoginError("접속 기록을 저장하지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    showLoginError("");

    if (!firebaseReady) {
      try {
        await loadFromFirebase();
        firebaseReady = true;
      } catch (err) {
        console.error(err);
        words = defaultWords();
        records = [];
        firebaseReady = true;
        alert(
          "Firebase 단어/시험 데이터 연결에 실패했습니다. 일시적으로 기본 단어로 동작합니다."
        );
      }
    }

    enterAppAsUser(user);
  }

  function logout() {
    stopExamTimer();
    showLoginScreen();
  }

  function adminLogout() {
    showLoginScreen();
  }

  async function handleAdminPasswordChange(e) {
    e.preventDefault();
    const next = $("#admin-new-password").value;
    const confirm = $("#admin-confirm-password").value;
    const msg = $("#admin-password-msg");

    if (!next) {
      msg.textContent = "새 패스워드를 입력해 주세요.";
      msg.className = "form-msg error";
      return;
    }
    if (next !== confirm) {
      msg.textContent = "새 패스워드와 확인 값이 일치하지 않습니다.";
      msg.className = "form-msg error";
      return;
    }

    try {
      await saveAdminPassword(next);
      $("#admin-password-form").reset();
      msg.textContent = "관리자 패스워드가 변경되었습니다.";
      msg.className = "form-msg success";
    } catch (err) {
      console.error(err);
      msg.textContent = "패스워드 저장에 실패했습니다.";
      msg.className = "form-msg error";
    }
  }

  function renderUsersTable() {
    const tbody = $("#users-table tbody");
    tbody.innerHTML = "";
    const empty = $("#users-empty");
    $("#user-count").textContent = `등록된 사용자: ${users.length}명`;

    if (users.length === 0) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    users.forEach((u, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.password)}</td>
        <td>${escapeHtml(formatDate(u.createdAt))}</td>
        <td>${u.loginCount}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm btn-ghost" data-user-edit="${escapeHtml(u.id)}">편집</button>
          <button type="button" class="btn btn-sm btn-danger" data-user-delete="${escapeHtml(u.id)}">삭제</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function openAddUserModal() {
    editingUserId = null;
    $("#user-modal-title").textContent = "신규 사용자 추가";
    $("#user-form-submit").textContent = "저장";
    $("#user-form").reset();
    $("#user-form-error").classList.add("hidden");
    $("#user-form-error").textContent = "";
    $("#user-modal").classList.remove("hidden");
    $("#input-user-name").focus();
  }

  function openEditUserModal(id) {
    const user = users.find((u) => u.id === id);
    if (!user) return;
    editingUserId = id;
    $("#user-modal-title").textContent = "사용자 편집";
    $("#user-form-submit").textContent = "저장";
    $("#input-user-name").value = user.name;
    $("#input-user-password").value = user.password;
    $("#user-form-error").classList.add("hidden");
    $("#user-form-error").textContent = "";
    $("#user-modal").classList.remove("hidden");
    $("#input-user-name").focus();
  }

  function closeUserModal() {
    $("#user-modal").classList.add("hidden");
    editingUserId = null;
    $("#user-form").reset();
    $("#user-form-error").classList.add("hidden");
    $("#user-form-error").textContent = "";
  }

  function showUserFormError(message) {
    const el = $("#user-form-error");
    if (!message) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
  }

  async function saveUser(e) {
    e.preventDefault();
    const name = $("#input-user-name").value.trim();
    const password = $("#input-user-password").value;

    if (!name || !password) {
      showUserFormError("이름과 패스워드를 입력해 주세요.");
      return;
    }

    if (name.toLowerCase() === ADMIN_NAME.toLowerCase()) {
      showUserFormError("administrator는 일반 사용자로 등록할 수 없습니다.");
      return;
    }

    const duplicated = users.some(
      (u) => u.name.toLowerCase() === name.toLowerCase() && u.id !== editingUserId
    );
    if (duplicated) {
      showUserFormError("이미 등록된 사용자 이름입니다.");
      return;
    }

    if (editingUserId) {
      const index = users.findIndex((u) => u.id === editingUserId);
      if (index === -1) {
        showUserFormError("편집할 사용자를 찾을 수 없습니다.");
        return;
      }
      users[index] = { ...users[index], name, password };
    } else {
      users.push({
        id: uid(),
        name,
        password,
        createdAt: new Date().toISOString(),
        loginCount: 0,
      });
    }

    try {
      await saveUsers();
    } catch (err) {
      console.error(err);
      showUserFormError("사용자 정보를 Firebase에 저장하지 못했습니다.");
      await loadAccounts();
      return;
    }

    closeUserModal();
    renderUsersTable();
  }

  async function deleteUser(id) {
    if (!confirm("이 사용자를 삭제할까요?")) return;
    users = users.filter((u) => u.id !== id);
    try {
      await saveUsers();
    } catch (err) {
      console.error(err);
      alert("사용자를 Firebase에서 삭제하지 못했습니다.");
      await loadAccounts();
      return;
    }
    renderUsersTable();
  }

  function showScreen(id) {
    $$(".screen").forEach((el) => el.classList.remove("active"));
    const target = document.getElementById(id);
    if (target) target.classList.add("active");
  }

  function formatMeanings(meanings) {
    return meanings
      .slice(0, 2)
      .map((m, i) => `${i + 1}. ${m}`)
      .join(" / ");
  }

  function formatMeaningsMultiline(meanings) {
    return meanings
      .slice(0, 2)
      .map((m, i) => `${i + 1}. ${escapeHtml(m)}`)
      .join("<br>");
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function findInBank(word) {
    if (typeof WORD_BANK === "undefined") return null;
    const key = word.trim().toLowerCase();
    return WORD_BANK.find((w) => w.word.toLowerCase() === key) || null;
  }

  function levelBadgeClass(level) {
    const map = {
      중학생: "badge-level-middle",
      고등학생: "badge-level-high",
      대학생: "badge-level-college",
      최상위: "badge-level-top",
    };
    return map[level] || "badge-level-middle";
  }

  /* ---------- 화면 전환 ---------- */

  function formatElapsed(ms) {
    const totalCs = Math.floor(Math.max(0, ms) / 10);
    const cs = totalCs % 100;
    const totalSec = Math.floor(totalCs / 100);
    const sec = totalSec % 60;
    const min = Math.floor(totalSec / 60) % 100;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
  }

  function formatElapsedResult(ms) {
    const totalCs = Math.floor(Math.max(0, ms) / 10);
    const cs = totalCs % 100;
    const totalSec = Math.floor(totalCs / 100);
    const sec = totalSec % 60;
    const min = Math.floor(totalSec / 60) % 100;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  function formatElapsedMinutesSeconds(ms) {
    if (ms == null || Number.isNaN(ms)) return "—";
    const totalSec = Math.floor(Math.max(0, ms) / 1000);
    const sec = totalSec % 60;
    const min = Math.floor(totalSec / 60) % 100;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function updateExamTimerDisplay() {
    const timerEl = $("#exam-timer");
    if (!timerEl || !examStartedAt) return;
    examElapsedMs = Date.now() - examStartedAt;
    timerEl.textContent = formatElapsed(examElapsedMs);
  }

  function startExamTimer() {
    stopExamTimer();
    examStartedAt = Date.now();
    examElapsedMs = 0;
    const timerEl = $("#exam-timer");
    if (timerEl) timerEl.textContent = "00:00:00";
    examTimerId = setInterval(updateExamTimerDisplay, 10);
  }

  function stopExamTimer() {
    if (examTimerId !== null) {
      clearInterval(examTimerId);
      examTimerId = null;
    }
    if (examStartedAt) {
      examElapsedMs = Date.now() - examStartedAt;
    }
  }

  function renderHomeStats() {
    $("#stat-word-count").textContent = String(words.length);
    $("#stat-exam-count").textContent = String(records.length);

    if (records.length === 0) {
      $("#stat-accuracy").textContent = "—";
      return;
    }

    const sumRate = records.reduce((sum, r) => {
      const total = r.answers?.length || EXAM_SIZE;
      const correct = r.correctCount ?? 0;
      return sum + (total > 0 ? (correct / total) * 100 : 0);
    }, 0);
    const avgRate = Math.round(sumRate / records.length);
    $("#stat-accuracy").textContent = `${avgRate}%`;
  }

  const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

  function renderHomeDateTime() {
    const el = $("#home-datetime");
    if (!el) return;
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth() + 1;
    const d = now.getDate();
    const h = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    const weekday = WEEKDAYS[now.getDay()];
    el.textContent = `${y}년 ${mo}월 ${d}일 ${weekday} ${h}시 ${mi}분 ${s}초`;
  }

  function goHome() {
    stopExamTimer();
    closeAddWordModal();
    closeExamLevelModal();
    renderHomeStats();
    showScreen("screen-home");
  }

  function ensureFirebaseReady() {
    if (!firebaseReady) {
      alert("Firebase 데이터를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return false;
    }
    return true;
  }

  function startExam() {
    if (!ensureFirebaseReady()) return;
    if (words.length < EXAM_SIZE) {
      alert(
        `시험에는 최소 ${EXAM_SIZE}개의 단어가 필요합니다.\n현재 ${words.length}개입니다. 단어 관리에서 단어를 추가해 주세요.`
      );
      return;
    }
    openExamLevelModal();
  }

  function getWordsForExamLevel(examLevel) {
    if (examLevel === "middle") {
      return words.filter((w) => (w.level || "중학생") === "중학생");
    }
    if (examLevel === "high") {
      return words.filter((w) => w.level === "고등학생");
    }
    if (examLevel === "college") {
      return words.filter((w) => w.level === "대학생" || w.level === "최상위");
    }
    return [...words];
  }

  function openExamLevelModal() {
    const pools = {
      middle: getWordsForExamLevel("middle"),
      high: getWordsForExamLevel("high"),
      college: getWordsForExamLevel("college"),
      random: getWordsForExamLevel("random"),
    };

    $("#exam-level-count-middle").textContent = `등록 단어 ${pools.middle.length}개`;
    $("#exam-level-count-high").textContent = `등록 단어 ${pools.high.length}개`;
    $("#exam-level-count-college").textContent = `등록 단어 ${pools.college.length}개`;
    $("#exam-level-count-random").textContent = `등록 단어 ${pools.random.length}개`;

    $("#exam-level-modal").classList.remove("hidden");
  }

  function closeExamLevelModal() {
    const modal = $("#exam-level-modal");
    if (modal) modal.classList.add("hidden");
  }

  function beginExamWithLevel(examLevel) {
    const pool = getWordsForExamLevel(examLevel);
    const labels = {
      middle: "중학생 수준",
      high: "고등학생 수준",
      college: "대학생 이상",
      random: "랜덤 수준",
    };
    const label = labels[examLevel] || "선택한 수준";

    if (pool.length < EXAM_SIZE) {
      alert(
        `${label}으로 출제할 단어가 부족합니다.\n필요: ${EXAM_SIZE}개, 현재: ${pool.length}개`
      );
      return;
    }

    closeExamLevelModal();
    examQueue = shuffle(pool).slice(0, EXAM_SIZE);
    examIndex = 0;
    examAnswers = [];
    showScreen("screen-exam");
    startExamTimer();
    renderExamQuestion();
  }

  function renderExamQuestion() {
    const item = examQueue[examIndex];
    $("#exam-progress").textContent = `${examIndex + 1} / ${EXAM_SIZE}`;
    $("#exam-word").textContent = item.word;

    const meaningsEl = $("#exam-meanings");
    meaningsEl.innerHTML = "";
    meaningsEl.classList.add("hidden");

    const ol = document.createElement("ol");
    item.meanings.slice(0, 2).forEach((m) => {
      const li = document.createElement("li");
      li.textContent = m;
      ol.appendChild(li);
    });
    meaningsEl.appendChild(ol);

    const level = item.level || "중학생";
    const levelEl = document.createElement("div");
    levelEl.className = "exam-level";
    levelEl.innerHTML = `수준 <span class="badge ${levelBadgeClass(level)}">${escapeHtml(level)}</span>`;
    meaningsEl.appendChild(levelEl);

    $("#btn-show-meaning").classList.remove("hidden");
    $("#answer-actions").classList.add("hidden");
  }

  function showMeaning() {
    $("#exam-meanings").classList.remove("hidden");
    $("#btn-show-meaning").classList.add("hidden");
    $("#answer-actions").classList.remove("hidden");
  }

  function answerQuestion(isCorrect) {
    const item = examQueue[examIndex];
    examAnswers.push({
      word: item.word,
      meanings: item.meanings.slice(0, 2),
      level: item.level || "중학생",
      correct: isCorrect,
    });

    examIndex += 1;
    if (examIndex >= EXAM_SIZE) {
      finishExam();
    } else {
      renderExamQuestion();
    }
  }

  async function finishExam() {
    stopExamTimer();
    const correctCount = examAnswers.filter((a) => a.correct).length;
    const wrongCount = EXAM_SIZE - correctCount;
    const elapsedText = formatElapsedResult(examElapsedMs);

    const record = {
      id: uid(),
      date: new Date().toISOString(),
      correctCount,
      wrongCount,
      elapsedMs: examElapsedMs,
      answers: examAnswers,
    };
    records.unshift(record);

    try {
      await saveExamRecord(record);
      await saveWords();
    } catch (err) {
      console.error(err);
      alert("시험 기록을 Firebase에 저장하지 못했습니다.");
    }

    $("#result-summary").innerHTML = `
      <span>총 ${EXAM_SIZE}문제 중 ${correctCount}개 맞음, ${wrongCount}개 틀림</span>
      <span class="result-elapsed">경과시간 ${elapsedText}</span>
    `;

    const tbody = $("#result-table tbody");
    tbody.innerHTML = "";
    examAnswers.forEach((a, i) => {
      const level = a.level || "중학생";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(a.word)}</td>
        <td class="meanings-cell">${formatMeaningsMultiline(a.meanings)}</td>
        <td><span class="badge ${levelBadgeClass(level)}">${escapeHtml(level)}</span></td>
        <td><span class="badge ${a.correct ? "badge-correct" : "badge-wrong"}">${
          a.correct ? "맞음" : "틀림"
        }</span></td>
      `;
      tbody.appendChild(tr);
    });

    showScreen("screen-result");
  }

  /* ---------- 단어 관리 ---------- */

  function openWordManage() {
    if (!ensureFirebaseReady()) return;
    closeAddWordModal();
    wordPage = 1;
    renderWordsTable();
    showScreen("screen-words");
  }

  function openAddWordModal() {
    editingWordId = null;
    resetWordForm();
    $("#word-modal-title").textContent = "새 단어 추가";
    $("#word-form-submit").textContent = "단어 추가";
    $("#btn-auto-word").classList.remove("hidden");
    $("#add-word-modal").classList.remove("hidden");
    $("#input-word").focus();
  }

  function openEditWordModal(id) {
    const entry = words.find((w) => w.id === id);
    if (!entry) return;

    editingWordId = id;
    resetWordForm();
    $("#input-word").value = entry.word;
    fillMeaningsAndLevel(entry);
    updateAutoButtons();

    $("#word-modal-title").textContent = "단어 편집";
    $("#word-form-submit").textContent = "저장";
    $("#btn-auto-word").classList.add("hidden");
    $("#add-word-modal").classList.remove("hidden");
    $("#input-word").focus();
  }

  function closeAddWordModal() {
    $("#add-word-modal").classList.add("hidden");
    editingWordId = null;
    resetWordForm();
    $("#word-modal-title").textContent = "새 단어 추가";
    $("#word-form-submit").textContent = "단어 추가";
    $("#btn-auto-word").classList.remove("hidden");
  }

  function resetWordForm() {
    $("#input-word").value = "";
    $("#input-meaning1").value = "";
    $("#input-meaning2").value = "";
    setSelectedLevel("중학생");
    updateAutoButtons();
  }

  function getSelectedLevel() {
    const checked = document.querySelector('input[name="word-level"]:checked');
    return checked ? checked.value : "중학생";
  }

  function setSelectedLevel(level) {
    const radio = document.querySelector(`input[name="word-level"][value="${level}"]`);
    if (radio) radio.checked = true;
  }

  function updateAutoButtons() {
    const hasWord = $("#input-word").value.trim().length > 0;
    if (editingWordId) {
      $("#btn-auto-word").disabled = true;
    } else {
      $("#btn-auto-word").disabled = hasWord;
    }
    $("#btn-auto-meaning").disabled = !hasWord;
  }

  function fillMeaningsAndLevel(entry) {
    $("#input-meaning1").value = entry.meanings[0] || "";
    $("#input-meaning2").value = entry.meanings[1] || "";
    if (entry.level) setSelectedLevel(entry.level);
  }

  function autoSelectWord() {
    if (editingWordId) return;

    if (typeof WORD_BANK === "undefined" || !WORD_BANK.length) {
      alert("단어 은행을 불러올 수 없습니다.");
      return;
    }

    const owned = new Set(words.map((w) => w.word.toLowerCase()));
    const candidates = WORD_BANK.filter((w) => !owned.has(w.word.toLowerCase()));

    if (candidates.length === 0) {
      alert("추가할 수 있는 새 단어가 더 이상 없습니다.");
      return;
    }

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    $("#input-word").value = pick.word;
    fillMeaningsAndLevel(pick);
    updateAutoButtons();
  }

  function autoFindMeaning() {
    const word = $("#input-word").value.trim();
    if (!word) {
      alert("영어 단어를 먼저 입력해 주세요.");
      return;
    }

    const found = findInBank(word);
    if (!found) {
      alert(`"${word}"의 뜻을 단어 은행에서 찾지 못했습니다.\n뜻을 직접 입력해 주세요.`);
      return;
    }

    fillMeaningsAndLevel(found);
  }

  function getWordAccuracyMap() {
    const map = new Map();
    records.forEach((record) => {
      (record.answers || []).forEach((answer) => {
        const key = String(answer.word || "").toLowerCase();
        if (!key) return;
        if (!map.has(key)) map.set(key, { appeared: 0, correct: 0 });
        const stat = map.get(key);
        stat.appeared += 1;
        if (answer.correct) stat.correct += 1;
      });
    });
    return map;
  }

  function getAccuracyRate(word, accuracyMap) {
    const stats = accuracyMap.get(String(word).toLowerCase());
    if (!stats || stats.appeared === 0) return null;
    return stats.correct / stats.appeared;
  }

  function getSortedWords(accuracyMap) {
    const list = [...words];
    if (wordSortMode === "wrong") {
      list.sort((a, b) => {
        const rateA = getAccuracyRate(a.word, accuracyMap);
        const rateB = getAccuracyRate(b.word, accuracyMap);
        const untestedA = rateA === null;
        const untestedB = rateB === null;

        if (untestedA && untestedB) {
          return (b.createdAt || 0) - (a.createdAt || 0);
        }
        if (untestedA) return 1;
        if (untestedB) return -1;
        if (rateA !== rateB) return rateA - rateB;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      return list;
    }

    if (wordSortMode === "alpha") {
      list.sort((a, b) =>
        a.word.localeCompare(b.word, "en", { sensitivity: "base" })
      );
      return list;
    }

    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }

  function updateSortButtons() {
    $$(".sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === wordSortMode);
    });
  }

  function setWordSortMode(mode) {
    if (mode !== "registered" && mode !== "wrong" && mode !== "alpha") return;
    wordSortMode = mode;
    wordPage = 1;
    updateSortButtons();
    renderWordsTable();
  }

  function getWordTotalPages() {
    return Math.max(1, Math.ceil(words.length / WORDS_PER_PAGE));
  }

  function setWordPage(page) {
    const totalPages = getWordTotalPages();
    wordPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    renderWordsTable();
  }

  function renderWordsPagination(totalPages) {
    const nav = $("#words-pagination");
    if (!nav) return;

    if (words.length === 0) {
      nav.classList.add("hidden");
      nav.innerHTML = "";
      return;
    }

    nav.classList.remove("hidden");
    const prevDisabled = wordPage <= 1 ? "disabled" : "";
    const nextDisabled = wordPage >= totalPages ? "disabled" : "";

    const windowSize = 5;
    let start = Math.max(1, wordPage - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    let pageButtons = "";
    if (start > 1) {
      pageButtons += `<button type="button" class="btn btn-sm pagination-page" data-action="word-page" data-page="1">1</button>`;
      if (start > 2) pageButtons += `<span class="pagination-ellipsis">…</span>`;
    }
    for (let p = start; p <= end; p += 1) {
      const active = p === wordPage ? "active" : "";
      pageButtons += `<button type="button" class="btn btn-sm pagination-page ${active}" data-action="word-page" data-page="${p}">${p}</button>`;
    }
    if (end < totalPages) {
      if (end < totalPages - 1) pageButtons += `<span class="pagination-ellipsis">…</span>`;
      pageButtons += `<button type="button" class="btn btn-sm pagination-page" data-action="word-page" data-page="${totalPages}">${totalPages}</button>`;
    }

    nav.innerHTML = `
      <div class="pagination-status">
        <span class="pagination-status-label">페이지</span>
        <strong class="pagination-status-current">${wordPage}</strong>
        <span class="pagination-status-sep">/</span>
        <strong class="pagination-status-total">${totalPages}</strong>
      </div>
      <div class="pagination-controls">
        <button type="button" class="btn btn-sm pagination-nav" data-action="word-page-prev" ${prevDisabled}>이전</button>
        <div class="pagination-pages">${pageButtons}</div>
        <button type="button" class="btn btn-sm pagination-nav" data-action="word-page-next" ${nextDisabled}>다음</button>
      </div>
    `;
  }

  function renderWordsTable() {
    updateSortButtons();
    $("#word-count").textContent = `등록된 단어: ${words.length}개 (시험에는 ${EXAM_SIZE}개 이상 필요)`;
    const tbody = $("#words-table tbody");
    tbody.innerHTML = "";
    const accuracyMap = getWordAccuracyMap();

    const totalPages = getWordTotalPages();
    if (wordPage > totalPages) wordPage = totalPages;
    if (wordPage < 1) wordPage = 1;

    if (words.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="5" style="text-align:center;color:#5a6f7a;">등록된 단어가 없습니다.</td>`;
      tbody.appendChild(tr);
      renderWordsPagination(totalPages);
      return;
    }

    const sorted = getSortedWords(accuracyMap);
    const start = (wordPage - 1) * WORDS_PER_PAGE;
    const pageItems = sorted.slice(start, start + WORDS_PER_PAGE);

    pageItems.forEach((w) => {
      const level = w.level || "중학생";
      const stats = accuracyMap.get(w.word.toLowerCase());
      let accuracyText = "미출제";
      let accuracyClass = "accuracy-none";
      if (stats && stats.appeared > 0) {
        accuracyText = `${Math.round((stats.correct / stats.appeared) * 100)}%`;
        accuracyClass = "accuracy-rate";
      } else if (w.answerRate !== null && w.answerRate !== undefined) {
        accuracyText = `${w.answerRate}%`;
        accuracyClass = "accuracy-rate";
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(w.word)}</td>
        <td class="meanings-cell">${formatMeaningsMultiline(w.meanings)}</td>
        <td><span class="badge ${levelBadgeClass(level)}">${escapeHtml(level)}</span></td>
        <td><span class="${accuracyClass}">${escapeHtml(accuracyText)}</span></td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm btn-ghost" data-edit="${escapeHtml(w.id)}">편집</button>
          <button type="button" class="btn btn-sm btn-danger" data-delete="${escapeHtml(w.id)}">삭제</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    renderWordsPagination(totalPages);
  }

  async function saveWord(e) {
    e.preventDefault();
    if (!ensureFirebaseReady()) return;

    const wordInput = $("#input-word");
    const m1 = $("#input-meaning1");
    const m2 = $("#input-meaning2");

    const word = wordInput.value.trim();
    const meaning1 = m1.value.trim();
    const meaning2 = m2.value.trim();
    const level = getSelectedLevel();

    if (!word || !meaning1) return;

    const exists = words.some(
      (w) => w.word.toLowerCase() === word.toLowerCase() && w.id !== editingWordId
    );
    if (exists) {
      alert("이미 등록된 단어입니다.");
      return;
    }

    const meanings = meaning2 ? [meaning1, meaning2] : [meaning1];

    if (editingWordId) {
      const index = words.findIndex((w) => w.id === editingWordId);
      if (index === -1) {
        alert("편집할 단어를 찾을 수 없습니다.");
        return;
      }
      words[index] = { ...words[index], word, meanings, level };
    } else {
      words.unshift({
        id: uid(),
        word,
        meanings,
        level,
        createdAt: Date.now(),
        answerRate: null,
      });
      wordPage = 1;
    }

    try {
      await saveWords();
    } catch (err) {
      console.error(err);
      alert("단어를 Firebase에 저장하지 못했습니다.");
      return;
    }

    closeAddWordModal();
    renderWordsTable();
  }

  async function deleteWord(id) {
    if (!confirm("이 단어를 삭제할까요?")) return;
    words = words.filter((w) => w.id !== id);
    try {
      await saveWords();
    } catch (err) {
      console.error(err);
      alert("단어를 Firebase에서 삭제하지 못했습니다.");
      return;
    }
    renderWordsTable();
  }

  function openWordFilePicker() {
    if (!ensureFirebaseReady()) return;
    const input = $("#word-file-input");
    input.value = "";
    input.click();
  }

  function parseAnswerRatio(value) {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    if (num >= 0 && num <= 1) return Math.round(num * 100);
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  function parseWordImportList(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed) return [];

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) throw new Error("empty");
      parsed = lines.map((line) => JSON.parse(line));
    }

    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    throw new Error("invalid");
  }

  async function handleWordFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;

    let entries;
    try {
      const text = await file.text();
      entries = parseWordImportList(text);
    } catch (err) {
      console.error(err);
      alert("JSON 파일을 읽지 못했습니다. 파일 형식을 확인해 주세요.");
      return;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      alert("추가할 단어 데이터가 없습니다.");
      return;
    }

    const owned = new Set(words.map((w) => w.word.toLowerCase()));
    let addedCount = 0;
    const now = Date.now();

    entries.forEach((item, index) => {
      if (!item || typeof item !== "object") return;

      const word = String(item.word || "").trim();
      const meaning1 = String(item.meaning1 || "").trim();
      const meaning2 = String(item.meaning2 || "").trim();
      const levelRaw = String(item.level || "").trim();
      const level = LEVELS.includes(levelRaw) ? levelRaw : "중학생";
      const answerRate = parseAnswerRatio(
        item["answer-ratio"] ?? item["answer-rartio"] ?? item.answer_ratio ?? item.answerRate
      );

      if (!word || !meaning1) return;
      if (owned.has(word.toLowerCase())) return;

      const meanings = meaning2 ? [meaning1, meaning2] : [meaning1];
      words.unshift({
        id: uid(),
        word,
        meanings,
        level,
        createdAt: now - index,
        answerRate,
      });
      owned.add(word.toLowerCase());
      addedCount += 1;
    });

    if (addedCount === 0) {
      alert("추가된 단어가 없습니다. (이미 등록된 단어이거나 형식이 올바르지 않습니다.)");
      return;
    }

    try {
      await saveWords();
    } catch (err) {
      console.error(err);
      alert("단어를 Firebase에 저장하지 못했습니다.");
      return;
    }

    wordPage = 1;
    renderWordsTable();
    showImportResultModal(addedCount);
  }

  function showImportResultModal(addedCount) {
    $("#import-result-message").textContent = `${addedCount}개의 단어가 추가되었습니다.`;
    $("#import-result-modal").classList.remove("hidden");
  }

  function closeImportResultModal() {
    $("#import-result-modal").classList.add("hidden");
  }

  /* ---------- 시험 기록 ---------- */

  function openRecords() {
    if (!ensureFirebaseReady()) return;
    renderRecordsTable();
    showScreen("screen-records");
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${day} ${h}:${mi}`;
  }

  function renderRecordsTable() {
    const tbody = $("#records-table tbody");
    tbody.innerHTML = "";
    const empty = $("#records-empty");

    if (records.length === 0) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    records.forEach((r) => {
      const rate = Math.round((r.correctCount / EXAM_SIZE) * 100);
      const elapsed = formatElapsedMinutesSeconds(r.elapsedMs);
      const tr = document.createElement("tr");
      tr.className = "clickable-row";
      tr.dataset.detail = r.id;
      tr.setAttribute("role", "button");
      tr.tabIndex = 0;
      tr.innerHTML = `
        <td>${formatDate(r.date)}</td>
        <td>${r.correctCount}</td>
        <td>${r.wrongCount}</td>
        <td>${rate}%</td>
        <td class="elapsed-cell">${elapsed}</td>
        <td><button type="button" class="btn btn-sm btn-ghost" data-detail="${escapeHtml(r.id)}">상세</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function openRecordDetail(id) {
    const record = records.find((r) => r.id === id);
    if (!record) return;

    const total = record.answers?.length || EXAM_SIZE;
    const correctCount = record.correctCount ?? record.answers.filter((a) => a.correct).length;
    const rate = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    $("#detail-title").textContent = `시험 상세 — ${formatDate(record.date)}`;
    $("#detail-summary").innerHTML = `
      <p>${total} 문제 중 ${correctCount} 문제 정답</p>
      <p>정답율 ${rate}%</p>
      <p>경과시간 ${formatElapsedResult(record.elapsedMs)}</p>
    `;

    const tbody = $("#detail-table tbody");
    tbody.innerHTML = "";

    record.answers.forEach((a, i) => {
      const fromWords = words.find((w) => w.word.toLowerCase() === String(a.word).toLowerCase());
      const level = a.level || fromWords?.level || "중학생";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(a.word)}</td>
        <td class="meanings-cell">${formatMeaningsMultiline(a.meanings)}</td>
        <td><span class="badge ${levelBadgeClass(level)}">${escapeHtml(level)}</span></td>
        <td><span class="badge ${a.correct ? "badge-correct" : "badge-wrong"}">${
          a.correct ? "맞음" : "틀림"
        }</span></td>
      `;
      tbody.appendChild(tr);
    });

    $("#record-detail-modal").classList.remove("hidden");
  }

  function closeModal() {
    $("#record-detail-modal").classList.add("hidden");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- 이벤트 ---------- */

  document.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === "start-exam") startExam();
      else if (action === "manage-words") openWordManage();
      else if (action === "view-records") openRecords();
      else if (action === "go-home") goHome();
      else if (action === "open-add-word") openAddWordModal();
      else if (action === "close-add-word") closeAddWordModal();
      else if (action === "close-modal") closeModal();
      else if (action === "sort-words") setWordSortMode(actionEl.dataset.sort);
      else if (action === "logout") logout();
      else if (action === "admin-logout") adminLogout();
      else if (action === "open-add-user") openAddUserModal();
      else if (action === "close-user-modal") closeUserModal();
      else if (action === "open-admin-login") openAdminLoginModal();
      else if (action === "close-admin-login") closeAdminLoginModal();
      else if (action === "import-words-file") openWordFilePicker();
      else if (action === "close-import-result") closeImportResultModal();
      else if (action === "close-exam-level") closeExamLevelModal();
      else if (action === "select-exam-level") beginExamWithLevel(actionEl.dataset.examLevel);
      else if (action === "word-page") setWordPage(actionEl.dataset.page);
      else if (action === "word-page-prev") setWordPage(wordPage - 1);
      else if (action === "word-page-next") setWordPage(wordPage + 1);
    }

    const deleteBtn = e.target.closest("[data-delete]");
    if (deleteBtn) deleteWord(deleteBtn.dataset.delete);

    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) openEditWordModal(editBtn.dataset.edit);

    const userDeleteBtn = e.target.closest("[data-user-delete]");
    if (userDeleteBtn) deleteUser(userDeleteBtn.dataset.userDelete);

    const userEditBtn = e.target.closest("[data-user-edit]");
    if (userEditBtn) openEditUserModal(userEditBtn.dataset.userEdit);

    const detailEl = e.target.closest("[data-detail]");
    if (detailEl) openRecordDetail(detailEl.dataset.detail);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("tr.clickable-row[data-detail]");
    if (!row) return;
    e.preventDefault();
    openRecordDetail(row.dataset.detail);
  });

  $("#btn-show-meaning").addEventListener("click", showMeaning);
  $("#btn-correct").addEventListener("click", () => answerQuestion(true));
  $("#btn-wrong").addEventListener("click", () => answerQuestion(false));
  $("#word-form").addEventListener("submit", saveWord);
  $("#btn-auto-word").addEventListener("click", autoSelectWord);
  $("#btn-auto-meaning").addEventListener("click", autoFindMeaning);
  $("#input-word").addEventListener("input", updateAutoButtons);
  $("#login-form").addEventListener("submit", handleLogin);
  $("#admin-login-form").addEventListener("submit", handleAdminLogin);
  $("#admin-password-form").addEventListener("submit", handleAdminPasswordChange);
  $("#user-form").addEventListener("submit", saveUser);
  $("#word-file-input").addEventListener("change", handleWordFileSelected);

  async function init() {
    updateAutoButtons();
    renderHomeDateTime();
    setInterval(renderHomeDateTime, 1000);
    showLoginScreen();

    try {
      await loadAccounts();
    } catch (err) {
      console.error(err);
      accountReady = true;
      adminPassword = DEFAULT_ADMIN_PASSWORD;
      users = [];
      alert(
        "Firebase 계정 정보를 불러오지 못했습니다.\nRealtime Database 규칙에서 읽기/쓰기가 허용되어 있는지 확인해 주세요."
      );
    }
  }

  init();
})();
