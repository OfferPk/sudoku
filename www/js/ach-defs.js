/* Game-specific achievements (cosmetic coin rewards). Shared ones live in achievements.js. */
window.ACH_DEFS = [
  { "id": "sd_first", "name": "First Ink", "desc": "Solve your first puzzle", "metric": "wins", "goal": 1, "reward": 15 },
  { "id": "sd_10", "name": "Quill Keeper", "desc": "Solve 10 puzzles", "metric": "wins", "goal": 10, "reward": 60 },
  { "id": "sd_50", "name": "Scholar", "desc": "Solve 50 puzzles", "metric": "wins", "goal": 50, "reward": 150 },
  { "id": "sd_hard5", "name": "Deep Thinker", "desc": "Solve 5 Hard, Expert or Master puzzles", "metric": "hard_solves", "goal": 5, "reward": 100 },
  { "id": "sd_master", "name": "Master Scribe", "desc": "Solve a Master puzzle", "metric": "master_solves", "goal": 1, "reward": 120 },
  { "id": "sd_perfect3", "name": "Clean Page", "desc": "Solve 3 puzzles with no mistakes and no hints", "metric": "perfect", "goal": 3, "reward": 80 },
  { "id": "sd_fast", "name": "Swift Quill", "desc": "Solve a puzzle in under 5 minutes", "metric": "best_ms", "goal": 300000, "lower": true, "reward": 70 },
  { "id": "sd_wstreak", "name": "Unbroken", "desc": "Solve 5 puzzles in a row without losing", "metric": "best_win_streak", "goal": 5, "reward": 90 }
]
;
if (typeof module !== 'undefined') module.exports = window.ACH_DEFS;
