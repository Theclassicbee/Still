(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const KEY = 'still.sessions.v1';
  const THEME_KEY = 'still.theme.v1';
  const CHIME_KEY = 'still.chime.v1';
  const RING = 2 * Math.PI * 118;

  const state = {
    mode: 'timer',
    minutes: 10,
    running: false,
    paused: false,
    elapsed: 0,
    startedAt: 0,
    interval: null,
    sound: 'morning',
    soundOn: false,
    chimeOn: true,
    range: 'year',
    audio: null,
    soundNodes: null,
    master: null,
    birdTimer: null,
    wakeLock: null,
    toastTimer: null
  };

  /* ------------------------------------------------------------------------
     Helpers & Persistence
     ------------------------------------------------------------------------ */

  function makeId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `still_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function readSessions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  let sessions = readSessions();

  function writeSessions() {
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions));
    } catch {
      toast('Your browser could not save this session.');
    }
    if (window.StillCloud?.connected) {
      window.StillCloud.sync();
    }
  }

  const localKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const todayKey = () => localKey(new Date());
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (date, n) => {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  };
  const mins = (n) => Math.round(n);

  function dayTotals() {
    return sessions.reduce((acc, s) => {
      const m = Math.max(0, Number(s.seconds || 0)) / 60;
      acc[s.date] = (acc[s.date] || 0) + m;
      return acc;
    }, {});
  }

  function totalFor(date) {
    return dayTotals()[localKey(date)] || 0;
  }

  function refreshDateAndGreeting() {
    const now = new Date();
    const niceDate = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    }).format(now);
    $('#today-label').textContent = niceDate;

    const hour = now.getHours();
    $('#greeting').textContent =
      hour < 12 ? 'A MOMENT FOR YOUR MORNING'
        : hour < 18 ? 'A MOMENT IN THE MIDDLE'
        : 'A MOMENT TO UNWIND';
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  /* ------------------------------------------------------------------------
     Screen Wake Lock (keeps screen awake during active meditation)
     ------------------------------------------------------------------------ */

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || state.wakeLock) return;
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {
        state.wakeLock = null;
      });
    } catch {}
  }

  function releaseWakeLock() {
    if (!state.wakeLock) return;
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshDateAndGreeting();
      if (state.running && !state.paused) requestWakeLock();
    }
  });

  /* ------------------------------------------------------------------------
     Timer & Mode Rendering
     ------------------------------------------------------------------------ */

  function setReadout(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    let display;
    if (state.mode === 'stopwatch' && seconds >= 3600) {
      display = `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    } else {
      display = `${String(Math.floor(seconds / 60)).padStart(2, '0')}<span>:</span>${String(seconds % 60).padStart(2, '0')}`;
    }
    $('#timer-readout').innerHTML = display;

    let progress = 0;
    if (state.mode === 'timer') {
      progress = state.running || state.paused ? Math.min(1, seconds / (state.minutes * 60)) : 0;
    } else {
      progress = Math.min(1, seconds / (120 * 60));
    }
    $('#progress-ring').style.strokeDashoffset = String(RING * (1 - progress));
  }

  function paintMode() {
    $$('.mode-tab').forEach((b) => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-selected', String(on));
    });

    const stopwatch = state.mode === 'stopwatch';
    const hideDuration = stopwatch || state.running || state.paused;
    $('#duration-controls').classList.toggle('hidden', hideDuration);
    $('#quick-times').classList.toggle('hidden', hideDuration);
    $('#timer-kicker').textContent = stopwatch ? 'YOUR TIME, YOUR PACE' : 'A MOMENT OF STILLNESS';
    $('#timer-caption').textContent = state.running
      ? (state.paused ? 'Take all the time you need' : 'Let your breath find its rhythm')
      : stopwatch ? 'Stop when you feel complete' : 'Settle in, at your own pace';
    $('#duration-label').textContent = state.minutes;

    $$('#quick-times button').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.minutes) === state.minutes)
    );

    $('#start-button').innerHTML = `<span class="button-icon" aria-hidden="true">▶</span><span>${state.paused ? 'Continue session' : 'Begin session'}</span>`;
    $('#start-button').classList.toggle('hidden', state.running && !state.paused);
    $('#pause-button').classList.toggle('hidden', !state.running || state.paused);
    $('#end-button').classList.toggle('hidden', !state.running && !state.paused);
    $('#timer-stage').closest('.session-card').classList.toggle('is-running', state.running && !state.paused);

    const displaySeconds =
      state.mode === 'timer'
        ? (state.running || state.paused ? Math.max(0, state.minutes * 60 - state.elapsed) : state.minutes * 60)
        : state.elapsed;
    setReadout(displaySeconds);
  }

  /* ------------------------------------------------------------------------
     Stats & Heatmap
     ------------------------------------------------------------------------ */

  function totals() {
    const today = totalFor(new Date());
    const todayCount = sessions.filter((s) => s.date === todayKey()).length;
    const now = dayStart(new Date());
    const weekStart = addDays(now, -now.getDay());
    let week = 0;
    for (let i = 0; i < 7; i++) week += totalFor(addDays(weekStart, i));

    $('#today-minutes').textContent = mins(today);
    $('#weekly-minutes').textContent = mins(week);
    $('#rhythm-week').innerHTML = `${mins(week)}<span> min</span>`;
    $('#today-session-count').textContent = todayCount
      ? `${todayCount} ${todayCount === 1 ? 'session' : 'sessions'} today`
      : 'No sessions today';

    const weekSessions = sessions.filter((s) => {
      const d = new Date(`${s.date}T12:00:00`);
      return d >= weekStart && d < addDays(weekStart, 7);
    }).length;
    $('#weekly-sessions').textContent = weekSessions
      ? `${weekSessions} ${weekSessions === 1 ? 'session' : 'sessions'} · Sun–Sat`
      : 'Sun–Sat practice';

    const practiceDays = new Set(sessions.map((s) => s.date));
    let streak = 0;
    let cursor = now;
    if (!practiceDays.has(localKey(cursor))) cursor = addDays(cursor, -1);
    while (practiceDays.has(localKey(cursor))) {
      streak++;
      cursor = addDays(cursor, -1);
    }

    let best = 0;
    let current = 0;
    const allDays = [...practiceDays].sort();
    let previous = null;
    for (const k of allDays) {
      const d = new Date(`${k}T12:00:00`);
      if (previous && Math.round((d - previous) / 86400000) === 1) current++;
      else current = 1;
      best = Math.max(best, current);
      previous = d;
    }

    $('#streak-count').textContent = streak;
    $('#current-streak').innerHTML = `${streak}<span> days</span>`;
    $('#best-streak').innerHTML = `${best}<span> days</span>`;
    $('#total-minutes').innerHTML = `${mins(sessions.reduce((a, s) => a + Number(s.seconds || 0), 0) / 60)} <small>min</small>`;
    $('#total-sessions').textContent = sessions.length
      ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} · ${practiceDays.size} ${practiceDays.size === 1 ? 'day' : 'days'} practiced`
      : 'Your first session is waiting';

    const monthTotals = new Map();
    sessions.forEach((s) => {
      const month = String(s.date || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) {
        monthTotals.set(month, (monthTotals.get(month) || 0) + Math.max(0, Number(s.seconds || 0)));
      }
    });
    const activeMonth = [...monthTotals].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
    $('#most-active-month').textContent = activeMonth
      ? new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(`${activeMonth[0]}-15T12:00:00`))
      : '—';
    $('#most-active-minutes').textContent = activeMonth ? `${mins(activeMonth[1] / 60)} min` : '0 min';

    const longest = Math.max(0, ...sessions.map((s) => Number(s.seconds) || 0));
    const longestMinutes = mins(longest / 60);
    $('#longest-session').textContent = longest
      ? (longestMinutes >= 60 ? `${Math.floor(longestMinutes / 60)}h ${longestMinutes % 60}m` : `${longestMinutes} min`)
      : '—';
    $('#longest-session-detail').textContent = longest ? 'Your longest recorded sit' : 'Your first session is waiting';
  }

  function levelFor(minutes) {
    return minutes <= 0 ? 0 : minutes < 10 ? 1 : minutes < 20 ? 2 : minutes < 40 ? 3 : 4;
  }

  function dayCell(date, cls = '') {
    const m = totalFor(date);
    const l = levelFor(m);
    const el = document.createElement('i');
    el.className = `heat-cell ${cls}`.trim();
    el.dataset.level = String(l);
    el.title = `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)} · ${mins(m)} ${mins(m) === 1 ? 'minute' : 'minutes'}`;
    el.setAttribute('aria-label', el.title);
    return el;
  }

  function renderHeatmap() {
    const box = $('#heatmap-container');
    box.replaceChildren();
    box.className = 'heatmap-container';
    const now = dayStart(new Date());

    if (state.range === 'week') {
      const start = addDays(now, -now.getDay());
      const grid = document.createElement('div');
      grid.className = 'week-grid';
      const full = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let practiced = 0;
      let weekMinutes = 0;

      full.forEach((label, i) => {
        const date = addDays(start, i);
        const m = totalFor(date);
        const day = document.createElement('div');
        day.className = 'week-day';
        day.append(
          dayCell(date, date.getTime() === now.getTime() ? 'today' : ''),
          Object.assign(document.createElement('strong'), { textContent: label }),
          Object.assign(document.createElement('small'), { textContent: m ? `${mins(m)}m` : '' })
        );
        grid.append(day);
        if (m) practiced++;
        weekMinutes += m;
      });

      box.classList.add('week-mode');
      box.append(grid);
      $('#heatmap-title').textContent = 'This week';
      $('#heatmap-summary').textContent = `${practiced} ${practiced === 1 ? 'day' : 'days'} practiced · ${mins(weekMinutes)} minutes in total`;
      return;
    }

    if (state.range === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const grid = document.createElement('div');
      grid.className = 'month-grid';

      const labels = document.createElement('div');
      labels.className = 'weekday-row';
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((x) => {
        const n = document.createElement('span');
        n.textContent = x;
        labels.append(n);
      });
      box.append(labels);

      for (let i = 0; i < first.getDay(); i++) {
        const empty = document.createElement('div');
        empty.className = 'month-day';
        empty.innerHTML = '<i class="empty"></i>';
        grid.append(empty);
      }

      let practiced = 0;
      let monthMinutes = 0;
      for (let d = 1; d <= last.getDate(); d++) {
        const date = new Date(now.getFullYear(), now.getMonth(), d);
        const m = totalFor(date);
        const cell = document.createElement('div');
        cell.className = 'month-day';
        cell.append(dayCell(date, date.getTime() === now.getTime() ? 'today' : ''));
        grid.append(cell);
        if (m) practiced++;
        monthMinutes += m;
      }

      box.append(grid);
      $('#heatmap-title').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(now);
      $('#heatmap-summary').textContent = `${practiced} ${practiced === 1 ? 'day' : 'days'} practiced · ${mins(monthMinutes)} minutes this month`;
      return;
    }

    const year = now.getFullYear();
    const first = new Date(year, 0, 1);
    const start = addDays(first, -first.getDay());
    const last = new Date(year, 11, 31);
    const columns = Math.ceil((dayStart(last) - dayStart(start)) / 86400000 / 7) + 1;
    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';

    let practiced = 0;
    let yearMinutes = 0;
    for (let c = 0; c < columns; c++) {
      const col = document.createElement('div');
      col.className = 'heatmap-column';
      for (let r = 0; r < 7; r++) {
        const date = addDays(start, c * 7 + r);
        const cell = date.getFullYear() === year
          ? dayCell(date, date.getTime() === now.getTime() ? 'today' : '')
          : Object.assign(document.createElement('i'), { className: 'heat-cell' });
        if (date.getFullYear() === year) {
          const m = totalFor(date);
          if (m) practiced++;
          yearMinutes += m;
        }
        col.append(cell);
      }
      grid.append(col);
    }

    box.append(grid);
    $('#heatmap-title').textContent = `${year} at a glance`;

    const labels = document.createElement('div');
    labels.className = 'heat-labels';
    labels.style.position = 'relative';
    labels.style.height = '14px';
    const months = [];
    for (let m = 0; m < 12; m++) {
      const firstMonth = new Date(year, m, 1);
      const offset = Math.floor((dayStart(firstMonth) - dayStart(start)) / 86400000 / 7);
      months.push({
        name: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(firstMonth),
        offset
      });
    }
    months.forEach((m, i) => {
      if (i === 0 || m.offset - months[i - 1].offset >= 3) {
        const s = document.createElement('span');
        s.textContent = m.name;
        s.style.position = 'absolute';
        s.style.left = `${m.offset * 16}px`;
        labels.append(s);
      }
    });
    box.append(labels);
    $('#heatmap-summary').textContent = `${practiced} ${practiced === 1 ? 'day' : 'days'} practiced · ${mins(yearMinutes)} minutes this year`;
  }

  function render() {
    totals();
    renderHeatmap();
  }

  /* ------------------------------------------------------------------------
     Theme & Preferences
     ------------------------------------------------------------------------ */

  function setTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const button = $('#theme-toggle');
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    $('#theme-icon').textContent = dark ? '☀' : '☾';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = dark ? '#171c18' : '#f8f8f5';
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {}
  }

  let savedTheme = 'light';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') {
      savedTheme = stored;
    } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      savedTheme = 'dark';
    }
  } catch {}
  setTheme(savedTheme);

  $('#theme-toggle').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  try {
    const savedChime = localStorage.getItem(CHIME_KEY);
    if (savedChime === 'false') state.chimeOn = false;
  } catch {}
  $('#chime-toggle').checked = state.chimeOn;
  $('#chime-toggle').addEventListener('change', (e) => {
    state.chimeOn = Boolean(e.target.checked);
    try {
      localStorage.setItem(CHIME_KEY, String(state.chimeOn));
    } catch {}
  });

  /* ------------------------------------------------------------------------
     Web Audio Ambient Soundscapes & Completion Chime
     ------------------------------------------------------------------------ */

  async function ensureAudio() {
    if (!state.audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        toast('Ambient sound is not available in this browser.');
        return false;
      }
      state.audio = new Ctx();
      state.master = state.audio.createGain();
      state.master.gain.value = 0;
      state.master.connect(state.audio.destination);
    }
    if (state.audio.state === 'suspended') {
      await state.audio.resume();
    }
    return true;
  }

  function connectNode(node, gain) {
    const g = state.audio.createGain();
    g.gain.value = gain;
    node.connect(g);
    g.connect(state.master);
    return { node, gain: g };
  }

  function stopSound(fade = true) {
    clearTimeout(state.birdTimer);
    state.birdTimer = null;

    if (!state.soundNodes) return;
    const nodes = state.soundNodes;
    state.soundNodes = null;

    if (state.master && state.audio) {
      const now = state.audio.currentTime;
      state.master.gain.cancelScheduledValues(now);
      state.master.gain.setTargetAtTime(0, now, fade ? 0.32 : 0.01);
    }

    setTimeout(() => {
      nodes.forEach((n) => {
        try {
          n.node.stop?.();
          n.node.disconnect();
          n.gain.disconnect();
        } catch {}
      });
    }, fade ? 1300 : 60);

    $('#sound-toggle').classList.add('muted');
    $('#sound-toggle').setAttribute('aria-label', 'Turn ambient sound on');
    $('#sound-foot-label').textContent = 'Sound is off';
    $('.now-playing-dot').classList.remove('playing');
  }

  function noiseBuffer(color = 'pink') {
    const ctx = state.audio;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        data[i] = w * 0.26;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  function oscillator(freq, type = 'sine', gain = 0.07, pan = 0) {
    const ctx = state.audio;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const node = connectNode(osc, gain);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.node.disconnect(node.gain);
      node.node.connect(p);
      p.connect(node.gain);
    }
    osc.start();
    return { node: osc, gain: node.gain };
  }

  async function playCompletionChime() {
    if (!state.chimeOn) return;
    if (!(await ensureAudio())) return;
    const ctx = state.audio;
    const now = ctx.currentTime + 0.05;
    const partials = [
      { freq: 432, gain: 0.14, decay: 3.6 },
      { freq: 864, gain: 0.05, decay: 2.4 },
      { freq: 1296, gain: 0.02, decay: 1.6 }
    ];

    partials.forEach(({ freq, gain, decay }) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + decay + 0.08);
    });
  }

  async function startSound() {
    if (state.sound === 'silence') {
      state.soundOn = false;
      stopSound();
      $('#sound-foot-label').textContent = 'A space of your own';
      return;
    }

    if (!(await ensureAudio())) return;
    if (state.soundNodes) stopSound(false);

    const ctx = state.audio;
    const nodes = [];
    state.master.gain.cancelScheduledValues(ctx.currentTime);
    state.master.gain.setTargetAtTime((Number($('#volume').value) / 100) * 0.2, ctx.currentTime, 0.35);

    if (state.sound === 'morning') {
      const wind = noiseBuffer('pink');
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 720;
      wind.connect(filter);
      const g = ctx.createGain();
      g.gain.value = 0.5;
      filter.connect(g);
      g.connect(state.master);
      wind.start();
      nodes.push({ node: wind, gain: g });

      const sway = ctx.createOscillator();
      const sg = ctx.createGain();
      sway.frequency.value = 0.07;
      sg.gain.value = 190;
      sway.connect(sg);
      sg.connect(filter.frequency);
      sway.start();
      nodes.push({ node: sway, gain: sg });

      const chirp = () => {
        if (!state.soundOn || state.sound !== 'morning') return;
        const base = ctx.currentTime + 0.1 + Math.random() * 1.5;
        for (let j = 0; j < 2; j++) {
          const o = ctx.createOscillator();
          const cg = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(2300 + Math.random() * 900, base + j * 0.11);
          o.frequency.exponentialRampToValueAtTime(1550 + Math.random() * 500, base + j * 0.11 + 0.17);
          cg.gain.setValueAtTime(0.0001, base + j * 0.11);
          cg.gain.exponentialRampToValueAtTime(0.025, base + j * 0.11 + 0.035);
          cg.gain.exponentialRampToValueAtTime(0.0001, base + j * 0.11 + 0.2);
          o.connect(cg);
          cg.connect(state.master);
          o.start(base + j * 0.11);
          o.stop(base + j * 0.11 + 0.23);
          o.onended = () => {
            try { o.disconnect(); cg.disconnect(); } catch {}
          };
        }
        state.birdTimer = setTimeout(chirp, 3500 + Math.random() * 6500);
      };
      state.birdTimer = setTimeout(chirp, 900);
    } else if (state.sound === 'river') {
      const water = noiseBuffer('pink');
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 520;
      f.Q.value = 0.7;
      water.connect(f);
      const g = ctx.createGain();
      g.gain.value = 0.6;
      f.connect(g);
      g.connect(state.master);
      water.start();
      nodes.push({ node: water, gain: g });

      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.16;
      lg.gain.value = 250;
      lfo.connect(lg);
      lg.connect(f.frequency);
      lfo.start();
      nodes.push({ node: lfo, gain: lg });
    } else if (state.sound === 'om') {
      nodes.push(
        oscillator(108, 'sine', 0.15),
        oscillator(162, 'sine', 0.045),
        oscillator(216, 'sine', 0.025)
      );
      const pulse = ctx.createOscillator();
      const pg = ctx.createGain();
      pulse.frequency.value = 0.09;
      pg.gain.value = 0.02;
      pulse.connect(pg);
      pg.connect(state.master.gain);
      pulse.start();
      nodes.push({ node: pulse, gain: pg });
    } else if (state.sound === 'binaural') {
      nodes.push(
        oscillator(216, 'sine', 0.06, -0.85),
        oscillator(222, 'sine', 0.06, 0.85)
      );
    }

    state.soundNodes = nodes;
    state.soundOn = true;
    $('#sound-toggle').classList.remove('muted');
    $('#sound-toggle').setAttribute('aria-label', 'Turn ambient sound off');
    $('.now-playing-dot').classList.add('playing');
    $('#sound-foot-label').textContent = `${$('.sound-option.selected .sound-copy strong').textContent} is playing`;
  }

  /* ------------------------------------------------------------------------
     Session Lifecycle
     ------------------------------------------------------------------------ */

  function endSession(completed = false) {
    clearInterval(state.interval);
    state.interval = null;
    releaseWakeLock();

    const elapsed = state.mode === 'timer' && completed ? state.minutes * 60 : Math.floor(state.elapsed);
    state.running = false;
    state.paused = false;
    state.startedAt = 0;

    if (elapsed >= 60) {
      sessions.push({
        id: makeId(),
        date: todayKey(),
        seconds: elapsed,
        mode: state.mode,
        createdAt: new Date().toISOString()
      });
      writeSessions();
      render();
      toast(completed ? 'Beautifully done. Your time is saved.' : 'Your session is saved.');
    } else {
      toast('A small beginning. Come back whenever you like.');
    }

    if (completed) playCompletionChime();

    state.elapsed = 0;
    setReadout(state.mode === 'timer' ? state.minutes * 60 : 0);
    paintMode();

    if (state.soundOn) {
      state.soundOn = false;
      stopSound();
    }
  }

  function tick() {
    const now = Date.now();
    state.elapsed += Math.max(0, (now - state.startedAt) / 1000);
    state.startedAt = now;

    if (state.mode === 'timer') {
      const remaining = Math.max(0, state.minutes * 60 - state.elapsed);
      setReadout(remaining);
      if (remaining <= 0) {
        endSession(true);
      }
    } else {
      setReadout(state.elapsed);
      if (state.elapsed >= 7200) {
        endSession(true);
        toast('Two hours of quiet. Your time is saved.');
      }
    }
  }

  function begin() {
    if (state.paused) {
      state.running = true;
      state.paused = false;
      state.startedAt = Date.now();
      state.interval = setInterval(tick, 250);
      requestWakeLock();
      paintMode();
      if (state.sound !== 'silence' && !state.soundOn) startSound();
      return;
    }

    state.elapsed = 0;
    state.running = true;
    state.startedAt = Date.now();
    state.interval = setInterval(tick, 250);
    requestWakeLock();
    paintMode();
    if (state.sound !== 'silence') startSound();
  }

  function pause() {
    state.elapsed += Math.max(0, (Date.now() - state.startedAt) / 1000);
    state.running = false;
    state.paused = true;
    clearInterval(state.interval);
    state.interval = null;
    releaseWakeLock();
    paintMode();
  }

  /* ------------------------------------------------------------------------
     Event Listeners
     ------------------------------------------------------------------------ */

  function setMode(mode) {
    if (state.running || state.paused) return;
    state.mode = mode;
    state.elapsed = 0;
    paintMode();
  }

  function setMinutes(m) {
    state.minutes = Math.max(1, Math.min(60, m));
    if (!state.running && !state.paused) setReadout(state.minutes * 60);
    $('#duration-label').textContent = state.minutes;
    $$('#quick-times button').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.minutes) === state.minutes)
    );
  }

  $$('.mode-tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#duration-minus').addEventListener('click', () => setMinutes(state.minutes - 1));
  $('#duration-plus').addEventListener('click', () => setMinutes(state.minutes + 1));
  $$('#quick-times button').forEach((b) =>
    b.addEventListener('click', () => setMinutes(Number(b.dataset.minutes)))
  );

  $('#start-button').addEventListener('click', begin);
  $('#pause-button').addEventListener('click', pause);
  $('#end-button').addEventListener('click', () => endSession(false));

  $('#sound-toggle').addEventListener('click', () => {
    if (state.soundOn) {
      state.soundOn = false;
      stopSound();
    } else {
      startSound();
    }
  });

  $$('.sound-option').forEach((b) =>
    b.addEventListener('click', () => {
      state.sound = b.dataset.sound;
      $$('.sound-option').forEach((x) => {
        const selected = x === b;
        x.classList.toggle('selected', selected);
        x.setAttribute('aria-checked', String(selected));
      });
      if (state.sound === 'silence') {
        state.soundOn = false;
        stopSound();
        $('#sound-foot-label').textContent = 'A space of your own';
      } else if (state.soundOn) {
        startSound();
      } else {
        $('#sound-foot-label').textContent = 'Ready when you are';
      }
    })
  );

  $('#volume').addEventListener('input', (e) => {
    if (state.audio && state.soundOn) {
      state.master.gain.setTargetAtTime((Number(e.target.value) / 100) * 0.2, state.audio.currentTime, 0.08);
    }
  });

  /* ------------------------------------------------------------------------
     Backup Panel (Google Drive + Local JSON Export/Import)
     ------------------------------------------------------------------------ */

  function paintCloudState(info = {}) {
    const connected = Boolean(info.connected);
    const setupNeeded = Boolean(info.setupNeeded);

    $('#cloud-status').textContent = info.text || 'Saved on this device only';
    $('#cloud-status-dot').className = `cloud-status-dot ${info.tone || ''}`;
    $('#cloud-action').classList.toggle('connected', connected);
    $('#cloud-action-label').textContent = connected ? 'Synced' : 'Backup';

    $('#google-cloud-actions').classList.toggle('hidden', setupNeeded);
    $('#cloud-footnote').classList.toggle('hidden', setupNeeded);
    $('#cloud-setup-note').classList.toggle('hidden', !setupNeeded);

    $('#cloud-connect').classList.toggle('hidden', connected);
    $('#cloud-sync').classList.toggle('hidden', !connected);
    $('#cloud-disconnect').classList.toggle('hidden', !connected);
    $('#cloud-connect').disabled = Boolean(setupNeeded || (!info.ready && !connected));
  }

  function closeCloudPanel() {
    $('#cloud-panel').classList.add('hidden');
    $('#cloud-action').setAttribute('aria-expanded', 'false');
  }

  $('#cloud-action').addEventListener('click', () => {
    const panel = $('#cloud-panel');
    const open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    $('#cloud-action').setAttribute('aria-expanded', String(open));
  });

  $('#cloud-close').addEventListener('click', closeCloudPanel);

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#cloud-panel') && !event.target.closest('#cloud-action')) {
      closeCloudPanel();
    }
  });

  $('#cloud-connect').addEventListener('click', () => {
    window.StillCloud?.connect();
  });
  $('#cloud-sync').addEventListener('click', () => window.StillCloud?.sync());
  $('#cloud-disconnect').addEventListener('click', () => window.StillCloud?.disconnect());

  // Local JSON Export & Import
  $('#export-json').addEventListener('click', () => {
    const payload = JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), sessions },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `still-backup-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup file downloaded.');
  });

  $('#import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.sessions) ? parsed.sessions : null);
      if (!incoming) throw new Error('Invalid format');
      const merged = window.StillCloud?.mergeSessions
        ? window.StillCloud.mergeSessions(sessions, incoming)
        : incoming;
      sessions = merged;
      writeSessions();
      render();
      toast(`Imported ${incoming.length} ${incoming.length === 1 ? 'session' : 'sessions'}.`);
    } catch {
      toast('Could not read that backup file.');
    }
  });

  window.StillCloud?.init({
    clientId: window.STILL_CONFIG?.googleClientId,
    getLocalSessions: () => sessions,
    setSessions: (next) => {
      sessions = next;
      try {
        localStorage.setItem(KEY, JSON.stringify(sessions));
      } catch {}
      render();
    },
    onState: paintCloudState
  });

  /* ------------------------------------------------------------------------
     Navigation & Keyboard Shortcuts
     ------------------------------------------------------------------------ */

  function showView(id) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    $$('.nav-item, .top-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
    if (id === 'rhythm-view') renderHeatmap();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $$('.nav-item, .top-nav-item').forEach((b) =>
    b.addEventListener('click', () => showView(b.dataset.view))
  );
  $('#back-to-practice').addEventListener('click', () => showView('practice-view'));
  $('#brand-home').addEventListener('click', (e) => {
    e.preventDefault();
    showView('practice-view');
  });

  $$('.view-tab').forEach((b) =>
    b.addEventListener('click', () => {
      state.range = b.dataset.range;
      $$('.view-tab').forEach((x) => x.classList.toggle('selected', x === b));
      renderHeatmap();
    })
  );

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCloudPanel();
      return;
    }
    if (
      event.code === 'Space' &&
      !['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes(document.activeElement?.tagName) &&
      $('#practice-view').classList.contains('active')
    ) {
      event.preventDefault();
      if (state.running && !state.paused) pause();
      else begin();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (state.running) {
      state.elapsed += Math.max(0, (Date.now() - state.startedAt) / 1000);
      if (state.elapsed >= 60) {
        sessions.push({
          id: makeId(),
          date: todayKey(),
          seconds: Math.floor(state.elapsed),
          mode: state.mode,
          createdAt: new Date().toISOString()
        });
        writeSessions();
      }
    }
  });

  /* ------------------------------------------------------------------------
     Initial Render & Service Worker
     ------------------------------------------------------------------------ */

  refreshDateAndGreeting();
  paintMode();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();
