/* ============================================================
   THE GRID — canvas.js
   Frame-rate independent via delta time.
   Grid breathes 0.15 → 0.40 on its own cycle.
   Light trails on outer convergence lanes only.
   ============================================================ */

(function () {
  const canvas = document.getElementById('bgCanvas');
  const ctx    = canvas.getContext('2d');

  let W, H, cx, hy;
  let tick = 0;
  let lastTime = 0;
  let gndGrad = null; // cached ground gradient, rebuilt on resize

  /* Global glow pulse: slow, ~33s period */
  const P  = () => 0.76 + 0.24 * Math.sin(tick * 0.20);
  /* Grid breath: 0.15 → 0.40 independent cycle, ~55s period */
  const GB = () => 0.275 + 0.125 * Math.sin(tick * 0.114 - 1.2);

  function resize() {
    W  = canvas.width  = window.innerWidth;
    H  = canvas.height = window.innerHeight;
    cx = W * 0.5;
    hy = H * 0.46;
    gndGrad = null; // invalidate cached gradient
  }
  resize();
  window.addEventListener('resize', resize);

  /* Deterministic RNG — no flicker */
  function rng(n) {
    let x = (n ^ 0xdeadbeef) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
  }

  /* City geometry — built once */
  function buildCity(seed) {
    return Array.from({ length: 18 }, (_, i) => {
      const s = seed + i * 997;
      return {
        relX:   rng(s),
        relW:   0.012 + rng(s + 1) * 0.060,
        relH:   0.10  + rng(s + 2) * 0.80,
        floors: 1     + Math.floor(rng(s + 3) * 6),
        ant:    rng(s + 4) > 0.40,
        antH:   0.06  + rng(s + 5) * 0.22,
      };
    }).sort((a, b) => a.relW - b.relW);
  }

  const CITIES = [buildCity(0xabcdef), buildCity(0x123456)];

  /* Stars — fixed */
  const STARS = Array.from({ length: 60 }, (_, i) => ({
    x: rng(i * 13 + 1),
    y: rng(i * 13 + 2) * 0.88,
    r: 0.35 + rng(i * 13 + 3) * 1.0,
    a: 0.06  + rng(i * 13 + 4) * 0.55,
  }));

  /* ── LIGHT TRAIL SYSTEM ─────────────────────────────────────
     Trails only spawn on outer lanes (away from centre vanishing
     point) so they have clear lateral movement.                */
  const vN = 24;
  const MAX_TRAILS = 2;
  const trails = [];

  /* Eligible lanes: outer third on each side */
  const outerLanes = [];
  for (let i = 1; i < vN; i++) {
    const distFromCentre = Math.abs(i - vN / 2) / (vN / 2);
    if (distFromCentre > 0.40) outerLanes.push(i);
  }

  function spawnTrail() {
    if (trails.length >= MAX_TRAILS) return;
    const used = new Set(trails.map(t => t.lane));
    const avail = outerLanes.filter(l => !used.has(l));
    if (!avail.length) return;
    const lane = avail[Math.floor(Math.random() * avail.length)];
    trails.push({
      lane,
      progress: 0,
      speed:    0.007 + Math.random() * 0.005,
      tailLen:  0.20  + Math.random() * 0.12,
    });
  }

  /* Perspective helpers */
  function trailX(lane, t) {
    return cx + ((lane / vN) * W - cx) * t;
  }
  function trailY(t) {
    return hy + Math.pow(t, 1.85) * (H - hy);
  }

  function drawTrail(tr, p) {
    const head = tr.progress;
    const tail = Math.max(0, head - tr.tailLen);
    const STEPS = 18;

    for (let s = 0; s < STEPS; s++) {
      const t0   = tail + (head - tail) * (s / STEPS);
      const t1   = tail + (head - tail) * ((s + 1) / STEPS);
      const frac = s / STEPS;
      const a    = Math.pow(frac, 1.6) * 0.88 * p;
      ctx.strokeStyle = `rgba(0,255,255,${a})`;
      ctx.lineWidth   = 0.5 + frac * 2.2;
      ctx.beginPath();
      ctx.moveTo(trailX(tr.lane, t0), trailY(t0));
      ctx.lineTo(trailX(tr.lane, t1), trailY(t1));
      ctx.stroke();
    }

    /* Head glow — single save/restore */
    const hx = trailX(tr.lane, head);
    const hy2 = trailY(head);
    ctx.save();
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur  = 20 * p;
    ctx.fillStyle   = `rgba(255,255,255,${0.92 * p})`;
    ctx.beginPath(); ctx.arc(hx, hy2, 2.0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur  = 35 * p;
    ctx.fillStyle   = `rgba(0,255,255,${0.70 * p})`;
    ctx.beginPath(); ctx.arc(hx, hy2, 3.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function updateTrails() {
    if (Math.random() < 0.003) spawnTrail();
    for (let i = trails.length - 1; i >= 0; i--) {
      trails[i].progress += trails[i].speed;
      if (trails[i].progress > 1.06) trails.splice(i, 1);
    }
  }

  function drawCity(buildings, x0, x1, maxH, p) {
    const lw = x1 - x0;
    for (const b of buildings) {
      const bx = x0 + b.relX * lw;
      const bw = b.relW * lw;
      const bh = b.relH * maxH;
      const by = hy - bh;

      ctx.fillStyle = 'rgba(0,3,8,0.95)';
      ctx.fillRect(bx, by, bw, bh);

      ctx.fillStyle = `rgba(0,255,255,${0.75 * p})`;
      ctx.fillRect(bx, by, bw, 1.5);

      ctx.fillStyle = `rgba(0,200,255,${0.12 * p})`;
      ctx.fillRect(bx,          by, 1, bh);
      ctx.fillRect(bx + bw - 1, by, 1, bh);

      for (let f = 1; f < b.floors; f++) {
        const fy = by + (f / b.floors) * bh;
        ctx.fillStyle = `rgba(0,180,255,${0.08 * p})`;
        ctx.fillRect(bx, fy, bw, 0.7);
      }

      if (b.ant) {
        const ax = bx + bw * 0.5;
        const ah = bh * b.antH;
        ctx.strokeStyle = `rgba(0,220,255,${0.28 * p})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(ax, by); ctx.lineTo(ax, by - ah); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.90 * p})`;
        ctx.beginPath(); ctx.arc(ax, by - ah, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(0,255,255,${0.70 * p})`;
        ctx.beginPath(); ctx.arc(ax, by - ah, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  const TARGET_MS = 1000 / 30; // cap at 30fps
  function frame(now) {
    requestAnimationFrame(frame);
    /* Skip frame if we're running faster than 30fps */
    const elapsed = now - lastTime;
    if (elapsed < TARGET_MS - 1) return;
    const dt = Math.min(elapsed * 0.001, 0.050);
    lastTime = now;
    tick += dt;

    ctx.clearRect(0, 0, W, H);
    const p  = P();
    const gb = GB();

    /* Sky */
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, hy);

    /* Stars */
    for (const s of STARS) {
      ctx.fillStyle = `rgba(210,245,255,${s.a * (0.55 + 0.45 * p)})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * hy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Ground — gradient cached, only rebuilt on resize */
    if (!gndGrad) {
      gndGrad = ctx.createLinearGradient(0, hy, 0, H);
      gndGrad.addColorStop(0,    '#001e34');
      gndGrad.addColorStop(0.10, '#000e1c');
      gndGrad.addColorStop(0.45, '#000610');
      gndGrad.addColorStop(1,    '#000000');
    }
    ctx.fillStyle = gndGrad;
    ctx.fillRect(0, hy, W, H - hy);

    /* ── HORIZONTAL GRID LINES — breathing 0.15 → 0.40 ── */
    const hN = 22;
    ctx.save();
    for (let i = 1; i <= hN; i++) {
      const t  = Math.pow(i / hN, 1.85);
      const y  = hy + t * (H - hy);
      const br = Math.pow(1 - t, 1.2);
      const a  = br * gb + 0.004;
      ctx.strokeStyle = `rgba(0,255,255,${a})`;
      ctx.lineWidth   = br * 1.4 + 0.2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();

    /* ── VERTICAL CONVERGENCE LINES ── */
    for (let i = 0; i <= vN; i++) {
      const xB = (i / vN) * W;
      const ef  = Math.sin((i / vN) * Math.PI);
      ctx.strokeStyle = `rgba(0,255,255,${gb * 0.72 * ef})`;
      ctx.lineWidth   = 0.5;
      ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(xB, H); ctx.stroke();
    }

    /* Cities */
    const margin = W * 0.04;
    const inner  = cx  * 0.68;
    const maxH   = hy  * 0.84;
    drawCity(CITIES[0], margin,    inner,      maxH, p);
    drawCity(CITIES[1], W - inner, W - margin, maxH, p);

    /* ── LIGHT TRAILS ── */
    updateTrails();
    for (const tr of trails) drawTrail(tr, p);

    /* ── HORIZON GLOW — three layers ── */
    const hg1 = ctx.createRadialGradient(cx, hy, 0, cx, hy, W * 0.85);
    hg1.addColorStop(0,    `rgba(0,65,105,${0.62 * p})`);
    hg1.addColorStop(0.35, `rgba(0,30,58,${0.28 * p})`);
    hg1.addColorStop(0.68, `rgba(0,10,22,${0.10 * p})`);
    hg1.addColorStop(1,    'transparent');
    ctx.fillStyle = hg1;
    ctx.fillRect(0, hy - 320, W, 640);

    const hg2 = ctx.createRadialGradient(cx, hy, 0, cx, hy, W * 0.36);
    hg2.addColorStop(0,    `rgba(0,255,255,${0.38 * p})`);
    hg2.addColorStop(0.40, `rgba(0,200,255,${0.14 * p})`);
    hg2.addColorStop(1,    'transparent');
    ctx.fillStyle = hg2;
    ctx.fillRect(0, hy - 170, W, 340);

    const hg3 = ctx.createRadialGradient(cx, hy, 0, cx, hy, 120);
    hg3.addColorStop(0,    `rgba(255,255,255,${0.55 * p})`);
    hg3.addColorStop(0.25, `rgba(0,255,255,${0.35 * p})`);
    hg3.addColorStop(0.60, `rgba(0,200,255,${0.12 * p})`);
    hg3.addColorStop(1,    'transparent');
    ctx.fillStyle = hg3;
    ctx.fillRect(cx - 120, hy - 120, 240, 240);

    /* ── HORIZON LINE ── */
    ctx.save();
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur  = 22;
    ctx.strokeStyle = `rgba(200,255,255,${0.95 * p})`;
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();
    ctx.restore();

    /* ── CENTRE RUNWAY BEAM ── */
    const rw = ctx.createLinearGradient(cx, hy, cx, H);
    rw.addColorStop(0,    `rgba(0,255,255,${0.26 * p})`);
    rw.addColorStop(0.28, 'rgba(0,200,255,0.06)');
    rw.addColorStop(1,    'transparent');
    ctx.fillStyle = rw;
    ctx.beginPath();
    ctx.moveTo(cx, hy);
    ctx.lineTo(cx + W * 0.20, H);
    ctx.lineTo(cx - W * 0.20, H);
    ctx.closePath();
    ctx.fill();

  }

  requestAnimationFrame(frame);
})();
