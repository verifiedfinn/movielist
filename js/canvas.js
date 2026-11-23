/* ============================================================
   THE GRID — canvas.js  v4
   Quiet constellation mesh behind the app:
   • Small points drift very slowly across an ink field
   • Nearby points connect with faint hairlines
   • No glows, no pulses. Static under prefers-reduced-motion
   ============================================================ */

(function () {
  const canvas = document.getElementById('bgCanvas');
  const ctx    = canvas.getContext('2d');

  let W, H, lastTime = 0, mobile = false;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CFG = {
    desktop: { count: 44, connect: 150, speed: [0.03, 0.08] },
    mobile:  { count: 24, connect: 100, speed: [0.02, 0.06] },
  };

  let particles = [];

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    mobile = W < 900;
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    init();
    if (still) draw();
  }

  function init() {
    const c = mobile ? CFG.mobile : CFG.desktop;
    particles = [];
    for (let i = 0; i < c.count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = c.speed[0] + Math.random() * (c.speed[1] - c.speed[0]);
      particles.push({
        x:  Math.random() * W,
        y:  Math.random() * H,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        r:  0.6 + Math.random() * 0.9,
        a:  0.10 + Math.random() * 0.22,
      });
    }
  }

  function draw() {
    ctx.fillStyle = '#07080d';
    ctx.fillRect(0, 0, W, H);

    const cDist = (mobile ? CFG.mobile : CFG.desktop).connect;
    const cSq   = cDist * cDist;

    for (let i = 0; i < particles.length; i++) {
      const pi = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const pj  = particles[j];
        const dx  = pi.x - pj.x;
        const dy  = pi.y - pj.y;
        const dSq = dx * dx + dy * dy;
        if (dSq > cSq) continue;
        const norm = 1 - Math.sqrt(dSq) / cDist;
        ctx.strokeStyle = `rgba(110,200,220,${norm * norm * 0.10})`;
        ctx.lineWidth   = 0.6;
        ctx.beginPath();
        ctx.moveTo(pi.x, pi.y);
        ctx.lineTo(pj.x, pj.y);
        ctx.stroke();
      }
    }

    for (const p of particles) {
      ctx.fillStyle = `rgba(140,215,230,${p.a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const TARGET_MS = 1000 / 30;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastTime < TARGET_MS - 1) return;
    lastTime = now;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -12) p.x = W + 12;
      if (p.x > W + 12) p.x = -12;
      if (p.y < -12) p.y = H + 12;
      if (p.y > H + 12) p.y = -12;
    }
    draw();
  }

  resize();
  window.addEventListener('resize', resize);
  if (!still) requestAnimationFrame(frame);
})();
