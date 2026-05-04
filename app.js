/* =============================================================
   日本旅遊日語 PWA — app.js  (v0.3.2)
   - 句型替換組架構（pattern + items）
   - TTS 一律讀假名版本（extractKana）
   - 測驗加退出按鈕 + Esc
   - 移除已會/待加強 mastery 功能
   - 右上角強制重整按鈕（清 SW cache + reload）
   ============================================================= */

const APP_VERSION = 'v0.5.0';

/* ---------- Sushi game assets ---------- */
const SUSHI_NORMAL = ['maguro', 'sake', 'ebi', 'tamago', 'inari'];
const SUSHI_PREMIUM = ['uni', 'ikura', 'tekka', 'ootoro'];
const PLATES = ['plate_white','plate_white','plate_white','plate_white','plate_white','plate_white','plate_red','plate_red','plate_red','plate_gold'];
const PLATE_MULT = { plate_white: 1, plate_red: 2, plate_gold: 3 };

/* ---------- Scenario carrier: each scenario has its own visual ---------- */
const SCENARIO_CARRIERS = {
  airport:      'airport_suitcase',
  flight:       'flight_tray',
  station:      'station_ekiben',
  hotel:        'hotel_tray',
  restaurant:   'restaurant_plate',
  ramen:        'ramen_bowl',
  izakaya:      'izakaya_yakitori',
  conbini:      'convenience_basket',
  sightseeing:  'sightseeing_souvenir',
  // emergency: 沒有 PNG，用 SVG fallback
};
function getCarrierForScope(scope) {
  if (scope === 'all') return null;          // 全部混合 → 用壽司流
  if (SCENARIO_CARRIERS[scope]) return `assets/scenes/${SCENARIO_CARRIERS[scope]}.png`;
  return 'svg-emergency';                     // emergency 等沒圖的場景
}

const PRELOAD = [
  'cat_idle','cat_happy','cat_sad','cat_surprised','cat_pro','cat_asleep'
].map(n => `assets/cat/${n}.png`).concat(
  SUSHI_NORMAL.concat(SUSHI_PREMIUM).map(n => `assets/sushi/${n}.png`),
  ['plate_white','plate_red','plate_gold'].map(n => `assets/plate/${n}.png`),
  Object.values(SCENARIO_CARRIERS).map(n => `assets/scenes/${n}.png`),
  ['sakura_petal','mini_torii','cloud','hanko_stamp'].map(n => `assets/decor/${n}.png`)
);
function preloadGameAssets() {
  PRELOAD.forEach(p => { const im = new Image(); im.src = p; });
}
function pickPlate() { return PLATES[Math.floor(Math.random()*PLATES.length)]; }
function pickSushi(pro) {
  const pool = pro ? SUSHI_PREMIUM : [...SUSHI_NORMAL, ...SUSHI_PREMIUM];
  return pool[Math.floor(Math.random()*pool.length)];
}
const LS_KEY = 'jpt_state_v4';

const state = {
  scenarios: [],
  byId: new Map(),
  itemIndex: new Map(),
  dialogueIndex: new Map(),

  currentTab: 'tab-dialogues',
  currentScenario: null,
  currentVocabScenario: null,

  voices: [],
  selectedVoiceURI: null,
  rate: 0.9,
  ttsAvailable: false,
  playingAll: null,

  quizActive: null,

  prefs: {
    theme: 'auto',
    voiceURI: null,
    rate: 0.9,
  },
  history: [],  // quiz history
};

/* ---------- Storage ---------- */
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.prefs) Object.assign(state.prefs, data.prefs);
    if (Array.isArray(data.history)) state.history = data.history;
    state.rate = state.prefs.rate ?? 0.9;
    state.selectedVoiceURI = state.prefs.voiceURI ?? null;
  } catch (e) { console.warn('loadState fail', e); }
  // 清掉舊版 mastery key（如果存在）
  try {
    localStorage.removeItem('jpt_state_v3');
    localStorage.removeItem('jpt_state_v1');
    localStorage.removeItem('mastered_ids');
    localStorage.removeItem('weak_ids');
  } catch (_) {}
}
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      prefs: state.prefs,
      history: state.history,
    }));
  } catch (e) { console.warn('saveState fail', e); }
}

