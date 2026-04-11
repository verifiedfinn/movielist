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
    cTime.textContent = [h, d.getMinutes(), d.getSeconds()]
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

  async function fetchOMDB(title) {
    const url = OMDB_BASE + '?' +
      new URLSearchParams({ t: title, apikey: OMDB_KEY, plot: 'short' });
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      return d.Response === 'True' ? d : null;
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
      const resp = await fetch(SHEETS_URL);
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
    el.addEventListener('click', () => setFilter(el.dataset.filter));
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
      if (hasPoster) card.style.setProperty('--poster-url', `url("${m.poster}")`);

      card.innerHTML = `
        ${hasPoster
          ? `<div class="card-bg"></div><div class="card-tint"></div><div class="card-scan"></div>`
          : `<div class="card-no-poster-bg"></div>`}
        <div class="card-overlay"></div>
        <div class="card-top">${cardTopBadges(m)}</div>
        <div class="card-footer">
          <div class="card-footer-head">
            <div class="card-meta-row">
              ${metaStr    ? `<span class="card-year-imdb">${metaStr}</span>` : ''}
              ${genreFirst ? `<span class="card-genre-tag">${escHtml(genreFirst)}</span>` : ''}
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

    card.addEventListener('click', () => openDetail(m));
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
    if (hasPoster) { detailImg.src = ''; detailImg.src = m.poster; detailImg.alt = m.title; }

    detailTitle.textContent = m.title;
    detailTitle.style.color = m.favorite ? '#ffb300' : '';
    detailYear.textContent  = m.year || '';

    const hasRuntime = !!m.runtime;
    detailRuntime.textContent = hasRuntime ? m.runtime : '';
    detailSubRow.querySelectorAll('.detail-dot').forEach(d =>
      d.style.display = (m.year && hasRuntime) ? '' : 'none');

    detailGenre.textContent   = m.genre || '';
    detailGenre.style.display = m.genre ? '' : 'none';

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
    document.getElementById('detailClose').focus();
  }

  plotToggleBtn.addEventListener('click', () => {
    const open = detailPlot.classList.toggle('open');
    plotToggleBtn.setAttribute('aria-expanded', open);
    plotToggleBtn.textContent = open ? '▾ Synopsis' : '▸ Synopsis';
  });

  function closeDetail() { detailOverlay.classList.remove('open'); }

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

  menuBtn   && menuBtn.addEventListener('click', () =>
    sbWrap.classList.contains('open') ? closeSidebar() : openSidebar());
  sbOverlay && sbOverlay.addEventListener('click', closeSidebar);
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', () => { if (window.innerWidth <= 900) closeSidebar(); }));

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  loadData();

})();
