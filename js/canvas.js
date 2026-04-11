/* ============================================================
   THE GRID — canvas.js  v3
   Drifting constellation mesh:
   • Small particles float slowly across a near-black field
   • Nearby particles connect with faint lines
   • A handful of bright nodes pulse with glow
   • Occasional "pulse" travels along a connection
   • Mobile: fewer particles, shorter connect range
   ============================================================ */

(function () {
  const canvas = document.getElementById('bgCanvas');
  const ctx    = canvas.getContext('2d');

  let W, H, tick = 0, lastTime = 0, mobile = false;

  /* ── Config ── */
  const CFG = {
    desktop: { count: 68, bright: 8,  connect: 180, speed: [0.06, 0.22] },
    mobile:  { count: 34, bright: 4,  connect: 110, speed: [0.05, 0.16] },
  };

  let particles = [];
  let pulseQueue = [];   // travelling pulses along edges

  /* ── Resize ── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    mobile = W < 900;
    init();
  }

  /* ── Init / reinit particles ── */
  function init() {
    const c = mobile ? CFG.mobile : CFG.desktop;
    particles = [];
    for (let i = 0; i < c.count; i++) {
      const isBright = i < c.bright;
      const angle = Math.random() * Math.PI * 2;
      const spd   = c.speed[0] + Math.random() * (c.speed[1] - c.speed[0]);
      particles.push({
        x:      Math.random() * W,
        y:      Math.random() * H,
        vx:     Math.cos(angle) * spd,
        vy:     Math.sin(angle) * spd,
        r:      isBright ? 1.8 + Math.random() * 1.4 : 0.7 + Math.random() * 1.0,
        bright: isBright,
        /* slow independent pulse per particle */
        phA:   Math.random() * Math.PI * 2,
        phB:   Math.random() * Math.PI * 2,
        spdA:  0.25 + Math.random() * 0.55,
        spdB:  0.15 + Math.random() * 0.35,
        baseA: isBright ? 0.55 + Math.random() * 0.35 : 0.08 + Math.random() * 0.22,
      });
    }
    pulseQueue = [];
  }

  resize();
  window.addEventListener('resize', resize);

  /* ── Pulse system ──
     A pulse travels from particle A to B over ~1–2 s, leaving
     a bright trace on the edge. Spawned rarely so it reads as
     "data flowing" rather than noise.                         */
  function maybeSpawnPulse() {
    if (pulseQueue.length >= (mobile ? 1 : 3)) return;
    if (Math.random() > 0.004) return;
    const c    = mobile ? CFG.mobile : CFG.desktop;
    const cSq  = c.connect * c.connect;
    const a    = Math.floor(Math.random() * particles.length);
    const pa   = particles[a];
    /* find a connected neighbour */
    let best = -1, bestD = Infinity;
    for (let b = 0; b < particles.length; b++) {
      if (b === a) continue;
      const dx = pa.x - particles[b].x, dy = pa.y - particles[b].y;
      const d  = dx*dx + dy*dy;
      if (d < cSq && d < bestD) { bestD = d; best = b; }
    }
    if (best < 0) return;
    pulseQueue.push({
      from:  a,
      to:    best,
      t:     0,
      speed: 0.45 + Math.random() * 0.35,
    });
  }

  /* ── Frame loop ── */
  const TARGET_MS = 1000 / 30;

  function frame(now) {
    requestAnimationFrame(frame);
    const elapsed = now - lastTime;
    if (elapsed < TARGET_MS - 1) return;
    const dt = Math.min(elapsed * 0.001, 0.05);
    lastTime  = now;
    tick     += dt;

    /* update particles */
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -12) p.x = W + 12;
      if (p.x > W + 12) p.x = -12;
      if (p.y < -12) p.y = H + 12;
      if (p.y > H + 12) p.y = -12;
    }

    /* update pulses */
    maybeSpawnPulse();
    for (let i = pulseQueue.length - 1; i >= 0; i--) {
      pulseQueue[i].t += pulseQueue[i].speed * dt;
      if (pulseQueue[i].t > 1.0) pulseQueue.splice(i, 1);
    }

    /* ── draw ── */
    ctx.clearRect(0, 0, W, H);

    /* background: pure black with a very faint teal breath at bottom */
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const ambA = 0.03 + 0.012 * Math.sin(tick * 0.14);
    const amb  = ctx.createRadialGradient(W * 0.5, H * 1.1, 0, W * 0.5, H * 0.5, H * 1.0);
    amb.addColorStop(0,   `rgba(0,60,90,${ambA * 3})`);
    amb.addColorStop(0.4, `rgba(0,20,40,${ambA})`);
    amb.addColorStop(1,   'transparent');
    ctx.fillStyle = amb;
    ctx.fillRect(0, 0, W, H);

    const cfg   = mobile ? CFG.mobile : CFG.desktop;
    const cDist = cfg.connect;
    const cSq   = cDist * cDist;

    /* ── connection lines ── */
    for (let i = 0; i < particles.length; i++) {
      const pi = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const pj  = particles[j];
        const dx  = pi.x - pj.x;
        const dy  = pi.y - pj.y;
        const dSq = dx*dx + dy*dy;
        if (dSq > cSq) continue;
        const norm = 1 - Math.sqrt(dSq) / cDist;
        const a    = norm * norm * 0.22;
        ctx.strokeStyle = `rgba(0,190,255,${a})`;
        ctx.lineWidth   = norm * 0.8;
        ctx.beginPath();
        ctx.moveTo(pi.x, pi.y);
        ctx.lineTo(pj.x, pj.y);
        ctx.stroke();
      }
    }

    /* ── travelling pulse traces ── */
    for (const pu of pulseQueue) {
      const pa = particles[pu.from];
      const pb = particles[pu.to];
      /* head position */
      const hx = pa.x + (pb.x - pa.x) * pu.t;
      const hy = pa.y + (pb.y - pa.y) * pu.t;
      /* tail fades back 30% of the edge */
      const tailT = Math.max(0, pu.t - 0.30);
      const tx    = pa.x + (pb.x - pa.x) * tailT;
      const ty    = pa.y + (pb.y - pa.y) * tailT;

      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, 'transparent');
      g.addColorStop(1, `rgba(0,255,255,${0.85 * (1 - pu.t * 0.5)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      /* head spark */
      ctx.save();
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur  = mobile ? 8 : 14;
      ctx.fillStyle   = `rgba(200,255,255,${0.9 * (1 - pu.t * 0.4)})`;
      ctx.beginPath();
      ctx.arc(hx, hy, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* ── particles ── */
    for (const p of particles) {
      const pulse = 0.65 + 0.35 * Math.sin(tick * p.spdA + p.phA)
                         * (0.7 + 0.3 * Math.sin(tick * p.spdB + p.phB));
      const a = p.baseA * pulse;

      if (p.bright) {
        /* outer halo */
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 8);
        halo.addColorStop(0,   `rgba(0,220,255,${a * 0.30})`);
        halo.addColorStop(0.4, `rgba(0,180,255,${a * 0.08})`);
        halo.addColorStop(1,   'transparent');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 8, 0, Math.PI * 2);
        ctx.fill();

        /* inner glow */
        ctx.save();
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur  = 10 * pulse;
        ctx.fillStyle   = `rgba(180,245,255,${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = `rgba(0,200,255,${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  requestAnimationFrame(frame);
})();
