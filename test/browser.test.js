// Headless Chrome phone-size play test for Quillnine (run against the live site for release checks).
// Taps cells and the number pad like a player: placement, mistakes + limit, extra-mistake continue, undo, erase,
// notes + auto-remove, highlighting, pause, hint, reload persistence, solving (stats, coins, ad gate), daily puzzle,
// dark theme, and fails on any console error or failed request.
// Usage: PUPPETEER=puppeteer-core node test/browser.test.js <url> [outdir]   (Chrome at /usr/bin/google-chrome or CHROME=...)
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const L = require('../www/js/logic.js');
const URL = (process.argv[2] || 'http://localhost:8780/').replace(/\/?$/, '/');
const OUT = process.argv[3] || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Mobile Safari/537.36' });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });

  const game = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__qn.game)));
  const visible = sel => page.$eval(sel, e => !e.classList.contains('hidden'));
  const cls = i => page.$eval(`.cell[data-i="${i}"]`, e => e.className);
  const tapCell = i => page.tap(`.cell[data-i="${i}"]`);
  const tapPad = d => page.tap(`#pad button[data-d="${d}"]`);
  async function put(i, d) { await tapCell(i); await tapPad(d); }

  console.log('Testing', URL);
  await page.goto(URL + 'privacy.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle0' }); await sleep(300);
  const today = L.dailyInfo();
  assert(await visible('#home') && !(await visible('#btn-continue')), 'home on launch, nothing to continue');
  assert((await page.$eval('#daily-sub', e => e.textContent)).startsWith(L.DIFF_NAMES[today.difficulty]), 'daily card shows today\'s difficulty (' + today.difficulty + ')');
  await page.screenshot({ path: `${OUT}/qn-home.png` });

  // ---- new Easy game ----
  await page.tap('#btn-new'); await sleep(350);
  assert(await visible('#picker') && (await page.$$('#picker-list button')).length === 5, 'difficulty picker with 5 levels');
  await page.tap('#picker-list button[data-diff="easy"]'); await sleep(1200);
  let g = await game();
  assert(await visible('#game') && g.difficulty === 'easy' && L.countSolutions(g.puzzle, 2) === 1, 'Easy puzzle started, unique solution');
  const givenShown = await page.$$eval('.cell.given', els => els.length);
  assert(givenShown === L.givensCount(g.puzzle), 'givens rendered (' + givenShown + ')');
  const empt = g.puzzle.map((v, i) => v ? -1 : i).filter(i => i >= 0);

  // ---- place correct, highlight ----
  const a = empt[0];
  await put(a, g.solution[a]);
  g = await game();
  assert(g.grid[a] === g.solution[a] && (await cls(a)).includes('user'), 'correct number placed');
  const same = g.grid.map((v, i) => v === g.solution[a] && i !== a ? i : -1).filter(i => i >= 0)[0];
  assert((await cls(same)).includes('same'), 'same numbers highlighted');
  const rowMate = L.UNITS[L.ROW[a]].find(i => i !== a && g.grid[i] !== g.solution[a]);
  assert((await cls(rowMate)).includes('area'), 'row / column / box highlighted');

  // ---- wrong entry, mistake counter, undo ----
  const b = empt[1], wrongD = g.solution[b] % 9 + 1;
  await put(b, wrongD); await sleep(100);
  g = await game();
  assert(g.mistakes === 1 && (await cls(b)).includes('wrong') && (await page.$eval('#g-mist', e => e.textContent)) === '1/3', 'wrong number: red and mistakes 1/3');
  await page.tap('#t-undo'); await sleep(100);
  g = await game();
  assert(g.grid[b] === 0 && g.mistakes === 1, 'undo removed the entry (mistake stays counted)');

  // ---- notes + auto-remove + erase ----
  const peersB = L.PEERS[b].filter(j => !g.puzzle[j] && !g.grid[j]);
  const noteCell = peersB[0];
  await page.tap('#t-notes');
  await tapCell(noteCell); await tapPad(g.solution[b]); await tapPad(wrongD === g.solution[b] ? 1 : wrongD);
  g = await game();
  assert(g.notes[noteCell] === (L.bit(g.solution[b]) | L.bit(wrongD === g.solution[b] ? 1 : wrongD)), 'two pencil notes added');
  assert((await page.$eval(`.cell[data-i="${noteCell}"] .notes`, e => e.textContent.replace(/\s/g, ''))).length === 2, 'notes drawn in the cell');
  await page.tap('#t-notes');
  await put(b, g.solution[b]);
  g = await game();
  assert(!(g.notes[noteCell] & L.bit(g.solution[b])) && g.notes[noteCell] !== 0, 'placing a number auto-removed that note from peers');
  await tapCell(noteCell); await page.tap('#t-erase');
  g = await game();
  assert(g.notes[noteCell] === 0, 'erase cleared the notes');

  // ---- timer + pause ----
  await sleep(2200);
  g = await game();
  assert(g.elapsed >= 1000, 'timer running (' + g.elapsed + ' ms)');
  await page.tap('#btn-pause'); await sleep(200);
  const t1 = (await game()).elapsed; await sleep(2100); const t2 = (await game()).elapsed;
  assert(await visible('#pause') && t1 === t2 && await page.evaluate(() => document.body.classList.contains('paused')), 'pause hides the board and stops the timer');
  await page.tap('#btn-resume'); await sleep(200);

  // ---- reload persistence ----
  {
    const before = await game();
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
    assert(await visible('#btn-continue'), 'home offers Continue after reload');
    await page.tap('#btn-continue'); await sleep(400);
    const after = await game();
    assert(JSON.stringify(after.grid) === JSON.stringify(before.grid) && JSON.stringify(after.notes) === JSON.stringify(before.notes) && after.mistakes === before.mistakes && after.elapsed >= before.elapsed - 1000,
      'grid, notes, mistakes and time restored');
  }

  // ---- hint (rewarded; granted immediately on web) ----
  {
    const before = await game();
    const filledBefore = before.grid.filter(v => v).length;
    await page.tap('#t-hint'); await sleep(300);
    const after = await game();
    const c = after.grid.findIndex((v, i) => v && !before.grid[i]);
    assert(after.hints === 1 && after.grid.filter(v => v).length === filledBefore + 1 && after.grid[c] === after.solution[c] && (await cls(c)).includes('hinted'), 'hint filled a correct number logically');
  }

  // ---- mistake limit -> extra mistake / continue ----
  {
    g = await game();
    const e2 = g.grid.map((v, i) => v ? -1 : i).filter(i => i >= 0);
    await put(e2[0], g.solution[e2[0]] % 9 + 1); await put(e2[1], g.solution[e2[1]] % 9 + 1); await sleep(600);
    g = await game();
    assert(g.mistakes === 3 && g.lost && await visible('#outm'), '3 mistakes: game over offered');
    await page.screenshot({ path: `${OUT}/qn-outm.png` });
    await page.tap('#btn-extra'); await sleep(300);
    g = await game();
    assert(!g.lost && g.mistakes === 2 && g.extraUsed && !(await visible('#outm')) && !g.grid.some((v, i) => v && v !== g.solution[i]), 'extra mistake: continue with 2/3, wrong numbers cleared');
  }

  // ---- solve it ----
  {
    g = await game();
    const rest = g.grid.map((v, i) => v ? -1 : i).filter(i => i >= 0);
    for (const i of rest) await put(i, g.solution[i]);
    await sleep(1300);
    g = await game();
    assert(g.done && await visible('#complete'), 'puzzle solved: complete screen');
    await page.screenshot({ path: `${OUT}/qn-complete.png` });
    const s = await page.evaluate(() => ({ st: window.__qn.save.stats.easy, coins: window.__qn.save.coins, pc: window.__qn.gate.state.puzzlesCompleted }));
    assert(s.st.won === 1 && s.st.started === 1 && s.st.bestMs > 0 && s.coins === L.COINS.easy && s.pc === 1, 'stats (won 1, best time), +' + L.COINS.easy + ' coins, ad gate counted 1 solved puzzle');
    assert(await page.evaluate(() => window.__qn.gate.canShow(Date.now())) === false, 'no interstitial before 5 solved puzzles + 3 minutes');
    await page.tap('#btn-c-home'); await sleep(500);
    assert(await visible('#home') && !(await visible('#btn-continue')), 'Home after solving; nothing to continue');
  }

  // ---- daily ----
  {
    await page.tap('#daily-card'); await sleep(1500);
    g = await game();
    const exp = L.generate(today.difficulty, today.seed);
    assert(g.daily === today.key && JSON.stringify(g.puzzle) === JSON.stringify(exp.puzzle), 'daily puzzle is the date-seeded puzzle (' + today.key + ')');
    const rest = g.grid.map((v, i) => v ? -1 : i).filter(i => i >= 0);
    for (const i of rest) await put(i, g.solution[i]);
    await sleep(1300);
    assert(await visible('#complete'), 'daily solved');
    await page.tap('#btn-c-home'); await sleep(500);
    const st = await page.$eval('#daily-state', e => e.textContent);
    assert(st.startsWith('✓') && await page.evaluate(k => !!window.__qn.save.daily.done[k] && window.__qn.save.daily.streak === 1, today.key), 'daily marked done with streak 1');
  }

  // ---- stats + dark theme ----
  await page.tap('#btn-stats'); await sleep(300);
  await page.tap('#stats-tabs button[data-diff="easy"]'); await sleep(100);
  assert((await page.$eval('#stats-body', e => e.textContent)).includes('100%'), 'stats per difficulty (Easy win rate 100%)');
  await page.tap('[data-close="stats"]'); await sleep(200);
  await page.tap('#btn-shop'); await sleep(300);
  const btns = await page.$$('#shop-grid .buy'); await btns[1].tap(); await sleep(200);
  assert(await page.evaluate(() => document.body.classList.contains('theme-midnight')), 'dark theme (Midnight) applied for free');

  await sleep(300);
  assert(errors.length === 0, 'no console errors / failed requests' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log('BROWSER TEST PASSED');
})().catch(e => { console.error('BROWSER TEST FAILED:', e.message); process.exit(1); });
