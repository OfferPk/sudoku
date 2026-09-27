// Unit tests for Quillnine's Sudoku engine (no DOM). Run: node test/logic.test.js
const assert = require('assert');
const L = require('../www/js/logic.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok -', name); } catch (e) { fail++; console.log('  FAIL -', name, '\n   ', e.message); } }
const P = s => s.replace(/\s/g, '').split('').map(c => (c === '.' || c === '0') ? 0 : +c);

// Well-known puzzles
const EASY = P('53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79'); // classic Wikipedia example
const EASY_SOL = P('534678912672195348198342567859761423426853791713924856961537284287419635345286179');
const XWING = P('1.....569492.561.8.561.924...964.8.1.64.1....218.356.4.4.5...169.5.614.2621.....5'); // needs X-Wing (sudokuwiki)
const HARDEST = P('8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..'); // "world's hardest" (Inkala)
const MULTI = P('.................................................................................'); // empty: many solutions

console.log('logic.test.js');
// ---- geometry & validation ----
t('27 units of 9, 20 peers per cell', () => {
  assert.strictEqual(L.UNITS.length, 27); L.UNITS.forEach(u => assert.strictEqual(u.length, 9));
  L.PEERS.forEach(p => assert.strictEqual(p.length, 20));
});
t('conflicts finds duplicates in a row, a column and a box', () => {
  const g = new Array(81).fill(0);
  g[0] = 5; g[8] = 5;            // row
  g[10] = 3; g[73] = 3;          // column 1
  g[30] = 7; g[50] = 7;          // box 4 (r3c3 and r5c5)
  assert.deepStrictEqual(L.conflicts(g), [0, 8, 10, 30, 50, 73]);
  assert.ok(!L.isValidGrid(g));
});
t('a solved grid is valid and solved; one wrong swap is not', () => {
  assert.ok(L.isValidGrid(EASY_SOL) && L.isSolved(EASY_SOL));
  const bad = EASY_SOL.slice(); [bad[0], bad[1]] = [bad[1], bad[0]];
  assert.ok(!L.isSolved(bad)); assert.ok(L.conflicts(bad).length > 0);
});
t('canPlace / candidatesFor respect row, column and box', () => {
  assert.ok(!L.canPlace(EASY, 2, 5) && !L.canPlace(EASY, 2, 6) && !L.canPlace(EASY, 2, 8) && L.canPlace(EASY, 2, 4));
  assert.deepStrictEqual(L.digitsOf(L.candidatesFor(EASY, 2)), [1, 2, 4]);
});

// ---- solver ----
t('solver finds the known solution', () => { assert.deepStrictEqual(L.solve(EASY), EASY_SOL); });
t('solver solves the "world\'s hardest" puzzle and it is unique', () => {
  const s = L.solve(HARDEST); assert.ok(L.isSolved(s)); assert.ok(L.hasUniqueSolution(HARDEST));
  HARDEST.forEach((v, i) => { if (v) assert.strictEqual(s[i], v); });
});
t('uniqueness: empty grid has several solutions, contradictory grid has none', () => {
  assert.strictEqual(L.countSolutions(MULTI, 2), 2);
  const bad = EASY.slice(); bad[2] = 5; assert.strictEqual(L.countSolutions(bad, 2), 0);
  const holes = EASY_SOL.slice(); [0, 1, 9, 10].forEach(i => { holes[i] = 0; }); // 5 3 / 6 7 rectangle -> still unique? (digits differ) 
  assert.strictEqual(L.countSolutions(holes, 2), 1);
  const ur = EASY_SOL.slice(); // deadly pattern: remove a swappable rectangle -> 2 solutions
  let found = false;
  for (let a = 0; a < 81 && !found; a++) for (let b = a + 1; b < 81 && !found; b++) {
    if (L.ROW[a] !== L.ROW[b] || L.BOX[a] === L.BOX[b]) continue;
    for (let r = 0; r < 9 && !found; r++) {
      if (r === L.ROW[a]) continue;
      const c = r * 9 + L.COL[a], d = r * 9 + L.COL[b];
      if (L.BOX[c] !== L.BOX[a] && L.BOX[c] !== L.BOX[b]) continue;
      if (ur[a] === ur[d] && ur[b] === ur[c]) { const g = ur.slice(); [a, b, c, d].forEach(i => { g[i] = 0; }); assert.strictEqual(L.countSolutions(g, 2), 2); found = true; }
    }
  }
  assert.ok(found, 'found a unique-rectangle deadly pattern');
});
t('random full grids are valid and seeded (same seed -> same grid)', () => {
  const a = L.randomSolution(L.makeRng(5)), b = L.randomSolution(L.makeRng(5)), c = L.randomSolution(L.makeRng(6));
  assert.ok(L.isSolved(a)); assert.deepStrictEqual(a, b); assert.notDeepStrictEqual(a, c);
});

// ---- grader ----
t('grader: the classic example needs only singles (tier 1-2)', () => { const g = L.grade(EASY); assert.ok(g.tier >= 1 && g.tier <= 2); assert.deepStrictEqual(g.grid, EASY_SOL); });
t('grader: the X-Wing puzzle is rated Expert (tier 4) and uses X-Wing', () => {
  const g = L.grade(XWING); assert.strictEqual(g.tier, 4, JSON.stringify(g.techniques)); assert.ok(g.techniques['X-Wing'] >= 1);
});
t('grader: the "world\'s hardest" puzzle is beyond tier 4', () => {
  const g4 = L.grade(HARDEST, 4); assert.strictEqual(g4.tier, 0);
});
t('grader techniques never eliminate the true solution (300 random minimal puzzles solve to their solution)', () => {
  const rng = L.makeRng(777);
  for (let k = 0; k < 300; k++) {
    const sol = L.randomSolution(rng), p = L.dig(sol, rng, 17, k % 2 === 0), g = L.grade(p, 5);
    if (g.tier) assert.deepStrictEqual(g.grid, sol, 'puzzle ' + k + ' ' + JSON.stringify(g.techniques));
    assert.ok(!g.broken, 'grader broke puzzle ' + k);
  }
});
t('nextPlacement returns a correct logical move (hints)', () => {
  const np = L.nextPlacement(EASY); assert.ok(np); assert.strictEqual(EASY_SOL[np.cell], np.digit); assert.strictEqual(EASY[np.cell], 0);
  const np2 = L.nextPlacement(XWING); assert.ok(np2 && L.solve(XWING)[np2.cell] === np2.digit);
});

