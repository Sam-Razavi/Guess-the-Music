// Deterministic "cool" avatar per category name for the category-voting
// feature — same category string always gets the same avatar (no host
// config needed), shared across host/tv/player as a plain global, same
// cross-page pattern as i18n.js (no bundler, just a <script> tag each page
// loads before its own page script).
const CATEGORY_AVATARS = [
  '🎸', '🎹', '🎷', '🥁', '🎺', '🎻', '🪘', '🎤',
  '🕺', '💃', '🪩', '🎧', '📀', '🌟', '🔥', '✨',
  '🎊', '🦄', '👑', '😎', '🚀', '🍕', '🌈', '🐸',
];

function categoryAvatar(name) {
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_AVATARS[hash % CATEGORY_AVATARS.length];
}
