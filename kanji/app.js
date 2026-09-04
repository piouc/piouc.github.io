(() => {
  let KANJI_DATA = {};

  const KEY = "kanjiApp.v1";
  const MAX_SESSIONS = 100;

  const defaults = () => ({
    settings: { levels: ["10"], count: 10 },
    mistakes: {},
    stats: { byLevel: {}, sessions: [] }
  });

  let cache = null;

  const loadStore = () => {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(KEY);
      cache = raw ? JSON.parse(raw) : defaults();
    } catch {
      cache = defaults();
    }
    if (!cache || typeof cache !== "object") cache = defaults();
    cache.settings ??= defaults().settings;
    cache.mistakes ??= {};
    cache.stats ??= defaults().stats;
    cache.stats.byLevel ??= {};
    cache.stats.sessions ??= [];
    return cache;
  };

  const saveStore = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(loadStore()));
    } catch {}
  };

  const storage = {
    getSettings: () => loadStore().settings,

    saveSettings(settings) {
      loadStore().settings = settings;
      saveStore();
    },

    recordAnswer(kanji, level, correct, isReview) {
      const data = loadStore();
      const by = data.stats.byLevel[level] ?? { correct: 0, total: 0 };
      by.total += 1;
      if (correct) by.correct += 1;
      data.stats.byLevel[level] = by;

      if (correct) {
        if (isReview && data.mistakes[kanji]) delete data.mistakes[kanji];
      } else {
        const m = data.mistakes[kanji] ?? { count: 0, last: 0, level };
        m.count += 1;
        m.last = Date.now();
        m.level = level;
        data.mistakes[kanji] = m;
      }
      saveStore();
    },

    addSession(session) {
      const data = loadStore();
      data.stats.sessions.push(session);
      if (data.stats.sessions.length > MAX_SESSIONS) {
        data.stats.sessions = data.stats.sessions.slice(-MAX_SESSIONS);
      }
      saveStore();
    },

    getMistakes: () => loadStore().mistakes,
    mistakeCount: () => Object.keys(loadStore().mistakes).length,
    getStats: () => loadStore().stats,

    resetAll() {
      cache = defaults();
      saveStore();
    }
  };

  const LEVELS = [
    { key: "10", label: "10級", sub: "小学1年" },
    { key: "9", label: "9級", sub: "小学2年" },
    { key: "8", label: "8級", sub: "小学3年" },
    { key: "7", label: "7級", sub: "小学4年" },
    { key: "6", label: "6級", sub: "小学5年" },
    { key: "5", label: "5級", sub: "小学6年" },
    { key: "4", label: "4級", sub: "中学在学" },
    { key: "3", label: "3級", sub: "中学卒業" },
    { key: "pre2", label: "準2級", sub: "高校在学" },
    { key: "2", label: "2級", sub: "高校卒業" }
  ];

  const dataFor = levelKey => KANJI_DATA[levelKey] ?? [];

  let kanjiIndex = null;
  const buildIndex = () => {
    if (kanjiIndex) return kanjiIndex;
    kanjiIndex = {};
    for (const lv of LEVELS) {
      for (const q of dataFor(lv.key)) {
        kanjiIndex[q.kanji] = { question: q, level: lv.key };
      }
    }
    return kanjiIndex;
  };

  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const quiz = {
    levelLabel: key => LEVELS.find(lv => lv.key === key)?.label ?? key,

    countFor: levelKey => dataFor(levelKey).length,

    buildPool: levelKeys =>
      levelKeys.flatMap(key =>
        dataFor(key).map(q => ({ ...q, level: key }))
      ),

    buildReviewPool() {
      const idx = buildIndex();
      return Object.keys(storage.getMistakes())
        .map(kanji => idx[kanji])
        .filter(Boolean)
        .map(({ question, level }) => ({ ...question, level }));
    },

    createSession(pool, count, mode) {
      let questions = shuffle([...pool]);
      if (count > 0 && questions.length > count) questions = questions.slice(0, count);
      return { mode, questions, current: 0, results: [] };
    },

    currentQuestion: session => session.questions[session.current],

    submitGrade(session, correct) {
      const q = session.questions[session.current];
      session.results.push({ question: q, correct });
      storage.recordAnswer(q.kanji, q.level, correct, session.mode === "review");
      session.current += 1;
      return session.current >= session.questions.length;
    }
  };

  const LINE_WIDTH = 7;
  const LINE_COLOR = "#33302a";

  const createPad = (canvas, canDraw) => {
    const ctx = canvas.getContext("2d");
    let strokes = [];
    let currentStroke = null;
    let activePointerId = null;
    let cssSize = 0;

    const drawStroke = points => {
      if (!points.length) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      if (points.length < 3) {
        for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
      } else {
        for (let j = 1; j < points.length - 1; j++) {
          const mx = (points[j].x + points[j + 1].x) / 2;
          const my = (points[j].y + points[j + 1].y) / 2;
          ctx.quadraticCurveTo(points[j].x, points[j].y, mx, my);
        }
        const last = points.at(-1);
        ctx.lineTo(last.x, last.y);
      }
      ctx.stroke();
    };

    const redraw = () => {
      ctx.clearRect(0, 0, cssSize, cssSize);
      strokes.forEach(drawStroke);
      if (currentStroke) drawStroke(currentStroke);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      cssSize = rect.width;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = LINE_WIDTH;
      redraw();
    };

    const toLocal = e => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    canvas.addEventListener("pointerdown", e => {
      if (activePointerId !== null) return;
      if (canDraw && !canDraw()) return;
      activePointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      currentStroke = [toLocal(e)];
      redraw();
    });

    canvas.addEventListener("pointermove", e => {
      if (e.pointerId !== activePointerId || !currentStroke) return;
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) currentStroke.push(toLocal(ev));
      redraw();
    });

    const endStroke = e => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      if (currentStroke?.length) strokes.push(currentStroke);
      currentStroke = null;
      redraw();
    };
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 100);
    });

    resize();

    return {
      clear() {
        strokes = [];
        currentStroke = null;
        redraw();
      },
      undo() {
        strokes.pop();
        redraw();
      },
      isEmpty: () => strokes.length === 0 && !currentStroke,
      resize
    };
  };

  const MAX_KNOB = 80;
  const THRESHOLD = 56;

  const markSvg = kind => kind === "correct"
    ? '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 100 100"><line x1="20" y1="20" x2="80" y2="80" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><line x1="80" y1="20" x2="20" y2="80" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';

  const createGrader = opts => {
    const btn = opts.button;
    let activePointerId = null;
    let startX = 0;
    let tentative = null;

    const setTentative = next => {
      if (next === tentative) return;
      tentative = next;
      opts.hintCorrect.classList.toggle("active", next === "correct");
      opts.hintWrong.classList.toggle("active", next === "wrong");
      if (next) {
        opts.judgeMark.hidden = false;
        opts.judgeMark.innerHTML = markSvg(next);
        opts.judgeMark.className = `judge-mark ${next}`;
      } else {
        opts.judgeMark.hidden = true;
      }
    };

    const onMove = e => {
      if (e.pointerId !== activePointerId) return;
      const dx = e.clientX - startX;
      const knob = Math.max(-MAX_KNOB, Math.min(MAX_KNOB, dx));
      btn.style.transform = `translateX(${knob}px)`;
      setTentative(dx >= THRESHOLD ? "correct" : dx <= -THRESHOLD ? "wrong" : null);
    };

    const reset = () => {
      activePointerId = null;
      setTentative(null);
      btn.classList.remove("dragging");
      btn.style.transform = "";
      opts.gradeArea.classList.remove("revealed");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };

    const onEnd = e => {
      if (e.pointerId !== activePointerId) return;
      const decided = tentative;
      reset();
      if (decided) opts.onGrade(decided === "correct");
      else opts.onCancel();
    };

    btn.addEventListener("pointerdown", e => {
      if (activePointerId !== null) return;
      if (!opts.canReveal()) return;
      activePointerId = e.pointerId;
      startX = e.clientX;
      tentative = null;
      try { btn.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
      btn.classList.add("dragging");
      opts.gradeArea.classList.add("revealed");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      opts.onReveal();
    });

    btn.addEventListener("contextmenu", e => e.preventDefault());

    return { reset };
  };

  const el = {};

  const ensureEls = () => {
    if (el.sentence) return;
    el.sentence = document.getElementById("sentence");
    el.progress = document.getElementById("progress");
    el.overlay = document.getElementById("answer-overlay");
    el.padContainer = document.getElementById("pad-container");
    el.modeBadge = document.getElementById("mode-badge");
  };

  const renderSentence = q => {
    el.sentence.textContent = "";
    q.sentence.split("□").forEach((part, i) => {
      if (i > 0) {
        const target = document.createElement("span");
        target.className = "target";
        const rt = document.createElement("span");
        rt.className = "rt";
        rt.textContent = q.ruby;
        const box = document.createElement("span");
        box.className = "box";
        target.append(rt, box);
        el.sentence.append(target);
      }
      if (part) el.sentence.append(part);
    });
  };

  const practice = {
    renderQuestion(q, currentIndex, total, mode) {
      ensureEls();
      renderSentence(q);
      el.progress.textContent = `${currentIndex + 1} / ${total}`;
      el.modeBadge.hidden = mode !== "review";
      this.hideAnswer();
    },

    showAnswer(q) {
      ensureEls();
      el.overlay.textContent = q.kanji;
      el.overlay.style.fontSize = `${el.padContainer.clientWidth * 0.8}px`;
      el.overlay.hidden = false;
    },

    hideAnswer() {
      ensureEls();
      el.overlay.hidden = true;
      el.overlay.textContent = "";
    }
  };

  const SCREENS = ["setup", "practice", "result", "stats"];

  const showScreen = name => {
    for (const s of SCREENS) {
      document.getElementById(`screen-${s}`).hidden = s !== name;
    }
    window.scrollTo(0, 0);
  };

  const renderSetup = () => {
    const settings = storage.getSettings();
    const list = document.getElementById("level-list");
    list.textContent = "";

    for (const lv of LEVELS) {
      const n = quiz.countFor(lv.key);
      const label = document.createElement("label");
      label.className = `level-item${n === 0 ? " empty" : ""}`;

      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = lv.key;
      input.disabled = n === 0;
      input.checked = n > 0 && settings.levels.includes(lv.key);

      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "lv-name";
      name.textContent = lv.label;
      const sub = document.createElement("span");
      sub.className = "lv-sub";
      sub.textContent = `${lv.sub}・${n > 0 ? `${n}字` : "準備中"}`;
      text.append(name, sub);

      label.append(input, text);
      list.append(label);
    }

    const radios = [...document.querySelectorAll('input[name="count"]')];
    for (const r of radios) r.checked = Number(r.value) === settings.count;
    if (!radios.some(r => r.checked) && radios.length) radios[0].checked = true;

    const mc = storage.mistakeCount();
    document.getElementById("mistake-count").textContent = mc;
    document.getElementById("btn-review").disabled = mc === 0;
  };

  const readSetupSelections = () => {
    const levels = [...document.querySelectorAll("#level-list input:checked")].map(i => i.value);
    const count = Number([...document.querySelectorAll('input[name="count"]')].find(r => r.checked)?.value ?? 10);
    return { levels, count };
  };

  const renderResult = session => {
    const total = session.results.length;
    const correct = session.results.filter(r => r.correct).length;
    const rate = total ? Math.round((correct / total) * 100) : 0;

    const summary = document.getElementById("result-summary");
    summary.textContent = "";
    const rateEl = document.createElement("div");
    rateEl.className = "rate";
    rateEl.textContent = `${rate}%`;
    const detail = document.createElement("div");
    detail.textContent = `${total}問中 ${correct}問正解`;
    summary.append(rateEl, detail);

    const list = document.getElementById("result-list");
    list.textContent = "";
    for (const r of session.results) {
      const li = document.createElement("li");
      li.className = "result-item";

      const mark = document.createElement("span");
      mark.className = `mark ${r.correct ? "correct" : "wrong"}`;
      mark.textContent = r.correct ? "◯" : "✕";

      const sent = document.createElement("span");
      sent.className = "r-sentence";
      r.question.sentence.split("□").forEach((part, i) => {
        if (i > 0) {
          const ans = document.createElement("ruby");
          ans.className = "r-answer";
          ans.textContent = r.question.kanji;
          const rt = document.createElement("rt");
          rt.textContent = r.question.ruby;
          ans.append(rt);
          sent.append(ans);
        }
        if (part) sent.append(part);
      });

      const lvl = document.createElement("span");
      lvl.className = "r-level";
      lvl.textContent = quiz.levelLabel(r.question.level);

      li.append(mark, sent, lvl);
      list.append(li);
    }

    document.getElementById("btn-retry-wrong").hidden = correct === total;
  };

  const renderStats = () => {
    const stats = storage.getStats();

    let totalAnswered = 0;
    let totalCorrect = 0;
    for (const by of Object.values(stats.byLevel)) {
      totalAnswered += by.total;
      totalCorrect += by.correct;
    }
    const totalRate = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    const summary = document.getElementById("stats-summary");
    summary.textContent = "";
    const div = document.createElement("div");
    div.className = "stats-total";
    div.textContent =
      `累計 ${totalAnswered}問 / 正答率 ${totalRate}% / 間違いノート ${storage.mistakeCount()}問 / セッション数 ${stats.sessions.length}`;
    summary.append(div);

    const container = document.getElementById("stats-levels");
    container.textContent = "";
    for (const lv of LEVELS) {
      const by = stats.byLevel[lv.key];
      const row = document.createElement("div");
      row.className = "stats-row";

      const name = document.createElement("span");
      name.className = "lv";
      name.textContent = lv.label;

      const track = document.createElement("div");
      track.className = "bar-track";
      const bar = document.createElement("div");
      bar.className = "bar";
      const rate = by?.total ? Math.round((by.correct / by.total) * 100) : 0;
      bar.style.width = `${rate}%`;
      track.append(bar);

      const num = document.createElement("span");
      num.className = "num";
      num.textContent = by?.total ? `${rate}% (${by.correct}/${by.total})` : "—";

      row.append(name, track, num);
      container.append(row);
    }
  };

  let session = null;
  let questionState = "writing";
  let pad = null;

  const $ = id => document.getElementById(id);

  const setQuestionState = state => {
    questionState = state;
  };

  const showQuestion = () => {
    const q = quiz.currentQuestion(session);
    practice.renderQuestion(q, session.current, session.questions.length, session.mode);
    pad.clear();
    setQuestionState("writing");
  };

  const finishSession = () => {
    const total = session.results.length;
    const correct = session.results.filter(r => r.correct).length;
    storage.addSession({
      date: Date.now(),
      mode: session.mode,
      total,
      correct
    });
    renderResult(session);
    showScreen("result");
  };

  const showJudgeMark = correct => {
    const mark = $("judge-mark");
    mark.hidden = false;
    mark.innerHTML = markSvg(correct ? "correct" : "wrong");
    mark.className = `judge-mark pop ${correct ? "correct" : "wrong"}`;
    return new Promise(resolve => setTimeout(() => {
      mark.hidden = true;
      resolve();
    }, 450));
  };

  const grade = async correct => {
    if (questionState === "graded") return;
    setQuestionState("graded");
    const done = quiz.submitGrade(session, correct);
    await showJudgeMark(correct);
    practice.hideAnswer();
    if (done) finishSession();
    else showQuestion();
  };

  const startSession = (pool, count, mode) => {
    if (!pool.length) return;
    session = quiz.createSession(pool, count, mode);
    showScreen("practice");
    pad.resize();
    showQuestion();
  };

  const init = () => {
    pad = createPad($("pad"), () => questionState === "writing");

    createGrader({
      button: $("btn-check"),
      gradeArea: document.querySelector(".grade-area"),
      hintCorrect: $("hint-correct"),
      hintWrong: $("hint-wrong"),
      judgeMark: $("judge-mark"),
      canReveal: () => questionState === "writing",
      onReveal: () => {
        practice.showAnswer(quiz.currentQuestion(session));
        setQuestionState("revealed");
      },
      onGrade: grade,
      onCancel: () => {
        practice.hideAnswer();
        setQuestionState("writing");
      }
    });

    $("btn-select-all").addEventListener("click", () => {
      document.querySelectorAll("#level-list input:not(:disabled)")
        .forEach(i => { i.checked = true; });
    });
    $("btn-select-none").addEventListener("click", () => {
      document.querySelectorAll("#level-list input")
        .forEach(i => { i.checked = false; });
    });

    $("btn-start").addEventListener("click", () => {
      const { levels, count } = readSetupSelections();
      if (!levels.length) {
        alert("出題範囲の級を選んでください");
        return;
      }
      storage.saveSettings({ levels, count });
      startSession(quiz.buildPool(levels), count, "normal");
    });

    $("btn-review").addEventListener("click", () => {
      const pool = quiz.buildReviewPool();
      if (!pool.length) return;
      const { count } = readSetupSelections();
      startSession(pool, count, "review");
    });

    $("btn-stats").addEventListener("click", () => {
      renderStats();
      showScreen("stats");
    });

    $("btn-quit").addEventListener("click", () => {
      practice.hideAnswer();
      renderSetup();
      showScreen("setup");
    });

    $("btn-undo").addEventListener("click", () => {
      if (questionState === "writing") pad.undo();
    });
    $("btn-clear").addEventListener("click", () => {
      if (questionState === "writing") pad.clear();
    });

    $("btn-retry").addEventListener("click", () => {
      startSession(session.questions, 0, session.mode);
    });
    $("btn-retry-wrong").addEventListener("click", () => {
      const wrong = session.results.filter(r => !r.correct).map(r => r.question);
      startSession(wrong, 0, "review");
    });
    $("btn-result-home").addEventListener("click", () => {
      renderSetup();
      showScreen("setup");
    });

    $("btn-stats-home").addEventListener("click", () => {
      renderSetup();
      showScreen("setup");
    });
    $("btn-reset-data").addEventListener("click", () => {
      if (confirm("成績と間違いの記録をすべて消します。よろしいですか?")) {
        storage.resetAll();
        renderStats();
        renderSetup();
      }
    });

    renderSetup();
    showScreen("setup");
  };

  const boot = async () => {
    try {
      const res = await fetch("kanji.json");
      KANJI_DATA = await res.json();
    } catch {
      const app = document.getElementById("app");
      app.textContent = "";
      const msg = document.createElement("p");
      msg.className = "load-error";
      msg.textContent = "問題データを読み込めませんでした。ローカルサーバー経由で開いてください(例: python3 -m http.server)。";
      app.append(msg);
      return;
    }
    init();
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
