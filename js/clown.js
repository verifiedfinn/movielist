/* Burnaby clown greeting. Plays once ever per browser for visitors whose
   IP geolocates to Burnaby, BC. Force it with ?clown=1 to test. */
(() => {
  const force = /[?&]clown=1\b/.test(location.search);
  if (!force && localStorage.getItem('clowned')) return;

  function honk() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.32].forEach(t => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(420, ac.currentTime + t);
        o.frequency.exponentialRampToValueAtTime(260, ac.currentTime + t + 0.22);
        g.gain.setValueAtTime(0.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.25);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.3);
      });
    } catch {}
  }

  function play() {
    localStorage.setItem('clowned', '1');
    const css = document.createElement('style');
    css.textContent = `
      #clown-ov{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;
        align-items:center;justify-content:center;background:rgba(0,0,0,.82);cursor:pointer;
        animation:clownFade .3s ease-out;font-family:inherit;overflow:hidden}
      #clown-ov .cl-face{font-size:min(42vw,260px);line-height:1;
        animation:clownIn 1s cubic-bezier(.2,1.6,.4,1) both, clownWob 1.1s 1s ease-in-out infinite}
      #clown-ov .cl-txt{margin-top:18px;color:#ff3b6b;font-size:clamp(18px,6.5vw,44px);font-weight:900;
        letter-spacing:.06em;text-transform:uppercase;text-align:center;padding:0 16px;
        text-shadow:0 0 12px #ff3b6b,0 0 30px #ffd600;animation:clownTxt .5s .6s both}
      #clown-ov .cl-sub{margin-top:10px;color:#ffd600;font-size:clamp(11px,3vw,15px);
        letter-spacing:.14em;opacity:.8;text-align:center;padding:0 16px;animation:clownTxt .5s 1s both}
      #clown-ov .cl-b{position:absolute;bottom:-60px;font-size:40px;animation:clownUp linear forwards}
      @keyframes clownFade{from{opacity:0}}
      @keyframes clownIn{0%{transform:scale(0) rotate(-540deg)}100%{transform:scale(1) rotate(0)}}
      @keyframes clownWob{0%,100%{transform:rotate(-8deg) scale(1)}50%{transform:rotate(8deg) scale(1.06)}}
      @keyframes clownTxt{from{opacity:0;transform:translateY(20px) scale(.6)}}
      @keyframes clownUp{to{transform:translateY(-120vh) rotate(var(--r))}}
      @media (prefers-reduced-motion:reduce){#clown-ov *{animation-duration:.01s!important}}`;
    document.head.appendChild(css);

    const ov = document.createElement('div');
    ov.id = 'clown-ov';
    ov.innerHTML = `<div class="cl-face">🤡</div>
      <div class="cl-txt">Burnaby Detected</div>
      <div class="cl-sub">HONK HONK // TAP TO CONTINUE</div>`;
    const bits = ['🎈', '🎈', '🎉', '🤡', '🎪', '🎈'];
    for (let i = 0; i < 18; i++) {
      const b = document.createElement('span');
      b.className = 'cl-b';
      b.textContent = bits[i % bits.length];
      b.style.left = Math.random() * 100 + 'vw';
      b.style.animationDuration = 3 + Math.random() * 3 + 's';
      b.style.animationDelay = Math.random() * 1.5 + 's';
      b.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      ov.appendChild(b);
    }
    const close = () => { ov.style.transition = 'opacity .3s'; ov.style.opacity = '0'; setTimeout(() => ov.remove(), 300); };
    ov.addEventListener('click', () => { honk(); setTimeout(close, 450); });
    document.body.appendChild(ov);
    honk(); // browsers may block sound until the first tap; the tap honks too
    setTimeout(close, 7000);
  }

  if (force) return void (document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', play) : play());

  fetch('/api/geo').then(r => r.ok ? r.json() : null).then(g => {
    if (g && /^burnaby$/i.test(g.city)) play();
  }).catch(() => {});
})();
