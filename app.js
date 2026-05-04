/* =============================================================
   日本旅遊日語 PWA — app.js  (v0.3.0)
   - 句型替換組架構（pattern + items）
   - TTS 一律讀假名版本（extractKana）
   - 測驗加退出按鈕 + Esc 鍵
   ============================================================= */

const APP_VERSION = 'v0.3.0';
const LS_KEY = 'jpt_state_v3';

/* ---------- State ---------- */
const state = {
  scenarios: [],
  byId: new Map(),
  itemIndex: new Map(),     // itemId → {item, group, scenario}
  dialogueIndex: new Map(),

  currentTab: 'tab-dialogues',
  currentScenario: null,
  currentVocabScenario: null,

  // TTS
  voices: [],
  selectedVoiceURI: null,
  rate: 0.9,
  ttsAvailable: false,
  playingAll: null,

  // Quiz
  quizActive: null,

  prefs: {
    theme: 'auto',
    voiceURI: null,
    rate: 0.9,
  },
  progress: {
    known: [],
    weak: [],
    quizHistory: [],
  }
};

/* ---------- Storage ---------- */
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.prefs) Object.assign(state.prefs, data.prefs);
    if (data.progress) Object.assign(state.progress, data.progress);
    state.rate = state.prefs.rate ?? 0.9;
    state.selectedVoiceURI = state.prefs.voiceURI ?? null;
  } catch (e) { console.warn('loadState fail', e); }
}
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      prefs: state.prefs,
      progress: state.progress,
    }));
  } catch (e) { console.warn('saveState fail', e); }
}

/* ---------- Ruby / Kana helpers ---------- */
// "{漢字|かんじ}" → <ruby>漢字<rt>かんじ</rt></ruby>
function parseRuby(str) {
  if (!str) return '';
  return escapeHTML(str).replace(/\{([^|{}]+)\|([^|{}]+)\}/g, (_, k, r) =>
    `<ruby>${k}<rt>${r}</rt></ruby>`);
}
// 留下漢字（顯示用）
function stripRuby(str) {
  if (!str) return '';
  return str.replace(/\{([^|{}]+)\|[^|{}]+\}/g, '$1');
}
// 取出讀音版（給 TTS 用，{漢字|讀音} → 讀音）
function extractKana(str) {
  if (!str) return '';
  return str.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, (_, k, r) => r);
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* ---------- TTS ---------- */
const tts = {
  init() {
    if (!('speechSynthesis' in window)) {
      state.ttsAvailable = false;
      return;
    }
    const refresh = () => {
      const all = window.speechSynthesis.getVoices();
      state.voices = all.filter(v => v.lang.toLowerCase().startsWith('ja'));
      state.ttsAvailable = state.voices.length > 0;
      if (state.selectedVoiceURI) {
        const found = state.voices.find(v => v.voiceURI === state.selectedVoiceURI);
        if (!found) state.selectedVoiceURI = state.voices[0]?.voiceURI || null;
      } else {
        state.selectedVoiceURI = state.voices[0]?.voiceURI || null;
      }
      renderVoiceSelect();
      updateTtsStatus();
    };
    refresh();
    if ('onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = refresh;
    }
  },
  cancel() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  },
  // text 可以是 {漢字|讀音} 標記版或純假名 — 一律 extractKana 後送出
  speak(text, { onend, onerror } = {}) {
    if (!('speechSynthesis' in window)) {
      onerror && onerror(new Error('no-tts'));
      return null;
    }
    const u = new SpeechSynthesisUtterance(extractKana(text));
    u.lang = 'ja-JP';
    u.rate = state.rate;
    const voice = state.voices.find(v => v.voiceURI === state.selectedVoiceURI);
    if (voice) u.voice = voice;
    u.onend = () => onend && onend();
    u.onerror = (e) => onerror && onerror(e);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return u;
  }
};

function updateTtsStatus() {
  const el = document.getElementById('tts-status');
  if (!el) return;
  if (!('speechSynthesis' in window)) {
    el.textContent = 'TTS：此瀏覽器不支援';
    return;
  }
  if (state.voices.length === 0) {
    el.textContent = 'TTS：尚未偵測到日語語音（iOS 設定 → 一般 → 輔助使用 → 朗讀內容 → 語音 → 日文）';
    return;
  }
  el.textContent = `TTS：可用（${state.voices.length} 個日語語音）`;
}

