(() => {
  "use strict";

  const WORD_LENGTH = 5;
  const MAX_ATTEMPTS = 6;
  const STATS_KEY = "slovli_stats_v1";
  const RANDOM_KEY = "slovli_random_v1";
  const LAST_MODE_KEY = "slovli_last_mode_v1";
  const DAILY_PREFIX = "slovli_daily_v1_";

  const STATUS_PRIORITY = { absent: 1, present: 2, correct: 3 };
  const KEYBOARD_LAYOUT = [
    ["Й", "Ц", "У", "К", "Е", "Н", "Г", "Ш", "Щ", "З", "Х", "Ъ"],
    ["Ф", "Ы", "В", "А", "П", "Р", "О", "Л", "Д", "Ж", "Э"],
    ["ENTER", "Я", "Ч", "С", "М", "И", "Т", "Ь", "Б", "Ю", "BACKSPACE"],
  ];
  const RU_LETTER_RE = /^[А-Я]$/;
  const RU_WORD_RE = /^[А-Я]{5}$/;
  const DEFAULT_CAT_SRC = "./cat-timer.jpg";
  const END_CAT_SRC = "./cat-end.jpg";
  const EN_TO_RU_KEY_MAP = {
    Q: "Й", W: "Ц", E: "У", R: "К", T: "Е", Y: "Н", U: "Г", I: "Ш", O: "Щ", P: "З", "[": "Х", "]": "Ъ",
    A: "Ф", S: "Ы", D: "В", F: "А", G: "П", H: "Р", J: "О", K: "Л", L: "Д", ";": "Ж", "'": "Э",
    Z: "Я", X: "Ч", C: "С", V: "М", B: "И", N: "Т", M: "Ь", ",": "Б", ".": "Ю",
  };

  const boardEl = document.getElementById("board");
  const keyboardEl = document.getElementById("keyboard");
  const gameInfoEl = document.getElementById("gameInfo");
  const statusTextEl = document.getElementById("statusText");
  const modeDailyBtn = document.getElementById("modeDailyBtn");
  const modeRandomBtn = document.getElementById("modeRandomBtn");
  const newRandomBtn = document.getElementById("newRandomBtn");
  const shareBtn = document.getElementById("shareBtn");
  const dailyCountdownEl = document.getElementById("dailyCountdown");
  const timerCatImgEl = document.getElementById("timerCatImg");

  const statPlayedEl = document.getElementById("statPlayed");
  const statWinsEl = document.getElementById("statWins");
  const statWinrateEl = document.getElementById("statWinrate");
  const statStreakEl = document.getElementById("statStreak");

  const normalizeWord = (word) => String(word || "").trim().toUpperCase().replace(/Ё/g, "Е");
  const solutions = (Array.isArray(window.WORDLY_SOLUTION_WORDS) ? window.WORDLY_SOLUTION_WORDS : [])
    .map(normalizeWord)
    .filter((word) => RU_WORD_RE.test(word));
  const allowed = (Array.isArray(window.WORDLY_ALLOWED_WORDS) ? window.WORDLY_ALLOWED_WORDS : [])
    .map(normalizeWord)
    .filter((word) => RU_WORD_RE.test(word));
  const allowedSet = new Set(allowed);

  if (solutions.length === 0 || allowed.length === 0) {
    statusTextEl.textContent = "Словари не загружены";
    return;
  }

  let state = null;
  let toastTimer = null;
  let countdownIntervalId = null;

  function getTodayStampLocal() {
    const now = new Date();
    const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor(localMidnight.getTime() / 86400000);
  }

  function msToNextLocalMidnight() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return Math.max(0, next.getTime() - now.getTime());
  }

  function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

  function updateDailyCountdown() {
    if (dailyCountdownEl) {
      dailyCountdownEl.textContent = formatCountdown(msToNextLocalMidnight());
    }

    if (!state || state.mode !== "daily") {
      return;
    }

    const todayStamp = getTodayStampLocal();
    if (todayStamp !== state.stamp) {
      startGame("daily", false);
      setStatus("Новое слово уже доступно", false);
    }
  }

  function startCountdownTicker() {
    if (countdownIntervalId) {
      clearInterval(countdownIntervalId);
    }
    updateDailyCountdown();
    countdownIntervalId = setInterval(updateDailyCountdown, 1000);
  }

  function dailySolution(stamp) {
    const idx = ((stamp % solutions.length) + solutions.length) % solutions.length;
    return solutions[idx];
  }

  function randomSolution() {
    const idx = Math.floor(Math.random() * solutions.length);
    return { word: solutions[idx], randomId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function statsDefault() {
    return {
      played: 0,
      wins: 0,
      streak: 0,
      bestStreak: 0,
      distribution: [0, 0, 0, 0, 0, 0],
      lastDailyStamp: null,
    };
  }

  function loadStats() {
    const data = loadJson(STATS_KEY, statsDefault());
    return {
      played: Number.isFinite(data.played) ? data.played : 0,
      wins: Number.isFinite(data.wins) ? data.wins : 0,
      streak: Number.isFinite(data.streak) ? data.streak : 0,
      bestStreak: Number.isFinite(data.bestStreak) ? data.bestStreak : 0,
      distribution: Array.isArray(data.distribution) && data.distribution.length === 6
        ? data.distribution.map((v) => (Number.isFinite(v) ? v : 0))
        : [0, 0, 0, 0, 0, 0],
      lastDailyStamp: Number.isFinite(data.lastDailyStamp) ? data.lastDailyStamp : null,
    };
  }

  function saveStats(stats) {
    saveJson(STATS_KEY, stats);
  }

  function updateStatsUi() {
    const stats = loadStats();
    const winrate = stats.played > 0 ? Math.round((stats.wins / stats.played) * 100) : 0;
    statPlayedEl.textContent = String(stats.played);
    statWinsEl.textContent = String(stats.wins);
    statWinrateEl.textContent = `${winrate}%`;
    statStreakEl.textContent = String(stats.streak);
  }

  function emptyState(mode, solution, stamp, randomId) {
    return {
      mode,
      solution,
      stamp: Number.isFinite(stamp) ? stamp : null,
      randomId: randomId || null,
      guesses: [],
      evaluations: [],
      currentGuess: "",
      gameOver: false,
      won: false,
      statsRecorded: false,
    };
  }

  function sanitizeLoadedState(raw, mode, solution, stamp, randomId) {
    if (!raw || typeof raw !== "object") {
      return emptyState(mode, solution, stamp, randomId);
    }

    const guesses = Array.isArray(raw.guesses) ? raw.guesses : [];
    const evaluations = Array.isArray(raw.evaluations) ? raw.evaluations : [];

    const safeGuesses = guesses
      .map((g) => normalizeWord(g))
      .filter((g) => RU_WORD_RE.test(g))
      .slice(0, MAX_ATTEMPTS);

    const safeEvaluations = evaluations
      .filter((row) => Array.isArray(row) && row.length === WORD_LENGTH)
      .slice(0, MAX_ATTEMPTS)
      .map((row) => row.map((mark) => (["correct", "present", "absent"].includes(mark) ? mark : "absent")));

    const count = Math.min(safeGuesses.length, safeEvaluations.length);

    return {
      mode,
      solution,
      stamp: Number.isFinite(stamp) ? stamp : null,
      randomId: randomId || null,
      guesses: safeGuesses.slice(0, count),
      evaluations: safeEvaluations.slice(0, count),
      currentGuess: typeof raw.currentGuess === "string"
        ? normalizeWord(raw.currentGuess).replace(/[^А-Я]/g, "").slice(0, WORD_LENGTH)
        : "",
      gameOver: Boolean(raw.gameOver),
      won: Boolean(raw.won),
      statsRecorded: Boolean(raw.statsRecorded),
    };
  }

  function stateStorageKey(mode, stamp) {
    return mode === "daily" ? `${DAILY_PREFIX}${stamp}` : RANDOM_KEY;
  }

  function saveState() {
    saveJson(stateStorageKey(state.mode, state.stamp), state);
    localStorage.setItem(LAST_MODE_KEY, state.mode);
  }

  function loadDailyState() {
    const stamp = getTodayStampLocal();
    const solution = dailySolution(stamp);
    const key = stateStorageKey("daily", stamp);
    const raw = loadJson(key, null);

    if (!raw || raw.solution !== solution) {
      return emptyState("daily", solution, stamp, null);
    }

    return sanitizeLoadedState(raw, "daily", solution, stamp, null);
  }

  function loadRandomState(forceNew) {
    if (!forceNew) {
      const raw = loadJson(RANDOM_KEY, null);
      if (raw && typeof raw.solution === "string" && RU_WORD_RE.test(normalizeWord(raw.solution))) {
        return sanitizeLoadedState(raw, "random", normalizeWord(raw.solution), null, raw.randomId || null);
      }
    }

    const rnd = randomSolution();
    return emptyState("random", rnd.word, null, rnd.randomId);
  }

  function setStatus(text, sticky = false) {
    statusTextEl.textContent = text;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (!sticky && text) {
      toastTimer = setTimeout(() => {
        if (!state.gameOver) {
          statusTextEl.textContent = "";
        }
      }, 2200);
    }
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    for (let row = 0; row < MAX_ATTEMPTS; row += 1) {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      for (let col = 0; col < WORD_LENGTH; col += 1) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        rowEl.appendChild(cell);
      }
      boardEl.appendChild(rowEl);
    }
  }

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    for (const row of KEYBOARD_LAYOUT) {
      const rowEl = document.createElement("div");
      rowEl.className = "kb-row";
      for (const key of row) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key";
        if (key === "ENTER" || key === "BACKSPACE") btn.classList.add("key-wide");
        btn.dataset.key = key;
        btn.textContent = key === "BACKSPACE" ? "⌫" : key;
        rowEl.appendChild(btn);
      }
      keyboardEl.appendChild(rowEl);
    }
  }

  function evaluateGuess(guess, solution) {
    const marks = Array(WORD_LENGTH).fill("absent");
    const counts = {};

    for (const ch of solution) counts[ch] = (counts[ch] || 0) + 1;

    for (let i = 0; i < WORD_LENGTH; i += 1) {
      if (guess[i] === solution[i]) {
        marks[i] = "correct";
        counts[guess[i]] -= 1;
      }
    }

    for (let i = 0; i < WORD_LENGTH; i += 1) {
      if (marks[i] !== "absent") continue;
      const ch = guess[i];
      if ((counts[ch] || 0) > 0) {
        marks[i] = "present";
        counts[ch] -= 1;
      }
    }

    return marks;
  }

  function keyboardStatuses() {
    const statusMap = {};

    for (let row = 0; row < state.guesses.length; row += 1) {
      const guess = state.guesses[row];
      const marks = state.evaluations[row];
      for (let i = 0; i < WORD_LENGTH; i += 1) {
        const ch = guess[i];
        const next = marks[i];
        const prev = statusMap[ch];
        if (!prev || STATUS_PRIORITY[next] > STATUS_PRIORITY[prev]) {
          statusMap[ch] = next;
        }
      }
    }

    return statusMap;
  }

  function renderBoard() {
    const cells = boardEl.querySelectorAll(".cell");
    cells.forEach((cell) => {
      cell.textContent = "";
      cell.className = "cell";
    });

    for (let row = 0; row < MAX_ATTEMPTS; row += 1) {
      let word = "";
      let marks = null;

      if (row < state.guesses.length) {
        word = state.guesses[row];
        marks = state.evaluations[row];
      } else if (row === state.guesses.length && !state.gameOver) {
        word = state.currentGuess;
      }

      for (let col = 0; col < WORD_LENGTH; col += 1) {
        const cell = boardEl.querySelector(`.cell[data-row=\"${row}\"][data-col=\"${col}\"]`);
        const ch = word[col] || "";
        cell.textContent = ch;

        if (ch) cell.classList.add("filled");
        if (marks) cell.classList.add(marks[col]);
      }
    }
  }

  function renderKeyboard() {
    const keyState = keyboardStatuses();
    keyboardEl.querySelectorAll(".key").forEach((keyEl) => {
      keyEl.classList.remove("correct", "present", "absent", "used", "unused");
      const key = keyEl.dataset.key;
      if (RU_LETTER_RE.test(key) && keyState[key]) {
        keyEl.classList.add("used");
        keyEl.classList.add(keyState[key]);
      } else if (RU_LETTER_RE.test(key)) {
        keyEl.classList.add("unused");
      }
      keyEl.disabled = state.gameOver && key !== "ENTER";
    });
  }

  function renderMeta() {
    const modeLabel = state.mode === "daily" ? "Ежедневно" : "Случайно";
    const puzzleLabel = state.mode === "daily" ? `#${state.stamp}` : `${state.randomId?.slice(-6) || "локал"}`;
    gameInfoEl.textContent = `${modeLabel} • ${puzzleLabel} • ${state.guesses.length}/${MAX_ATTEMPTS}`;

    modeDailyBtn.classList.toggle("is-active", state.mode === "daily");
    modeRandomBtn.classList.toggle("is-active", state.mode === "random");
    newRandomBtn.disabled = state.mode !== "random";
    shareBtn.disabled = !state.gameOver;
  }

  function syncTimerCatImage() {
    if (!timerCatImgEl) {
      return;
    }

    const targetSrc = state && state.gameOver ? END_CAT_SRC : DEFAULT_CAT_SRC;
    if (timerCatImgEl.dataset.currentSrc === targetSrc) {
      return;
    }

    timerCatImgEl.dataset.currentSrc = targetSrc;
    timerCatImgEl.dataset.fallbackApplied = "";
    timerCatImgEl.style.display = "";
    timerCatImgEl.src = targetSrc;
  }

  function renderAll() {
    syncTimerCatImage();
    renderMeta();
    renderBoard();
    renderKeyboard();
    updateStatsUi();
  }

  function applyStatsResult(won) {
    const stats = loadStats();

    stats.played += 1;
    if (won) stats.wins += 1;

    if (state.mode === "daily") {
      if (won) {
        if (stats.lastDailyStamp === state.stamp - 1) {
          stats.streak += 1;
        } else if (stats.lastDailyStamp !== state.stamp) {
          stats.streak = 1;
        }
      } else {
        stats.streak = 0;
      }
      stats.lastDailyStamp = state.stamp;
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    }

    if (won) {
      const index = Math.max(0, Math.min(5, state.guesses.length - 1));
      stats.distribution[index] += 1;
    }

    saveStats(stats);
  }

  function finishGame(won) {
    state.gameOver = true;
    state.won = won;

    if (!state.statsRecorded) {
      applyStatsResult(won);
      state.statsRecorded = true;
    }

    if (won) {
      setStatus(`Отлично! Слово: ${state.solution}`, true);
    } else {
      setStatus(`Не угадал. Слово: ${state.solution}`, true);
    }

    saveState();
    renderAll();
  }

  function submitGuess() {
    if (state.gameOver) return;

    if (state.currentGuess.length < WORD_LENGTH) {
      setStatus("Нужно 5 букв");
      return;
    }

    const guess = state.currentGuess;
    if (!allowedSet.has(guess)) {
      setStatus("Такого слова нет в словаре");
      return;
    }

    const marks = evaluateGuess(guess, state.solution);
    state.guesses.push(guess);
    state.evaluations.push(marks);
    state.currentGuess = "";

    if (guess === state.solution) {
      finishGame(true);
      return;
    }

    if (state.guesses.length >= MAX_ATTEMPTS) {
      finishGame(false);
      return;
    }

    setStatus("Отлично, следующая попытка");
    saveState();
    renderAll();
  }

  function handleInput(rawKey) {
    let key = String(rawKey || "").toUpperCase().replace("Ё", "Е");
    if (!key) return;

    if (Object.prototype.hasOwnProperty.call(EN_TO_RU_KEY_MAP, key)) {
      key = EN_TO_RU_KEY_MAP[key];
    }

    if (key === "ENTER") {
      submitGuess();
      return;
    }

    if (key === "BACKSPACE") {
      if (state.gameOver) return;
      state.currentGuess = state.currentGuess.slice(0, -1);
      saveState();
      renderAll();
      return;
    }

    if (!RU_LETTER_RE.test(key)) return;
    if (state.gameOver) return;
    if (state.currentGuess.length >= WORD_LENGTH) return;

    state.currentGuess += key;
    saveState();
    renderAll();
  }

  function shareResult() {
    if (!state.gameOver) return;

    const score = state.won ? `${state.guesses.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
    const puzzle = state.mode === "daily" ? `Ежедневно ${state.stamp}` : `Случайно ${state.randomId?.slice(-6) || "локал"}`;

    const grid = state.evaluations
      .map((row) => row.map((mark) => {
        if (mark === "correct") return "🟩";
        if (mark === "present") return "🟨";
        return "⬛";
      }).join(""))
      .join("\n");

    const text = `СЛОВЛИ ${puzzle} ${score}\n${grid}\n${location.origin}${location.pathname}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => setStatus("Результат скопирован", false))
        .catch(() => setStatus("Не удалось скопировать", false));
      return;
    }

    setStatus("Копирование недоступно в этом браузере", false);
  }

  function startGame(mode, forceNewRandom = false) {
    if (mode === "daily") {
      state = loadDailyState();
    } else {
      state = loadRandomState(forceNewRandom);
    }

    saveState();

    if (state.gameOver) {
      if (state.won) {
        setStatus(`Игра завершена: победа (${state.solution})`, true);
      } else {
        setStatus(`Игра завершена: слово ${state.solution}`, true);
      }
    } else {
      setStatus("");
    }

    renderAll();
  }

  function bindEvents() {
    keyboardEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".key");
      if (!btn) return;
      handleInput(btn.dataset.key);
    });

    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      if (key === "Enter") {
        event.preventDefault();
        handleInput("ENTER");
        return;
      }
      if (key === "Backspace") {
        event.preventDefault();
        handleInput("BACKSPACE");
        return;
      }
      if (/^[a-zA-Zа-яА-ЯёЁ\[\];'.,]$/.test(key)) {
        handleInput(key);
      }
    });

    modeDailyBtn.addEventListener("click", () => startGame("daily", false));
    modeRandomBtn.addEventListener("click", () => startGame("random", false));
    newRandomBtn.addEventListener("click", () => startGame("random", true));
    shareBtn.addEventListener("click", shareResult);
  }

  function init() {
    buildBoard();
    buildKeyboard();
    bindEvents();
    startCountdownTicker();

    if (timerCatImgEl) {
      timerCatImgEl.addEventListener("error", () => {
        if (!timerCatImgEl.dataset.fallbackApplied) {
          timerCatImgEl.dataset.fallbackApplied = "1";
          timerCatImgEl.src = "./cat-timer-fallback.svg";
          return;
        }
        timerCatImgEl.style.display = "none";
      });
    }

    const lastMode = localStorage.getItem(LAST_MODE_KEY);
    if (lastMode === "random") {
      startGame("random", false);
    } else {
      startGame("daily", false);
    }
  }

  init();
})();
