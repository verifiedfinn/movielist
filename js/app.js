/* ============================================================
   THE GRID — app.js  v3
   Data: Google Sheets CSV + OMDB enrichment
   ============================================================ */

(function () {

  const SHEETS_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQaW3E2smu0ThuVsc5cl-bDq7xVjNhKEDxqyg9gc9sMHyN9Xcs_YeJ5p2vqMeENklqT0T7h3Q9HVqWK/pub?gid=1211537153&single=true&output=csv';
  const OMDB_KEY   = 'cf5a42d0';
  const OMDB_BASE  = 'https://www.omdbapi.com/';
  const STATUS     = { SEEN: 'seen', QUEUE: 'queue' };

  let movies = [];
  let filter = 'all';

  const cardsWrap      = document.getElementById('cardsWrap');
  const statTotal      = document.getElementById('statTotal');
  const statSeen       = document.getElementById('statSeen');
  const statQueue      = document.getElementById('statQueue');
  const statFav        = document.getElementById('statFav');
  const sectionTitle   = document.getElementById('section-title');
  const sectionCount   = document.getElementById('section-count');
  const loadingOverlay = document.getElementById('loading-overlay');

  /* ── Clock ── */
  const cTime = document.getElementById('cTime');
  const cAmpm = document.getElementById('cAmpm');
  function tickClock() {
    const d = new Date();
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    cTime.textContent = [h, d.getMinutes()]
      .map(n => String(n).padStart(2, '0')).join(':');
    cAmpm.textContent = ampm;
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ── CSV parser ── */
  function splitCSVRow(line) {
    const vals = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur);
    return vals;
  }

  function parseCSV(raw) {
    const lines = raw.replace(/\r/g, '').trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = splitCSVRow(lines[0]).map(h => h.trim().toLowerCase());
    return lines.slice(1).map((line, idx) => {
      const vals = splitCSVRow(line);
      const row  = {};
      headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
      const favRaw = (row.favorite || '').toLowerCase();
      return {
        id:       idx + 1,
        title:    row.title   || '',
        status:   (row.status || STATUS.QUEUE).toLowerCase(),
        favorite: ['true', 'yes', '1', 'y'].includes(favRaw),
        notes:    row.notes   || '',
        rating:   row.rating  || '',
        poster: null, imdbRating: null, genre: null,
        runtime: null, director: null, plot: null, year: null,
        enriched: false, corrupted: false
      };
    }).filter(m => m.title);
  }

  /* ── OMDB ── */
  const valOmdb = v => (v && v !== 'N/A') ? v : null;

  const OMDB_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  function omdbCacheGet(title) {
    try {
      const raw = localStorage.getItem('omdb:' + title);
      if (!raw) return undefined;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > OMDB_TTL) { localStorage.removeItem('omdb:' + title); return undefined; }
      return data; // null = confirmed not found; undefined = not in cache
    } catch { return undefined; }
  }

  function omdbCacheSet(title, data) {
    try { localStorage.setItem('omdb:' + title, JSON.stringify({ ts: Date.now(), data })); }
    catch {} // storage quota full — fail silently
  }

  async function fetchOMDB(title) {
    const cached = omdbCacheGet(title);
    if (cached !== undefined) return cached;
    const url = OMDB_BASE + '?' +
      new URLSearchParams({ t: title, apikey: OMDB_KEY, plot: 'short' });
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      if (d.Error && d.Error.toLowerCase().includes('limit')) return null; // rate-limited — don't cache
      const result = d.Response === 'True' ? d : null;
      omdbCacheSet(title, result);
      return result;
    } catch { return null; }
  }

  function applyOMDB(m, d) {
    m.poster     = valOmdb(d.Poster);
    m.imdbRating = valOmdb(d.imdbRating);
    m.genre      = valOmdb(d.Genre);
    m.runtime    = valOmdb(d.Runtime);
    m.director   = valOmdb(d.Director);
    m.plot       = valOmdb(d.Plot);
    m.year       = valOmdb(d.Year);
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));

  /* ── Sound + Haptics ── */
  const FX = (() => {
    let ac = null;
    const ctx = () => {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      return ac;
    };

    /* iOS requires AudioContext to be created + a silent buffer played
       inside a real user-gesture handler. Do this once on first touch. */
    const unlockiOS = () => {
      try {
        const a = ctx();
        const buf = a.createBuffer(1, 1, 22050);
        const src = a.createBufferSource();
        src.buffer = buf;
        src.connect(a.destination);
        src.start(0);
      } catch {}
      document.removeEventListener('touchstart', unlockiOS);
      document.removeEventListener('touchend',   unlockiOS);
    };
    document.addEventListener('touchstart', unlockiOS, { once: true, passive: true });
    document.addEventListener('touchend',   unlockiOS, { once: true, passive: true });

    /* Haptics — vibration API (Android/some browsers; not available on iOS) */
    const buzz = pattern => { try { navigator.vibrate?.(pattern); } catch {} };

    /* UI click — Tron confirm chirp: rise then settle */
    function click() {
      try {
        const a = ctx(), t = a.currentTime;
        const o1 = a.createOscillator(), g1 = a.createGain();
        o1.connect(g1); g1.connect(a.destination);
        o1.type = 'triangle';
        o1.frequency.setValueAtTime(720, t);
        o1.frequency.linearRampToValueAtTime(1380, t + 0.016);
        o1.frequency.exponentialRampToValueAtTime(940, t + 0.038);
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(0.065, t + 0.004);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.038);
        o1.start(t); o1.stop(t + 0.038);
        // Digital crunch bite on top
        const o2 = a.createOscillator(), g2 = a.createGain();
        o2.connect(g2); g2.connect(a.destination);
        o2.type = 'square';
        o2.frequency.setValueAtTime(4400, t);
        o2.frequency.exponentialRampToValueAtTime(1600, t + 0.010);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(0.018, t + 0.002);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.010);
        o2.start(t); o2.stop(t + 0.010);
      } catch {}
      buzz(3);
    }

    /* Card burst out — paper swoosh with Tron digital edge */
    function cardLaunch(i) {
      try {
        const a = ctx(), t = a.currentTime;
        // Noise burst — the paper texture (broadband noise, bandpass filtered)
        const bufLen = Math.ceil(a.sampleRate * 0.072);
        const buf    = a.createBuffer(1, bufLen, a.sampleRate);
        const data   = buf.getChannelData(0);
        for (let j = 0; j < bufLen; j++) data[j] = Math.random() * 2 - 1;
        const ns   = a.createBufferSource();
        ns.buffer  = buf;
        const filt = a.createBiquadFilter();
        filt.type            = 'bandpass';
        filt.frequency.value = 2800 + i * 200; // slight pitch step per card
        filt.Q.value         = 1.1;
        const ng = a.createGain();
        ns.connect(filt); filt.connect(ng); ng.connect(a.destination);
        ng.gain.setValueAtTime(0.0001, t);
        ng.gain.linearRampToValueAtTime(0.20, t + 0.004);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.068);
        ns.start(t); ns.stop(t + 0.072);
        // Airy whoosh body — low sine arc
        const base = 160 + i * 22;
        const o1   = a.createOscillator(), g1 = a.createGain();
        o1.connect(g1); g1.connect(a.destination);
        o1.type = 'sine';
        o1.frequency.setValueAtTime(base, t);
        o1.frequency.exponentialRampToValueAtTime(base * 3.2, t + 0.020);
        o1.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.075);
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(0.058, t + 0.005);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
        o1.start(t); o1.stop(t + 0.075);
      } catch {}
      buzz(2);
    }

    /* Card reveal — happy major-key jackpot: C major arpeggio → bright cling */
    function reveal() {
      try {
        const a = ctx(), t = a.currentTime;

        // C major arpeggio ascending — C4 E4 G4 C5 E5 G5
        // Pure sine for clean bell/chime tone, not buzzy
        const C4=261.6, E4=329.6, G4=392.0, C5=523.3, E5=659.3, G5=784.0;
        const notes = [C4, E4, G4, C5, E5, G5];
        const step  = 0.075; // 75ms between notes

        notes.forEach((freq, i) => {
          const d = i * step;
          // Main bell body
          const o = a.createOscillator(), g = a.createGain();
          o.connect(g); g.connect(a.destination);
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t + d);
          g.gain.setValueAtTime(0.0001, t + d);
          g.gain.linearRampToValueAtTime(0.14 + i * 0.012, t + d + 0.005);
          g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
          o.start(t + d); o.stop(t + d + 0.23);

          // Overtone — gives it the "cling" metallic ring (2× freq)
          const o2 = a.createOscillator(), g2 = a.createGain();
          o2.connect(g2); g2.connect(a.destination);
          o2.type = 'sine';
          o2.frequency.setValueAtTime(freq * 2, t + d);
          g2.gain.setValueAtTime(0.0001, t + d);
          g2.gain.linearRampToValueAtTime(0.040 + i * 0.004, t + d + 0.003);
          g2.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12);
          o2.start(t + d); o2.stop(t + d + 0.13);

          // Sharp click transient — the actual "cling" attack
          const o3 = a.createOscillator(), g3 = a.createGain();
          o3.connect(g3); g3.connect(a.destination);
          o3.type = 'triangle';
          o3.frequency.setValueAtTime(freq * 5, t + d);
          o3.frequency.exponentialRampToValueAtTime(freq * 2.5, t + d + 0.012);
          g3.gain.setValueAtTime(0.0001, t + d);
          g3.gain.linearRampToValueAtTime(0.055, t + d + 0.001);
          g3.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.012);
          o3.start(t + d); o3.stop(t + d + 0.013);
        });

        // Big finish chord — lands after last note (5 × 75ms = 375ms)
        // C major triad: C5 + E5 + G5, all ring together
        const fin = notes.length * step; // 0.450s
        [[C5, 0.22], [E5, 0.18], [G5, 0.14]].forEach(([freq, vol]) => {
          const of = a.createOscillator(), gf = a.createGain();
          of.connect(gf); gf.connect(a.destination);
          of.type = 'sine';
          of.frequency.setValueAtTime(freq, t + fin);
          gf.gain.setValueAtTime(0.0001, t + fin);
          gf.gain.linearRampToValueAtTime(vol, t + fin + 0.008);
          gf.gain.exponentialRampToValueAtTime(0.0001, t + fin + 0.55);
          of.start(t + fin); of.stop(t + fin + 0.56);
        });

        // Sub warmth under the final chord — not boomy, just full
        const os = a.createOscillator(), gs = a.createGain();
        os.connect(gs); gs.connect(a.destination);
        os.type = 'sine';
        os.frequency.setValueAtTime(C4, t + fin);
        os.frequency.exponentialRampToValueAtTime(C4 * 0.5, t + fin + 0.30);
        gs.gain.setValueAtTime(0.0001, t + fin);
        gs.gain.linearRampToValueAtTime(0.30, t + fin + 0.006);
        gs.gain.exponentialRampToValueAtTime(0.0001, t + fin + 0.30);
        os.start(t + fin); os.stop(t + fin + 0.31);

        // Bright high sparkle — G7, rings into the chord
        const oh = a.createOscillator(), gh = a.createGain();
        oh.connect(gh); gh.connect(a.destination);
        oh.type = 'sine';
        oh.frequency.setValueAtTime(G5 * 4, t + fin); // ~3136Hz
        gh.gain.setValueAtTime(0.0001, t + fin);
        gh.gain.linearRampToValueAtTime(0.072, t + fin + 0.004);
        gh.gain.exponentialRampToValueAtTime(0.0001, t + fin + 0.38);
        oh.start(t + fin); oh.stop(t + fin + 0.39);

        // Final cling — one last high ping 80ms after the chord, the exclamation point
        const oc = a.createOscillator(), gc = a.createGain();
        oc.connect(gc); gc.connect(a.destination);
        oc.type = 'sine';
        oc.frequency.setValueAtTime(C5 * 4, t + fin + 0.08); // C8 ~2093Hz × 4 = 8372Hz-ish, use C6 = 1047Hz
        oc.frequency.setValueAtTime(1047, t + fin + 0.08);
        oc.frequency.exponentialRampToValueAtTime(900, t + fin + 0.32);
        gc.gain.setValueAtTime(0.0001, t + fin + 0.08);
        gc.gain.linearRampToValueAtTime(0.095, t + fin + 0.085);
        gc.gain.exponentialRampToValueAtTime(0.0001, t + fin + 0.32);
        oc.start(t + fin + 0.08); oc.stop(t + fin + 0.33);

      } catch {}
      buzz([5,8,5,8,5,8,5,8,5,8,5,28,12,20]);
    }

    /* Carousel tick — hard mechanical snap, no musical ring */
    function carouselTick(speed) { // speed: 1.0=fast, 0.0=nearly stopped
      try {
        const a = ctx(), t = a.currentTime;

        // Contact noise — the click itself, very short and dry
        const nLen = Math.ceil(a.sampleRate * 0.006);
        const nbuf = a.createBuffer(1, nLen, a.sampleRate);
        const nd   = nbuf.getChannelData(0);
        for (let j = 0; j < nLen; j++) nd[j] = Math.random() * 2 - 1;
        const ns = a.createBufferSource();
        ns.buffer = nbuf;
        const hp = a.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1800;
        const ng = a.createGain();
        ns.connect(hp); hp.connect(ng); ng.connect(a.destination);
        ng.gain.setValueAtTime(0.55 + speed * 0.25, t); // 0.55–0.80
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.005);
        ns.start(t); ns.stop(t + 0.006);

        // Body snap — square, dies in ≤12ms, zero sustain
        const hz = 300 + speed * 500; // 300Hz (slow) → 800Hz (fast)
        const o1 = a.createOscillator(), g1 = a.createGain();
        o1.connect(g1); g1.connect(a.destination);
        o1.type = 'square';
        o1.frequency.setValueAtTime(hz, t);
        o1.frequency.exponentialRampToValueAtTime(hz * 0.30, t + 0.010);
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(0.22 + speed * 0.10, t + 0.0005);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.010);
        o1.start(t); o1.stop(t + 0.011);

        // Low body thump — physical ratchet weight, gives it mechanical mass
        const o2 = a.createOscillator(), g2 = a.createGain();
        o2.connect(g2); g2.connect(a.destination);
        o2.type = 'sine';
        o2.frequency.setValueAtTime(110 + speed * 70, t); // 110-180Hz
        o2.frequency.exponentialRampToValueAtTime(38, t + 0.013);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(0.30 + speed * 0.12, t + 0.001);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.013);
        o2.start(t); o2.stop(t + 0.014);

        // Tron ting — brief high triangle sweep, ties tick to the overall sound palette
        const o3 = a.createOscillator(), g3 = a.createGain();
        o3.connect(g3); g3.connect(a.destination);
        o3.type = 'triangle';
        o3.frequency.setValueAtTime(2200 + speed * 1400, t); // 2200-3600Hz
        o3.frequency.exponentialRampToValueAtTime(900 + speed * 400, t + 0.018);
        g3.gain.setValueAtTime(0.0001, t);
        g3.gain.linearRampToValueAtTime(0.038 + speed * 0.018, t + 0.001);
        g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
        o3.start(t); o3.stop(t + 0.019);
      } catch {}
    }

    /* Settle — heavy mechanical lock as wheel bounces to a stop */
    function settle() {
      try {
        const a = ctx(), t = a.currentTime;
        // Deep thunk
        const o1 = a.createOscillator(), g1 = a.createGain();
        o1.connect(g1); g1.connect(a.destination);
        o1.type = 'sine';
        o1.frequency.setValueAtTime(380, t);
        o1.frequency.exponentialRampToValueAtTime(72, t + 0.072);
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(0.28, t + 0.003);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.072);
        o1.start(t); o1.stop(t + 0.072);
        // Hard crack
        const o2 = a.createOscillator(), g2 = a.createGain();
        o2.connect(g2); g2.connect(a.destination);
        o2.type = 'square';
        o2.frequency.setValueAtTime(2800, t);
        o2.frequency.exponentialRampToValueAtTime(440, t + 0.020);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(0.065, t + 0.001);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.020);
        o2.start(t); o2.stop(t + 0.020);
      } catch {}
      buzz(8);
    }

    /* Card vortex hit — digital crunch ping */
    function tap() {
      try {
        const a = ctx(), t = a.currentTime;
        // Main descend with triangle warmth
        const o1 = a.createOscillator(), g1 = a.createGain();
        o1.connect(g1); g1.connect(a.destination);
        o1.type = 'triangle';
        o1.frequency.setValueAtTime(1800, t);
        o1.frequency.exponentialRampToValueAtTime(340, t + 0.082);
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(0.092, t + 0.005);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.082);
        o1.start(t); o1.stop(t + 0.082);
        // Crunch transient — the "digital" of it
        const o2 = a.createOscillator(), g2 = a.createGain();
        o2.connect(g2); g2.connect(a.destination);
        o2.type = 'square';
        o2.frequency.setValueAtTime(3600, t);
        o2.frequency.exponentialRampToValueAtTime(600, t + 0.028);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(0.038, t + 0.003);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
        o2.start(t); o2.stop(t + 0.028);
        // Sine octave — keeps it musical
        const o3 = a.createOscillator(), g3 = a.createGain();
        o3.connect(g3); g3.connect(a.destination);
        o3.type = 'sine';
        o3.frequency.setValueAtTime(3600, t);
        o3.frequency.exponentialRampToValueAtTime(680, t + 0.065);
        g3.gain.setValueAtTime(0.0001, t);
        g3.gain.linearRampToValueAtTime(0.028, t + 0.004);
        g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
        o3.start(t); o3.stop(t + 0.065);
      } catch {}
      buzz(4);
    }

    /* Lucky draw implosion — cinematic Tron de-rez */
    function impact() {
      try {
        const a = ctx(), t = a.currentTime;
        // Sub-bass punch — hard fast attack
        const o1 = a.createOscillator(), g1 = a.createGain();
        o1.connect(g1); g1.connect(a.destination);
        o1.type = 'sine';
        o1.frequency.setValueAtTime(260, t);
        o1.frequency.exponentialRampToValueAtTime(24, t + 0.55);
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.linearRampToValueAtTime(0.44, t + 0.004);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        o1.start(t); o1.stop(t + 0.55);
        // De-rez cascade — starts much higher, sweeps fast
        const o2 = a.createOscillator(), g2 = a.createGain();
        o2.connect(g2); g2.connect(a.destination);
        o2.type = 'triangle';
        o2.frequency.setValueAtTime(3600, t);
        o2.frequency.exponentialRampToValueAtTime(120, t + 0.30);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(0.22, t + 0.004);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
        o2.start(t); o2.stop(t + 0.30);
        // Digital shatter — high square burst at impact
        const o3 = a.createOscillator(), g3 = a.createGain();
        o3.connect(g3); g3.connect(a.destination);
        o3.type = 'square';
        o3.frequency.setValueAtTime(6000, t);
        o3.frequency.exponentialRampToValueAtTime(320, t + 0.090);
        g3.gain.setValueAtTime(0.0001, t);
        g3.gain.linearRampToValueAtTime(0.16, t + 0.003);
        g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.090);
        o3.start(t); o3.stop(t + 0.090);
        // Harmonic shard — delayed echo of the cascade
        const o4 = a.createOscillator(), g4 = a.createGain();
        o4.connect(g4); g4.connect(a.destination);
        o4.type = 'sine';
        o4.frequency.setValueAtTime(2400, t + 0.010);
        o4.frequency.exponentialRampToValueAtTime(180, t + 0.28);
        g4.gain.setValueAtTime(0.0001, t);
        g4.gain.linearRampToValueAtTime(0.095, t + 0.016);
        g4.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o4.start(t); o4.stop(t + 0.28);
        // Resonant ring-out — long musical tail
        const o5 = a.createOscillator(), g5 = a.createGain();
        o5.connect(g5); g5.connect(a.destination);
        o5.type = 'sine';
        o5.frequency.setValueAtTime(880, t + 0.022);
        o5.frequency.exponentialRampToValueAtTime(500, t + 0.75);
        g5.gain.setValueAtTime(0.0001, t);
        g5.gain.linearRampToValueAtTime(0.095, t + 0.032);
        g5.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        o5.start(t); o5.stop(t + 0.75);
        // Aftershock — small delayed de-rez echo
        const o6 = a.createOscillator(), g6 = a.createGain();
        o6.connect(g6); g6.connect(a.destination);
        o6.type = 'triangle';
        o6.frequency.setValueAtTime(1800, t + 0.065);
        o6.frequency.exponentialRampToValueAtTime(200, t + 0.34);
        g6.gain.setValueAtTime(0.0001, t);
        g6.gain.linearRampToValueAtTime(0.068, t + 0.072);
        g6.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        o6.start(t); o6.stop(t + 0.34);
      } catch {}
      buzz([22, 30, 14]);
    }

    return { click, cardLaunch, carouselTick, settle, reveal, tap, impact };
  })();

  /* ── Loading overlay ── */
  function showLoading() {
    loadingOverlay.style.display = '';
    loadingOverlay.classList.remove('hidden');
  }
  function hideLoading() {
    loadingOverlay.classList.add('hidden');
    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 650);
  }

  /* ── Data loading ── */
  async function loadData() {
    showLoading();

    try {
      /* Cache-bust so a sheet update is always picked up on reload */
      const resp = await fetch(SHEETS_URL + '&_=' + Date.now());
      if (!resp.ok) throw new Error(resp.status);
      movies = parseCSV(await resp.text());
    } catch (e) {
      console.error('[Grid] Sheet fetch error:', e);
      hideLoading();
      showError();
      return;
    }

    /* Show skeleton cards immediately, hide the overlay */
    renderCards();
    updateStats();
    hideLoading();

    /* Enrich with OMDB — patch individual cards as data arrives */
    const BATCH = 5;
    for (let i = 0; i < movies.length; i += BATCH) {
      await Promise.all(
        movies.slice(i, i + BATCH).map(async m => {
          const d = await fetchOMDB(m.title);
          if (d) applyOMDB(m, d);
          else   m.corrupted = true;
          m.enriched = true;
          patchCard(m);
        })
      );
      if (i + BATCH < movies.length) await delay(120);
    }
  }

  function showError() {
    cardsWrap.innerHTML = `
      <div class="empty">
        <div class="empty-glyph" style="color:rgba(255,30,50,0.55)">✕</div>
        <div class="empty-text" style="color:rgba(255,30,50,0.70)">Connection to the Grid failed</div>
      </div>`;
  }

  /* ── Filter ── */
  function filtered() {
    if (filter === STATUS.SEEN)  return movies.filter(m => m.status === STATUS.SEEN);
    if (filter === STATUS.QUEUE) return movies.filter(m => m.status === STATUS.QUEUE);
    if (filter === 'favorites')  return movies.filter(m => m.favorite);
    return movies;
  }

  const SECTION_LABELS = {
    all: 'All Titles', seen: 'Seen', queue: 'Queue', favorites: 'Favorites'
  };

  function setFilter(f) {
    filter = f;
    document.querySelectorAll('[data-filter]').forEach(el =>
      el.classList.toggle('active', el.dataset.filter === f));
    renderCards();
  }

  /* Wire filter controls — sidebar divs and toolbar buttons */
  document.querySelectorAll('[data-filter]').forEach(el => {
    el.addEventListener('click', () => { setFilter(el.dataset.filter); });
    /* Keyboard access for non-button filter items */
    if (el.tagName !== 'BUTTON') {
      el.setAttribute('tabindex', '0');
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter(el.dataset.filter); }
      });
    }
  });

  /* ── Stats — single pass ── */
  function updateStats() {
    let seen = 0, queue = 0, fav = 0;
    movies.forEach(m => {
      if (m.status === STATUS.SEEN)  seen++;
      if (m.status === STATUS.QUEUE) queue++;
      if (m.favorite) fav++;
    });
    statTotal.textContent = movies.length;
    statSeen.textContent  = seen;
    statQueue.textContent = queue;
    statFav.textContent   = fav;
  }

  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  }

  /* Tron-style no-poster placeholder HTML — used site-wide */
  function npcHtml(title, year) {
    return `<div class="npc-inner">
      <div class="npc-glyph">◈</div>
      <div class="npc-title">${escHtml(title)}</div>
      ${year ? `<div class="npc-year">${escHtml(String(year))}</div>` : ''}
    </div>`;
  }

  /* Shared card-top badge markup */
  function cardTopBadges(m) {
    return `
      <span class="card-status-badge ${m.status}">${m.status === STATUS.SEEN ? 'Seen' : 'Queue'}</span>
      ${m.favorite ? '<span class="card-fav-badge">★</span>' : ''}`;
  }

  /* ── Render all cards ── */
  function renderCards() {
    cardsWrap.innerHTML = '';
    const list = filtered();

    if (sectionTitle) sectionTitle.textContent = SECTION_LABELS[filter] || 'All Titles';
    if (sectionCount) sectionCount.textContent = list.length
      ? `${list.length} title${list.length !== 1 ? 's' : ''}` : '';

    if (!list.length) {
      cardsWrap.innerHTML = `
        <div class="empty">
          <div class="empty-glyph">◈</div>
          <div class="empty-text">No titles in this sector</div>
        </div>`;
      return;
    }

    list.forEach((m, idx) => {
      const card = document.createElement('div');
      card.dataset.id = m.id;
      card.style.setProperty('--i', idx);
      buildCard(card, m);
      cardsWrap.appendChild(card);
    });
  }

  /* Update a single card in-place after OMDB enrichment */
  function patchCard(m) {
    const card = cardsWrap.querySelector(`[data-id="${m.id}"]`);
    if (!card) return;
    card.style.removeProperty('--i');
    buildCard(card, m);
    card.classList.add('card-enriched');
  }

  /* ── Build / rebuild a single card element ── */
  function buildCard(card, m) {
    /* Skeleton: title arrived from sheet but OMDB not yet fetched */
    if (!m.enriched) {
      card.className = 'card card-skeleton' + (m.favorite ? ' fav' : '');
      card.setAttribute('role', 'img');
      card.setAttribute('aria-label', m.title + ' — loading');
      card.innerHTML = `
        <div class="card-no-poster-bg"></div>
        <div class="card-overlay"></div>
        <div class="card-top">${cardTopBadges(m)}</div>
        <div class="card-footer">
          <div class="card-footer-head">
            <div class="card-meta-row">
              <div class="card-skeleton-bar w-short"></div>
              <div class="card-skeleton-bar w-tag"></div>
            </div>
            <div class="card-skeleton-bar w-title"></div>
          </div>
        </div>
        <div class="card-corner"></div>`;
      return;
    }

    const hasPoster  = !!m.poster;
    const yearStr    = m.year       ? escHtml(m.year) : '';
    const imdbStr    = m.imdbRating ? `★ ${escHtml(m.imdbRating)}` : '';
    const metaStr    = [yearStr, imdbStr].filter(Boolean).join(' · ');
    const genreFirst = m.genre ? m.genre.split(',')[0].trim() : '';

    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', m.title);

    if (m.corrupted) {
      card.className = 'card card-corrupted' + (m.favorite ? ' fav' : '');
      card.innerHTML = `
        <div class="card-no-poster-bg"></div>
        <div class="card-overlay"></div>
        <div class="card-top">${cardTopBadges(m)}</div>
        <div class="card-footer">
          <div class="card-footer-head">
            <div class="card-corrupted-label">DATA CORRUPTED</div>
            <div class="card-title">${escHtml(m.title)}</div>
          </div>
        </div>
        <div class="card-corner"></div>`;
    } else {
      card.className = 'card' + (m.favorite ? ' fav' : '');
      if (hasPoster) {
        card.style.setProperty('--poster-url', `url("${m.poster}")`);
        // If the poster URL is broken, swap to no-poster layout
        const probe = new Image();
        probe.onerror = () => {
          m.poster = null;
          card.style.removeProperty('--poster-url');
          card.querySelector('.card-bg')?.remove();
          card.querySelector('.card-tint')?.remove();
          card.querySelector('.card-scan')?.remove();
          const bg = document.createElement('div');
          bg.className = 'card-no-poster-bg';
          bg.innerHTML = npcHtml(m.title, m.year);
          card.insertBefore(bg, card.firstChild);
        };
        probe.src = m.poster;
      }

      card.innerHTML = `
        ${hasPoster
          ? `<div class="card-bg"></div><div class="card-tint"></div><div class="card-scan"></div>`
          : `<div class="card-no-poster-bg">${npcHtml(m.title, m.year)}</div>`}
        <div class="card-overlay"></div>
        <div class="card-top">${cardTopBadges(m)}</div>
        <div class="card-footer">
          <div class="card-footer-head">
            <div class="card-meta-row">
              ${metaStr    ? `<span class="card-year-imdb">${metaStr}</span>` : ''}
            </div>
            <div class="card-title-row">
              <div class="card-title">${escHtml(m.title)}</div>
              ${m.plot
                ? `<button class="card-plot-toggle" title="Show synopsis" aria-label="Show synopsis" aria-expanded="false">▸</button>`
                : ''}
            </div>
          </div>
          ${m.plot ? `<div class="card-plot-panel" aria-hidden="true"><p class="card-plot-text">${escHtml(m.plot)}</p></div>` : ''}
        </div>
        <div class="card-corner"></div>`;

      const toggleBtn = card.querySelector('.card-plot-toggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', e => {
          e.stopPropagation();
          const open = card.classList.toggle('plot-open');
          const panel = card.querySelector('.card-plot-panel');
          toggleBtn.textContent = open ? '▾' : '▸';
          toggleBtn.title       = open ? 'Hide synopsis' : 'Show synopsis';
          toggleBtn.setAttribute('aria-expanded', open);
          if (panel) panel.setAttribute('aria-hidden', !open);
        });
      }
    }

    card.addEventListener('click', () => { openDetail(m); });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter') openDetail(m);
    });
  }

  /* ── Detail modal ── */
  const detailOverlay     = document.getElementById('detail-overlay');
  const detailImg         = document.getElementById('detailImg');
  const detailPosterBox   = document.getElementById('detail-poster-box');
  const detailPosterEmpty = document.getElementById('detail-poster-empty');
  const detailTitle       = document.getElementById('detail-title');
  const detailYear        = document.getElementById('detail-year');
  const detailRuntime     = document.getElementById('detail-runtime');
  const detailSubRow      = document.getElementById('detail-sub-row');
  const detailGenre       = document.getElementById('detail-genre');
  const detailDirector    = document.getElementById('detail-director');
  const detailImdb        = document.getElementById('detail-imdb');
  const detailPlot        = document.getElementById('detail-plot');
  const detailActionRow   = document.getElementById('detail-action-row');
  const detailUserMeta    = document.getElementById('detail-user-meta');
  const plotToggleBtn     = document.getElementById('plotToggleBtn');

  function openDetail(m) {
    const hasPoster = !!m.poster;
    detailPosterBox.style.display   = hasPoster ? '' : 'none';
    detailPosterEmpty.style.display = hasPoster ? 'none' : 'flex';
    detailPosterEmpty.innerHTML     = npcHtml(m.title, m.year);
    if (hasPoster) {
      detailImg.onerror = () => {
        detailImg.style.display         = 'none';
        detailPosterBox.style.display   = 'none';
        detailPosterEmpty.style.display = 'flex';
        detailPosterEmpty.innerHTML     = npcHtml(m.title, m.year);
      };
      detailImg.style.display = '';
      detailImg.alt = m.title;
      detailImg.src = m.poster;
    }

    detailTitle.textContent = m.title;
    detailTitle.style.color = m.favorite ? '#ffb300' : '';
    detailYear.textContent  = m.year || '';

    const hasRuntime = !!m.runtime;
    detailRuntime.textContent = hasRuntime ? m.runtime : '';
    detailSubRow.querySelectorAll('.detail-dot').forEach(d =>
      d.style.display = (m.year && hasRuntime) ? '' : 'none');

    if (m.genre) {
      detailGenre.innerHTML = m.genre.split(',')
        .map(g => `<span class="detail-genre-tag">${escHtml(g.trim())}</span>`).join('');
      detailGenre.style.display = '';
    } else {
      detailGenre.innerHTML = '';
      detailGenre.style.display = 'none';
    }

    detailDirector.textContent   = m.director ? 'Dir. ' + escHtml(m.director) : '';
    detailDirector.style.display = m.director ? '' : 'none';

    detailImdb.textContent   = m.imdbRating ? '★ IMDb ' + m.imdbRating : '';
    detailImdb.style.display = m.imdbRating ? '' : 'none';

    detailPlot.textContent = m.plot || 'No summary available.';
    detailPlot.className   = m.plot ? '' : 'no-plot';
    detailPlot.classList.remove('open');
    plotToggleBtn.setAttribute('aria-expanded', 'false');
    plotToggleBtn.textContent = '▸ Synopsis';

    const parts = [
      m.rating ? `<span class="detail-user-rating">Your rating: ${escHtml(m.rating)}</span>` : '',
      m.notes  ? `<span class="detail-user-notes">${escHtml(m.notes)}</span>`  : ''
    ].filter(Boolean);
    detailUserMeta.innerHTML      = parts.join('');
    detailActionRow.style.display = parts.length ? '' : 'none';

    detailOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    /* Reset scroll to top each time modal opens */
    const dWrap = document.getElementById('detail-wrap');
    if (dWrap) dWrap.scrollTop = 0;
    document.getElementById('detailClose').focus();
  }

  plotToggleBtn.addEventListener('click', () => {
    const open = detailPlot.classList.toggle('open');
    plotToggleBtn.setAttribute('aria-expanded', open);
    plotToggleBtn.textContent = open ? '▾ Synopsis' : '▸ Synopsis';
  });

  function closeDetail() {
    detailOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  detailImg.addEventListener('error', () => {
    detailPosterBox.style.display   = 'none';
    detailPosterEmpty.style.display = 'flex';
  });

  document.getElementById('detailClose').addEventListener('click', closeDetail);
  detailOverlay.addEventListener('click', e => { if (e.target === detailOverlay) closeDetail(); });

  /* ── Mobile sidebar ── */
  const menuBtn   = document.getElementById('menuBtn');
  const sbWrap    = document.getElementById('sb-wrap');
  const sbOverlay = document.getElementById('sb-overlay');

  function openSidebar() {
    sbWrap.classList.add('open'); sbOverlay.classList.add('open');
    menuBtn.classList.add('open'); menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    sbWrap.classList.remove('open'); sbOverlay.classList.remove('open');
    menuBtn.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false');
  }

  menuBtn && menuBtn.addEventListener('click', () => {
    FX.click();
    sbWrap.classList.contains('open') ? closeSidebar() : openSidebar();
  });

  /* Intercept clicks in the capture phase (before any element gets them).
     If the sidebar is open and the click is outside it, stop the event
     completely so nothing behind the overlay gets triggered. */
  document.addEventListener('click', e => {
    if (!sbWrap.classList.contains('open')) return;
    if (sbWrap.contains(e.target) || (menuBtn && menuBtn.contains(e.target))) return;
    e.stopImmediatePropagation();
    closeSidebar();
  }, true);

  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', () => { if (window.innerWidth <= 900) closeSidebar(); }));

  /* Swipe left on the sidebar to close it */
  if (sbWrap) {
    let _tx = 0, _ty = 0;
    sbWrap.addEventListener('touchstart', e => {
      _tx = e.touches[0].clientX;
      _ty = e.touches[0].clientY;
    }, { passive: true });
    sbWrap.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _tx;
      const dy = e.changedTouches[0].clientY - _ty;
      if (dx < -50 && Math.abs(dy) < Math.abs(dx)) closeSidebar();
    }, { passive: true });
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  /* ── Refresh button ── */
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('spinning');
      refreshBtn.addEventListener('animationend', () => refreshBtn.classList.remove('spinning'), { once: true });
      movies = [];
      filter = 'all';
      document.querySelectorAll('[data-filter]').forEach(el =>
        el.classList.toggle('active', el.dataset.filter === 'all'));
      loadData();
    });
  }

  /* ── LUCKY DRAW ─────────────────────────────────────────── */
  const luckyOverlay   = document.getElementById('lucky-overlay');
  const luckyArena     = document.getElementById('lucky-arena');
  const luckyCloseBtn  = document.getElementById('luckyClose');
  const luckyDealBtn   = document.getElementById('luckyDealBtn');
  const luckyAgainBtn  = document.getElementById('luckyAgainBtn');
  const luckyResult    = document.getElementById('lucky-result-panel');
  const luckyImg       = document.getElementById('luckyImg');
  const luckyNoPoster  = document.getElementById('lucky-result-no-poster');
  const luckyResTitle  = document.getElementById('lucky-result-title');
  const luckyResMeta   = document.getElementById('lucky-result-meta');
  const luckyResGenre  = document.getElementById('lucky-result-genre');
  const luckyViewBtn   = document.getElementById('luckyViewBtn');
  const luckyPoolLabel = document.getElementById('lucky-pool-label');
  const navLucky       = document.getElementById('navLucky');
  const luckyToolbarBtn = document.getElementById('luckyBtn');

  const LUCKY_CARD_COUNT = 8;
  const ANGLE_PER_CARD   = 360 / LUCKY_CARD_COUNT; // 45°
  const CARD_W = 140, CARD_H = 196;

  /* Scatter destinations — pixel offsets from card centre */
  const SPREADS = [
    { x: -225, y: -125, r: -44 },
    { x:  215, y: -135, r:  38 },
    { x: -258, y:    8, r: -64 },
    { x:  248, y:   12, r:  52 },
    { x: -215, y:  138, r: -22 },
    { x:  205, y:  143, r:  40 },
    { x:    0, y: -182, r:  70 },
    { x:    5, y:  185, r: -60 },
  ];

  let luckyCards    = [];
  let luckyDealing  = false;
  let luckyPicked   = null;
  let luckyCarousel = null;
  let carouselAngle = 0;
  let carouselRAF   = null;
  let luckyRadius   = 215;
  let luckyDealGen  = 0;  // incremented on each deal; lets async chain self-cancel on close

  function stopCarousel() {
    if (carouselRAF) { cancelAnimationFrame(carouselRAF); carouselRAF = null; }
  }

  /* Build a stacked 2-D deck — no carousel yet */
  function buildLuckyDeck() {
    stopCarousel();
    luckyArena.innerHTML = '';
    luckyArena.style.opacity = '';
    luckyArena.style.display = '';
    luckyCards = [];

    // Use smaller cards on narrow screens to fit the reduced arena
    const mobile = window.innerWidth <= 600;
    const deckW  = mobile ? 106 : CARD_W;
    const deckH  = mobile ? 148 : CARD_H;

    for (let i = 0; i < LUCKY_CARD_COUNT; i++) {
      const rot  = (i - LUCKY_CARD_COUNT / 2) * 2.4 + (Math.random() - 0.5) * 1.2;
      const card = document.createElement('div');
      card.className = 'lucky-card';
      card.style.cssText =
        `position:absolute;width:${deckW}px;height:${deckH}px;` +
        `top:50%;left:50%;cursor:pointer;` +
        `transform:translate(-50%,-50%) rotate(${rot.toFixed(1)}deg);` +
        `z-index:${i};`;
      card.dataset.initRot = rot.toFixed(1);
      card.innerHTML = `
        <div class="lucky-card-inner">
          <div class="lucky-card-back">◈</div>
          <div class="lucky-card-front">
            <div class="lf-poster"></div>
            <div class="lf-title">—</div>
          </div>
        </div>`;
      // Tap/click the deck to deal — same as pressing the DEAL button
      card.addEventListener('click', runLuckyDeal);
      luckyArena.appendChild(card);
      luckyCards.push(card);
    }
  }

  function openLucky() {
    const pool = filtered();
    const labels = { all: 'All Titles', seen: 'Seen', queue: 'Queue', favorites: 'Favorites' };
    luckyPoolLabel.textContent =
      `Picking from: ${labels[filter] || 'All'} · ${pool.length} title${pool.length !== 1 ? 's' : ''}`;
    luckyResult.hidden   = true;
    luckyAgainBtn.hidden = true;
    luckyDealBtn.hidden  = false;
    luckyDealBtn.disabled = false;
    buildLuckyDeck();
    luckyOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLucky() {
    stopCarousel();
    luckyDealing = false;
    luckyDealGen++;                                    // cancel any in-flight deal chain
    const kf = document.getElementById('lucky-kf');
    if (kf) kf.remove();                              // clean up injected keyframes
    luckyOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  const luckyWait = ms => new Promise(r => setTimeout(r, ms));

  async function runLuckyDeal() {
    if (luckyDealing) return;
    const pool = filtered();
    if (!pool.length) return;

    luckyDealing = true;
    luckyDealBtn.disabled = true;
    luckyResult.hidden    = true;
    luckyPicked = pool[Math.floor(Math.random() * pool.length)];

    // Cancel-aware wait: throws 'cancelled' if the overlay was closed mid-deal
    const myGen = ++luckyDealGen;
    const wait = ms => new Promise(r => setTimeout(r, ms)).then(() => {
      if (luckyDealGen !== myGen) throw 'cancelled';
    });

    // Scale spreads so scattered cards stay within the arena regardless of screen size.
    // Uses arena width as the primary constraint (most limiting on mobile).
    const spreadScale = Math.min(1, luckyArena.offsetWidth / 680);

    /* ── SCATTER — 3-act keyframe animation per card ────────────────── */
    // Act 1 BURST  (0→22%):  ultra-fast launch, 3D flip, slight overshoot
    // Act 2 DWELL  (30→62%): cards hang at spread — linear slow rotation only,
    //                         position unchanged, long visible "fan" moment
    // Act 3 VORTEX (62→100%): fast clockwise spiral implosion to center.
    //                         Carousel erupts from center immediately after last
    //                         card hits opacity 0 — zero overlap, full continuity.
    const TOTAL_DUR  = 2400; // ms per card — longer, more majestic feel
    const STAGGER_MS = 95;   // ms — graceful cascade stagger

    const oldKf = document.getElementById('lucky-kf');
    if (oldKf) oldKf.remove();
    const kfStyle = document.createElement('style');
    kfStyle.id = 'lucky-kf';

    let kfText = '';
    luckyCards.forEach((c, i) => {
      const sp    = SPREADS[i];
      const r     = sp.x * spreadScale;
      const d     = sp.y * spreadScale;
      const x112  = (r * 1.12).toFixed(2); const y112 = (d * 1.12).toFixed(2); // overshoot peak
      const x94   = (r * 0.94).toFixed(2); const y94  = (d * 0.94).toFixed(2); // spring settle
      // Clockwise vortex: tangent of spread vector (r,d) clockwise = (d,-r)
      // arc midpoint = 34% of spread + 40% clockwise tangent
      const arcX  = (r * 0.34 + d * 0.40).toFixed(2);
      const arcY  = (d * 0.34 - r * 0.40).toFixed(2);
      const x8    = (r * 0.08).toFixed(2); const y8   = (d * 0.08).toFixed(2); // near center
      const ir    = parseFloat(c.dataset.initRot || 0);
      kfText += `
@keyframes lk${i} {
  0%  { transform:translate(-50%,-50%) rotateZ(${ir}deg) rotateY(0deg) scale(1); opacity:1; animation-timing-function:cubic-bezier(0.13,0,0.25,1); }
  16% { transform:translate(calc(-50% + ${x112}px),calc(-50% + ${y112}px)) rotateZ(${sp.r+170}deg) rotateY(90deg) scale(0.95); opacity:1; animation-timing-function:cubic-bezier(0.22,0,0.36,1); }
  22% { transform:translate(calc(-50% + ${x112}px),calc(-50% + ${y112}px)) rotateZ(${sp.r+225}deg) rotateY(180deg) scale(0.93); opacity:1; animation-timing-function:cubic-bezier(0.40,0,0.60,1); }
  30% { transform:translate(calc(-50% + ${x94}px),calc(-50% + ${y94}px)) rotateZ(${sp.r+288}deg) rotateY(360deg) scale(0.92); opacity:1; animation-timing-function:linear; }
  62% { transform:translate(calc(-50% + ${x94}px),calc(-50% + ${y94}px)) rotateZ(${sp.r+340}deg) rotateY(400deg) scale(0.91); opacity:1; animation-timing-function:cubic-bezier(0.44,0,0.80,1); }
  76% { transform:translate(calc(-50% + ${arcX}px),calc(-50% + ${arcY}px)) rotateZ(${sp.r+540}deg) rotateY(448deg) scale(0.73); opacity:0.72; animation-timing-function:cubic-bezier(0.52,0,0.88,1); }
  88% { transform:translate(calc(-50% + ${x8}px),calc(-50% + ${y8}px)) rotateZ(${sp.r+700}deg) rotateY(486deg) scale(0.42); opacity:0.20; animation-timing-function:ease-in; }
  95% { transform:translate(-50%,-50%) rotateZ(${sp.r+775}deg) rotateY(508deg) scale(0.11); opacity:0.04; }
  100%{ transform:translate(-50%,-50%) rotateZ(${sp.r+815}deg) rotateY(518deg) scale(0.02); opacity:0; }
}
@keyframes lk-glow${i} {
  0%  { filter: drop-shadow(0 0 3px rgba(0,255,255,0.30)); }
  14% { filter: drop-shadow(0 0 2px rgba(0,255,255,1)) drop-shadow(0 0 10px rgba(0,255,255,0.80)) drop-shadow(0 0 22px rgba(0,220,255,0.45)); }
  22% { filter: drop-shadow(0 0 6px rgba(0,255,255,0.65)) drop-shadow(0 0 18px rgba(0,210,255,0.35)); }
  30% { filter: drop-shadow(0 0 4px rgba(0,255,255,0.28)); }
  62% { filter: drop-shadow(0 0 4px rgba(0,255,255,0.28)); }
  76% { filter: drop-shadow(0 0 7px rgba(0,255,255,0.55)) drop-shadow(0 0 18px rgba(0,200,255,0.28)); }
  88% { filter: drop-shadow(0 0 10px rgba(0,255,255,0.80)) drop-shadow(0 0 28px rgba(0,200,255,0.40)); }
  95% { filter: drop-shadow(0 0 14px rgba(0,255,255,0.90)) drop-shadow(0 0 38px rgba(0,200,255,0.45)); }
  100%{ filter: none; }
}`;
    });
    kfStyle.textContent = kfText;
    document.head.appendChild(kfStyle);

    const scatterCards = luckyCards.slice();
    luckyCards.forEach((c, i) => {
      const delay = i * STAGGER_MS;
      c.style.transition = 'none';
      // Two simultaneous animations: position/flip path + Tron glow envelope
      c.style.animation  =
        `lk${i} ${TOTAL_DUR}ms ${delay}ms linear forwards,` +
        `lk-glow${i} ${TOTAL_DUR}ms ${delay}ms linear forwards`;
    });

    // Card launch sounds — fire as each card bursts outward
    for (let i = 0; i < LUCKY_CARD_COUNT; i++) {
      setTimeout(() => {
        if (luckyDealGen !== myGen) return;
        FX.cardLaunch(i);
      }, Math.round(i * STAGGER_MS + 35));
    }

    // Per-card impact taps — fire at the vortex arc sweep (80% keyframe) for each card,
    // staggered by each card's animation delay. Each tap appears slightly offset toward
    // that card's spread origin so the positions are distinct (not all on top of each other).
    const tapBase = Math.round(TOTAL_DUR * 0.80); // 1920ms for card 0
    for (let i = 0; i < LUCKY_CARD_COUNT; i++) {
      const sp   = SPREADS[i];
      // 15% of spread offset — near center but spatially distinct per card
      const tapX = (sp.x * spreadScale * 0.15).toFixed(1);
      const tapY = (sp.y * spreadScale * 0.15).toFixed(1);
      setTimeout(() => {
        if (luckyDealGen !== myGen) return;
        const tap = document.createElement('div');
        tap.className = 'lucky-card-tap';
        tap.style.transform = `translate(${tapX}px, ${tapY}px)`;
        // ripple pulse
        const ripple = document.createElement('div');
        ripple.className = 'tap-ripple';
        tap.appendChild(ripple);
        // 9 mini spark streaks per tap hit
        for (let j = 0; j < 9; j++) {
          const ang  = Math.random() * 360;
          const dist = 10 + Math.random() * 22;
          const len  = Math.ceil(4 + Math.random() * 8);
          const dur  = Math.round(140 + Math.random() * 160);
          const rad  = ang * Math.PI / 180;
          const sp   = document.createElement('div');
          sp.className = 'tap-spark';
          sp.style.height = `${len}px`;
          sp.style.top    = `${-(len / 2)}px`;
          sp.style.left   = '-0.5px';
          sp.style.setProperty('--tx',  `${Math.round(dist * Math.cos(rad))}px`);
          sp.style.setProperty('--ty',  `${Math.round(dist * Math.sin(rad))}px`);
          sp.style.setProperty('--rot', `${ang - 90}deg`);
          sp.style.setProperty('--dur', `${dur}ms`);
          tap.appendChild(sp);
        }
        luckyArena.appendChild(tap);
        void tap.offsetHeight;
        tap.classList.add('active');
        FX.tap();
        setTimeout(() => { if (tap.parentNode) tap.remove(); }, 360);
      }, tapBase + i * STAGGER_MS);
    }

    // lastCardEnd = 2400 + 7×95 = 3065ms — last scatter card hits opacity 0.
    // Start carousel at lastCardEnd - 220ms (last card at 95% = opacity 0.04 ≈ invisible).
    const lastCardEnd = TOTAL_DUR + (LUCKY_CARD_COUNT - 1) * STAGGER_MS; // 3065ms
    await wait(lastCardEnd - 220);

    /* ── IMPACT — shockwave at implosion center ──────────────────────── */
    const impact = document.createElement('div');
    impact.className = 'lucky-impact';
    const rF = (lo, hi) => lo + Math.random() * (hi - lo);
    const pal = [
      'rgba(255,255,255,0.95)', 'rgba(255,255,255,0.90)',
      'rgba(0,255,255,0.92)',   'rgba(0,255,255,0.84)',
      'rgba(40,210,255,0.88)',  'rgba(60,180,255,0.80)',
      'rgba(165,230,255,0.64)', 'rgba(200,240,255,0.50)',
    ];
    const brightC = () => pal[Math.floor(Math.random() * 4)];
    const midC    = () => pal[2 + Math.floor(Math.random() * 4)];
    const wispC   = () => pal[6 + Math.floor(Math.random() * 2)];

    // Spark streaks — 1px wide, rotated to face travel direction
    // --rot orients the line along its trajectory so it looks like a streaking spark
    const mkSpark = (ang, dist, dur, del, len) => {
      const el  = document.createElement('div');
      el.className = 'lucky-spark';
      const rad = ang * Math.PI / 180;
      const h   = Math.round(len);
      el.style.height = `${h}px`;
      el.style.top    = `${-(h / 2)}px`;
      el.style.left   = '-0.5px';
      el.style.setProperty('--tx',  `${Math.round(dist * Math.cos(rad))}px`);
      el.style.setProperty('--ty',  `${Math.round(dist * Math.sin(rad))}px`);
      el.style.setProperty('--rot', `${ang - 90}deg`);  // align long axis to travel angle
      el.style.setProperty('--c',   brightC());
      el.style.setProperty('--dur', `${Math.round(dur)}ms`);
      el.style.setProperty('--del', `${Math.round(del)}ms`);
      impact.appendChild(el);
    };

    // Dust blobs — small squares for ember/settling atmosphere
    const mkDust = (ang, dist, dur, del, sz, col) => {
      const el = document.createElement('div');
      el.className = 'lucky-dust';
      const s  = Math.ceil(sz);
      el.style.width  = `${s}px`;
      el.style.height = `${s}px`;
      el.style.top    = `${-(s / 2)}px`;
      el.style.left   = `${-(s / 2)}px`;
      const rad = ang * Math.PI / 180;
      el.style.setProperty('--tx',  `${Math.round(dist * Math.cos(rad))}px`);
      el.style.setProperty('--ty',  `${Math.round(dist * Math.sin(rad))}px`);
      el.style.setProperty('--c',   col);
      el.style.setProperty('--dur', `${Math.round(dur)}ms`);
      el.style.setProperty('--del', `${Math.round(del)}ms`);
      impact.appendChild(el);
    };

    for (let i = 0; i < 22; i++) // fast sparks — long bright streaks flying far
      mkSpark(rF(0,360), rF(52,112), rF(255,445), rF(0,18),  rF(6,14));
    for (let i = 0; i < 8; i++)  // medium sparks — mid range
      mkSpark(rF(0,360), rF(20,54),  rF(310,510), rF(0,30),  rF(4,8));
    for (let i = 0; i < 10; i++) // ember blobs — small squares, mid range
      mkDust(rF(0,360), rF(10,48), rF(340,570), rF(0,40), rF(2,3), midC());
    for (let i = 0; i < 14; i++) // settling dust — wispy specks barely moving
      mkDust(rF(0,360), rF(2,20),  rF(470,940), rF(0,70), 1,       wispC());

    luckyArena.appendChild(impact);
    void impact.offsetHeight;
    impact.classList.add('active');
    FX.impact();
    setTimeout(() => { if (impact.parentNode) impact.remove(); }, 1300);

    /* ── PHASE 5: CASINO SPIN ────────────────────────────────────────── */
    luckyRadius   = Math.min(215, Math.floor(luckyArena.offsetWidth * 0.37));
    luckyCards    = [];

    luckyCarousel = document.createElement('div');
    luckyCarousel.id      = 'lucky-carousel';
    luckyCarousel.style.cssText = 'opacity:0;';
    luckyArena.appendChild(luckyCarousel);

    for (let i = 0; i < LUCKY_CARD_COUNT; i++) {
      const card = document.createElement('div');
      card.className = 'lucky-card';
      card.style.transform = `rotateY(${i * ANGLE_PER_CARD}deg) translateZ(${luckyRadius}px)`;
      card.innerHTML = `
        <div class="lucky-card-inner">
          <div class="lucky-card-back">◈</div>
          <div class="lucky-card-front">
            <div class="lf-poster"></div>
            <div class="lf-title">—</div>
          </div>
        </div>`;
      luckyCarousel.appendChild(card);
      luckyCards.push(card);
    }

    const winnerSlot      = Math.floor(Math.random() * LUCKY_CARD_COUNT);
    const winnerFaceAngle = ((-(winnerSlot * ANGLE_PER_CARD)) % 360 + 360) % 360;
    // 6 full rotations — builds genuine suspense during the long decel
    const spinTarget      = winnerFaceAngle + 6 * 360;
    carouselAngle         = spinTarget;

    let posterBroken = false;
    if (luckyPicked.poster) {
      const probe = new Image();
      probe.onerror = () => { posterBroken = true; };
      probe.src = luckyPicked.poster;
    }

    void luckyCarousel.offsetHeight; // commit opacity:0 before transition

    // Carousel erupts instantly — no fade delay, full velocity from the first frame.
    // The 7× initial velocity of the bezier means it launches from the exact spot
    // the cards just imploded into, reading as one continuous motion.
    luckyCarousel.style.transition =
      `opacity 0.14s ease-out, transform 6.0s cubic-bezier(0.08,0.55,0.18,1)`;
    luckyCarousel.style.opacity   = '1';
    luckyCarousel.style.transform = `rotateY(${spinTarget}deg)`;

    // Schedule carousel tick sounds — bezier solver maps each 45° tick to real time.
    // Throttled to 38ms min so rapid early ticks are audible rather than a blur.
    {
      const bezProg  = u => 3*0.55*u*(1-u)*(1-u) + 3*1.0*u*u*(1-u) + u*u*u;
      const bezTimeAt = p => {
        let lo = 0, hi = 1;
        for (let k = 0; k < 24; k++) { const m=(lo+hi)/2; bezProg(m)<p ? (lo=m) : (hi=m); }
        const u = (lo+hi)/2;
        return 3*0.08*u*(1-u)*(1-u) + 3*0.18*u*u*(1-u) + u*u*u;
      };
      const nTicks = Math.floor(spinTarget / ANGLE_PER_CARD);
      let lastFiredMs = -100;
      for (let k = 1; k <= nTicks; k++) {
        const p = (k * ANGLE_PER_CARD) / spinTarget;
        if (p >= 0.998) break;
        const tickMs = Math.round(bezTimeAt(p) * 6000);
        // Skip if too close to the last fired tick (fast spin)
        if (tickMs - lastFiredMs < 38) continue;
        const interval = tickMs - lastFiredMs;
        lastFiredMs = tickMs;
        // speed 1.0 = fastest audible (38ms apart), 0.0 = nearly stopped (400ms+)
        const speed = Math.min(1, Math.max(0, 1 - (interval - 38) / 362));
        const cMs = tickMs, cSpd = speed;
        setTimeout(() => {
          if (luckyDealGen !== myGen) return;
          FX.carouselTick(cSpd);
        }, cMs);
      }
    }

    // Remove scatter cards 120ms after carousel starts (they're at opacity 0 by now)
    await wait(120);
    scatterCards.forEach(c => c.remove());
    kfStyle.remove();

    await wait(6000 - 120);

    /* ── PHASE 6: TICK STOP — gentle settle ─────────────────────────── */
    const tick = async (extra, ms) => {
      FX.settle();
      luckyCarousel.style.transition = `transform ${ms}ms ease-in-out`;
      luckyCarousel.style.transform  = `rotateY(${carouselAngle + extra}deg)`;
      await wait(ms);
    };
    await tick( 2.2, 110);
    await tick(-1.6, 100);
    await tick( 0.6,  88);
    await tick( 0,    80);

    /* ── PHASE 7: REVEAL POSTER — loaded during spin, no spoilers ─── */
    const winnerCard = luckyCards[winnerSlot];
    const lfPoster   = winnerCard.querySelector('.lf-poster');
    const lfTitle    = winnerCard.querySelector('.lf-title');
    const showTronTitle = () => {
      lfPoster.innerHTML = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:14px;box-sizing:border-box;">
          <div style="color:rgba(0,255,255,0.38);font-size:20px;letter-spacing:4px;line-height:1;">◈</div>
          <div style="color:rgba(0,255,255,0.95);font-size:12px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;text-align:center;line-height:1.45;text-shadow:0 0 10px rgba(0,255,255,0.7),0 0 26px rgba(0,255,255,0.28);">${escHtml(luckyPicked.title)}</div>
          ${luckyPicked.year ? `<div style="color:rgba(0,255,255,0.4);font-size:10px;letter-spacing:2.5px;">${escHtml(String(luckyPicked.year))}</div>` : ''}
        </div>`;
      lfTitle.style.display = 'none';
    };
    if (luckyPicked.poster && !posterBroken) {
      lfPoster.style.backgroundImage = `url("${luckyPicked.poster}")`;
      lfTitle.textContent = luckyPicked.title;
    } else {
      showTronTitle();
    }

    /* ── PHASE 8: POP FORWARD + NEON CHARGE ──────────────────────── */
    winnerCard.style.transition = `transform 0.36s cubic-bezier(0.4,0,0.2,1)`;
    winnerCard.style.transform  =
      `rotateY(${winnerSlot * ANGLE_PER_CARD}deg) translateZ(${luckyRadius + 62}px) scale(1.09)`;
    winnerCard.style.filter =
      'drop-shadow(0 0 14px rgba(0,255,255,0.72)) drop-shadow(0 0 32px rgba(0,255,255,0.34))';

    await wait(800);

    /* ── PHASE 9: FLIP + FLASH ────────────────────────────────────── */
    winnerCard.style.filter = '';
    winnerCard.classList.add('flipped');
    FX.reveal();

    const flash = document.createElement('div');
    flash.className = 'lucky-flash';
    luckyArena.appendChild(flash);
    requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.add('active')));
    flash.addEventListener('animationend', () => flash.remove(), { once: true });

    await wait(2400);

    /* ── PHASE 10: FADE ARENA → RESULT PANEL ─────────────────────── */
    luckyArena.style.transition = 'opacity 0.36s';
    luckyArena.style.opacity    = '0';
    await wait(380);
    luckyArena.style.display = 'none';

    luckyResTitle.textContent = luckyPicked.title;
    const metaParts = [
      luckyPicked.year       || '',
      luckyPicked.runtime    || '',
      luckyPicked.imdbRating ? `★ ${luckyPicked.imdbRating}` : '',
      luckyPicked.favorite   ? '★ Fav' : ''
    ].filter(Boolean);
    luckyResMeta.textContent = metaParts.join(' · ');

    if (luckyPicked.genre) {
      luckyResGenre.innerHTML = luckyPicked.genre.split(',').slice(0, 3)
        .map(g => `<span class="lucky-genre-tag">${escHtml(g.trim())}</span>`).join('');
    } else {
      luckyResGenre.innerHTML = '';
    }

    luckyNoPoster.innerHTML = npcHtml(luckyPicked.title, luckyPicked.year);
    if (luckyPicked.poster && !posterBroken) {
      luckyImg.onerror = () => {
        luckyImg.style.display      = 'none';
        luckyNoPoster.style.display = 'flex';
      };
      luckyImg.src                = luckyPicked.poster;
      luckyImg.style.display      = '';
      luckyNoPoster.style.display = 'none';
    } else {
      luckyImg.style.display      = 'none';
      luckyNoPoster.style.display = 'flex';
    }

    luckyResult.hidden   = false;
    luckyAgainBtn.hidden = false;
    luckyDealing = false;
  }

  /* Wrap the async deal body so any 'cancelled' throw from wait() silently
     terminates the chain without leaving luckyDealing stuck at true */
  const _runLuckyDeal = runLuckyDeal;
  runLuckyDeal = async function() {
    try { await _runLuckyDeal(); }
    catch(e) {
      if (e !== 'cancelled') throw e;
      luckyDealing = false;
    }
  };

  luckyDealBtn.addEventListener('click', runLuckyDeal);

  luckyAgainBtn.addEventListener('click', () => {
    luckyResult.hidden    = true;
    luckyAgainBtn.hidden  = true;
    luckyDealBtn.hidden   = false;
    luckyDealBtn.disabled = false;
    buildLuckyDeck();
  });

  luckyViewBtn.addEventListener('click', () => {
    if (luckyPicked) { closeLucky(); openDetail(luckyPicked); }
  });

  luckyCloseBtn.addEventListener('click', closeLucky);
  luckyOverlay.addEventListener('click', e => { if (e.target === luckyOverlay) closeLucky(); });

  navLucky && navLucky.addEventListener('click', () => {
    if (window.innerWidth <= 900) closeSidebar();
    openLucky();
  });

  luckyToolbarBtn && luckyToolbarBtn.addEventListener('click', openLucky);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && luckyOverlay.classList.contains('open')) closeLucky();
  });

  loadData();

})();
