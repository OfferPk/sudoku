// Captures raw 1080x1920 screenshots from the real game (360x640 CSS px @3x) for the store kit.
// Usage: PUPPETEER=puppeteer-core node store/capture_screens.js <url> <outdir>
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const L = require('../www/js/logic.js');
const URL = (process.argv[2] || 'http://localhost:8780/').replace(/\/?$/, '/');
const OUT = process.argv[3] || 'store/raw';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'quillnine.save.v1';
const ALL = ['paper', 'midnight', 'sage', 'dusk'];

function stats() {
  const s = {};
  const rows = { easy: [42, 41, 244000], medium: [37, 34, 402000], hard: [26, 22, 611000], expert: [15, 11, 1022000], master: [6, 3, 1580000] };
  for (const d of L.DIFFS) { const [st, won, best] = rows[d]; s[d] = { started: st, won, lost: st - won, bestMs: best, totalMs: won * best * 1.45, perfect: Math.floor(won * 0.4), streak: Math.min(won, 7), bestStreak: Math.min(won, 16) }; }
  return s;
}
function daily() { const done = {}; const t = new Date(); for (let k = 1; k <= 12; k++) { const d = new Date(t); d.setDate(t.getDate() - k); done[L.dateKey(d)] = 500000; } return { done, streak: 12, best: 19, last: L.dateKey(new Date(Date.now() - 864e5)) }; }
function settings(x) { return Object.assign({ sound: false, haptics: false, limit: true, check: true, autonotes: true, same: true, area: true, timer: true }, x || {}); }
// a game in progress: fill `fill` of the empty cells with the solution and pencil the legal candidates into `noted` others
function inProgress(diff, seed, fill, noted, elapsed) {
  const g = L.generate(diff, seed);
  const s = { difficulty: diff, daily: null, seed, puzzle: g.puzzle.slice(), solution: g.solution.slice(), grid: g.puzzle.slice(), notes: new Array(81).fill(0),
    hinted: [], mistakes: 1, hints: 0, extraUsed: false, elapsed, done: false, lost: false, undo: [], counted: true, awarded: 0, started: Date.now() };
  const rng = L.makeRng(seed * 7 + 1);
  const empties = []; for (let i = 0; i < 81; i++) if (!s.grid[i]) empties.push(i);
  empties.sort(() => rng.next() - 0.5);
  empties.slice(0, fill).forEach(i => { s.grid[i] = s.solution[i]; });
  empties.slice(fill, fill + noted).forEach(i => { s.notes[i] = L.fullNotes(s.grid)[i]; });
  return s;
}
const base = (theme, game, extra) => Object.assign({ coins: 860, owned: ALL, theme, lastDiff: game ? game.difficulty : 'medium', settings: settings(), stats: stats(), daily: daily(), game, ad: {} }, extra || {});

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async n => { await sleep(350); await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
  async function load(save, play = true) {
    await page.goto(URL + 'privacy.html', { waitUntil: 'networkidle0' });
    await page.evaluate((k, s) => localStorage.setItem(k, JSON.stringify(s)), KEY, save);
    await page.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
    if (play) { await page.tap('#btn-continue'); await sleep(600); }
  }
  const tapCell = async i => { const r = await page.evaluate(i => { const b = document.querySelector('.cell[data-i="' + i + '"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, i); await page.touchscreen.tap(r.x, r.y); await sleep(200); };
  const firstWith = (g, v) => { for (let i = 0; i < 81; i++) if (g.grid[i] === v && !g.puzzle[i]) return i; return g.grid.indexOf(v); };

  // 1) paper: notes + same-number highlight
  { const g = inProgress('medium', 4242, 18, 14, 262000); await load(base('paper', g)); await tapCell(firstWith(g, 7)); await shot('1-paper-notes'); }
  // 2) midnight (dark): hard puzzle, notes mode on
  { const g = inProgress('hard', 9191, 16, 18, 431000); await load(base('midnight', g)); await page.tap('#t-notes'); await tapCell(g.grid.indexOf(0)); await shot('2-midnight'); }
  // 3) difficulty picker
  { await load(base('paper', null), false); await page.tap('#btn-new'); await sleep(500); await shot('3-picker'); }
  // 4) solved (expert)
  {
    const g = inProgress('expert', 777, 0, 0, 1104000); g.mistakes = 0;
    let last = -1; for (let i = 0; i < 81; i++) if (!g.puzzle[i]) { g.grid[i] = g.solution[i]; last = i; }
    g.grid[last] = 0;
    await load(base('sage', g)); await tapCell(last);
    await page.evaluate(d => document.querySelector('#pad button[data-d="' + d + '"]').click(), g.solution[last]);
    await sleep(1600); await shot('4-solved');
  }
  // 5) statistics
  { await load(base('paper', null), false); await page.tap('#btn-stats'); await sleep(400); await page.evaluate(() => { const t = document.querySelector('#stats-tabs [data-diff="hard"]'); if (t) t.click(); }); await shot('5-stats'); }
  // 6) themes
  { await load(base('dusk', null, { coins: 420, owned: ['paper', 'midnight', 'dusk'] }), false); await page.tap('#btn-shop'); await sleep(500); await shot('6-themes'); }
  // 7) home with the daily puzzle (dusk, a game to continue)
  { const g = inProgress('expert', 5150, 12, 0, 318000); await load(base('dusk', g), false); await shot('7-home'); }
  console.log('errors:', errors);
  await browser.close();
})();
