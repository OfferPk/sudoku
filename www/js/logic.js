/*
 * Quillnine - pure Sudoku engine (no DOM). Browser: window.QNLogic, Node: module.exports.
 *
 *  - grids are arrays of 81 ints (0 = empty), row-major
 *  - countSolutions(): bitmask backtracking with MRV, stops at a limit (uniqueness check)
 *  - grade(): human-style logical solver; the difficulty is the hardest technique tier REQUIRED
 *      1 Easy    : hidden singles (incl. full house) only
 *      2 Medium  : + naked singles
 *      3 Hard    : + locked candidates (pointing, claiming), naked & hidden pairs
 *      4 Expert  : + naked / hidden triples & quads, X-Wing, Swordfish, Jellyfish, XY-Wing, XYZ-Wing
 *      5 Master  : + contradiction forcing (assume a candidate, propagate singles, eliminate on contradiction)
 *    puzzles that need guessing beyond that are never shipped
 *  - generate(difficulty, seed): seeded, unique solution, graded exactly to the requested tier
 *  - daily seed from the local date (offline, same puzzle for everyone on that date)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QNLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DIFFS = ['easy', 'medium', 'hard', 'expert', 'master'];
  var DIFF_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };
  var ALL = 0x1FF;

  // ---------- geometry ----------
  var ROW = [], COL = [], BOX = [], UNITS = [], PEERS = [], CELL_UNITS = [];
  (function () {
    var i, r, c, b;
    for (i = 0; i < 81; i++) { ROW[i] = Math.floor(i / 9); COL[i] = i % 9; BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3); }
    for (r = 0; r < 9; r++) { var u = []; for (c = 0; c < 9; c++) u.push(r * 9 + c); UNITS.push(u); }
    for (c = 0; c < 9; c++) { var v = []; for (r = 0; r < 9; r++) v.push(r * 9 + c); UNITS.push(v); }
    for (b = 0; b < 9; b++) {
      var w = [], br = Math.floor(b / 3) * 3, bc = (b % 3) * 3;
      for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) w.push((br + r) * 9 + bc + c);
      UNITS.push(w);
    }
    for (i = 0; i < 81; i++) {
      CELL_UNITS[i] = [ROW[i], 9 + COL[i], 18 + BOX[i]];
      var set = {};
      CELL_UNITS[i].forEach(function (k) { UNITS[k].forEach(function (j) { if (j !== i) set[j] = 1; }); });
      PEERS[i] = Object.keys(set).map(Number);
    }
  })();
  var POP = []; for (var m = 0; m < 512; m++) { var n = 0, x = m; while (x) { n += x & 1; x >>= 1; } POP[m] = n; }
  function bit(d) { return 1 << (d - 1); }
  function digitsOf(mask) { var out = []; for (var d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d); return out; }
  function lowDigit(mask) { for (var d = 1; d <= 9; d++) if (mask & bit(d)) return d; return 0; }

  // ---------- RNG ----------
  function makeRng(seed) {
    var s = seed >>> 0;
    return {
      get s() { return s; }, set s(v) { s = v >>> 0; },
      next: function () {
        s = (s + 0x6D2B79F5) >>> 0; var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int: function (k) { return Math.floor(this.next() * k); }
    };
  }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = rng.int(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
    return h >>> 0;
  }

  // ---------- validation ----------
  /** Cells that clash with another equal digit in a row, column or box. */
  function conflicts(grid) {
    var bad = {};
    UNITS.forEach(function (u) {
      var seen = {};
      u.forEach(function (i) { var d = grid[i]; if (!d) return; if (seen[d] != null) { bad[i] = 1; bad[seen[d]] = 1; } else seen[d] = i; });
    });
    return Object.keys(bad).map(Number).sort(function (a, b) { return a - b; });
  }
  function isValidGrid(grid) { return grid.length === 81 && grid.every(function (d) { return d >= 0 && d <= 9 && d === (d | 0); }) && conflicts(grid).length === 0; }
  function isSolved(grid) { return grid.every(function (d) { return d > 0; }) && conflicts(grid).length === 0; }
  function canPlace(grid, i, d) { for (var k = 0; k < PEERS[i].length; k++) if (grid[PEERS[i][k]] === d) return false; return true; }
  function candidatesFor(grid, i) {
    if (grid[i]) return 0;
    var used = 0; for (var k = 0; k < PEERS[i].length; k++) { var d = grid[PEERS[i][k]]; if (d) used |= bit(d); }
    return ALL & ~used;
  }

  // ---------- brute-force solver ----------
  /** Count solutions up to `limit` (default 2). Optionally store the first solution in out.solution. */
  function countSolutions(grid, limit, out) {
    limit = limit || 2;
    var g = grid.slice(), rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
    for (var i = 0; i < 81; i++) {
      var d = g[i]; if (!d) continue;
      var b = bit(d);
      if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return 0;
      rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
    }
    var count = 0;
    function rec() {
      var best = -1, bestMask = 0, bestN = 10;
      for (var i = 0; i < 81; i++) {
        if (g[i]) continue;
        var mask = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
        var n = POP[mask];
        if (n < bestN) { bestN = n; best = i; bestMask = mask; if (n <= 1) break; }
      }
      if (best < 0) { count++; if (out && !out.solution) out.solution = g.slice(); return count >= limit; }
      if (bestN === 0) return false;
      var r = ROW[best], c = COL[best], bx = BOX[best];
      for (var d = 1; d <= 9; d++) {
        var bb = bit(d); if (!(bestMask & bb)) continue;
        g[best] = d; rows[r] |= bb; cols[c] |= bb; boxes[bx] |= bb;
        var stop = rec();
        g[best] = 0; rows[r] &= ~bb; cols[c] &= ~bb; boxes[bx] &= ~bb;
        if (stop) return true;
      }
      return false;
    }
    rec();
    return count;
  }
  function solve(grid) { var out = {}; return countSolutions(grid, 1, out) ? out.solution : null; }
  function hasUniqueSolution(grid) { return countSolutions(grid, 2) === 1; }

  /** Random complete grid. */
  function randomSolution(rng) {
    var g = new Array(81).fill(0);
    // fill the three diagonal boxes randomly, then solve with a shuffled digit order
    [0, 4, 8].forEach(function (b) { var ds = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng); UNITS[18 + b].forEach(function (i, k) { g[i] = ds[k]; }); });
    var order = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
    function rec() {
      var best = -1, bestMask = 0, bestN = 10;
      for (var i = 0; i < 81; i++) { if (g[i]) continue; var mask = candidatesFor(g, i), n = POP[mask]; if (n < bestN) { bestN = n; best = i; bestMask = mask; } }
      if (best < 0) return true;
      for (var k = 0; k < 9; k++) { var d = order[k]; if (!(bestMask & bit(d))) continue; g[best] = d; if (rec()) return true; g[best] = 0; }
      return false;
    }
    rec();
    return g;
  }

  // ---------- logical solver / grader ----------
  function Board(grid) {
    this.g = grid.slice();
    this.c = new Array(81);
    for (var i = 0; i < 81; i++) this.c[i] = candidatesFor(this.g, i);
  }
  Board.prototype.clone = function () { var b = Object.create(Board.prototype); b.g = this.g.slice(); b.c = this.c.slice(); return b; };
  Board.prototype.place = function (i, d) {
    this.g[i] = d; this.c[i] = 0;
    var b = bit(d); for (var k = 0; k < PEERS[i].length; k++) this.c[PEERS[i][k]] &= ~b;
  };
  Board.prototype.solved = function () { for (var i = 0; i < 81; i++) if (!this.g[i]) return false; return true; };
  Board.prototype.broken = function () {
    for (var i = 0; i < 81; i++) if (!this.g[i] && !this.c[i]) return true;
    for (var u = 0; u < 27; u++) {
      var have = 0, can = 0;
      for (var k = 0; k < 9; k++) { var j = UNITS[u][k]; if (this.g[j]) { if (have & bit(this.g[j])) return true; have |= bit(this.g[j]); } else can |= this.c[j]; }
      if ((have | can) !== ALL) return true;
    }
    return false;
  };
  function elim(bd, i, mask) { if (bd.c[i] & mask) { bd.c[i] &= ~mask; return true; } return false; }

  // each technique returns a step object or null. Steps: {tech, tier, place:[i,d]} or {tech, tier, elims:n}
  function nakedSingle(bd) {
    for (var i = 0; i < 81; i++) if (!bd.g[i] && POP[bd.c[i]] === 1) { var d = lowDigit(bd.c[i]); bd.place(i, d); return { tech: 'Naked single', tier: 2, cell: i, digit: d }; }
    return null;
  }
  function hiddenSingle(bd) {
    // boxes first (most natural for humans), then rows, columns
    var order = [18, 19, 20, 21, 22, 23, 24, 25, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    for (var o = 0; o < 27; o++) {
      var u = UNITS[order[o]];
      for (var d = 1; d <= 9; d++) {
        var b = bit(d), pos = -1, n = 0;
        for (var k = 0; k < 9; k++) { var j = u[k]; if (bd.g[j] === d) { n = -99; break; } if (!bd.g[j] && (bd.c[j] & b)) { n++; pos = j; } }
        if (n === 1) { bd.place(pos, d); return { tech: 'Hidden single', tier: 1, cell: pos, digit: d, unit: order[o] }; }
      }
    }
    return null;
  }
  function lockedCandidates(bd) {
    for (var d = 1; d <= 9; d++) {
      var b = bit(d);
      // pointing: in a box, all candidates of d on one row/col -> eliminate from rest of that line
      for (var bx = 0; bx < 9; bx++) {
        var cells = UNITS[18 + bx].filter(function (j) { return !bd.g[j] && (bd.c[j] & b); });
        if (cells.length < 2) continue;
        var r0 = ROW[cells[0]], c0 = COL[cells[0]];
        var sameR = cells.every(function (j) { return ROW[j] === r0; }), sameC = cells.every(function (j) { return COL[j] === c0; });
        var line = sameR ? UNITS[r0] : sameC ? UNITS[9 + c0] : null;
        if (line) {
          var n = 0; line.forEach(function (j) { if (BOX[j] !== bx && !bd.g[j] && elim(bd, j, b)) n++; });
          if (n) return { tech: 'Pointing pair', tier: 3, elims: n };
        }
      }
      // claiming: in a line, all candidates in one box -> eliminate from rest of the box
      for (var u = 0; u < 18; u++) {
        var cs = UNITS[u].filter(function (j) { return !bd.g[j] && (bd.c[j] & b); });
        if (cs.length < 2) continue;
        var b0 = BOX[cs[0]];
        if (!cs.every(function (j) { return BOX[j] === b0; })) continue;
        var n2 = 0; UNITS[18 + b0].forEach(function (j) { if (UNITS[u].indexOf(j) < 0 && !bd.g[j] && elim(bd, j, b)) n2++; });
        if (n2) return { tech: 'Box/line reduction', tier: 3, elims: n2 };
      }
    }
    return null;
  }
  function combos(arr, k, start, acc, out) {
    if (acc.length === k) { out.push(acc.slice()); return out; }
    for (var i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out); acc.pop(); }
    return out;
  }
  function nakedSubset(size, tier, name) {
    return function (bd) {
      for (var u = 0; u < 27; u++) {
        var empty = UNITS[u].filter(function (j) { return !bd.g[j]; });
        if (empty.length <= size) continue;
        var pool = empty.filter(function (j) { return POP[bd.c[j]] >= 2 && POP[bd.c[j]] <= size; });
        if (pool.length < size) continue;
        var cs = combos(pool, size, 0, [], []);
        for (var q = 0; q < cs.length; q++) {
          var mask = 0; cs[q].forEach(function (j) { mask |= bd.c[j]; });
          if (POP[mask] !== size) continue;
          var n = 0; empty.forEach(function (j) { if (cs[q].indexOf(j) < 0 && elim(bd, j, mask)) n++; });
          if (n) return { tech: name, tier: tier, elims: n };
        }
      }
      return null;
    };
  }
  function hiddenSubset(size, tier, name) {
    return function (bd) {
      for (var u = 0; u < 27; u++) {
        var empty = UNITS[u].filter(function (j) { return !bd.g[j]; });
        if (empty.length <= size) continue;
        var digs = [];
        for (var d = 1; d <= 9; d++) { var cnt = 0; empty.forEach(function (j) { if (bd.c[j] & bit(d)) cnt++; }); if (cnt >= 1 && cnt <= size) digs.push(d); }
        if (digs.length < size) continue;
        var cs = combos(digs, size, 0, [], []);
        for (var q = 0; q < cs.length; q++) {
          var dm = 0; cs[q].forEach(function (d) { dm |= bit(d); });
          var cells = empty.filter(function (j) { return bd.c[j] & dm; });
          if (cells.length !== size) continue;
          var n = 0; cells.forEach(function (j) { if (elim(bd, j, ALL & ~dm)) n++; });
          if (n) return { tech: name, tier: tier, elims: n };
        }
      }
      return null;
    };
  }
  function fish(size, tier, name) {
    return function (bd) {
      for (var d = 1; d <= 9; d++) {
        var b = bit(d);
        for (var orient = 0; orient < 2; orient++) {
          // base lines = rows (orient 0) or columns (orient 1)
          var lines = [], masks = [];
          for (var l = 0; l < 9; l++) {
            var mask = 0, cnt = 0;
            for (var k = 0; k < 9; k++) { var j = orient ? k * 9 + l : l * 9 + k; if (!bd.g[j] && (bd.c[j] & b)) { mask |= 1 << k; cnt++; } }
            if (cnt >= 2 && cnt <= size) { lines.push(l); masks.push(mask); }
          }
          if (lines.length < size) continue;
          var cs = combos(lines.map(function (_, i) { return i; }), size, 0, [], []);
          for (var q = 0; q < cs.length; q++) {
            var cover = 0; cs[q].forEach(function (i) { cover |= masks[i]; });
            if (POP[cover] !== size) continue;
            var base = cs[q].map(function (i) { return lines[i]; });
            var n = 0;
            for (var k2 = 0; k2 < 9; k2++) {
              if (!(cover & (1 << k2))) continue;
              for (var l2 = 0; l2 < 9; l2++) {
                if (base.indexOf(l2) >= 0) continue;
                var j2 = orient ? k2 * 9 + l2 : l2 * 9 + k2;
                if (!bd.g[j2] && elim(bd, j2, b)) n++;
              }
            }
            if (n) return { tech: name, tier: tier, elims: n };
          }
        }
      }
      return null;
    };
  }
  function sees(a, b) { return a !== b && (ROW[a] === ROW[b] || COL[a] === COL[b] || BOX[a] === BOX[b]); }
  function xyWing(bd) {
    var bi = []; for (var i = 0; i < 81; i++) if (!bd.g[i] && POP[bd.c[i]] === 2) bi.push(i);
    for (var p = 0; p < bi.length; p++) {
      var pv = bi[p], pm = bd.c[pv];
      var wings = bi.filter(function (j) { return sees(pv, j) && POP[pm & bd.c[j]] === 1; });
      for (var a = 0; a < wings.length; a++) for (var c = a + 1; c < wings.length; c++) {
        var w1 = wings[a], w2 = wings[c];
        var m1 = bd.c[w1], m2 = bd.c[w2];
        if ((m1 & pm) === (m2 & pm)) continue;
        var z = m1 & m2 & ~pm;
        if (POP[z] !== 1 || ((m1 | m2 | pm) !== (pm | z))) continue;
        var n = 0;
        for (var j = 0; j < 81; j++) if (!bd.g[j] && j !== w1 && j !== w2 && sees(j, w1) && sees(j, w2) && elim(bd, j, z)) n++;
        if (n) return { tech: 'XY-Wing', tier: 4, elims: n };
      }
    }
    return null;
  }
  function xyzWing(bd) {
    for (var pv = 0; pv < 81; pv++) {
      if (bd.g[pv] || POP[bd.c[pv]] !== 3) continue;
      var pm = bd.c[pv];
      var wings = []; for (var j = 0; j < 81; j++) if (!bd.g[j] && POP[bd.c[j]] === 2 && (bd.c[j] & ~pm) === 0 && sees(pv, j)) wings.push(j);
      for (var a = 0; a < wings.length; a++) for (var c = a + 1; c < wings.length; c++) {
        var w1 = wings[a], w2 = wings[c];
        if (bd.c[w1] === bd.c[w2]) continue;
        var z = bd.c[w1] & bd.c[w2]; if (POP[z] !== 1) continue;
        var n = 0;
        for (var k = 0; k < 81; k++) if (!bd.g[k] && k !== pv && k !== w1 && k !== w2 && sees(k, pv) && sees(k, w1) && sees(k, w2) && elim(bd, k, z)) n++;
        if (n) return { tech: 'XYZ-Wing', tier: 4, elims: n };
      }
    }
    return null;
  }
  // propagate singles only; returns false on contradiction
  function propagate(bd, maxSteps) {
    for (var s = 0; s < (maxSteps || 200); s++) {
      if (bd.broken()) return false;
      if (bd.solved()) return true;
      if (!hiddenSingle(bd) && !nakedSingle(bd)) return true;
    }
    return !bd.broken();
  }
  function forcing(bd) {
    // try the cells with fewest candidates first
    var cells = []; for (var i = 0; i < 81; i++) if (!bd.g[i] && POP[bd.c[i]] >= 2 && POP[bd.c[i]] <= 3) cells.push(i);
    cells.sort(function (a, b) { return POP[bd.c[a]] - POP[bd.c[b]] || a - b; });
    for (var q = 0; q < cells.length; q++) {
      var cell = cells[q], ds = digitsOf(bd.c[cell]);
      for (var k = 0; k < ds.length; k++) {
        var t = bd.clone(); t.place(cell, ds[k]);
        if (!propagate(t)) { bd.c[cell] &= ~bit(ds[k]); return { tech: 'Forcing chain', tier: 5, elims: 1 }; }
      }
    }
    return null;
  }
  var TECHS = [
    hiddenSingle, nakedSingle,
    lockedCandidates, nakedSubset(2, 3, 'Naked pair'), hiddenSubset(2, 3, 'Hidden pair'),
    nakedSubset(3, 4, 'Naked triple'), hiddenSubset(3, 4, 'Hidden triple'), fish(2, 4, 'X-Wing'), nakedSubset(4, 4, 'Naked quad'), hiddenSubset(4, 4, 'Hidden quad'),
    fish(3, 4, 'Swordfish'), xyWing, xyzWing, fish(4, 4, 'Jellyfish'),
    forcing
  ];
  var TECH_TIER = [1, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5];

  /**
   * Grade a puzzle: { tier (1..5, or 0 if it can't be solved logically), steps, techniques:{name:count} }.
   * maxTier limits the techniques tried (for fast rejection while generating).
   */
  function grade(grid, maxTier) {
    maxTier = maxTier || 5;
    var bd = new Board(grid), tier = 1, steps = 0, used = {};
    while (!bd.solved()) {
      if (bd.broken()) return { tier: 0, steps: steps, techniques: used, broken: true };
      var step = null;
      for (var t = 0; t < TECHS.length && TECH_TIER[t] <= maxTier; t++) { step = TECHS[t](bd); if (step) break; }
      if (!step) return { tier: 0, steps: steps, techniques: used, stuckAt: tier };
      if (step.tier > tier) tier = step.tier;
      used[step.tech] = (used[step.tech] || 0) + 1;
      steps++;
    }
    return { tier: tier, steps: steps, techniques: used, grid: bd.g };
  }
  /** First logical placement available from `grid` (for hints): {cell, digit, tech} or null. */
  function nextPlacement(grid) {
    var bd = new Board(grid);
    for (var guard = 0; guard < 400 && !bd.solved(); guard++) {
      var step = null;
      for (var t = 0; t < TECHS.length; t++) { step = TECHS[t](bd); if (step) break; }
      if (!step) return null;
      if (step.cell != null) return { cell: step.cell, digit: step.digit, tech: step.tech, unit: step.unit };
    }
    return null;
  }

  // ---------- generator ----------
  var TARGET = { easy: 1, medium: 2, hard: 3, expert: 4, master: 5 };
  /** Remove clues in random order while the solution stays unique. For easy, stop around 38 givens. */
  function dig(solution, rng, minGivens, symmetric) {
    var p = solution.slice(), order = shuffle(Array.from({ length: 81 }, function (_, i) { return i; }), rng), givens = 81;
    for (var k = 0; k < 81 && givens > minGivens; k++) {
      var i = order[k], j = 80 - i;
      if (!p[i]) continue;
      var a = p[i], b = p[j];
      var pair = symmetric && i !== j && b;
      if (givens - (pair ? 2 : 1) < minGivens) continue;
      p[i] = 0; if (symmetric) p[j] = 0;
      if (hasUniqueSolution(p)) { givens -= pair ? 2 : 1; }
      else { p[i] = a; if (symmetric) p[j] = b; }
    }
    return p;
  }
  function givensCount(p) { var n = 0; for (var i = 0; i < 81; i++) if (p[i]) n++; return n; }
  /**
   * Generate a puzzle of the given difficulty from a seed. Deterministic for (difficulty, seed).
   * Returns { puzzle, solution, difficulty, tier, givens, seed, attempts, techniques }.
   */
  function generate(difficulty, seed, opts) {
    opts = opts || {};
    var want = TARGET[difficulty]; if (!want) throw new Error('bad difficulty ' + difficulty);
    var rng = makeRng(seed >>> 0);
    var maxAttempts = opts.maxAttempts || 4000;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      var sol = randomSolution(rng);
      // a few dig orders per solution grid: cheap way to explore harder puzzles
      for (var v = 0; v < 3; v++) {
        var minG = want === 1 ? 36 + rng.int(4) : want === 2 ? 28 + rng.int(4) : 17;
        var sym = want <= 2 ? rng.next() < 0.7 : rng.next() < 0.35;
        var p = dig(sol, rng, minG, sym);
        var g = grade(p, want);
        if (g.tier !== want) continue;   // too easy, or needs more than this tier
        return { puzzle: p, solution: sol, difficulty: difficulty, tier: g.tier, givens: givensCount(p), seed: seed >>> 0, attempts: attempt, techniques: g.techniques };
      }
    }
    throw new Error('could not generate ' + difficulty + ' puzzle for seed ' + seed);
  }

  // ---------- daily ----------
  function dateKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  var DAILY_ROTATION = ['expert', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert']; // by weekday, Sunday first
  function dailyInfo(d) {
    d = d || new Date();
    var key = dateKey(d);
    return { key: key, seed: hashString('quillnine-daily-' + key), difficulty: DAILY_ROTATION[d.getDay()] };
  }

  // ---------- player-state helpers (notes etc.) ----------
  /** Toggle note digit d in a cell's note mask. */
  function toggleNote(mask, d) { return mask ^ bit(d); }
  /** After placing digit d at i, remove d from the notes of all peers. Returns the list of changed peer cells. */
  function autoRemoveNotes(notes, i, d) {
    var changed = [], b = bit(d);
    PEERS[i].forEach(function (j) { if (notes[j] & b) { notes[j] &= ~b; changed.push(j); } });
    return changed;
  }
  /** Notes filled with every legal candidate (used by tests / optional helpers). */
  function fullNotes(grid) { var out = []; for (var i = 0; i < 81; i++) out.push(candidatesFor(grid, i)); return out; }
  function formatTime(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return (h ? h + ':' + (mm < 10 ? '0' : '') : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  }
  var COINS = { easy: 5, medium: 10, hard: 15, expert: 20, master: 30 };

  return {
    DIFFS: DIFFS, DIFF_NAMES: DIFF_NAMES, TARGET: TARGET, ROW: ROW, COL: COL, BOX: BOX, UNITS: UNITS, PEERS: PEERS,
    bit: bit, digitsOf: digitsOf, makeRng: makeRng, hashString: hashString,
    conflicts: conflicts, isValidGrid: isValidGrid, isSolved: isSolved, canPlace: canPlace, candidatesFor: candidatesFor,
    countSolutions: countSolutions, solve: solve, hasUniqueSolution: hasUniqueSolution, randomSolution: randomSolution,
    grade: grade, nextPlacement: nextPlacement, dig: dig, generate: generate, givensCount: givensCount,
    dateKey: dateKey, dailyInfo: dailyInfo, DAILY_ROTATION: DAILY_ROTATION,
    toggleNote: toggleNote, autoRemoveNotes: autoRemoveNotes, fullNotes: fullNotes, formatTime: formatTime, COINS: COINS
  };
});
