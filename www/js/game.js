/* Quillnine - UI, input, notes, undo, timer, stats, daily, persistence. Rules/generator live in logic.js. */
(function () {
  'use strict';
  var L = window.QNLogic, SFX = window.SFX, THEMES = window.THEMES;
  var $ = function (id) { return document.getElementById(id); };
  var SAVE_KEY = 'quillnine.save.v1';
  var MAX_MISTAKES = 3;
  var native = window.Ads && window.Ads.isNative();
  document.body.classList.add(native ? 'native' : 'web');

  // ---------------- persistence ----------------
  function emptyStats() { var s = {}; L.DIFFS.forEach(function (d) { s[d] = { started: 0, won: 0, lost: 0, bestMs: 0, totalMs: 0, perfect: 0, streak: 0, bestStreak: 0 }; }); return s; }
  function defaults() {
    return {
      coins: 0, owned: ['paper', 'midnight'], theme: 'paper', lastDiff: 'medium',
      settings: { sound: true, haptics: true, limit: true, check: true, autonotes: true, same: true, area: true, timer: true },
      stats: emptyStats(), daily: { done: {}, streak: 0, best: 0, last: '' }, game: null, ad: {}
    };
  }
  function load() {
    var d = defaults();
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && typeof s === 'object') {
        Object.keys(d).forEach(function (k) { if (s[k] !== undefined) d[k] = s[k]; });
        d.settings = Object.assign(defaults().settings, s.settings || {});
        d.stats = Object.assign(emptyStats(), s.stats || {});
        d.daily = Object.assign(defaults().daily, s.daily || {});
      }
    } catch (e) {}
    return d;
  }
  var save = load();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
  var gate = window.AdGate.create(window.ADS_CONFIG, save.ad);
  save.ad = gate.state;

  // ---------------- state ----------------
  var G = null;          // current puzzle state (save.game)
  var sel = -1;          // selected cell
  var notesMode = false;
  var paused = false;
  var cells = [];
  function validGame(g) {
    return g && Array.isArray(g.puzzle) && g.puzzle.length === 81 && Array.isArray(g.solution) && g.solution.length === 81 &&
      Array.isArray(g.grid) && g.grid.length === 81 && Array.isArray(g.notes) && g.notes.length === 81 && L.DIFFS.indexOf(g.difficulty) >= 0;
  }
  function newGameState(gen, daily) {
    return {
      difficulty: gen.difficulty, daily: daily || null, seed: gen.seed, puzzle: gen.puzzle.slice(), solution: gen.solution.slice(),
      grid: gen.puzzle.slice(), notes: new Array(81).fill(0), hinted: [], mistakes: 0, hints: 0, extraUsed: false,
      elapsed: 0, done: false, lost: false, undo: [], counted: false, awarded: 0, started: Date.now()
    };
  }

  // ---------------- helpers ----------------
  function haptic(kind) {
    if (!save.settings.haptics || !native) return;
    var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if (!H) return;
    try {
      if (kind === 'success') H.notification({ type: 'SUCCESS' });
      else if (kind === 'error') H.notification({ type: 'ERROR' });
      else H.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
    } catch (e) {}
  }
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2200);
  }
  function setCoins() { Array.prototype.forEach.call(document.querySelectorAll('.coins-val'), function (e) { e.textContent = save.coins; }); }
  function theme() { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === save.theme) return THEMES[i]; return THEMES[0]; }
  function applyTheme() {
    var cl = document.body.classList;
    Array.prototype.slice.call(cl).forEach(function (c) { if (/^theme-/.test(c)) cl.remove(c); });
    cl.add('theme-' + save.theme);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', theme().swatch[0]);
  }
  function limitOn() { return !!save.settings.limit; }
  function checkOn() { return !!save.settings.check || limitOn(); }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function isOpen(id) { return !$(id).classList.contains('hidden'); }
  function diffName(d) { return L.DIFF_NAMES[d]; }
  function prettyDate(key) {
    var p = key.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ---------------- board ----------------
  function buildBoard() {
    var b = $('board'); b.innerHTML = ''; cells = [];
    for (var i = 0; i < 81; i++) {
      var c = document.createElement('div');
      c.className = 'cell r' + L.ROW[i] + ' c' + L.COL[i];
      c.dataset.i = i;
      c.innerHTML = '<span class="v"></span><div class="notes"></div>';
      c.addEventListener('pointerdown', onCellDown);
      b.appendChild(c); cells.push(c);
    }
    var pad = $('pad'); pad.innerHTML = '';
    for (var d = 1; d <= 9; d++) {
      var bt = document.createElement('button');
      bt.dataset.d = d; bt.innerHTML = '<b>' + d + '</b><small></small>';
      bt.addEventListener('click', onPad);
      pad.appendChild(bt);
    }
  }
  function layout() {
    var stage = $('stage'), r = stage.getBoundingClientRect();
    var w = Math.min(r.width - 20, 520);
    var h = r.height - 170; // tools + pad
    var bs = Math.floor(Math.max(220, Math.min(w, h)) / 9) * 9;
    document.documentElement.style.setProperty('--bs', bs + 'px');
  }
  function wrongAt(i) { return G.grid[i] && !G.puzzle[i] && G.grid[i] !== G.solution[i]; }
  function render() {
    if (!G) return;
    var conf = {}; L.conflicts(G.grid).forEach(function (i) { conf[i] = 1; });
    var sv = sel >= 0 ? G.grid[sel] : 0;
    var counts = new Array(10).fill(0);
    for (var i = 0; i < 81; i++) {
      var c = cells[i], v = G.grid[i];
      if (v && !(checkOn() && wrongAt(i))) counts[v]++;
      var cls = 'cell r' + L.ROW[i] + ' c' + L.COL[i];
      if (G.puzzle[i]) cls += ' given'; else if (v) cls += ' user';
      if (v && checkOn() && wrongAt(i)) cls += ' wrong';
      if (conf[i] && !G.puzzle[i]) cls += ' conflict';
      if (G.hinted.indexOf(i) >= 0) cls += ' hinted';
      if (sel >= 0) {
        if (i === sel) cls += ' sel';
        else if (save.settings.same && sv && v === sv) cls += ' same';
        else if (save.settings.area && (L.ROW[i] === L.ROW[sel] || L.COL[i] === L.COL[sel] || L.BOX[i] === L.BOX[sel])) cls += ' area';
      }
      if (c.className.indexOf(' pop') >= 0) cls += ' pop';
      c.className = cls;
      c.firstChild.textContent = v || '';
      var nd = c.lastChild, nm = v ? 0 : G.notes[i];
      if (nd.dataset.m !== String(nm) + '|' + (save.settings.same ? sv : 0)) {
        var html = '';
        if (nm) for (var d = 1; d <= 9; d++) html += '<i' + (sv === d && save.settings.same ? ' class="hl"' : '') + '>' + ((nm & L.bit(d)) ? d : '') + '</i>';
        nd.innerHTML = html; nd.dataset.m = String(nm) + '|' + (save.settings.same ? sv : 0);
      }
    }
    Array.prototype.forEach.call($('pad').children, function (b) {
      var d = +b.dataset.d, left = 9 - counts[d];
      b.classList.toggle('done', left <= 0);
      b.lastChild.textContent = left > 0 ? left : '';
    });
    $('g-diff').textContent = diffName(G.difficulty);
    $('g-diff').classList.toggle('daily', !!G.daily);
    $('g-mist').textContent = limitOn() ? G.mistakes + '/' + MAX_MISTAKES : String(G.mistakes);
    $('g-time').textContent = L.formatTime(G.elapsed);
    $('t-notes').classList.toggle('on', notesMode);
    $('notes-badge').textContent = notesMode ? 'ON' : 'OFF';
    document.body.classList.toggle('notes-mode', notesMode);
    $('t-undo').disabled = !G.undo.length || G.done;
    document.body.classList.toggle('no-timer', !save.settings.timer);
  }
  function pop(i) { var c = cells[i]; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); setTimeout(function () { c.classList.remove('pop'); }, 260); }
  function wave(list, step) {
    list.forEach(function (i, k) { var c = cells[i]; setTimeout(function () { c.classList.remove('wave'); void c.offsetWidth; c.classList.add('wave'); setTimeout(function () { c.classList.remove('wave'); }, 600); }, k * (step || 30)); });
  }

  // ---------------- input ----------------
  function playable() { return G && !G.done && !G.lost && !paused && !isOpen('outm'); }
  function onCellDown(e) {
    if (!playable()) return;
    SFX.unlock();
    var i = +e.currentTarget.dataset.i;
    sel = i; SFX.select(); render();
  }
  function onPad(e) {
    var d = +e.currentTarget.dataset.d;
    input(d);
  }
  function input(d) {
    if (!playable() || sel < 0) return;
    SFX.unlock();
    if (G.puzzle[sel]) { haptic('light'); return; }
    if (notesMode) {
      if (G.grid[sel]) return;
      pushUndo({ i: sel, v: G.grid[sel], n: G.notes[sel], peers: [] });
      G.notes[sel] = L.toggleNote(G.notes[sel], d);
      SFX.note(); haptic('light');
      afterChange(false);
      return;
    }
    if (G.grid[sel] === d) { erase(); return; }
    var act = { i: sel, v: G.grid[sel], n: G.notes[sel], peers: [] };
    G.grid[sel] = d; G.notes[sel] = 0;
    if (save.settings.autonotes) {
      L.PEERS[sel].forEach(function (j) { if (G.notes[j] & L.bit(d)) act.peers.push([j, G.notes[j]]); });
      L.autoRemoveNotes(G.notes, sel, d);
    }
    pushUndo(act);
    pop(sel);
    if (d !== G.solution[sel]) {
      if (checkOn()) { cells[sel].classList.add('shake'); var c = cells[sel]; setTimeout(function () { c.classList.remove('shake'); }, 340); }
      if (limitOn()) {
        G.mistakes++;
        SFX.error(); haptic('error');
        afterChange(true);
        if (G.mistakes >= MAX_MISTAKES) outOfMistakes();
        return;
      }
      if (checkOn()) { SFX.error(); haptic('error'); } else SFX.place();
      afterChange(true);
      return;
    }
    SFX.place(); haptic('light');
    // completed units
    var done = [];
    [L.ROW[sel], 9 + L.COL[sel], 18 + L.BOX[sel]].forEach(function (u) {
      if (L.UNITS[u].every(function (j) { return G.grid[j] === G.solution[j]; })) done = done.concat(L.UNITS[u]);
    });
    afterChange(true);
    if (checkSolved()) return;
    if (done.length) { SFX.unit(); wave(done, 18); }
  }
  function erase() {
    if (!playable() || sel < 0 || G.puzzle[sel]) return;
    if (!G.grid[sel] && !G.notes[sel]) return;
    pushUndo({ i: sel, v: G.grid[sel], n: G.notes[sel], peers: [] });
    G.grid[sel] = 0; G.notes[sel] = 0;
    SFX.erase(); haptic('light');
    afterChange(true);
  }
  function pushUndo(a) { G.undo.push(a); if (G.undo.length > 300) G.undo.shift(); }
  function undo() {
    if (!playable() || !G.undo.length) return;
    var a = G.undo.pop();
    G.grid[a.i] = a.v; G.notes[a.i] = a.n;
    a.peers.forEach(function (p) { G.notes[p[0]] = p[1]; });
    sel = a.i; SFX.erase();
    afterChange(true);
  }
  function afterChange() { persist(); render(); }
  function checkSolved() {
    for (var i = 0; i < 81; i++) if (G.grid[i] !== G.solution[i]) {
      if (G.grid.every(function (v) { return v; })) toast("The grid is full, but something isn't right yet");
      return false;
    }
    onSolved();
    return true;
  }

  // ---------------- timer ----------------
  var lastTick = Date.now();
  setInterval(function () {
    var now = Date.now(), dt = now - lastTick; lastTick = now;
    if (!G || G.done || G.lost || paused || document.visibilityState !== 'visible' || $('game').classList.contains('hidden') || isOpen('outm')) return;
    if (dt > 0 && dt < 5000) { G.elapsed += dt; gate.addPlayTime(dt); }
    $('g-time').textContent = L.formatTime(G.elapsed);
    if (Math.floor(G.elapsed / 1000) % 10 === 0) persist();
  }, 1000);
  function pause() {
    if (!G || G.done || G.lost || paused) return;
    paused = true; document.body.classList.add('paused');
    $('pause-time').textContent = L.formatTime(G.elapsed);
    $('pause-sub').textContent = (G.daily ? 'Daily · ' : '') + diffName(G.difficulty) + ' · mistakes ' + G.mistakes;
    show('pause'); persist();
  }
  function resume() { paused = false; document.body.classList.remove('paused'); hide('pause'); lastTick = Date.now(); render(); }

  // ---------------- start / finish ----------------
  function markStarted(g) {
    if (g.counted) return;
    g.counted = true;
    save.stats[g.difficulty].started++;
  }
  /** Leaving an unfinished puzzle counts as a loss for the streak. */
  function abandonCurrent() {
    if (G && !G.done && !G.lost && G.counted && G.undo.length) {
      var st = save.stats[G.difficulty]; st.lost++; st.streak = 0;
    }
  }
  function busy(on) { $('busy').classList.toggle('hidden', !on); }
  function startPuzzle(difficulty, daily) {
    busy(true);
    setTimeout(function () {
      var info = daily ? L.dailyInfo() : null;
      var seed = info ? info.seed : ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
      var gen = L.generate(info ? info.difficulty : difficulty, seed);
      abandonCurrent();
      G = save.game = newGameState(gen, info ? info.key : null);
      if (!info) save.lastDiff = difficulty;
      markStarted(G);
      sel = -1; notesMode = false; paused = false; document.body.classList.remove('paused');
      persist();
      busy(false);
      hide('picker'); hide('complete'); hide('outm'); hide('pause'); hide('confirm');
      showGame();
      wave(Array.from({ length: 81 }, function (_, i) { return i; }).filter(function (i) { return G.puzzle[i]; }), 6);
    }, 30);
  }
  function restartPuzzle() {
    G.grid = G.puzzle.slice(); G.notes = new Array(81).fill(0); G.undo = []; G.hinted = [];
    G.mistakes = 0; G.elapsed = 0; G.hints = 0; G.extraUsed = false;
    sel = -1; persist(); resume(); render();
  }
  function onSolved() {
    G.done = true; sel = -1;
    var st = save.stats[G.difficulty];
    if (!G.awarded) {
      st.won++; st.totalMs += G.elapsed; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak);
      var isBest = !st.bestMs || G.elapsed < st.bestMs;
      if (isBest) st.bestMs = G.elapsed;
      if (!G.mistakes && !G.hints) st.perfect++;
      G.awarded = L.COINS[G.difficulty] + (G.daily ? 10 : 0);
      G.newBest = isBest && st.won > 1;
      save.coins += G.awarded;
      if (G.daily) {
        var d = save.daily;
        if (!d.done[G.daily]) {
          d.done[G.daily] = G.elapsed;
          var y = new Date(); y.setDate(y.getDate() - 1);
          d.streak = d.last === L.dateKey(y) ? d.streak + 1 : 1;
          d.last = G.daily; d.best = Math.max(d.best, d.streak);
        }
      }
      gate.puzzleCompleted();
    }
    persist(); render();
    SFX.win(); haptic('success');
    wave(Array.from({ length: 81 }, function (_, i) { return i; }), 8);
    setTimeout(showComplete, 900);
    if (native && gate.state.puzzlesCompleted >= gate.config.INTERSTITIAL_MIN_PUZZLES - 1) window.Ads.prepareInterstitial();
  }
  function showComplete() {
    var st = save.stats[G.difficulty];
    $('c-kicker').textContent = G.daily ? 'DAILY PUZZLE SOLVED' : diffName(G.difficulty).toUpperCase() + ' SOLVED';
    $('c-title').textContent = G.newBest ? 'New best time' : (!G.mistakes && !G.hints ? 'Flawless' : 'Well done');
    $('c-time').textContent = L.formatTime(G.elapsed);
    $('c-best').textContent = L.formatTime(st.bestMs);
    $('c-coins').textContent = '+' + G.awarded;
    $('c-note').textContent = 'Mistakes ' + G.mistakes + ' · hints ' + G.hints + ' · win streak ' + st.streak + (G.daily ? ' · daily streak ' + save.daily.streak : '');
    $('c-new-sub').textContent = diffName(G.daily ? save.lastDiff : G.difficulty);
    show('complete');
    setCoins();
  }
  var leaving = false;
  /** The ONLY place an interstitial may be shown: after a solved puzzle, when the player moves on. */
  async function leaveComplete(dest) {
    if (leaving) return;
    leaving = true;
    SFX.click();
    hide('complete');
    try { await window.Ads.maybeInterstitial(gate); } catch (e) {}
    leaving = false;
    if (dest === 'new') startPuzzle(G.daily ? save.lastDiff : G.difficulty, false);
    else showHome();
  }
  function outOfMistakes() {
    G.lost = true;
    var st = save.stats[G.difficulty]; st.lost++; st.streak = 0;
    persist();
    SFX.lose();
    $('btn-extra').classList.toggle('hidden', !!G.extraUsed);
    setTimeout(function () { show('outm'); }, 350);
  }
  function extraMistake() {
    if (!G || !G.lost || G.extraUsed) return;
    SFX.click();
    window.Ads.showRewarded(function () {
      // undo the loss: one more mistake allowed, the last wrong entry is cleared
      G.lost = false; G.extraUsed = true; G.mistakes = MAX_MISTAKES - 1;
      var st = save.stats[G.difficulty]; st.lost = Math.max(0, st.lost - 1);
      for (var i = 0; i < 81; i++) if (wrongAt(i)) G.grid[i] = 0;
      hide('outm'); persist(); render(); lastTick = Date.now();
      toast('One more mistake allowed. Wrong numbers cleared.');
    }, function () { toast('No ad available right now. Try again in a moment.'); });
  }
  function hint() {
    if (!playable()) return;
    SFX.click();
    window.Ads.showRewarded(function () {
      var cell = -1, digit = 0, msg = '';
      // 1) a wrong entry gets corrected first
      for (var i = 0; i < 81; i++) if (wrongAt(i)) { cell = i; break; }
      if (cell >= 0) { digit = G.solution[cell]; msg = 'That number was wrong. Corrected.'; }
      else {
        var clean = G.grid.map(function (v, k) { return v === G.solution[k] ? v : 0; });
        var np = L.nextPlacement(clean);
        if (np) { cell = np.cell; digit = np.digit; msg = np.tech + (np.tech === 'Hidden single' && np.unit != null ? ': the only place for ' + digit + ' in this ' + (np.unit < 9 ? 'row' : np.unit < 18 ? 'column' : 'box') : ': ' + digit + ' is the only candidate here'); }
        else {
          cell = sel >= 0 && !G.grid[sel] ? sel : G.grid.indexOf(0);
          digit = G.solution[cell]; msg = 'Revealed one number';
        }
      }
      if (cell < 0) return;
      var act = { i: cell, v: G.grid[cell], n: G.notes[cell], peers: [] };
      G.grid[cell] = digit; G.notes[cell] = 0;
      L.PEERS[cell].forEach(function (j) { if (G.notes[j] & L.bit(digit)) act.peers.push([j, G.notes[j]]); });
      L.autoRemoveNotes(G.notes, cell, digit);
      pushUndo(act);
      G.hints++; if (G.hinted.indexOf(cell) < 0) G.hinted.push(cell);
      sel = cell; pop(cell); SFX.hint();
      persist(); render();
      toast(msg, 2600);
      checkSolved();
    }, function () { toast('No ad available right now. Try again in a moment.'); });
  }

  // ---------------- screens ----------------
  function updateHome() {
    setCoins();
    var info = L.dailyInfo();
    $('daily-date').textContent = prettyDate(info.key);
    var doneMs = save.daily.done[info.key];
    $('daily-sub').textContent = diffName(info.difficulty) + (save.daily.streak ? ' · streak ' + save.daily.streak : '');
    var ds = $('daily-state');
    ds.textContent = doneMs ? '✓ ' + L.formatTime(doneMs) : (G && G.daily === info.key && !G.done && !G.lost ? 'Resume' : 'Play');
    ds.classList.toggle('done', !!doneMs);
    var cont = G && !G.done && !G.lost;
    $('btn-continue').classList.toggle('hidden', !cont);
    if (cont) $('continue-sub').textContent = (G.daily ? 'Daily · ' : '') + diffName(G.difficulty) + ' · ' + L.formatTime(G.elapsed);
    $('btn-new').classList.toggle('primary', !cont);
  }
  function showHome() {
    if (G && !G.done && !G.lost) pause();
    hide('pause'); paused = false; document.body.classList.remove('paused');
    $('game').classList.add('hidden'); $('home').classList.remove('hidden');
    updateHome(); persist();
    window.Ads.hideBanner();
  }
  function showGame() {
    $('home').classList.add('hidden'); $('game').classList.remove('hidden');
    layout(); render(); lastTick = Date.now();
    if (G.lost) { $('btn-extra').classList.toggle('hidden', !!G.extraUsed); show('outm'); }
    window.Ads.showBanner().then(function () { setTimeout(function () { layout(); render(); }, 60); });
  }
  function openPicker() {
    var list = $('picker-list'); list.innerHTML = '';
    var desc = { easy: 'Hidden singles', medium: '+ naked singles', hard: '+ pairs & pointing', expert: '+ triples, X-Wing, XY-Wing', master: '+ forcing chains' };
    L.DIFFS.forEach(function (d, k) {
      var b = document.createElement('button');
      b.dataset.diff = d;
      b.innerHTML = '<span>' + diffName(d) + '<small>' + desc[d] + '</small></span><span class="dots">' + '●'.repeat(k + 1) + '○'.repeat(4 - k) + '</span>';
      b.addEventListener('click', function () {
        SFX.click();
        if (G && !G.done && !G.lost && G.undo.length) askConfirm('Start a new game?', 'Your current puzzle will count as unfinished.', function () { startPuzzle(d, false); });
        else startPuzzle(d, false);
      });
      list.appendChild(b);
    });
    $('picker-note').textContent = 'Every puzzle has exactly one solution and is graded by the hardest technique it needs.';
    show('picker');
  }
  var confirmCb = null;
  function askConfirm(title, text, cb) { $('confirm-title').textContent = title; $('confirm-text').textContent = text; confirmCb = cb; show('confirm'); }
  function playDaily() {
    SFX.unlock(); SFX.click();
    var info = L.dailyInfo();
    if (save.daily.done[info.key]) { toast("You've solved today's puzzle. Come back tomorrow!"); return; }
    if (G && G.daily === info.key && !G.done && !G.lost) { showGame(); return; }
    if (G && !G.done && !G.lost && G.undo.length) askConfirm("Play today's puzzle?", 'Your current puzzle will count as unfinished.', function () { startPuzzle(null, true); });
    else startPuzzle(null, true);
  }

  // ---------------- stats ----------------
  var statsTab = 'medium';
  function renderStats() {
    var tabs = $('stats-tabs'); tabs.innerHTML = '';
    L.DIFFS.forEach(function (d) {
      var b = document.createElement('button'); b.textContent = diffName(d); b.dataset.diff = d;
      if (d === statsTab) b.className = 'on';
      b.addEventListener('click', function () { statsTab = d; SFX.click(); renderStats(); });
      tabs.appendChild(b);
    });
    var s = save.stats[statsTab];
    var rows = [
      ['Games started', s.started], ['Games won', s.won],
      ['Win rate', s.started ? Math.round(s.won / s.started * 100) + '%' : '–'], ['Flawless wins', s.perfect],
      ['Best time', s.bestMs ? L.formatTime(s.bestMs) : '–'], ['Average time', s.won ? L.formatTime(s.totalMs / s.won) : '–'],
      ['Current streak', s.streak], ['Best streak', s.bestStreak]
    ];
    $('stats-body').innerHTML = rows.map(function (r) { return '<div><b>' + r[1] + '</b><span>' + r[0] + '</span></div>'; }).join('');
    $('daily-stats').textContent = 'Daily puzzles solved: ' + Object.keys(save.daily.done).length + ' · daily streak ' + save.daily.streak + ' (best ' + save.daily.best + ')';
  }

  // ---------------- shop ----------------
  function renderShop() {
    setCoins();
    var grid = $('shop-grid'); grid.innerHTML = '';
    THEMES.forEach(function (th) {
      var owned = save.owned.indexOf(th.id) >= 0 || th.price === 0, selTh = save.theme === th.id;
      var d = document.createElement('div'); d.className = 'item' + (selTh ? ' selected' : '');
      var prev = document.createElement('div'); prev.className = 'prev'; prev.style.background = th.swatch[0];
      var mini = document.createElement('div'); mini.className = 'mini'; mini.style.borderColor = th.swatch[1]; mini.style.color = th.swatch[1];
      [5, '', 3, '', 7, '', 1, '', 9].forEach(function (v, k) { var c = document.createElement('i'); c.textContent = v; if (k === 4) { c.style.color = th.swatch[2]; } mini.appendChild(c); });
      prev.appendChild(mini); d.appendChild(prev);
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = th.name + (th.dark ? ' (dark)' : ''); d.appendChild(nm);
      var b = document.createElement('button'); b.className = 'buy';
      if (selTh) b.textContent = 'In use';
      else if (owned) { b.textContent = 'Use'; b.classList.add('can'); }
      else { b.innerHTML = '<span class="coin-ico"></span>' + th.price; if (save.coins >= th.price) b.classList.add('can'); }
      b.addEventListener('click', function () {
        if (selTh) return;
        if (!owned) {
          if (save.coins < th.price) { SFX.error(); toast('Solve more puzzles to earn ' + (th.price - save.coins) + ' more coins'); return; }
          save.coins -= th.price; save.owned.push(th.id); SFX.coin();
        } else SFX.click();
        save.theme = th.id; persist(); applyTheme(); renderShop();
      });
      d.appendChild(b); grid.appendChild(d);
    });
  }
  var SETTINGS = ['limit', 'check', 'autonotes', 'same', 'area', 'timer', 'sound', 'haptics'];
  function syncSettingsUI() {
    SETTINGS.forEach(function (k) { $('set-' + k).checked = !!save.settings[k]; });
    $('set-check').disabled = limitOn();
    if (limitOn()) $('set-check').checked = true;
    $('btn-privacy-options').classList.toggle('hidden', !(native && window.Ads.privacyOptionsRequired()));
  }

  // ---------------- wiring ----------------
  $('btn-new').addEventListener('click', function () { SFX.unlock(); SFX.click(); openPicker(); });
  $('btn-continue').addEventListener('click', function () { SFX.unlock(); SFX.click(); showGame(); });
  $('daily-card').addEventListener('click', playDaily);
  $('btn-home').addEventListener('click', function () { SFX.click(); showHome(); });
  $('btn-pause').addEventListener('click', function () { SFX.click(); pause(); });
  $('btn-resume').addEventListener('click', function () { SFX.click(); resume(); });
  $('btn-restart').addEventListener('click', function () { SFX.click(); askConfirm('Restart this puzzle?', 'All entries, notes, mistakes and the timer reset.', function () { hide('confirm'); restartPuzzle(); }); });
  $('t-undo').addEventListener('click', undo);
  $('t-erase').addEventListener('click', erase);
  $('t-notes').addEventListener('click', function () { if (!playable()) return; notesMode = !notesMode; SFX.click(); render(); });
  $('t-hint').addEventListener('click', hint);
  $('btn-c-new').addEventListener('click', function () { leaveComplete('new'); });
  $('btn-c-home').addEventListener('click', function () { leaveComplete('home'); });
  $('btn-extra').addEventListener('click', extraMistake);
  $('btn-o-new').addEventListener('click', function () { SFX.click(); hide('outm'); openPicker(); });
  $('btn-o-home').addEventListener('click', function () { SFX.click(); hide('outm'); showHome(); });
  $('confirm-no').addEventListener('click', function () { SFX.click(); hide('confirm'); confirmCb = null; });
  $('confirm-yes').addEventListener('click', function () { var cb = confirmCb; confirmCb = null; hide('confirm'); if (cb) cb(); });
  $('btn-stats').addEventListener('click', function () { SFX.unlock(); SFX.click(); statsTab = save.lastDiff || 'medium'; renderStats(); show('stats'); });
  $('btn-shop').addEventListener('click', function () { SFX.unlock(); SFX.click(); renderShop(); show('shop'); });
  $('btn-settings-home').addEventListener('click', function () { SFX.unlock(); SFX.click(); syncSettingsUI(); show('settings'); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.addEventListener('click', function () { SFX.click(); hide(b.dataset.close); });
  });
  SETTINGS.forEach(function (k) {
    $('set-' + k).addEventListener('change', function (e) {
      save.settings[k] = e.target.checked;
      if (k === 'sound') SFX.setEnabled(save.settings.sound);
      persist(); syncSettingsUI(); render(); SFX.click();
    });
  });
  $('btn-privacy-options').addEventListener('click', function () { window.Ads.showPrivacyOptions(); });
  $('btn-reset').addEventListener('click', function () {
    if (!confirm('Reset statistics, coins, themes, daily streak and the current puzzle?')) return;
    var ad = save.ad; save = defaults(); save.ad = ad; G = null;
    persist(); applyTheme(); hide('settings'); updateHome();
  });
  window.addEventListener('resize', function () { if (!$('game').classList.contains('hidden')) { layout(); } });
  document.addEventListener('keydown', function (e) {
    if ($('game').classList.contains('hidden')) return;
    if (e.key >= '1' && e.key <= '9') { input(+e.key); e.preventDefault(); }
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
    else if (e.key === 'n' || e.key === 'N') { notesMode = !notesMode; render(); }
    else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) undo();
    else if (e.key.indexOf('Arrow') === 0 && playable()) {
      if (sel < 0) sel = 40;
      var r = L.ROW[sel], c = L.COL[sel];
      if (e.key === 'ArrowUp') r = (r + 8) % 9; if (e.key === 'ArrowDown') r = (r + 1) % 9;
      if (e.key === 'ArrowLeft') c = (c + 8) % 9; if (e.key === 'ArrowRight') c = (c + 1) % 9;
      sel = r * 9 + c; render(); e.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (!$('game').classList.contains('hidden')) pause(); persist(); }
  });

  // ---------------- boot ----------------
  SFX.setEnabled(save.settings.sound);
  if (validGame(save.game)) G = save.game; else { G = null; save.game = null; }
  applyTheme(); buildBoard(); updateHome();
  // consent + SDK init only: no ad is shown on launch
  if (window.Ads) window.Ads.init().then(syncSettingsUI);

  window.__qn = {
    get game() { return G; }, get save() { return save; }, logic: L, gate: gate,
    get sel() { return sel; }, get paused() { return paused; }, layout: layout
  };
})();
