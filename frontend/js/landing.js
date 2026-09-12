/* ============================================================
   AquaGrid v2 — Landing: animated globe + floating particles,
   scroll reveal, and the cinematic dive into the dashboard.
   ============================================================ */
(function (global) {
  'use strict';

  const canvas = document.getElementById('landing-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  let W, H, raf, t = 0;
  const stars = [], motes = [];

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = innerWidth * dpr;
    H = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    stars.length = 0; motes.length = 0;
    for (let i = 0; i < 140; i++) stars.push({ x: Math.random()*innerWidth, y: Math.random()*innerHeight, r: Math.random()*1.4+0.2, a: Math.random() });
    for (let i = 0; i < 46; i++) motes.push({ x: Math.random()*innerWidth, y: Math.random()*innerHeight, vx:(Math.random()-.5)*0.25, vy:(Math.random()-.5)*0.25, r: Math.random()*2.4+1 });
  }

  function globe(cx, cy, R) {
    // glow
    const g = ctx.createRadialGradient(cx, cy, R*0.2, cx, cy, R*1.5);
    g.addColorStop(0, 'rgba(25,198,200,0.20)');
    g.addColorStop(1, 'rgba(25,198,200,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R*1.5, 0, Math.PI*2); ctx.fill();

    // sphere
    const s = ctx.createRadialGradient(cx - R*0.3, cy - R*0.3, R*0.1, cx, cy, R);
    s.addColorStop(0, '#0c2f45'); s.addColorStop(1, '#050f1c');
    ctx.fillStyle = s; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(98,230,255,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();

    // rotating lat/long grid
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.clip();
    ctx.strokeStyle = 'rgba(25,198,200,0.28)'; ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) { // latitudes
      const yy = cy + (i/3.4)*R;
      const rx = R * Math.sqrt(Math.max(0, 1 - Math.pow((yy-cy)/R,2)));
      ctx.beginPath(); ctx.ellipse(cx, yy, rx, rx*0.16, 0, 0, Math.PI*2); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) { // longitudes rotate
      const ph = t*0.006 + i*Math.PI/8;
      const w = Math.cos(ph)*R;
      ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(w), R, 0, 0, Math.PI*2); ctx.stroke();
    }
    // a suggestion of the Indian subcontinent landmass
    ctx.fillStyle = 'rgba(46,204,113,0.22)';
    const lx = cx + Math.cos(t*0.006)*R*0.15;
    ctx.beginPath(); ctx.ellipse(lx, cy+R*0.1, R*0.28, R*0.4, 0.3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function frame() {
    if (!ctx) return;
    t++;
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    // stars
    stars.forEach(st => { st.a += 0.02; ctx.globalAlpha = 0.4 + Math.sin(st.a)*0.35; ctx.fillStyle = '#8fd8ff'; ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI*2); ctx.fill(); });
    ctx.globalAlpha = 1;

    // globe centered upper area
    const cx = innerWidth*0.5, cy = innerHeight*0.42, R = Math.min(innerWidth, innerHeight)*0.24;
    globe(cx, cy, R);

    // floating motes
    motes.forEach(m => {
      m.x += m.vx; m.y += m.vy;
      if (m.x<0||m.x>innerWidth) m.vx*=-1;
      if (m.y<0||m.y>innerHeight) m.vy*=-1;
      ctx.fillStyle = 'rgba(98,230,255,0.5)'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI*2); ctx.fill();
    });

    // wave bands near bottom
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(25,198,200,${0.16 - b*0.04})`;
      ctx.lineWidth = 2;
      const yBase = innerHeight*0.82 + b*26;
      for (let x = 0; x <= innerWidth; x += 8) {
        const y = yBase + Math.sin(x*0.012 + t*0.03 + b)*10;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    raf = requestAnimationFrame(frame);
  }

  function start() { if (!raf && ctx) { resize(); seed(); frame(); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }
  window.addEventListener('resize', () => { if (raf) { resize(); seed(); } });

  // Scroll reveal
  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); }), { threshold: 0.15 });
    els.forEach(el => io.observe(el));
  }

  global.AQ_LANDING = { start, stop, initReveal };
})(window);
