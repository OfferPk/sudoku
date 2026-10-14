/* Weekly challenge goal pool (stats are Achievements.bump keys). 3 are picked per week, same for everyone. */
(function (root) { var POOL = [
  { stat: 'wins', text: 'Solve {n} puzzles', targets: [3, 5, 8] },
  { stat: 'hard_solves', text: 'Solve {n} Hard or tougher puzzles', targets: [1, 2, 3] },
  { stat: 'perfect', text: 'Solve {n} puzzles with no mistakes or hints', targets: [1, 2, 3] },
  { stat: 'challenges', text: "Finish {n} of Today's Puzzles", targets: [2, 3, 4] },
  { stat: 'daily_claims', text: 'Claim the daily reward {n} times', targets: [3, 4, 5] }
]; root.WEEKLY_GOALS = POOL; if (typeof module !== 'undefined') module.exports = POOL; })(typeof window !== 'undefined' ? window : globalThis);