/* ---------- Ruby / Kana helpers ---------- */
function parseRuby(str) {
  if (!str) return '';
  return escapeHTML(str).replace(/\{([^|{}]+)\|([^|{}]+)\}/g, (_, k, r) =>
    `<ruby>${k}<rt>${r}</rt></ruby>`);
}
function stripRuby(str) {
  if (!str) return '';
  return str.replace(/\{([^|{}]+)\|[^|{}]+\}/g, '$1');
}
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
  speak(text, { onend, onerror } = {}) {
    if (!('speechSynthesis' in window)) {
      onerror && onerror(new Error('no-tts'));
      return null;
    }
    // 開頭是 は/へ/を 會被 TTS 當助詞唸成 wa/e/o
    // 例：「歯」(は) → wa、「歯磨き粉」(はみがきこ) → wamigakiko
    // → 若有漢字版本，改餵漢字（TTS 對純漢字字串不會當助詞）
    let speakText = extractKana(text);
    const trimmed = speakText.trim();
    if (/^[はへを]/.test(trimmed)) {
      const kanji = stripRuby(text).trim();
      // 漢字版本要含 CJK 字元才用（避免換成跟 kana 一樣）
      if (kanji && kanji !== trimmed && /[一-鿿]/.test(kanji)) {
        speakText = kanji;
      }
    }
    const u = new SpeechSynthesisUtterance(speakText);
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

/* ---------- Force refresh: unregister SW + clear caches + reload ---------- */
async function forceRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch (e) { console.warn('force refresh err', e); }
  // bypass cache
  location.reload();
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

  root.innerHTML = `
    <div class="sub-head">
      <button class="back-btn" id="back-vocab" aria-label="返回">←</button>
      <div class="title-block">
        <h2>${sc.emoji} ${escapeHTML(sc.name_zh)}</h2>
        <span class="ja-sub">${sc.groups.length} 句型 · ${totalItems} 替換詞</span>
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
        <button class="icon-btn play-pattern" title="朗讀整句">🔊</button>
      </div>
      <div class="pattern-display">
        <div class="pattern-ja">${patternJaHtml}</div>
        <div class="pattern-zh">${patternZhHtml}</div>
      </div>
      <div class="item-chips">
        ${g.items.map(it => `
          <button class="item-chip" data-id="${it.id}"
                  data-ja="${escapeHTML(it.ja)}"
                  data-kana="${escapeHTML(it.kana)}"
                  data-zh="${escapeHTML(it.zh)}">
            <div class="chip-ja">${parseRuby(it.ja)}</div>
            <div class="chip-zh">${escapeHTML(it.zh)}</div>
          </button>
        `).join('')}
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

      const filledKana = patternKana.replace('{X}', itemKana);
      const filledJa = patternJa.replace('{X}', itemJa);  // 含 markup 給 TTS 用

      // ja 側：先 parseRuby pattern（ {X} 因為沒 | 不會被 ruby regex match，保留），再把 {X} 替換成包好的 item html
      const itemJaHtml = parseRuby(itemJa);
      const patternJaHtml = parseRuby(patternJa).replace(
        '{X}',
        `<span class="filled">${itemJaHtml}</span>`
      );
      groupCard.querySelector('.pattern-ja').innerHTML = patternJaHtml;

      // zh 側
      groupCard.querySelector('.pattern-zh').innerHTML =
        escapeHTML(patternZh).replace('{X}', `<span class="filled">${escapeHTML(itemZh)}</span>`);

      groupCard.dataset.currentKana = filledKana;
      groupCard.dataset.currentJa = filledJa;  // 給 play-pattern 用

      if (state.ttsAvailable) tts.speak(filledJa);  // 餵 markup，speak() 處理 fallback
      else toast('此瀏覽器無日語 TTS');

      groupCard.querySelectorAll('.item-chip.selected').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      chip.classList.add('flash');
      setTimeout(() => chip.classList.remove('flash'), 800);
    });
  });

  root.querySelectorAll('.play-pattern').forEach(b => {
    b.addEventListener('click', () => {
      const card = b.closest('.group-card');
      let toSpeak = card.dataset.currentJa || card.dataset.currentKana;
      if (!toSpeak) {
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
}

/* ---------- Tab 3: 測驗 ---------- */
function renderQuizView() {
  const root = document.getElementById('quiz-view');
  // 🍣 sushi mode: 不同 dispatcher
  if (state.sushiQuiz) {
    return renderSushiQuiz();
  }
  if (state._mapView) {
    return renderMapView(root);
  }
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

/* ---------- 🗾 日本旅行地圖 ---------- */
const MAP_CITIES = [
  { id: 'airport',     name: '札幌',   x: 290, y: 110, scenario: 'airport',     emoji: '✈️' },
  { id: 'station',     name: '青森',   x: 245, y: 200, scenario: 'station',     emoji: '🚉' },
  { id: 'flight',      name: '仙台',   x: 250, y: 270, scenario: 'flight',      emoji: '🛫' },
  { id: 'restaurant',  name: '東京',   x: 240, y: 340, scenario: 'restaurant',  emoji: '🍽️' },
  { id: 'sightseeing', name: '鎌倉',   x: 215, y: 380, scenario: 'sightseeing', emoji: '🗺️' },
  { id: 'hotel',       name: '京都',   x: 175, y: 360, scenario: 'hotel',       emoji: '🏨' },
  { id: 'ramen',       name: '大阪',   x: 162, y: 388, scenario: 'ramen',       emoji: '🍜' },
  { id: 'izakaya',     name: '神戸',   x: 138, y: 388, scenario: 'izakaya',     emoji: '🏮' },
  { id: 'conbini',     name: '福岡',   x: 78,  y: 425, scenario: 'conbini',     emoji: '🏪' },
  { id: 'emergency',   name: '沖縄',   x: 50,  y: 545, scenario: 'emergency',   emoji: '🆘' },
];
function getCityStars(scenarioId) {
  return parseInt(localStorage.getItem(`jpt_unlock_${scenarioId}`) || '0', 10);
}
function isMaster() {
  return MAP_CITIES.every(c => getCityStars(c.scenario) >= 1);
}

function renderMapView(root) {
  const totalStars = MAP_CITIES.reduce((s, c) => s + getCityStars(c.scenario), 0);
  const cleared = MAP_CITIES.filter(c => getCityStars(c.scenario) >= 1).length;
  const master = isMaster();

  root.innerHTML = `
    <div class="map-view">
      <div class="map-header">
        <button class="header-btn" id="map-back" aria-label="返回">←</button>
        <div class="map-title">
          <span class="map-title-zh">🗾 日本之旅</span>
          <span class="map-title-meta">${cleared}/${MAP_CITIES.length} 城市 · ${totalStars}/30 ★</span>
        </div>
        ${master ? '<div class="map-master-badge" title="達人">🎴 達人</div>' : '<div style="width:40px;"></div>'}
      </div>

      <div class="map-scroll">
        <svg class="map-svg" viewBox="0 0 360 600" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <!-- 海 -->
          <rect x="0" y="0" width="360" height="600" fill="url(#sea-gradient)"/>
          <defs>
            <linearGradient id="sea-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#E5EFF7"/>
              <stop offset="100%" stop-color="#C9DEEC"/>
            </linearGradient>
            <filter id="island-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" in="SourceAlpha"/>
              <feOffset dx="0" dy="2"/>
              <feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          <!-- 北海道 -->
          <path d="M 230,60 Q 280,40 320,80 Q 340,120 320,160 Q 290,180 250,165 Q 210,150 215,110 Q 215,80 230,60 Z"
                fill="#F4ECDC" stroke="#B89B6E" stroke-width="1.5" filter="url(#island-shadow)"/>
          <!-- 本州 -->
          <path d="M 240,180 Q 255,200 250,225 Q 245,260 245,290 Q 240,320 235,345
                   Q 215,375 180,375 Q 145,380 115,395 Q 90,410 75,425
                   Q 65,420 80,400 Q 110,375 145,365 Q 175,355 195,345
                   Q 215,330 220,300 Q 225,260 225,225 Q 220,200 235,180 Z"
                fill="#F4ECDC" stroke="#B89B6E" stroke-width="1.5" filter="url(#island-shadow)"/>
          <!-- 四國 -->
          <ellipse cx="135" cy="425" rx="32" ry="14" fill="#F4ECDC" stroke="#B89B6E" stroke-width="1.5" filter="url(#island-shadow)"/>
          <!-- 九州 -->
          <path d="M 60,415 Q 95,415 100,440 Q 105,465 85,480 Q 60,490 45,470 Q 35,445 50,420 Q 55,415 60,415 Z"
                fill="#F4ECDC" stroke="#B89B6E" stroke-width="1.5" filter="url(#island-shadow)"/>
          <!-- 沖繩 -->
          <ellipse cx="50" cy="545" rx="20" ry="8" fill="#F4ECDC" stroke="#B89B6E" stroke-width="1.5" filter="url(#island-shadow)"/>

          <!-- 連線（旅行路線） -->
          <path d="${MAP_CITIES.map((c,i) => (i===0?'M':'L')+c.x+','+c.y).join(' ')}"
                stroke="#C5302B" stroke-width="1.5" stroke-dasharray="3,4"
                fill="none" opacity="0.4"/>
        </svg>

        ${MAP_CITIES.map(c => {
          const stars = getCityStars(c.scenario);
          return `
            <button class="map-city ${stars>=1?'unlocked':'locked'} ${stars===3?'three-star':''}"
                    style="left:${(c.x/360)*100}%;top:${(c.y/600)*100}%;"
                    data-scope="${c.scenario}"
                    aria-label="${escapeHTML(c.name)} - ${stars} 星">
              <div class="city-dot">
                ${stars>=1
                  ? `<img class="city-torii" src="assets/decor/mini_torii.png" alt="">`
                  : `<span class="city-emoji">${c.emoji}</span>`}
              </div>
              <div class="city-name">${escapeHTML(c.name)}</div>
              <div class="city-stars">${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</div>
            </button>
          `;
        }).join('')}
      </div>

      <div class="map-footer">
        <p class="hint">${master ? '🎌 全部過關，恭喜旅程完滿！' : '點選城市開始挑戰 · 最佳分數記錄會更新城市星數'}</p>
      </div>
    </div>
  `;

  root.querySelector('#map-back').addEventListener('click', () => {
    state._mapView = false;
    renderQuizView();
  });
  root.querySelectorAll('.map-city').forEach(b => {
    b.addEventListener('click', () => {
      const scope = b.dataset.scope;
      state._mapView = false;
      // 城市旅 = 看假名 → 選漢字（10 題）
      const setup = { type: 'kanaKanji', scope, count: 10 };
      state._quizSetup = setup;
      startQuiz(setup);
    });
  });
}

function renderQuizSetup(root) {
  const setup = state._quizSetup || { type: 'listen', scope: 'all', count: 10 };
  if (setup.type === 'fill') setup.type = 'listen';  // 填空題已下架，自動轉聽選中
  state._quizSetup = setup;

  const totalStars = MAP_CITIES.reduce((s, c) => s + getCityStars(c.scenario), 0);
  const cleared = MAP_CITIES.filter(c => getCityStars(c.scenario) >= 1).length;

  root.innerHTML = `
    <button class="map-entry-card" id="map-entry">
      <div class="map-entry-left">
        <div class="map-entry-emoji">🗾</div>
        <div>
          <div class="map-entry-title">日本之旅</div>
          <div class="map-entry-sub">看假名選漢字 · ${cleared}/${MAP_CITIES.length} 城市已過關</div>
        </div>
      </div>
      <div class="map-entry-stars">${totalStars}/30 ★</div>
    </button>

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
        <button class="option-pill ${setup.type==='readJa'?'active':''}" data-type="readJa">
          📖 看選中
          <span class="desc">看日文 → 選中文</span>
        </button>
        <button class="option-pill ${setup.type==='sushi'?'active':''}" data-type="sushi" style="grid-column:1/-1;background:linear-gradient(135deg, var(--bg-input), rgba(245,194,199,0.15));">
          🍣 流れクイズ
          <span class="desc">迴轉壽司題庫 — 限時點正確的盤子（取代填空題）</span>
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

    ${state.history.length ? `
      <div class="quiz-setup-card" style="margin-top:14px;">
        <h3>歷史紀錄</h3>
        <ul style="display:flex;flex-direction:column;gap:6px;">
          ${state.history.slice(-5).reverse().map(h => `
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
  root.querySelector('#start-quiz').addEventListener('click', () => {
    if (setup.type === 'sushi') startSushiQuiz(setup);
    else startQuiz(setup);
  });
  root.querySelector('#map-entry').addEventListener('click', () => {
    state._mapView = true;
    renderQuizView();
  });
}

function quizTypeLabel(t) {
  return { listen: '聽選中', read: '看選日', readJa: '看選中', kanaKanji: '假名→漢字', fill: '填空', sushi: '🍣 流れ' }[t] || t;
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
  const allItems = [];
  scenarios.forEach(sc => {
    sc.groups.forEach(g => g.items.forEach(it => allItems.push({ item: it, group: g, scenario: sc })));
  });
  if (allItems.length === 0) { toast('題庫不足'); return; }

  // 純隨機（無加權）
  const shuffled = shuffle(allItems.slice());
  const picks = shuffled.slice(0, count);
  const qs = picks.map(rec => buildQuestion(type, rec, allItems));

  state.quizActive = { type, scope, qs, idx: 0, score: 0, errors: [] };
  renderQuizView();
}

function buildQuestion(type, rec, allItems) {
  const correct = rec.item;

  let prompt, choices, correctIdx, promptLabel, isJaPrompt = false, ttsText = null;

  if (type === 'readJa') {
    // 看日文 → 選中文
    promptLabel = '日文：';
    prompt = parseRuby(correct.ja);
    isJaPrompt = true;
    ttsText = correct.ja;  // 餵 markup，讓 speak() 處理 は→歯 fallback
    const distractorPool = allItems.filter(r => r.item.id !== correct.id).map(r => r.item);
    shuffle(distractorPool);
    const distractors = distractorPool.slice(0, 3);
    const opts = shuffle([correct, ...distractors]);
    choices = opts.map(it => ({ text: it.zh, isJa: false, id: it.id }));
    correctIdx = opts.findIndex(it => it.id === correct.id);
  } else if (type === 'kanaKanji') {
    // 看假名 → 選漢字（地圖城市用）
    promptLabel = '假名：';
    prompt = escapeHTML(correct.kana || stripRuby(correct.ja));
    isJaPrompt = true;
    ttsText = correct.ja;  // 餵 markup，讓 speak() 處理 は→歯 fallback
    const distractorPool = allItems.filter(r => r.item.id !== correct.id).map(r => r.item);
    shuffle(distractorPool);
    const distractors = distractorPool.slice(0, 3);
    const opts = shuffle([correct, ...distractors]);
    choices = opts.map(it => ({
      text: escapeHTML(stripRuby(it.ja)),  // 漢字版本（ruby furigana 拿掉）
      isJa: true,
      id: it.id,
    }));
    correctIdx = opts.findIndex(it => it.id === correct.id);
  } else if (type === 'fill') {
    // 填空題：擾亂選項從同 group（同句型）抽，玩家靠中文提示挑正解
    const g = rec.group;
    let pool = shuffle(g.items.filter(it => it.id !== correct.id));
    if (pool.length < 3) {
      const sameSc = [];
      rec.scenario.groups.forEach(gg => {
        if (gg.id === g.id) return;
        gg.items.forEach(it => {
          if (it.id !== correct.id && !pool.find(p => p.id === it.id)) sameSc.push(it);
        });
      });
      pool = pool.concat(shuffle(sameSc));
    }
    if (pool.length < 3) {
      const extra = allItems
        .filter(r => r.item.id !== correct.id && !pool.find(p => p.id === r.item.id))
        .map(r => r.item);
      pool = pool.concat(shuffle(extra));
    }
    const distractors = pool.slice(0, 3);

    const jaBlank = parseRuby(g.pattern_ja).replace('{X}',
      '<span class="blank">　　　</span>');
    const zhFilled = escapeHTML(g.pattern_zh).replace('{X}',
      `<span class="filled">${escapeHTML(correct.zh)}</span>`);
    prompt = `${jaBlank}<div class="prompt-zh-hint">${zhFilled}</div>`;
    isJaPrompt = true;
    promptLabel = '填空：';
    const opts = shuffle([correct, ...distractors]);
    choices = opts.map(it => ({ text: parseRuby(it.ja), isJa: true, id: it.id }));
    correctIdx = opts.findIndex(it => it.id === correct.id);
  } else {
    // listen / read：擾亂從全題庫抽（不同 zh / ja 一定不衝突）
    const distractorPool = allItems.filter(r => r.item.id !== correct.id).map(r => r.item);
    shuffle(distractorPool);
    const distractors = distractorPool.slice(0, 3);

    if (type === 'listen') {
      promptLabel = '請聽：';
      prompt = '';
      ttsText = correct.ja;
      const opts = shuffle([correct, ...distractors]);
      choices = opts.map(it => ({ text: it.zh, isJa: false, id: it.id }));
      correctIdx = opts.findIndex(it => it.id === correct.id);
    } else { // read
      promptLabel = '中文：';
      prompt = correct.zh;
      const opts = shuffle([correct, ...distractors]);
      choices = opts.map(it => ({ text: parseRuby(it.ja), isJa: true, id: it.id }));
      correctIdx = opts.findIndex(it => it.id === correct.id);
    }
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
        ` : (cur.type === 'readJa' || cur.type === 'kanaKanji') ? `
          <div class="prompt-content ja${cur.type === 'kanaKanji' ? ' kana-only' : ''}">${cur.prompt}</div>
          <button class="play-mini" id="play-prompt">🔊 再聽一次</button>
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

  if (cur.type === 'listen' || cur.type === 'readJa' || cur.type === 'kanaKanji') {
    const playBtn = root.querySelector('#play-prompt');
    const speakIt = () => {
      if (!state.ttsAvailable) {
        if (cur.type === 'listen') toast('此瀏覽器無日語 TTS');
        return;
      }
      tts.speak(cur.ttsText);
    };
    if (playBtn) playBtn.addEventListener('click', speakIt);
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
      } else {
        q.errors.push({ q: cur, picked: i });
      }

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
    state.sushiQuiz = null;
    renderQuizView();
  }
}

function renderQuizResult(root) {
  const q = state.quizActive;
  state.history.push({
    ts: Date.now(), type: q.type, scope: q.scope, score: q.score, total: q.qs.length
  });
  if (state.history.length > 50) state.history.splice(0, state.history.length - 50);

  // 城市星數解鎖：看選中（readJa）/ 看假名選漢字（kanaKanji）達到分數門檻就算過關
  const pct = Math.round((q.score / q.qs.length) * 100);
  if ((q.type === 'readJa' || q.type === 'kanaKanji') && q.scope !== 'all') {
    const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;
    if (stars >= 1) {
      const unlockKey = `jpt_unlock_${q.scope}`;
      const prev = parseInt(localStorage.getItem(unlockKey) || '0', 10);
      if (stars > prev) {
        try { localStorage.setItem(unlockKey, String(stars)); } catch (_) {}
      }
    }
  }
  saveState();
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

/* ---------- 🍣 寿司流れクイズ ---------- */
function startSushiQuiz({ scope, count }) {
  const scenarios = scope === 'all' ? state.scenarios : [state.byId.get(scope)].filter(Boolean);
  const allItems = [];
  scenarios.forEach(sc => sc.groups.forEach(g => g.items.forEach(it => allItems.push({ item: it, group: g, scenario: sc }))));
  if (allItems.length === 0) { toast('題庫不足'); return; }

  // 按 pattern_ja 字串分組（不只 group.id），同 pattern 跨場景視為同一桶，避免重複出題
  const byPattern = new Map();
  allItems.forEach(rec => {
    const key = rec.group.pattern_ja;
    if (!byPattern.has(key)) byPattern.set(key, []);
    byPattern.get(key).push(rec);
  });
  const groupBuckets = shuffle(Array.from(byPattern.values()).map(arr => shuffle(arr.slice())));
  const picks = [];
  let gi = 0;
  while (picks.length < Math.min(count, allItems.length)) {
    const bucket = groupBuckets[gi % groupBuckets.length];
    if (bucket.length) picks.push(bucket.shift());
    gi++;
    if (groupBuckets.every(b => b.length === 0)) break;
  }

  const qs = picks.map(rec => {
    const correct = rec.item;
    // 從同一 group（同一句型）抽擾亂選項，讓 4 個選項語意一致
    let pool = shuffle(rec.group.items.filter(it => it.id !== correct.id));
    // 同 group 不足 3 個 → 從同 scenario 其他 group 補
    if (pool.length < 3) {
      const sameSc = [];
      rec.scenario.groups.forEach(g => {
        if (g.id === rec.group.id) return;
        g.items.forEach(it => {
          if (it.id !== correct.id && !pool.find(p => p.id === it.id)) sameSc.push(it);
        });
      });
      pool = pool.concat(shuffle(sameSc));
    }
    // 仍不足 → 全題庫補（極端情況才會走到）
    if (pool.length < 3) {
      const extra = allItems
        .filter(r => r.item.id !== correct.id && !pool.find(p => p.id === r.item.id))
        .map(r => r.item);
      pool = pool.concat(shuffle(extra));
    }
    const opts = shuffle([correct, ...pool.slice(0, 3)]);
    return {
      pattern: rec.group,
      items: opts,
      correctIdx: opts.findIndex(it => it.id === correct.id),
      answered: false,
    };
  });

  state.sushiQuiz = {
    scope, qs, qIdx: 0, score: 0, hp: 3, streak: 0, proMode: false,
    correctCount: 0,
  };
  state.quizActive = state.sushiQuiz;  // 共用 beforeunload 邏輯
  renderSushiQuiz();
}

function renderSushiQuiz() {
  const root = document.getElementById('quiz-view');
  const q = state.sushiQuiz;
  if (!q) return;
  if (q.hp <= 0 || q.qIdx >= q.qs.length) {
    return renderSushiResult(root);
  }
  const cur = q.qs[q.qIdx];
  const carrier = getCarrierForScope(q.scope);  // null=壽司, 路徑=場景圖, 'svg-emergency'=救護SVG
  // pre-pick visuals so re-render keeps them
  if (!cur._visuals) {
    cur._visuals = cur.items.map(() => ({
      sushi: pickSushi(q.proMode),
      plate: pickPlate(),
    }));
  }
  // duration: 14s → min 8s（讀假名比讀中文慢，給多一點時間）
  const baseDur = 14000;
  const minDur = 8000;
  const duration = Math.max(minDur, baseDur * Math.pow(0.96, q.qIdx));

  // 中文句型把答案直接填進去當提示，玩家按出對應的「日文（假名）」盤
  const correctItem = cur.items[cur.correctIdx];
  const patternJaHtml = parseRuby(cur.pattern.pattern_ja).replace(
    '{X}', '<span class="sushi-blank">　　　</span>'
  );
  const patternZhHtml = escapeHTML(cur.pattern.pattern_zh).replace(
    '{X}', `<span class="sushi-answer-zh">${escapeHTML(correctItem.zh)}</span>`
  );

  root.innerHTML = `
    <div class="sushi-game ${q.proMode ? 'pro-mode' : ''}">
      <div class="sushi-head">
        <span>第 ${q.qIdx + 1} / ${q.qs.length} 題</span>
        ${q.proMode ? '<span class="pro-badge">板前モード ×2</span>' : ''}
        <button class="quit-quiz-btn" id="quit-quiz">✕ 退出</button>
      </div>
      <div class="sushi-pattern">
        <div class="pattern-ja-game">${patternJaHtml}</div>
        <div class="pattern-zh-game">${patternZhHtml}</div>
      </div>
      <div class="conveyor-area">
        <div class="cat-area">
          <img class="cat" src="assets/cat/cat_${q.proMode ? 'pro' : 'idle'}.png" alt="cat">
        </div>
        <div class="conveyor-track">
          <div class="conveyor-wrapper" id="conveyor-wrapper" style="--duration: ${duration}ms">
            ${cur.items.map((it, i) => {
              const v = cur._visuals[i];
              const bonusClass = v.plate === 'plate_gold' ? 'bonus-gold'
                              : v.plate === 'plate_red'  ? 'bonus-red' : '';
              if (carrier === null) {
                // 全部混合 → 用壽司流（既有行為）
                return `
                  <button class="plate-btn" data-i="${i}">
                    <div class="plate-label">${escapeHTML(it.kana || stripRuby(it.ja))}</div>
                    <img class="sushi-img" src="assets/sushi/${v.sushi}.png" alt="">
                    <img class="plate-img" src="assets/plate/${v.plate}.png" alt="">
                  </button>
                `;
              } else if (carrier === 'svg-emergency') {
                // emergency 用 SVG 救護箱
                return `
                  <button class="plate-btn carrier-mode ${bonusClass}" data-i="${i}">
                    <div class="plate-label">${escapeHTML(it.kana || stripRuby(it.ja))}</div>
                    <div class="carrier-svg">
                      <svg viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <rect x="6" y="12" width="52" height="32" rx="4" fill="#fff" stroke="#333" stroke-width="2"/>
                        <rect x="22" y="6" width="20" height="8" rx="1" fill="#fff" stroke="#333" stroke-width="2"/>
                        <rect x="28" y="22" width="8" height="14" fill="#C5302B"/>
                        <rect x="22" y="26" width="20" height="6" fill="#C5302B"/>
                      </svg>
                    </div>
                  </button>
                `;
              } else {
                // 場景化載體
                return `
                  <button class="plate-btn carrier-mode ${bonusClass}" data-i="${i}">
                    <div class="plate-label">${escapeHTML(it.kana || stripRuby(it.ja))}</div>
                    <img class="carrier-img" src="${carrier}" alt="">
                  </button>
                `;
              }
            }).join('')}
          </div>
        </div>
      </div>
      <div class="sushi-bottom">
        <div class="hp-row">${'❤'.repeat(q.hp)}<span class="hp-empty">${'♡'.repeat(3 - q.hp)}</span></div>
        <div class="score-info">
          <span>分數 <strong>${q.score}</strong></span>
          <span class="streak-${q.streak >= 3 ? 'hot' : 'cool'}">連對 ${q.streak}</span>
        </div>
      </div>
    </div>
  `;

  const wrapper = root.querySelector('#conveyor-wrapper');

  // 直接 JS 控制 transition（避免 RAF/class 競態）
  // 1. 確保起始 transform=0、無 transition
  wrapper.style.transition = 'none';
  wrapper.style.transform = 'translateX(0)';
  void wrapper.offsetWidth;  // force reflow
  // 2. 下一個 tick 套上 transition + 終點 transform
  setTimeout(() => {
    if (!wrapper.isConnected) return;
    wrapper.style.transition = `transform ${duration}ms linear`;
    // 動態算終點：跨完整個 viewport + wrapper 自身寬
    const endX = -(window.innerWidth + wrapper.offsetWidth + 50);
    wrapper.style.transform = `translateX(${endX}px)`;
  }, 30);

  // Miss handler — transition finishes without click
  wrapper.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'transform') return;
    if (cur.answered) return;
    cur.answered = true;
    handleSushiAnswer(false, null, true, null);
  }, { once: true });

  // Plate click
  root.querySelectorAll('.plate-btn').forEach(b => {
    b.addEventListener('click', e => {
      if (cur.answered) return;
      cur.answered = true;
      const i = parseInt(b.dataset.i, 10);
      const isCorrect = i === cur.correctIdx;
      const plateType = cur._visuals[i].plate;
      handleSushiAnswer(isCorrect, plateType, false, b);
    });
  });

  root.querySelector('#quit-quiz')?.addEventListener('click', confirmSushiQuit);
}

