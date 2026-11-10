// Small helpers shared by the party games in this folder.

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(v, max = 40) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Persian/Arabic keyboards produce several spellings of the "same" letter
// (Arabic yeh/kaf vs Persian ones, hamza forms of alef, teh marbuta…). Folded
// to one form so "علي" and "علی" count as the same answer.
function foldPersian(s) {
  return String(s || '')
    .replace(/[ً-ٰٟ]/g, '')   // harakat / diacritics
    .replace(/ـ/g, '')                   // tatweel
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ی')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

// The key two answers are compared by: case, spaces, zero-width joiners and
// punctuation don't make an answer "different".
function answerKey(s) {
  return foldPersian(s)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s‌‍‎‏.,'"`!?؟،؛:;()\-_/\\]+/g, '');
}

// Balanced random split of ids into n teams.
function splitTeams(ids, n) {
  const teams = Array.from({ length: n }, () => []);
  shuffle(ids).forEach((id, i) => teams[i % n].push(id));
  return teams;
}

// One-shot timers keyed by name, so a game can (re)arm "the round timer"
// without leaking the previous one.
function makeTimers() {
  const handles = new Map();
  return {
    set(name, ms, fn) {
      this.clear(name);
      handles.set(name, setTimeout(() => { handles.delete(name); fn(); }, Math.max(0, ms)));
    },
    clear(name) {
      const h = handles.get(name);
      if (h) { clearTimeout(h); handles.delete(name); }
    },
    clearAll() {
      for (const h of handles.values()) clearTimeout(h);
      handles.clear();
    },
    has(name) { return handles.has(name); },
  };
}

module.exports = { shuffle, pick, clampInt, cleanText, foldPersian, answerKey, splitTeams, makeTimers };

// Ranked rows → groups of ids for ctx.finish(): equal values share a group.
function rankGroups(rows, valueOf, idOf = (r) => r.id) {
  const sorted = rows.slice().sort((a, b) => valueOf(b) - valueOf(a));
  const groups = [];
  let last = null;
  for (const r of sorted) {
    const v = valueOf(r);
    if (!groups.length || v !== last) { groups.push([]); last = v; }
    groups[groups.length - 1].push(idOf(r));
  }
  return groups;
}
module.exports.rankGroups = rankGroups;
