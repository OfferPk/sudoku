/* Cosmetic themes (CSS class theme-<id>). Paper and Midnight (dark mode) are free; the others unlock with earned coins. */
window.THEMES = [
  { id: 'paper', name: 'Paper', price: 0, dark: false, swatch: ['#f7f4ee', '#2b2a27', '#3d6fb6'] },
  { id: 'midnight', name: 'Midnight', price: 0, dark: true, swatch: ['#15171c', '#e6e8ee', '#7aa7ff'] },
  { id: 'sage', name: 'Sage', price: 150, dark: false, swatch: ['#eef2ec', '#23302a', '#4f8a6b'] },
  { id: 'dusk', name: 'Dusk', price: 300, dark: true, swatch: ['#1e1824', '#ece4f2', '#e0a86a'] },
  { id: 'blossom', name: 'Blossom', price: 200, dark: false, swatch: ['#fbf0f2', '#3a2329', '#c4577a'] },
  { id: 'harbor', name: 'Harbor Night', price: 400, dark: true, swatch: ['#0f1c2b', '#e3edf7', '#5fc2c9'] },
  { id: 'sepia', name: 'Old Manuscript', price: 500, dark: false, swatch: ['#f1e6cf', '#3b2f1e', '#9a5b26'] },
  { id: 'chalk', name: 'Chalkboard', price: 650, dark: true, swatch: ['#1f2d27', '#eef3ea', '#f2d36b'] },
  { id: 'lavender', name: 'Lavender Field', price: 250, dark: false, swatch: ['#f3f0fa', '#2c2640', '#7a5cc2'] },
  { id: 'forest', name: 'Night Forest', price: 450, dark: true, swatch: ['#121c17', '#e4efe6', '#8fd19e'] },
  { id: 'terracotta', name: 'Terracotta', price: 350, dark: false, swatch: ['#f6ebe2', '#3a2418', '#c0623a'] },
  { id: 'inkgold', name: 'Ink & Gold', price: 700, dark: true, swatch: ['#14141a', '#f0ead8', '#d8b45a'] }
];

if (typeof module !== 'undefined') module.exports = window.THEMES;