function freezeConveyor() {
  const w = document.querySelector('#conveyor-wrapper');
  if (!w) return;
  // 把目前 transform 凍住（停止 transition）
  const cs = getComputedStyle(w);
  w.style.transition = 'none';
  w.style.transform = cs.transform;
}

function handleSushiAnswer(correct, plateType, missed, btnEl) {
  const q = state.sushiQuiz;
  if (!q) return;
  freezeConveyor();

  let catState;
  if (missed) {
    q.hp--;
    q.streak = 0;
    catState = 'surprised';
  } else if (correct) {
    const mult = PLATE_MULT[plateType] || 1;
    const proBonus = q.proMode ? 2 : 1;
    q.score += 10 * mult * proBonus;
    q.streak++;
    q.correctCount++;
    catState = 'happy';
    if (btnEl) btnEl.classList.add('plate-correct');
    // 連對 ≥3 → 撒櫻花慶祝
    if (q.streak >= 3) spawnSakuraBurst(q.streak >= 5 ? 10 : 6);
    if (q.streak >= 5 && !q.proMode) {
      q.proMode = true;
      catState = 'pro';
    }
  } else {
    q.hp--;
    q.streak = 0;
    catState = 'sad';
    if (btnEl) btnEl.classList.add('plate-wrong');
  }

  // Briefly show what was correct (highlight correct plate green outline)
  if (!correct && !missed) {
    const correctBtn = document.querySelector(`.plate-btn[data-i="${q.qs[q.qIdx].correctIdx}"]`);
    if (correctBtn) correctBtn.classList.add('plate-show-correct');
  }

  const cat = document.querySelector('.cat');
  if (cat) cat.src = `assets/cat/cat_${catState}.png`;

  setTimeout(() => {
    if (q.hp <= 0) {
      renderSushiResult(document.getElementById('quiz-view'));
      return;
    }
    q.qIdx++;
    renderSushiQuiz();
  }, missed ? 900 : 1300);
}

