const translations = {
  en: {
    brand: 'Guess the Music',
    waitingRound: 'Waiting for the next round…',
    scanToBuzz: 'Scan to grab a buzzer:',
    idleHints: [
      'Tip: pick songs that don’t show the title on screen.',
      'First to buzz gets first crack at the answer.',
      'Hosts can adjust scores by hand if a call was close.',
      'Scores are saved — a restart won’t wipe the board.',
    ],
    nowPlaying: 'Now playing…',
    buzzInPhone: 'Buzz in on your phone!',
    buzzInPhoneTimer: 'Buzz in on your phone! ({s}s)',
    timesUp: "⏰ Time's up!",
    buzzedInFirst: 'buzzed in first!',
    theSongWas: 'The song was',
    unknown: 'Unknown',

    whatShouldTvCallYou: 'What should the TV call you?',
    yourNamePlaceholder: 'Your name',
    joinGame: 'Join the game',
    pts: 'pts',
    getReady: 'Get ready…',
    waitingHostStart: 'Waiting for the host to start a round…',
    alreadyBuzzed: 'Already buzzed',
    someoneElsesTurn: "It's someone else's turn now.",
    waitingHost: 'Waiting for the host…',
    buzzBtnLabel: 'BUZZ',
    buzzInAsap: 'Buzz in as soon as you know it!',
    lockedIn: '🔒 Locked in!',
    sayAnswerHostChecking: 'Say your answer out loud — the host is checking.',
    buzzedFirst: '{name} buzzed first',
    someone: 'Someone',
    betterLuck: 'Better luck next round!',
    roundOver: 'Round over',

    finalScores: '🏆 Final Scores',
    noOnePlayed: 'No one played 🎵',
    gameOver: '🏆 Game over!',
    yourFinalScore: 'Your final score: {n}',
    nextSongIn: '⏭ Next song in {s}s…',
  },
  fa: {
    brand: 'حدس آهنگ',
    waitingRound: 'در انتظار دور بعدی…',
    scanToBuzz: 'برای گرفتن دکمه اسکن کن:',
    idleHints: [
      'نکته: آهنگ‌هایی را انتخاب کن که اسمشان روی صفحه نیفتد.',
      'هر کس زودتر دکمه بزند، اول جواب می‌دهد.',
      'میزبان می‌تواند امتیازها را دستی تغییر بدهد.',
      'امتیازها ذخیره می‌شوند — ری‌استارت چیزی را پاک نمی‌کند.',
    ],
    nowPlaying: 'در حال پخش…',
    buzzInPhone: 'با گوشی‌ات دکمه بزن!',
    buzzInPhoneTimer: 'با گوشی‌ات دکمه بزن! ({s} ثانیه)',
    timesUp: '⏰ وقت تمام شد!',
    buzzedInFirst: 'اول دکمه زد!',
    theSongWas: 'آهنگ این بود',
    unknown: 'نامشخص',

    whatShouldTvCallYou: 'تلویزیون چه اسمی صدات کند؟',
    yourNamePlaceholder: 'اسمت',
    joinGame: 'ورود به بازی',
    pts: 'امتیاز',
    getReady: 'آماده باش…',
    waitingHostStart: 'در انتظار شروع دور توسط میزبان…',
    alreadyBuzzed: 'قبلاً دکمه زدی',
    someoneElsesTurn: 'حالا نوبت یکی دیگه‌ست.',
    waitingHost: 'در انتظار میزبان…',
    buzzBtnLabel: 'بزن!',
    buzzInAsap: 'به محض اینکه فهمیدی، دکمه بزن!',
    lockedIn: '🔒 نوبت توئه!',
    sayAnswerHostChecking: 'جواب را بلند بگو — میزبان دارد بررسی می‌کند.',
    buzzedFirst: '{name} اول دکمه زد',
    someone: 'یکی',
    betterLuck: 'دور بعد شانس بیشتری داری!',
    roundOver: 'دور تمام شد',

    finalScores: '🏆 نتایج نهایی',
    noOnePlayed: 'کسی بازی نکرد 🎵',
    gameOver: '🏆 بازی تمام شد!',
    yourFinalScore: 'امتیاز نهایی‌ات: {n}',
    nextSongIn: '⏭ آهنگ بعدی تا {s} ثانیه دیگر…',
  },
};

function t(key, lang) {
  const dict = translations[lang] || translations.en;
  const value = key in dict ? dict[key] : translations.en[key];
  return value === undefined ? key : value;
}

function applyTranslations(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n, lang);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder, lang);
  });
}
