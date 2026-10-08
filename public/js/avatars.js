// Shared avatar helpers, loaded cross-page as plain globals (same pattern as
// i18n.js — no bundler, just a <script> tag each page loads before its own
// page script).

function hashString(s) {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Deterministic "cool" avatar per category name for the category-voting
// feature — same category string always gets the same avatar, no host
// config needed.
const CATEGORY_AVATARS = [
  '🎸', '🎹', '🎷', '🥁', '🎺', '🎻', '🪘', '🎤',
  '🕺', '💃', '🪩', '🎧', '📀', '🌟', '🔥', '✨',
  '🎊', '🦄', '👑', '😎', '🚀', '🍕', '🌈', '🐸',
];

function categoryAvatar(name) {
  return CATEGORY_AVATARS[hashString(String(name || '')) % CATEGORY_AVATARS.length];
}

// Per-player avatar: a gradient disc with the player's initial(s), color
// picked deterministically from their name so the same person keeps the
// same color on the TV, their own phone, and the host's scoreboard.
const PLAYER_GRADIENTS = [
  ['#ff7a50', '#ffc24b'],
  ['#8b5cf6', '#d946ef'],
  ['#3b82f6', '#22d3ee'],
  ['#10b981', '#a3e635'],
  ['#f43f5e', '#fb923c'],
  ['#6366f1', '#38bdf8'],
  ['#ec4899', '#f472b6'],
  ['#14b8a6', '#4ade80'],
  ['#f59e0b', '#facc15'],
  ['#a855f7', '#6366f1'],
];

function playerColors(name) {
  return PLAYER_GRADIENTS[hashString(String(name || '').trim().toLowerCase()) % PLAYER_GRADIENTS.length];
}

function playerInitials(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  // Array.from splits by code point, so an emoji or a Farsi letter stays
  // whole instead of being cut in half.
  const first = Array.from(words[0])[0] || '?';
  const second = words.length > 1 ? (Array.from(words[1])[0] || '') : '';
  return (first + second).toUpperCase();
}

function avatarHtml(name, extraClass) {
  const [a1, a2] = playerColors(name);
  const initials = playerInitials(name).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<span class="avatar${extraClass ? ' ' + extraClass : ''}" style="--a1:${a1};--a2:${a2}" aria-hidden="true"><span>${initials}</span></span>`;
}