// ---- generator: uniqueness + exact difficulty for 200 puzzles per difficulty ----
const PER = +(process.env.PUZZLES_PER_DIFFICULTY || 200);
const RANGE = { easy: [36, 45], medium: [26, 36], hard: [20, 34], expert: [19, 34], master: [18, 34] };
for (const d of L.DIFFS) {
  t(`generator: ${PER} ${d} puzzles, each with exactly one solution and graded exactly ${d}`, () => {
    const t0 = Date.now(), seen = new Set(); let giv = 0;
    for (let s = 1; s <= PER; s++) {
      const seed = L.hashString(d + ':' + s);
      const r = L.generate(d, seed);
      assert.strictEqual(L.countSolutions(r.puzzle, 2), 1, `${d} seed ${seed} not unique`);
      assert.ok(L.isSolved(r.solution));
      r.puzzle.forEach((v, i) => { if (v) assert.strictEqual(v, r.solution[i]); });
      assert.deepStrictEqual(L.solve(r.puzzle), r.solution);
      const g = L.grade(r.puzzle, 5);
      assert.strictEqual(g.tier, L.TARGET[d], `${d} seed ${seed} graded ${g.tier}`);
      assert.ok(r.givens >= RANGE[d][0] && r.givens <= RANGE[d][1], `${d} givens ${r.givens}`);
      giv += r.givens;
      seen.add(r.puzzle.join(''));
    }
    assert.strictEqual(seen.size, PER, 'all puzzles different');
    console.log(`    (${d}: ${Date.now() - t0} ms, avg ${(giv / PER).toFixed(1)} givens)`);
  });
}
t('generator is deterministic for (difficulty, seed)', () => {
  assert.deepStrictEqual(L.generate('hard', 42).puzzle, L.generate('hard', 42).puzzle);
  assert.notDeepStrictEqual(L.generate('hard', 42).puzzle, L.generate('hard', 43).puzzle);
});

// ---- daily ----
t('daily: same date -> same seed, difficulty and puzzle; different dates differ', () => {
  const a = L.dailyInfo(new Date(2026, 8, 27, 8)), b = L.dailyInfo(new Date(2026, 8, 27, 23, 59)), c = L.dailyInfo(new Date(2026, 8, 28, 0, 1));
  assert.strictEqual(a.key, '2026-09-27'); assert.strictEqual(a.seed, b.seed); assert.notStrictEqual(a.seed, c.seed);
  assert.deepStrictEqual(L.generate(a.difficulty, a.seed).puzzle, L.generate(b.difficulty, b.seed).puzzle);
  const seeds = new Set(); for (let k = 0; k < 365; k++) seeds.add(L.dailyInfo(new Date(2026, 0, 1 + k)).seed);
  assert.strictEqual(seeds.size, 365, 'a year of distinct daily seeds');
});
t('daily: difficulty rotates by weekday (Mon easy ... Sat/Sun expert)', () => {
  assert.strictEqual(L.dailyInfo(new Date(2026, 8, 28)).difficulty, 'easy');   // Monday
  assert.strictEqual(L.dailyInfo(new Date(2026, 9, 3)).difficulty, 'expert');  // Saturday
  assert.strictEqual(L.dailyInfo(new Date(2026, 8, 27)).difficulty, 'expert'); // Sunday
});
t('dateKey pads month and day', () => assert.strictEqual(L.dateKey(new Date(2026, 0, 5)), '2026-01-05'));

// ---- notes ----
t('toggleNote adds and removes a pencil mark', () => {
  let m = 0; m = L.toggleNote(m, 3); m = L.toggleNote(m, 7); assert.deepStrictEqual(L.digitsOf(m), [3, 7]);
  m = L.toggleNote(m, 3); assert.deepStrictEqual(L.digitsOf(m), [7]);
});
t('autoRemoveNotes clears the digit from row, column and box peers only', () => {
  const notes = new Array(81).fill(L.bit(4) | L.bit(9));
  const changed = L.autoRemoveNotes(notes, 40, 4); // centre cell
  assert.strictEqual(changed.length, 20);
  L.PEERS[40].forEach(j => assert.strictEqual(notes[j], L.bit(9)));
  assert.strictEqual(notes[0], L.bit(4) | L.bit(9), 'non-peer untouched');
});
t('fullNotes gives exactly the legal candidates', () => {
  const n = L.fullNotes(EASY);
  assert.deepStrictEqual(L.digitsOf(n[2]), [1, 2, 4]); assert.strictEqual(n[0], 0);
  n.forEach((m, i) => { if (!EASY[i]) assert.ok(m & L.bit(EASY_SOL[i]), 'solution digit is a candidate'); });
});
t('formatTime', () => { assert.strictEqual(L.formatTime(65000), '1:05'); assert.strictEqual(L.formatTime(3725000), '1:02:05'); });
t('coins are cosmetic rewards that grow with difficulty', () => { assert.ok(L.COINS.easy < L.COINS.medium && L.COINS.expert < L.COINS.master); });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
