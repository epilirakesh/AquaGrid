/* ============================================================
   AquaGrid v2 — Windy-style ocean current particle field
   Curved streamlines (each particle keeps a trail history),
   velocity-based color, adjustable speed + density.
   ============================================================ */
(function (global) {
  'use strict';

  function ParticleField(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.particles = [];
    this.baseCount = 2400;
    this.density = 1;
    this.playing = true;
    this.speedMul = 1;
    this.opacity = 1;
    this.date = '2025-01-01';
    this.raf = null;
    this._seed = 1;
    this.resize();
  }

  ParticleField.prototype.resize = function () {
    const b = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = b.width * dpr;
    this.canvas.height = b.height * dpr;
    this.canvas.style.width = b.width + 'px';
    this.canvas.style.height = b.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = b.width; this.h = b.height;
    this.respawn();
  };

  ParticleField.prototype.respawn = function () {
    this._roi = this.roiBox();
    const n = Math.round(this.baseCount * this.density);
    this.particles = [];
    for (let i = 0; i < n; i++) this.particles.push(this.spawn());
  };
  // Refresh cached ROI screen-box (call on map move/zoom/resize).
  ParticleField.prototype.refreshBounds = function () { this._roi = this.roiBox(); };
  ParticleField.prototype.setDensity = function (d) { this.density = d; this.respawn(); };

  // On-screen bounding box of the region of interest (recomputed cheaply so
  // spawning is concentrated inside the ROI at any zoom / pan).
  ParticleField.prototype.roiBox = function () {
    if (!this.map || !global.AQ_DATA || !AQ_DATA.ROI) return { x0:0, y0:0, x1:this.w, y1:this.h };
    let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
    AQ_DATA.ROI[0].forEach(([lng,lat]) => {
      const p = this.map.project([lng,lat]);
      if (p.x<x0)x0=p.x; if (p.y<y0)y0=p.y; if (p.x>x1)x1=p.x; if (p.y>y1)y1=p.y;
    });
    // clamp to canvas
    x0=Math.max(0,x0); y0=Math.max(0,y0); x1=Math.min(this.w,x1); y1=Math.min(this.h,y1);
    if (x1<=x0||y1<=y0) return { x0:0, y0:0, x1:this.w, y1:this.h };
    return { x0, y0, x1, y1 };
  };

  // Spawn only inside the region of interest. Sample within the ROI's screen
  // bbox and confirm the point is truly inside; retry generously.
  ParticleField.prototype.spawn = function () {
    const b = this._roi || (this._roi = this.roiBox());
    for (let t = 0; t < 30; t++) {
      const x = b.x0 + Math.random()*(b.x1-b.x0);
      const y = b.y0 + Math.random()*(b.y1-b.y0);
      if (this.overWater(x, y)) return { x, y, age: Math.random()*80, life: 70+Math.random()*90, trail: [] };
    }
    // fallback: park just off-screen so it is culled next frame (no land draw)
    return { x:-9999, y:-9999, age: 999, life: 0, trail: [] };
  };

  // Is the given screen point inside the offshore region of interest?
  // Currents render ONLY here — this is water AND the study area, so no
  // streamlines ever appear on land or in open sea outside the ROI.
  ParticleField.prototype.overWater = function (x, y) {
    if (!this.map) return true;
    const ll = this.map.unproject([x, y]);
    if (global.AQ_DATA && AQ_DATA.inRegion) return AQ_DATA.inRegion(ll.lng, ll.lat);
    if (global.AQ_COAST && AQ_COAST.isWater) return AQ_COAST.isWater(ll.lng, ll.lat);
    return true;
  };

  ParticleField.prototype.setDate = function (d) {
    this.date = d;
    const dt = new Date(d);
    this._seed = (dt.getFullYear()*100 + dt.getMonth()*8 + dt.getDate()*0.3) * 0.017;
  };

  // curved vector field sampled in geographic space so flow follows the map
  ParticleField.prototype.sample = function (x, y) {
    if (!this.map) return { vx:0.3, vy:-0.1, spd:0.2 };
    const ll = this.map.unproject([x, y]);
    const s = this._seed;
    const a = Math.sin(ll.lng*0.6*Math.PI + s) * Math.cos(ll.lat*0.6*Math.PI + s*1.3)
            + 0.4*Math.sin(ll.lat*1.4 + s*0.7);
    const ang = a * Math.PI + Math.PI*0.85;
    const spd = 0.05 + Math.abs(Math.sin(ll.lng*1.2 + ll.lat*0.8 + s))*0.62;
    return { vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, spd };
  };

  ParticleField.prototype.color = function (spd) { return AQ_DATA.speedColor(spd); };

  ParticleField.prototype.step = function () {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.playing) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    const mul = this.speedMul, scale = 95, TRAIL = 10;
    for (const p of this.particles) {
      // if the particle has drifted onto land, respawn it over water and skip
      if (!this.overWater(p.x, p.y)) { Object.assign(p, this.spawn()); continue; }

      const v = this.sample(p.x, p.y);
      p.x += v.vx * scale * mul * 0.055;
      p.y += v.vy * scale * mul * 0.055;
      p.age++;
      p.trail.push([p.x, p.y]);
      if (p.trail.length > TRAIL) p.trail.shift();

      const col = this.color(v.spd);
      ctx.strokeStyle = col;
      ctx.lineWidth = 0.9 + v.spd*1.9;
      for (let i = 1; i < p.trail.length; i++) {
        ctx.globalAlpha = this.opacity * (i / p.trail.length) * 0.82;
        ctx.beginPath();
        ctx.moveTo(p.trail[i-1][0], p.trail[i-1][1]);
        ctx.lineTo(p.trail[i][0], p.trail[i][1]);
        ctx.stroke();
      }
      if (p.age > p.life || p.x<-25 || p.x>this.w+25 || p.y<-25 || p.y>this.h+25) Object.assign(p, this.spawn());
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  ParticleField.prototype.start = function () { if (this.raf) return; const loop=()=>{ this.step(); this.raf=requestAnimationFrame(loop); }; this.raf=requestAnimationFrame(loop); };
  ParticleField.prototype.stop = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf=null; };
  ParticleField.prototype.setVisible = function (on) { this.canvas.style.display = on ? 'block' : 'none'; };

  global.ParticleField = ParticleField;
})(window);