function confirmSushiQuit() {
  if (!state.sushiQuiz) return;
  if (confirm('確定要退出？目前進度不會儲存')) {
    state.sushiQuiz = null;
    state.quizActive = null;
    renderQuizView();
  }
}

function renderSushiResult(root) {
  const q = state.sushiQuiz;
  const won = q.hp > 0 && q.qIdx >= q.qs.length;

  // Best score
  const bestKey = `jpt_sushi_best_${q.scope}`;
  let best = parseInt(localStorage.getItem(bestKey) || '0', 10);
  const newBest = q.score > best;
  if (newBest) {
    best = q.score;
    try { localStorage.setItem(bestKey, String(best)); } catch (_) {}
  }

  // History
  state.history.push({
    ts: Date.now(), type: 'sushi', scope: q.scope, score: q.score, total: q.qs.length
  });
  if (state.history.length > 50) state.history.splice(0, state.history.length - 50);

  // 通關記錄：每個 scenario 達到 1 星以上就記下，方便地圖頁解鎖
  const stars = q.score >= 200 ? 3 : q.score >= 100 ? 2 : q.score >= 30 ? 1 : 0;
  if (stars >= 1 && q.scope !== 'all') {
    const unlockKey = `jpt_unlock_${q.scope}`;
    const prev = parseInt(localStorage.getItem(unlockKey) || '0', 10);
    if (stars > prev) {
      try { localStorage.setItem(unlockKey, String(stars)); } catch (_) {}
    }
  }
  saveState();

  const scopeName = q.scope === 'all' ? '全部混合' : (state.byId.get(q.scope)?.name_zh || q.scope);
  const starsHtml = Array.from({length: 3}, (_, i) =>
    `<span class="result-star ${i < stars ? 'on' : ''}">★</span>`
  ).join('');

  root.innerHTML = `
    <div class="quiz-question-card sushi-result">
      <div class="hanko-area">
        <img class="hanko-stamp ${won && stars >= 2 ? 'stamped' : 'half'}" src="assets/decor/hanko_stamp.png" alt="御朱印">
        <div class="hanko-scope-label">${escapeHTML(scopeName)}</div>
      </div>
      <div style="text-align:center;">
        <div class="result-cat" style="margin-top:10px;">
          <img src="assets/cat/cat_${won ? 'happy' : 'asleep'}.png" alt="" style="width:90px;height:90px;">
        </div>
        <div class="score" style="font-size:48px;color:var(--c-shu);font-weight:700;">${q.score}</div>
        <div class="score-label">${won ? '🎉 全部過關！' : `第 ${q.qIdx + 1} 題 game over`}</div>
        <div class="result-stars">${starsHtml}</div>
        <div class="muted small" style="margin-top:6px;">
          答對 ${q.correctCount} / ${q.qs.length} 題
          ${newBest ? '<span style="color:var(--c-shu);font-weight:600;"> · 新紀錄！</span>' : ` · 最佳 ${best}`}
        </div>
        <div class="btn-row" style="justify-content:center;margin-top:18px;">
          <button class="btn-secondary" id="quiz-back">回設定</button>
          <button class="btn-primary" id="quiz-again">再試一次</button>
        </div>
      </div>
    </div>
  `;

  // Cleanup state but keep scope for re-try
  state.sushiQuiz = null;
  state.quizActive = null;

  root.querySelector('#quiz-back').addEventListener('click', () => {
    renderQuizView();
  });
  root.querySelector('#quiz-again').addEventListener('click', () => {
    const setup = state._quizSetup;
    startSushiQuiz(setup);
  });

  // 蓋章音效模擬：稍微 delay 觸發 stamp 動畫（CSS animation 會自己跑，這只是視覺再震一下）
  if (won && stars >= 1) {
    setTimeout(() => {
      const stamp = root.querySelector('.hanko-stamp');
      if (stamp) stamp.classList.add('thump');
    }, 500);
  }
}

