(() => {
  "use strict";

  const STORAGE_WORDS = "wordmemo_words";
  const STORAGE_RECORDS = "wordmemo_records";
  const EXAM_SIZE = 10;
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

  let words = loadWords();
  let records = loadRecords();
  let examQueue = [];
  let examIndex = 0;
  let examAnswers = [];
  let editingWordId = null;
  let wordSortMode = "registered";
  let examStartedAt = 0;
  let examElapsedMs = 0;
  let examTimerId = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function normalizeWord(entry, index = 0, total = 1) {
    const fromBank = findInBank(entry.word);
    return {
      id: entry.id || uid(),
      word: entry.word,
      meanings: Array.isArray(entry.meanings) ? entry.meanings.slice(0, 2) : [],
      level: LEVELS.includes(entry.level) ? entry.level : fromBank?.level || "중학생",
      createdAt: entry.createdAt || Date.now() - (total - index) * 1000,
    };
  }

  function loadWords() {
    try {
      const raw = localStorage.getItem(STORAGE_WORDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = parsed.map((w, i, arr) => normalizeWord(w, i, arr.length));
          const needsSave = parsed.some((w) => !w.createdAt);
          if (needsSave) {
            localStorage.setItem(STORAGE_WORDS, JSON.stringify(normalized));
          }
          return normalized;
        }
      }
    } catch (_) {
      /* ignore */
    }
    const defaults = structuredClone(DEFAULT_WORDS).map((w, i, arr) =>
      normalizeWord(w, i, arr.length)
    );
    return defaults;
  }

  function saveWords() {
    localStorage.setItem(STORAGE_WORDS, JSON.stringify(words));
  }

  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_RECORDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {
      /* ignore */
    }
    return [];
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_RECORDS, JSON.stringify(records));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
    renderHomeStats();
    showScreen("screen-home");
  }

  function startExam() {
    if (words.length < EXAM_SIZE) {
      alert(
        `시험에는 최소 ${EXAM_SIZE}개의 단어가 필요합니다.\n현재 ${words.length}개입니다. 단어 관리에서 단어를 추가해 주세요.`
      );
      return;
    }

    examQueue = shuffle(words).slice(0, EXAM_SIZE);
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

  function finishExam() {
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
    saveRecords();

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
        <td>${escapeHtml(formatMeanings(a.meanings))}</td>
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
    closeAddWordModal();
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
    updateSortButtons();
    renderWordsTable();
  }

  function renderWordsTable() {
    updateSortButtons();
    $("#word-count").textContent = `등록된 단어: ${words.length}개 (시험에는 ${EXAM_SIZE}개 이상 필요)`;
    const tbody = $("#words-table tbody");
    tbody.innerHTML = "";
    const accuracyMap = getWordAccuracyMap();

    if (words.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="5" style="text-align:center;color:#5a6f7a;">등록된 단어가 없습니다.</td>`;
      tbody.appendChild(tr);
      return;
    }

    getSortedWords(accuracyMap).forEach((w) => {
      const level = w.level || "중학생";
      const stats = accuracyMap.get(w.word.toLowerCase());
      const accuracyText =
        !stats || stats.appeared === 0
          ? "미출제"
          : `${Math.round((stats.correct / stats.appeared) * 100)}%`;
      const accuracyClass =
        !stats || stats.appeared === 0 ? "accuracy-none" : "accuracy-rate";

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
  }

  function saveWord(e) {
    e.preventDefault();
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
      words.unshift({ id: uid(), word, meanings, level, createdAt: Date.now() });
    }

    saveWords();
    closeAddWordModal();
    renderWordsTable();
  }

  function deleteWord(id) {
    if (!confirm("이 단어를 삭제할까요?")) return;
    words = words.filter((w) => w.id !== id);
    saveWords();
    renderWordsTable();
  }

  /* ---------- 시험 기록 ---------- */

  function openRecords() {
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
        <td>${escapeHtml(formatMeanings(a.meanings))}</td>
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
    }

    const deleteBtn = e.target.closest("[data-delete]");
    if (deleteBtn) deleteWord(deleteBtn.dataset.delete);

    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) openEditWordModal(editBtn.dataset.edit);

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

  updateAutoButtons();
  renderHomeStats();
  renderHomeDateTime();
  setInterval(renderHomeDateTime, 1000);
})();