function renderVoiceSelect() {
  const sel = document.getElementById('voice-select');
  if (!sel) return;
  sel.innerHTML = '';
  if (state.voices.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '（無可用日語語音）';
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  state.voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})${v.localService ? ' · 本機' : ''}`;
    if (v.voiceURI === state.selectedVoiceURI) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* ---------- Data loading ---------- */
async function loadScenarios() {
  const indexResp = await fetch('data/index.json');
  const idx = await indexResp.json();
  const results = await Promise.all(idx.scenarios.map(id =>
    fetch(`data/scenarios/${id}.json`).then(r => r.json())
  ));
  state.scenarios = results;
  state.byId.clear(); state.itemIndex.clear(); state.dialogueIndex.clear();
  results.forEach(sc => {
    state.byId.set(sc.id, sc);
    sc.dialogues.forEach(d => state.dialogueIndex.set(d.id, { dialogue: d, scenario: sc }));
    (sc.groups || []).forEach(g => {
      g.items.forEach(it => state.itemIndex.set(it.id, { item: it, group: g, scenario: sc }));
    });
  });
}

/* ---------- Tab switching ---------- */
function setTab(tabId) {
  state.currentTab = tabId;
  tts.cancel();
  state.playingAll = null;

  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === tabId;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    const active = p.id === tabId;
    p.classList.toggle('active', active);
    p.hidden = !active;
  });

  if (tabId === 'tab-dialogues') renderDialoguesView();
  else if (tabId === 'tab-vocab') renderVocabView();
  else if (tabId === 'tab-quiz') renderQuizView();
}

/* ---------- Tab 1: 對話 ---------- */
function renderDialoguesView() {
  const root = document.getElementById('dialogues-view');
  if (state.currentScenario) {
    renderDialogueDetail(root, state.currentScenario);
  } else {
    renderScenarioGrid(root, 'dialogues');
  }
}

function renderScenarioGrid(root, mode) {
  const html = `
    <div class="scenario-grid">
      ${state.scenarios.map(sc => {
        const dialogueCount = sc.dialogues.length;
        const groupCount = (sc.groups || []).length;
        const itemCount = (sc.groups || []).reduce((s, g) => s + g.items.length, 0);
        return `
          <button class="scenario-card" data-id="${sc.id}" data-mode="${mode}">
            <span class="emoji">${sc.emoji}</span>
            <span class="name-zh">${escapeHTML(sc.name_zh)}</span>
            <span class="name-ja">${escapeHTML(sc.name_ja)}</span>
            <span class="meta">
              ${mode === 'dialogues' ? `${dialogueCount} 段對話` : `${groupCount} 句型 · ${itemCount} 詞`}
            </span>
          </button>
        `;
      }).join('')}
    </div>
  `;
  root.innerHTML = html;
  root.querySelectorAll('.scenario-card').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      if (mode === 'dialogues') {
        state.currentScenario = id;
        renderDialoguesView();
      } else {
        state.currentVocabScenario = id;
        renderVocabView();
      }
    });
  });
}

function renderDialogueDetail(root, scenarioId) {
  const sc = state.byId.get(scenarioId);
  if (!sc) { state.currentScenario = null; renderDialoguesView(); return; }

  root.innerHTML = `
    <div class="sub-head">
      <button class="back-btn" id="back-dlg" aria-label="返回">←</button>
      <div class="title-block">
        <h2>${sc.emoji} ${escapeHTML(sc.name_zh)}</h2>
        <span class="ja-sub">${escapeHTML(sc.name_ja)}</span>
      </div>
      <div class="actions">
        <button class="icon-btn" id="toggle-zh" title="隱藏中文">中</button>
      </div>
    </div>
    ${sc.dialogues.map(d => renderDialogueSection(d)).join('')}
  `;
  root.querySelector('#back-dlg').addEventListener('click', () => {
    state.currentScenario = null; renderDialoguesView();
  });
  const toggleBtn = root.querySelector('#toggle-zh');
  toggleBtn.addEventListener('click', () => {
    const hidden = root.classList.toggle('zh-hidden');
    toggleBtn.classList.toggle('active', hidden);
    root.querySelectorAll('.turn-zh').forEach(z => z.classList.toggle('hidden-zh', hidden));
  });
  attachDialogueHandlers(root);
}

function renderDialogueSection(d) {
  return `
    <div class="dialogue-section" data-dialogue-id="${d.id}">
      <div class="dialogue-title">
        <h3>
          <span>${escapeHTML(d.title_zh)}</span>
          <span class="ja-sub">${escapeHTML(d.title_ja)}</span>
        </h3>
        <div class="dialogue-controls">
          <button class="icon-btn play-all" title="整段播放">▶</button>
        </div>
      </div>
      ${d.turns.map((t, i) => `
        <div class="turn" data-idx="${i}">
          <div class="turn-role ${t.role}">${t.role === 'B' ? '店' : '客'}</div>
          <div class="turn-body">
            <div class="turn-ja">${parseRuby(t.ja)}</div>
            <div class="turn-zh">${escapeHTML(t.zh)}</div>
            <div class="turn-actions">
              <button class="turn-mini-btn play-one">🔊 朗讀</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function attachDialogueHandlers(root) {
  root.querySelectorAll('.play-one').forEach(b => {
    b.addEventListener('click', () => {
      const turn = b.closest('.turn');
      const sectionId = b.closest('.dialogue-section').dataset.dialogueId;
      const idx = parseInt(turn.dataset.idx, 10);
      const entry = state.dialogueIndex.get(sectionId);
      if (!entry) return;
      const turnData = entry.dialogue.turns[idx];
      if (!state.ttsAvailable) { toast('此瀏覽器無日語 TTS'); return; }
      root.querySelectorAll('.turn-mini-btn').forEach(x => x.classList.remove('playing'));
      b.classList.add('playing');
      tts.speak(turnData.ja, {
        onend: () => b.classList.remove('playing'),
        onerror: () => b.classList.remove('playing'),
      });
    });
  });
  root.querySelectorAll('.play-all').forEach(b => {
    b.addEventListener('click', () => {
      const section = b.closest('.dialogue-section');
      const dialogueId = section.dataset.dialogueId;
      if (state.playingAll && state.playingAll.dialogueId === dialogueId) {
        stopPlayAll();
        return;
      }
      stopPlayAll();
      const entry = state.dialogueIndex.get(dialogueId);
      if (!entry) return;
      playDialogueSequence(section, entry.dialogue);
    });
  });
}

function stopPlayAll() {
  tts.cancel();
  if (state.playingAll) {
    state.playingAll.aborted = true;
    document.querySelectorAll('.dialogue-section.playing-all').forEach(s => s.classList.remove('playing-all'));
    document.querySelectorAll('.turn.now-playing').forEach(t => t.classList.remove('now-playing'));
    document.querySelectorAll('.play-all').forEach(b => { b.textContent = '▶'; b.classList.remove('active'); });
  }
  state.playingAll = null;
}

function playDialogueSequence(section, dialogue) {
  if (!state.ttsAvailable) { toast('此瀏覽器無日語 TTS'); return; }
  section.classList.add('playing-all');
  const playBtn = section.querySelector('.play-all');
  playBtn.textContent = '■';
  playBtn.classList.add('active');
  const ctx = { dialogueId: dialogue.id, aborted: false };
  state.playingAll = ctx;
  let i = 0;
  const turns = section.querySelectorAll('.turn');
  const next = () => {
    if (ctx.aborted) return;
    if (i >= dialogue.turns.length) { stopPlayAll(); return; }
    turns.forEach(t => t.classList.remove('now-playing'));
    const turnEl = turns[i];
    turnEl.classList.add('now-playing');
    turnEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const text = dialogue.turns[i].ja;
    i++;
    tts.speak(text, {
      onend: () => setTimeout(next, 350),
      onerror: () => setTimeout(next, 200),
    });
  };
  next();
}

/* ---------- Tab 2: 句型替換組 ---------- */
function renderVocabView() {
  const root = document.getElementById('vocab-view');
  if (state.currentVocabScenario) {
    renderVocabDetail(root, state.currentVocabScenario);
  } else {
    renderScenarioGrid(root, 'vocab');
  }
}

function renderVocabDetail(root, scenarioId) {
  const sc = state.byId.get(scenarioId);
  if (!sc) { state.currentVocabScenario = null; renderVocabView(); return; }
  const totalItems = sc.groups.reduce((s, g) => s + g.items.length, 0);
  const knownCount = sc.groups.reduce((s, g) =>
    s + g.items.filter(it => state.progress.known.includes(it.id)).length, 0);
  const weakCount = sc.groups.reduce((s, g) =>
    s + g.items.filter(it => state.progress.weak.includes(it.id)).length, 0);

  root.innerHTML = `
    <div class="sub-head">
      <button class="back-btn" id="back-vocab" aria-label="返回">←</button>
      <div class="title-block">
        <h2>${sc.emoji} ${escapeHTML(sc.name_zh)}</h2>
        <span class="ja-sub">${sc.groups.length} 句型 · ${totalItems} 替換詞 · 已會 ${knownCount} · 待加強 ${weakCount}</span>
      </div>
    </div>
    ${sc.groups.map(g => renderGroupCard(g)).join('')}
  `;
  root.querySelector('#back-vocab').addEventListener('click', () => {
    state.currentVocabScenario = null; renderVocabView();
  });
  attachGroupHandlers(root);
}

function renderGroupCard(g) {
  // 用 placeholder 表示未選詞時的呈現
  const placeholderJa = '<span class="placeholder">◯◯</span>';
  const placeholderZh = '<span class="placeholder">◯◯</span>';
  const patternJaHtml = parseRuby(g.pattern_ja).replace('{X}', placeholderJa);
  const patternZhHtml = escapeHTML(g.pattern_zh).replace('{X}', placeholderZh);

  return `
    <div class="group-card" data-group-id="${g.id}"
         data-pattern-ja="${escapeHTML(g.pattern_ja)}"
         data-pattern-kana="${escapeHTML(g.pattern_kana)}"
         data-pattern-zh="${escapeHTML(g.pattern_zh)}">
      <div class="group-head">
        <span class="group-cat">${escapeHTML(g.category)}</span>
        <button class="icon-btn play-pattern" title="朗讀整句（會用第一個或剛點的詞）">🔊</button>
      </div>
      <div class="pattern-display">
        <div class="pattern-ja">${patternJaHtml}</div>
        <div class="pattern-zh">${patternZhHtml}</div>
      </div>
      <div class="item-chips">
        ${g.items.map(it => {
          const isKnown = state.progress.known.includes(it.id);
          const isWeak = state.progress.weak.includes(it.id);
          const masteryCls = isKnown ? 'known' : (isWeak ? 'weak' : '');
          return `
            <div class="chip-wrap">
              <button class="item-chip ${masteryCls}" data-id="${it.id}"
                      data-ja="${escapeHTML(it.ja)}"
                      data-kana="${escapeHTML(it.kana)}"
                      data-zh="${escapeHTML(it.zh)}">
                <div class="chip-ja">${parseRuby(it.ja)}</div>
                <div class="chip-zh">${escapeHTML(it.zh)}</div>
              </button>
              <div class="chip-mastery">
                <button class="mastery-btn known ${isKnown?'active':''}" data-id="${it.id}" data-mark="known" title="已會">✓</button>
                <button class="mastery-btn weak ${isWeak?'active':''}" data-id="${it.id}" data-mark="weak" title="待加強">✗</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function attachGroupHandlers(root) {
  root.querySelectorAll('.item-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const groupCard = chip.closest('.group-card');
      const patternJa = groupCard.dataset.patternJa;
      const patternKana = groupCard.dataset.patternKana;
      const patternZh = groupCard.dataset.patternZh;
      const itemJa = chip.dataset.ja;
      const itemKana = chip.dataset.kana;
      const itemZh = chip.dataset.zh;

      // 替換並渲染
      const filledJa = patternJa.replace('{X}', itemJa);
      const filledZh = patternZh.replace('{X}', itemZh);
      const filledKana = patternKana.replace('{X}', itemKana);

      groupCard.querySelector('.pattern-ja').innerHTML = parseRuby(filledJa);
      groupCard.querySelector('.pattern-zh').innerHTML =
        escapeHTML(patternZh).replace('{X}', `<span class="filled">${escapeHTML(itemZh)}</span>`);

      // 暫存當前選擇（給 play-pattern 用）
      groupCard.dataset.currentKana = filledKana;
      groupCard.dataset.currentJa = filledJa;

      // TTS
      if (state.ttsAvailable) tts.speak(filledKana);
      else toast('此瀏覽器無日語 TTS');

      // 視覺 flash
      groupCard.querySelectorAll('.item-chip.selected').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      chip.classList.add('flash');
      setTimeout(() => chip.classList.remove('flash'), 800);
    });
  });

  root.querySelectorAll('.play-pattern').forEach(b => {
    b.addEventListener('click', () => {
      const card = b.closest('.group-card');
      let toSpeak = card.dataset.currentKana;
      if (!toSpeak) {
        // 預設用第一個 item 念
        const firstChip = card.querySelector('.item-chip');
        if (firstChip) {
          firstChip.click();
          return;
        }
      }
      if (state.ttsAvailable && toSpeak) tts.speak(toSpeak);
      else if (!state.ttsAvailable) toast('此瀏覽器無日語 TTS');
    });
  });

  root.querySelectorAll('.mastery-btn').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const id = b.dataset.id;
      const mark = b.dataset.mark;
      if (mark === 'known') {
        toggleListItem(state.progress.known, id);
        removeFromList(state.progress.weak, id);
      } else {
        toggleListItem(state.progress.weak, id);
        removeFromList(state.progress.known, id);
      }
      saveState();
      renderVocabView();
    });
  });
}

function toggleListItem(arr, id) {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
}
function removeFromList(arr, id) {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
}

/* ---------- Tab 3: 測驗 ---------- */
function renderQuizView() {
  const root = document.getElementById('quiz-view');
  if (state.quizActive) {
    if (state.quizActive.idx >= state.quizActive.qs.length) {
      renderQuizResult(root);
    } else {
      renderQuizQuestion(root);
    }
  } else {
    renderQuizSetup(root);
  }
}

function renderQuizSetup(root) {
  const setup = state._quizSetup || { type: 'listen', scope: 'all', count: 10 };
  state._quizSetup = setup;

  root.innerHTML = `
    <div class="quiz-setup-card">
      <h3>題型</h3>
      <div class="option-grid">
        <button class="option-pill ${setup.type==='listen'?'active':''}" data-type="listen">
          🔊 聽選中
          <span class="desc">播日語 → 選中文</span>
        </button>
        <button class="option-pill ${setup.type==='read'?'active':''}" data-type="read">
          👀 看選日
          <span class="desc">給中文 → 選日語</span>
        </button>
        <button class="option-pill ${setup.type==='fill'?'active':''}" data-type="fill" style="grid-column:1/-1;">
          ✍️ 填空（句型挖一字）
          <span class="desc">看句型 → 選正確日語</span>
        </button>
      </div>
    </div>

    <div class="quiz-setup-card">
      <h3>範圍</h3>
      <div class="scenario-chip-row">
        <button class="scenario-chip ${setup.scope==='all'?'active':''}" data-scope="all">全部混合</button>
        ${state.scenarios.map(sc => `
          <button class="scenario-chip ${setup.scope===sc.id?'active':''}" data-scope="${sc.id}">${sc.emoji} ${escapeHTML(sc.name_zh)}</button>
        `).join('')}
      </div>
    </div>

    <div class="quiz-setup-card">
      <h3>題數</h3>
      <div class="option-grid" style="grid-template-columns:repeat(4,1fr);">
        ${[5,10,15,20].map(n => `
          <button class="option-pill ${setup.count===n?'active':''}" data-count="${n}">${n}</button>
        `).join('')}
      </div>
    </div>

    <div class="btn-row" style="margin-top:14px;">
      <button class="btn-primary" id="start-quiz" style="flex:1;">開始測驗</button>
    </div>

    ${state.progress.quizHistory.length ? `
      <div class="quiz-setup-card" style="margin-top:14px;">
        <h3>歷史紀錄</h3>
        <ul style="display:flex;flex-direction:column;gap:6px;">
          ${state.progress.quizHistory.slice(-5).reverse().map(h => `
            <li class="muted small" style="display:flex;justify-content:space-between;">
              <span>${formatTime(h.ts)} · ${quizTypeLabel(h.type)} · ${scopeLabel(h.scope)}</span>
              <span style="color:var(--c-shu);font-weight:600;">${h.score}/${h.total}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''}
  `;

  root.querySelectorAll('.option-pill[data-type]').forEach(b => {
    b.addEventListener('click', () => { setup.type = b.dataset.type; renderQuizSetup(root); });
  });
  root.querySelectorAll('.scenario-chip[data-scope]').forEach(b => {
    b.addEventListener('click', () => { setup.scope = b.dataset.scope; renderQuizSetup(root); });
  });
  root.querySelectorAll('.option-pill[data-count]').forEach(b => {
    b.addEventListener('click', () => { setup.count = parseInt(b.dataset.count, 10); renderQuizSetup(root); });
  });
  root.querySelector('#start-quiz').addEventListener('click', () => startQuiz(setup));
}

function quizTypeLabel(t) {
  return { listen: '聽選中', read: '看選日', fill: '填空' }[t] || t;
}
function scopeLabel(s) {
  if (s === 'all') return '全部';
  return state.byId.get(s)?.name_zh || s;
}
function formatTime(ts) {
  const d = new Date(ts);
  const m = (d.getMonth()+1).toString().padStart(2,'0');
  const day = d.getDate().toString().padStart(2,'0');
  const hh = d.getHours().toString().padStart(2,'0');
  const mm = d.getMinutes().toString().padStart(2,'0');
  return `${m}/${day} ${hh}:${mm}`;
}

function startQuiz({ type, scope, count }) {
  const scenarios = scope === 'all' ? state.scenarios : [state.byId.get(scope)].filter(Boolean);
  // 收集所有 items + 對應 group（給 fill 用）
  const allItems = [];
  scenarios.forEach(sc => {
    sc.groups.forEach(g => g.items.forEach(it => allItems.push({ item: it, group: g, scenario: sc })));
  });
  if (allItems.length === 0) { toast('題庫不足'); return; }

  // 加權：weak 三倍、known 半數
  const weighted = allItems.flatMap(rec => {
    const id = rec.item.id;
    if (state.progress.weak.includes(id)) return [rec, rec, rec];
    if (state.progress.known.includes(id)) return Math.random() < 0.5 ? [rec] : [];
    return [rec];
  });
  const finalPool = weighted.length >= count ? weighted : allItems;

  const qs = [];
  const usedIds = new Set();
  let safety = 0;
  while (qs.length < count && safety < count * 10) {
    safety++;
    const rec = finalPool[Math.floor(Math.random() * finalPool.length)];
    if (usedIds.has(rec.item.id)) continue;
    usedIds.add(rec.item.id);
    qs.push(buildQuestion(type, rec, allItems));
  }

  state.quizActive = { type, scope, qs, idx: 0, score: 0, errors: [] };
  renderQuizView();
}

function buildQuestion(type, rec, allItems) {
  const correct = rec.item;
  const distractorPool = allItems.filter(r => r.item.id !== correct.id).map(r => r.item);
  shuffle(distractorPool);
  const distractors = distractorPool.slice(0, 3);

  let prompt, choices, correctIdx, promptLabel, isJaPrompt = false, ttsText = null;

  if (type === 'listen') {
    promptLabel = '請聽：';
    prompt = '';
    ttsText = correct.ja;  // {漢字|讀音} 標記版 → tts.speak 內 extractKana
    const opts = shuffle([correct, ...distractors]);
    choices = opts.map(it => ({ text: it.zh, isJa: false, id: it.id }));
    correctIdx = opts.findIndex(it => it.id === correct.id);
  } else if (type === 'read') {
    promptLabel = '中文：';
    prompt = correct.zh;
    const opts = shuffle([correct, ...distractors]);
    choices = opts.map(it => ({ text: parseRuby(it.ja), isJa: true, id: it.id }));
    correctIdx = opts.findIndex(it => it.id === correct.id);
  } else {
    // fill: 用 group 的 pattern 挖空
    const g = rec.group;
    const promptHTML = parseRuby(g.pattern_ja).replace('{X}',
      '<span class="blank">＿＿＿</span>');
    prompt = promptHTML;
    isJaPrompt = true;
    const opts = shuffle([correct, ...distractors]);
    choices = opts.map(it => ({ text: parseRuby(it.ja), isJa: true, id: it.id }));
    correctIdx = opts.findIndex(it => it.id === correct.id);
  }
  return { type, promptLabel, prompt, isJaPrompt, ttsText, choices, correctIdx, correctItem: correct };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderQuizQuestion(root) {
  const q = state.quizActive;
  const cur = q.qs[q.idx];
  const pct = ((q.idx) / q.qs.length) * 100;
  root.innerHTML = `
    <div class="quiz-question-card">
      <div class="quiz-progress">
        <span>第 ${q.idx + 1} / ${q.qs.length} 題</span>
        <div class="progress-actions">
          <span class="score-display">得分 ${q.score}</span>
          <button class="quit-quiz-btn" id="quit-quiz" title="退出測驗">✕ 退出</button>
        </div>
      </div>
      <div class="quiz-progress-bar"><span style="width:${pct}%"></span></div>
      <div class="quiz-prompt">
        <div class="prompt-label">${cur.promptLabel}</div>
        ${cur.type === 'listen' ? `
          <button class="play-big" id="play-prompt">🔊</button>
          <div class="muted small" style="margin-top:8px;">點按聽題目</div>
        ` : `
          <div class="prompt-content ${cur.isJaPrompt ? 'ja' : ''}">${cur.isJaPrompt ? cur.prompt : escapeHTML(cur.prompt)}</div>
        `}
      </div>
      <div class="quiz-choices">
        ${cur.choices.map((c, i) => `
          <button class="quiz-choice ${c.isJa ? 'ja' : ''}" data-i="${i}">${c.isJa ? c.text : escapeHTML(c.text)}</button>
        `).join('')}
      </div>
      <div class="quiz-feedback hidden" id="quiz-feedback"></div>
      <div class="btn-row hidden" id="next-row" style="margin-top:14px;">
        <button class="btn-primary" id="next-q" style="flex:1;">下一題 →</button>
      </div>
    </div>
  `;

  if (cur.type === 'listen') {
    const playBtn = root.querySelector('#play-prompt');
    const speakIt = () => {
      if (!state.ttsAvailable) { toast('此瀏覽器無日語 TTS'); return; }
      tts.speak(cur.ttsText);
    };
    playBtn.addEventListener('click', speakIt);
    setTimeout(speakIt, 250);
  }

  root.querySelectorAll('.quiz-choice').forEach(b => {
    b.addEventListener('click', () => {
      const i = parseInt(b.dataset.i, 10);
      const correct = i === cur.correctIdx;
      root.querySelectorAll('.quiz-choice').forEach((x, xi) => {
        x.disabled = true;
        if (xi === cur.correctIdx) x.classList.add('correct');
        if (xi === i && !correct) x.classList.add('wrong');
      });
      if (correct) {
        q.score++;
        removeFromList(state.progress.weak, cur.correctItem.id);
      } else {
        q.errors.push({ q: cur, picked: i });
        if (!state.progress.weak.includes(cur.correctItem.id)) state.progress.weak.push(cur.correctItem.id);
      }
      saveState();

      const fb = root.querySelector('#quiz-feedback');
      fb.classList.remove('hidden');
      fb.innerHTML = correct
        ? `<strong style="color:var(--c-matcha);">✓ 答對了！</strong> <span class="ja">${parseRuby(cur.correctItem.ja)}</span> · ${escapeHTML(cur.correctItem.kana)} · ${escapeHTML(cur.correctItem.zh)}`
        : `<strong style="color:var(--c-shu);">✗ 正解：</strong> <span class="ja">${parseRuby(cur.correctItem.ja)}</span> · ${escapeHTML(cur.correctItem.kana)} · ${escapeHTML(cur.correctItem.zh)}`;
      root.querySelector('#next-row').classList.remove('hidden');
    });
  });
  root.querySelector('#next-q')?.addEventListener('click', () => {
    q.idx++;
    renderQuizView();
  });
  root.querySelector('#quit-quiz')?.addEventListener('click', confirmQuitQuiz);
}

function confirmQuitQuiz() {
  if (!state.quizActive) return;
  if (confirm('確定要退出？目前進度不會儲存')) {
    tts.cancel();
    state.quizActive = null;
    renderQuizView();
  }
}

function renderQuizResult(root) {
  const q = state.quizActive;
  state.progress.quizHistory.push({
    ts: Date.now(), type: q.type, scope: q.scope, score: q.score, total: q.qs.length
  });
  if (state.progress.quizHistory.length > 50) state.progress.quizHistory.splice(0, state.progress.quizHistory.length - 50);
  saveState();
  const pct = Math.round((q.score / q.qs.length) * 100);
  root.innerHTML = `
    <div class="quiz-question-card">
      <div class="quiz-result">
        <div class="score">${q.score}<span style="font-size:24px;color:var(--c-text-muted);">/${q.qs.length}</span></div>
        <div class="score-label">${pct}% · ${pct >= 80 ? '🎉 太厲害了！' : pct >= 60 ? '👍 不錯！再加強就更好' : '加油，多練幾次就會了'}</div>
        <div class="btn-row" style="justify-content:center;">
          <button class="btn-secondary" id="quiz-back">回設定</button>
          <button class="btn-primary" id="quiz-again">再來一輪</button>
        </div>
      </div>
      ${q.errors.length ? `
        <h3 style="margin-top:18px;font-size:14px;color:var(--c-text-muted);">錯題回顧 (${q.errors.length})</h3>
        ${q.errors.map(e => `
          <div class="error-review-card">
            <div class="err-q">${e.q.promptLabel} ${e.q.type === 'listen' ? `🔊 ${escapeHTML(stripRuby(e.q.correctItem.ja))}` : (e.q.isJaPrompt ? e.q.prompt : escapeHTML(e.q.prompt))}</div>
            <div>正解：<span class="err-correct">${parseRuby(e.q.correctItem.ja)}</span> · ${escapeHTML(e.q.correctItem.zh)}</div>
            <div class="muted small">你選了：${e.q.choices[e.picked].isJa ? `<span class="err-wrong">${e.q.choices[e.picked].text}</span>` : escapeHTML(e.q.choices[e.picked].text)}</div>
          </div>
        `).join('')}
      ` : ''}
    </div>
  `;
  root.querySelector('#quiz-back').addEventListener('click', () => {
    state.quizActive = null; renderQuizView();
  });
  root.querySelector('#quiz-again').addEventListener('click', () => {
    const setup = state._quizSetup;
    state.quizActive = null;
    startQuiz(setup);
  });
}

/* ---------- Settings modal ---------- */
function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.checked = (r.value === state.prefs.theme);
  });
  document.getElementById('rate-range').value = state.rate;
  document.getElementById('rate-val').textContent = state.rate.toFixed(2);
  document.getElementById('app-version').textContent = APP_VERSION;
  renderVoiceSelect();
  updateTtsStatus();
}
function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

/* ---------- Theme ---------- */
function applyTheme() {
  const t = state.prefs.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const isDark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#1A1612' : '#F4ECDC');
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(42,33,24,0.92);color:#F4ECDC;padding:10px 16px;border-radius:10px;font-size:13px;z-index:200;max-width:80%;text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2400);
}

/* ---------- Init ---------- */
async function init() {
  loadState();
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.prefs.theme === 'auto') applyTheme();
  });

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  });

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target.id === 'settings-modal') closeSettings();
  });
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = state.prefs.theme;
    const isDarkNow = cur === 'dark' || (cur === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    state.prefs.theme = isDarkNow ? 'light' : 'dark';
    saveState(); applyTheme();
  });

  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.addEventListener('change', () => {
      state.prefs.theme = r.value; saveState(); applyTheme();
    });
  });
  document.getElementById('voice-select').addEventListener('change', e => {
    state.selectedVoiceURI = e.target.value;
    state.prefs.voiceURI = e.target.value;
    saveState();
  });
  document.getElementById('rate-range').addEventListener('input', e => {
    state.rate = parseFloat(e.target.value);
    state.prefs.rate = state.rate;
    document.getElementById('rate-val').textContent = state.rate.toFixed(2);
    saveState();
  });
  document.getElementById('voice-test').addEventListener('click', () => {
    if (!state.ttsAvailable) { toast('此瀏覽器無日語 TTS'); return; }
    tts.speak('こんにちは、{今日|きょう}もいい{天気|てんき}ですね。');
  });
  document.getElementById('reset-progress').addEventListener('click', () => {
    if (!confirm('要清掉「已會」「待加強」標記跟測驗歷史嗎？')) return;
    state.progress = { known: [], weak: [], quizHistory: [] };
    saveState();
    toast('已重置');
    if (state.currentTab === 'tab-vocab') renderVocabView();
    if (state.currentTab === 'tab-quiz') renderQuizView();
  });

  // Esc 鍵：測驗中退出 / 關設定
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('settings-modal').classList.contains('hidden')) {
        closeSettings();
      } else if (state.quizActive && state.currentTab === 'tab-quiz') {
        confirmQuitQuiz();
      }
    }
  });

  // beforeunload：測驗中提示
  window.addEventListener('beforeunload', e => {
    if (state.quizActive) {
      e.preventDefault();
      e.returnValue = '測驗進行中，離開會失去進度。';
    }
  });

  try {
    await loadScenarios();
  } catch (e) {
    document.getElementById('dialogues-view').innerHTML = `
      <div class="empty-state">
        <span class="big">⚠️</span>
        資料載入失敗：${escapeHTML(e.message)}
      </div>
    `;
    return;
  }

  tts.init();
  setTab('tab-dialogues');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW reg fail', err));
  }
}

document.addEventListener('DOMContentLoaded', init);