/* 連對 sakura 飄落 */
function spawnSakuraBurst(count = 6) {
  const layer = document.getElementById('sakura-layer') || (() => {
    const l = document.createElement('div');
    l.id = 'sakura-layer';
    l.className = 'sakura-layer';
    document.body.appendChild(l);
    return l;
  })();
  for (let i = 0; i < count; i++) {
    const p = document.createElement('img');
    p.className = 'sakura-petal';
    p.src = 'assets/decor/sakura_petal.png';
    p.style.left = (10 + Math.random() * 80) + 'vw';
    p.style.animationDelay = (Math.random() * 0.6) + 's';
    p.style.animationDuration = (2.5 + Math.random() * 1.5) + 's';
    p.style.transform = `rotate(${Math.random()*360}deg)`;
    layer.appendChild(p);
    setTimeout(() => p.remove(), 4500);
  }
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
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    if (confirm('強制重新整理？會清掉 cache 並抓最新版本。')) forceRefresh();
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
  document.getElementById('clear-history')?.addEventListener('click', () => {
    if (!confirm('清掉測驗歷史紀錄？')) return;
    state.history = [];
    saveState();
    toast('已清空歷史');
    if (state.currentTab === 'tab-quiz') renderQuizView();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('settings-modal').classList.contains('hidden')) {
        closeSettings();
      } else if (state.quizActive && state.currentTab === 'tab-quiz') {
        confirmQuitQuiz();
      }
    }
  });

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
  preloadGameAssets();
  setTab('tab-dialogues');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW reg fail', err));
  }
}

document.addEventListener('DOMContentLoaded', init);
