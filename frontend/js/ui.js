/* ============================================================
   AquaGrid v2 — UI rendering (state-driven components)
   ============================================================ */
(function (global) {
  'use strict';
  const store = AQ_STORE;
  const D = AQ_DATA;
  const $ = s => document.querySelector(s);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(str){ const d=new Date(str); return d.getDate()+' '+MONTHS[d.getMonth()]+' '+d.getFullYear(); }
  function confClass(c){ return c==='High'?'high':c==='Medium'?'med':'low'; }

  /* ---------------- Sidebar ---------------- */
  function renderSidebar() {
    const wrap = $('#layer-controls');
    const al = store.get().activeLayers;
    const mode = store.get().mapMode;
    const list = D.LAYERS.filter(l => l.map === 'both' || l.map === mode || (mode==='pfz'&&l.key==='pfz') || (mode==='bio'&&l.key==='bio'));
    wrap.innerHTML = list.map(l => layerItemHTML(l, al[l.key], l.key!=='currents'&&l.key!=='markers')).join('');
    bindLayerEvents(wrap);

    // GEE-ready layers
    const gwrap = $('#gee-controls');
    if (gwrap) {
      gwrap.innerHTML = D.GEE_LAYERS.map(l => layerItemHTML(l, al[l.key], true, true)).join('');
      bindLayerEvents(gwrap);
    }
  }
  function layerItemHTML(l, s, showOp, gee) {
    return `<div class="layer-item ${s.on?'on':''}" data-key="${l.key}">
      <div class="layer-head">
        <span class="layer-swatch" style="color:${l.color};background:${l.color}"></span>
        <span class="layer-name">${l.name}</span>
        <button class="layer-info-btn" data-info="${l.key}" aria-label="About ${l.name}"><i class="fas fa-circle-info"></i></button>
        <label class="switch"><input type="checkbox" data-toggle="${l.key}" ${s.on?'checked':''} aria-label="Toggle ${l.name}"><span class="track"></span></label>
      </div>
      <span class="layer-tag ${gee?'gee-tag':''}">${l.type}</span>
      <div class="opacity-row ${(showOp&&s.on)?'':'hide'}" data-oprow="${l.key}">
        <label>Opacity</label>
        <input type="range" min="0" max="100" value="${Math.round(s.opacity*100)}" data-opacity="${l.key}">
        <span class="op-val">${Math.round(s.opacity*100)}%</span>
      </div></div>`;
  }
  function bindLayerEvents(wrap) {
    wrap.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('change', e => {
      const k = e.target.dataset.toggle;
      store.set(st => ({ activeLayers: Object.assign({}, st.activeLayers, { [k]: Object.assign({}, st.activeLayers[k], { on:e.target.checked }) }) }));
      AQ_MAP.applyLayerVisibility();
      if (k==='currents' && window.AQ_PARTICLES) window.AQ_PARTICLES.setVisible(e.target.checked);
      if (k.startsWith('gee_')) toast('<b>Earth Engine layer</b><br><span style="color:var(--text-2)">Connect a GEE tile URL via the layer service to render live data.</span>', 3600);
      renderSidebar(); renderLegend();
    }));
    wrap.querySelectorAll('[data-opacity]').forEach(el => el.addEventListener('input', e => {
      const k=e.target.dataset.opacity, v=+e.target.value/100;
      e.target.parentElement.querySelector('.op-val').textContent=e.target.value+'%';
      store.set(st => ({ activeLayers: Object.assign({}, st.activeLayers, { [k]: Object.assign({}, st.activeLayers[k], { opacity:v }) }) }));
      AQ_MAP.applyLayerVisibility();
    }));
    wrap.querySelectorAll('[data-info]').forEach(el => el.addEventListener('click', e => {
      const key = e.currentTarget.dataset.info;
      const l = D.LAYERS.concat(D.GEE_LAYERS).find(x=>x.key===key);
      toast(`<b>${l.name}</b> · ${l.type}<br><span style="color:var(--text-2)">${l.info}</span>`, 4200);
    }));
  }

  /* ---------------- Legend ---------------- */
  function renderLegend() {
    const el = $('#legend'); const al = store.get().activeLayers; const mode = store.get().mapMode;
    let html = '';
    if (mode==='pfz' && al.pfz.on) { html += grad('PFZ Confidence','linear-gradient(90deg,#127fa6,#19c6c8,#8ff0ea,#c9fbf6)','Low','High'); }
    if (mode==='bio' && al.bio.on) { html += grad('Biodiversity','linear-gradient(90deg,#15803d,#2ECC71,#d7ffe6)','Low','High'); }
    if (al.currents.on) { html += grad('Current Speed (m/s)','linear-gradient(90deg,#1E63C8,#19C6C8,#2ECC71,#F4B942,#FF8A3D)','0.0','0.7+'); }
    if (mode==='pfz' && al.markers.on) html += '<div class="legend-row" style="margin-top:8px"><span style="width:12px;height:12px;border-radius:50%;background:#F4B942;display:inline-block"></span> Recommended Zone</div>';
    if (mode==='bio') html += '<div class="legend-row" style="margin-top:8px"><span style="width:12px;height:12px;border-radius:50%;background:#F4B942;display:inline-block"></span> Species richness</div>';
    if (!html) html = '<h5>Legend</h5><div class="legend-row">No active layers</div>';
    el.innerHTML = html;
  }
  function grad(title, g, lo, hi){ return `<h5>${title}</h5><div class="legend-grad" style="background:${g}"></div><div class="legend-row" style="justify-content:space-between"><span>${lo}</span><span>${hi}</span></div>`; }

  /* ---------------- Map mode tag ---------------- */
  function renderMapMode() {
    const tag = $('#map-mode-tag');
    const mode = store.get().mapMode;
    const d = store.get().selectedDate;

    const meta = window.AQ_DATE_STATUS
      ? window.AQ_DATE_STATUS(d)
      : null;

    const source = meta?.source || (D.isForecast(d) ? 'forecast' : 'historical');
    const status = meta?.status || 'available';

    let phase = 'Historical';
    let cls = 'hist';

    if (source === 'observed' && status === 'available') {
      phase = 'Observed';
      cls = 'pred';
    } else if (source === 'forecast' && status === 'prediction') {
      phase = 'Forecast';
      cls = 'pred';
    } else if (status === 'unavailable' && d > '2025-12-31') {
      phase = 'Forecast Pending';
      cls = 'hist';
    } else if (status === 'unavailable') {
      phase = 'Unavailable';
      cls = 'hist';
    }

    tag.className = 'glass mode-tag ' + cls;

    const icon = mode==='bio' ? 'fa-dna' : 'fa-fish-fins';
    const name = mode==='bio' ? 'Biodiversity' : 'PFZ';

    tag.innerHTML = `<i class="fas ${icon}"></i><span>${name} · ${phase}</span>`;

    // header switch active
    document.querySelectorAll('[data-mapmode]').forEach(
      b=>b.classList.toggle('active', b.dataset.mapmode===mode)
    );
  }

  /* ---------------- Dates ---------------- */
  function renderDates() {
    const d = store.get().selectedDate;
    $('#tl-date').textContent = fmtDate(d);

    const meta = window.AQ_DATE_STATUS
      ? window.AQ_DATE_STATUS(d)
      : null;

    const source = meta?.source || (D.isForecast(d) ? 'forecast' : 'historical');
    const status = meta?.status || 'available';

    let label = 'Historical';
    let cls = 'hist';

    if (source === 'observed' && status === 'available') {
      label = 'Observed';
      cls = 'pred';
    } else if (source === 'forecast' && status === 'prediction') {
      label = 'Forecast';
      cls = 'pred';
    } else if (status === 'unavailable' && d > '2025-12-31') {
      label = 'Forecast Pending';
      cls = 'hist';
    } else if (status === 'unavailable') {
      label = 'Unavailable';
      cls = 'hist';
    }

    const ph = $('#tl-phase');
    ph.textContent = label;
    ph.className = 'tl-phase ' + cls;

    const di = $('#date-input');
    if (di && di.value !== d) di.value = d;

    const tp = $('#tl-datepick');
    if (tp && tp.value !== d) tp.value = d;
  }

  /* ---------------- Telemetry ---------------- */
  function renderTelemetry() {
    const body = $('#telemetry-body'); const cell = store.get().selectedH3;
    if (!cell) {
      body.innerHTML = `<div class="tel-empty"><i class="fas fa-hexagon-nodes"></i>
        <p>Select an H3 cell on the map to view telemetry.</p>
        <p class="t-cap">Hover to preview • Click to pin • Double-click to fly to</p></div>`;
      return;
    }
    const fc = cell.forecast;
    const dir = D.dirFull(cell.current_dir_deg) + ' (' + cell.current_dir_deg + '°)';
    let modeBlock;
    if (fc) {
      modeBlock = `<div class="mode-banner pred"><i class="fas fa-brain"></i> AI Forecast</div>
        <div class="metric-list">
          ${row('AI Forecast', `<span class="chip ${confClass(cell.confidence)}">PFZ ${cell.confidence}</span>`)}
          ${row('Probability', probBar(cell.pfz_probability))}
          ${row('Forecast Confidence', `<span class="chip ${confClass(cell.confidence)}">${cell.confidence}</span>`)}
          ${row('Current Speed', cell.current_speed_ms+' m/s <span style="color:'+D.speedColor(cell.current_speed_ms)+'">●</span>')}
          ${row('Current Direction', dir)}
          ${row('SST', cell.sst_c+' °C')}${row('Salinity', cell.salinity_psu+' PSU')}${row('Chlorophyll', cell.chl_mg+' mg/m³')}
        </div>`;
    } else {
      const replay = cell.pfz_probability>=0.66?'Strong':cell.pfz_probability>=0.4?'Moderate':'Weak';
      modeBlock = `<div class="mode-banner hist"><i class="fas fa-clock-rotate-left"></i> Historical</div>
        <div class="metric-list">
          ${row('Historical Advisory', `<span class="chip ${cell.pfz_probability>=0.55?'high':'med'}">${cell.pfz_probability>=0.55?'Issued':'Not issued'}</span>`)}
          ${row('Observed PFZ', cell.pfz_probability>=0.5?'<span class="chip high">Yes</span>':'<span class="chip low">No</span>')}
          ${row('Replay Score', `<span class="chip ${cell.pfz_probability>=0.55?'high':'med'}">${replay}</span>`)}
          ${row('Replay Confidence', `<span class="chip ${confClass(cell.confidence)}">${cell.confidence}</span>`)}
          ${row('SST', cell.sst_c+' °C')}${row('Chlorophyll', cell.chl_mg+' mg/m³')}${row('Current Speed', cell.current_speed_ms+' m/s')}
        </div>`;
    }
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span class="cell-id">${cell.id} · ${cell.lat.toFixed(3)}, ${cell.lng.toFixed(3)}</span>
        <button class="icon-btn" id="tel-close" aria-label="Clear selection" style="width:28px;height:28px"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="gauges">
        <div class="gauge-card"><h6>Compass</h6><canvas id="g-compass" width="120" height="120" style="width:108px;height:108px"></canvas><div class="gauge-sub">${D.dirName(cell.current_dir_deg)} · ${cell.current_dir_deg}°</div></div>
        <div class="gauge-card"><h6>Current Speed</h6><canvas id="g-speed" width="120" height="120" style="width:108px;height:108px"></canvas><div class="gauge-val" style="margin-top:-6px">${cell.current_speed_ms}<span style="font-size:12px;color:var(--text-3)"> m/s</span></div></div>
      </div>
      ${modeBlock}
      <div class="metric-list" style="margin-top:12px">
        ${row('Biodiversity', cell.forecast ? probBar(cell.biodiversity) : (cell.species_richness != null ? cell.species_richness + ' species' : '—'))}
        ${row('Species Richness', cell.species_richness)}
        ${row('Shannon Index', cell.shannon_index)}
        ${row('Mixed Layer Depth', cell.mld_m+' m')}
        ${row('SSH Anomaly', cell.ssh_m+' m')}
      </div>
      <button class="btn ghost" id="tel-fly" style="width:100%;margin-top:14px;justify-content:center"><i class="fas fa-location-crosshairs"></i> Fly to cell</button>`;
    drawCompass('g-compass', cell.current_dir_deg);
    drawSpeed('g-speed', cell.current_speed_ms);
    $('#tel-close').addEventListener('click', ()=>{ store.set({selectedH3:null}); const m=AQ_MAP.getMap(); if(m&&m.getLayer('cell-selected'))m.setFilter('cell-selected',['==','id','__none__']); });
    $('#tel-fly').addEventListener('click', ()=>AQ_MAP.flyTo(cell.lng, cell.lat, 9.2));
  }
  function row(k,v){ return `<div class="metric-row"><span class="k">${k}</span><span class="v">${v}</span></div>`; }
  function probBar(p){ return `<div style="min-width:120px"><div style="text-align:right;font-weight:700">${Math.round(p*100)}%</div><div class="prob-bar"><div class="prob-fill" style="width:${Math.round(p*100)}%"></div></div></div>`; }

  function drawCompass(id, deg){ const c=document.getElementById(id); if(!c)return; const x=c.getContext('2d'); const w=c.width,cx=w/2,cy=w/2,r=w/2-10; x.clearRect(0,0,w,w);
    x.strokeStyle='rgba(255,255,255,.15)'; x.lineWidth=6; x.beginPath(); x.arc(cx,cy,r,0,Math.PI*2); x.stroke();
    x.fillStyle='#6E8299'; x.font='11px Inter'; x.textAlign='center'; x.textBaseline='middle';
    [['N',-Math.PI/2],['E',0],['S',Math.PI/2],['W',Math.PI]].forEach(([t,a])=>x.fillText(t,cx+Math.cos(a)*(r-14),cy+Math.sin(a)*(r-14)));
    const a=(deg-90)*Math.PI/180; x.strokeStyle='#19C6C8'; x.lineWidth=3; x.beginPath(); x.moveTo(cx,cy); x.lineTo(cx+Math.cos(a)*(r-18),cy+Math.sin(a)*(r-18)); x.stroke();
    x.fillStyle='#FF5D6C'; x.beginPath(); x.arc(cx+Math.cos(a)*(r-18),cy+Math.sin(a)*(r-18),4,0,Math.PI*2); x.fill();
    x.fillStyle='#F3F8FC'; x.beginPath(); x.arc(cx,cy,3,0,Math.PI*2); x.fill(); }
  function drawSpeed(id, spd){ const c=document.getElementById(id); if(!c)return; const x=c.getContext('2d'); const w=c.width,cx=w/2,cy=w/2+6,r=w/2-12; const s=Math.PI*0.75,e=Math.PI*2.25,f=Math.min(1,spd/0.8); x.clearRect(0,0,w,w); x.lineCap='round';
    x.strokeStyle='rgba(255,255,255,.12)'; x.lineWidth=8; x.beginPath(); x.arc(cx,cy,r,s,e); x.stroke();
    x.strokeStyle=D.speedColor(spd); x.lineWidth=8; x.beginPath(); x.arc(cx,cy,r,s,s+(e-s)*f); x.stroke(); }

  /* ---------------- Overview ---------------- */
  let trendChart=null;
  function renderOverview(){
  const stats = (window.AQ_PFZ_STATS_DATE === store.get().selectedDate)
    ? window.AQ_PFZ_STATS
    : null;

  const cards = stats ? [
    { icon:'fa-signal', bg:'rgba(46,204,113,.15)', col:'#2ECC71',
      metric:stats.high_confidence, label:'High Confidence Cells',
      trend:'Real PFZ statistics', up:true },

    { icon:'fa-fish-fins', bg:'rgba(98,230,255,.15)', col:'#62E6FF',
      metric:stats.recommended, label:'Recommended Zones',
      trend:'Real PFZ statistics', up:true },

    { icon:'fa-chart-line', bg:'rgba(255,138,61,.15)', col:'#FF8A3D',
      metric:(Number(stats.average_probability) * 100).toFixed(1)+'%',
      label:'Average PFZ Probability',
      trend:'Backend model output', up:true },

    { icon:'fa-hexagon-nodes', bg:'rgba(159,178,198,.15)', col:'#9FB2C6',
      metric:stats.pfz_cells, label:'PFZ Cells',
      trend:'Probability ≥ PFZ threshold', up:true },

    { icon:'fa-ban', bg:'rgba(244,185,66,.15)', col:'#F4B942',
      metric:stats.unavailable_cells, label:'Unavailable Cells',
      trend:'Missing usable prediction', up:false },

    { icon:'fa-globe', bg:'rgba(159,178,198,.15)', col:'#9FB2C6',
      metric:stats.total_cells, label:'Monitored H3 Cells',
      trend:'Mumbai–Goa grid', up:true }
  ] : [
    {
      icon: window.AQ_PFZ_STATS_DATE === store.get().selectedDate ? 'fa-circle-exclamation' : 'fa-spinner',
      bg: window.AQ_PFZ_STATS_DATE === store.get().selectedDate
        ? 'rgba(244,185,66,.15)'
        : 'rgba(159,178,198,.15)',
      col: window.AQ_PFZ_STATS_DATE === store.get().selectedDate ? '#F4B942' : '#9FB2C6',
      metric: '—',
      label: window.AQ_PFZ_STATS_DATE === store.get().selectedDate
        ? 'PFZ Data Unavailable'
        : 'PFZ Statistics',
      trend: window.AQ_PFZ_STATS_DATE === store.get().selectedDate
        ? 'No PFZ prediction for selected date'
        : 'Loading backend data…',
      up: false
    }
  ];

  $('#overview-cards').innerHTML = cards.map(c => `
    <div class="stat-card glass">
      <div class="stat-icon" style="background:${c.bg};color:${c.col}">
        <i class="fas ${c.icon}"></i>
      </div>
      <div class="stat-body">
        <div class="stat-metric">${c.metric}</div>
        <div class="stat-label">${c.label}</div>
        <div class="stat-trend ${c.up?'up':''}">
          ${c.trend}
        </div>
      </div>
    </div>
  `).join('');

  // Render the real backend-backed historical/forecast trend.
  drawTrendChart();
}

  function animateCounters(){ document.querySelectorAll('[data-count]').forEach(el=>{ const t=parseFloat(el.dataset.count)||0, suf=el.dataset.suffix||''; const dur=900,t0=performance.now(); (function tick(n){ const p=Math.min(1,(n-t0)/dur); const v=t*(1-Math.pow(1-p,3)); el.textContent=(t%1===0?Math.round(v):v.toFixed(1))+suf; if(p<1)requestAnimationFrame(tick); })(t0); }); }
  function drawSparks(){ document.querySelectorAll('[data-spark]').forEach(cv=>{ const x=cv.getContext('2d'),w=cv.width,h=cv.height; x.clearRect(0,0,w,h); const pts=Array.from({length:12},(_,i)=>h*0.3+Math.abs(Math.sin(i*0.9+ +cv.dataset.spark))*h*0.5); x.strokeStyle='#19C6C8'; x.lineWidth=1.5; x.beginPath(); pts.forEach((p,i)=>{ const px=i/(pts.length-1)*w; i?x.lineTo(px,h-p):x.moveTo(px,h-p);}); x.stroke(); }); }
  let trendRequestToken = 0;

  async function drawTrendChart(){
    const canvas = document.getElementById('trend-chart');
    if (!canvas) return;

    const token = ++trendRequestToken;

    if (trendChart) {
      try { trendChart.destroy(); } catch(e) {}
      trendChart = null;
    }

    // Real confidence-band distribution from /pfz/stats.
    const candidates = [
      {date:'2024-09-15', kind:'historical'},
      {date:'2025-03-15', kind:'historical'},
      {date:'2025-09-15', kind:'historical'},
      {date:'2026-03-15', kind:'observed'},
      {date:'2026-09-15', kind:'forecast'}
    ];

    const results = [];

    for (const item of candidates) {
      if (token !== trendRequestToken) return;

      try {
        const stats = await AQ_API.getPFZStats(item.date);
        const usable = Number(stats && stats.usable_cells);

        if (stats && Number.isFinite(usable) && usable > 0) {
          results.push({
            date: item.date,
            kind: item.kind,
            high: Number(stats.high_confidence || 0) / usable * 100,
            recommended: Number(stats.recommended || 0) / usable * 100,
            moderate: Number(stats.moderate_opportunity || 0) / usable * 100,
            low: Number(stats.low_potential || 0) / usable * 100
          });
        }
      } catch(e) {
        console.warn('PFZ confidence point unavailable', item.date, e);
      }
    }

    if (token !== trendRequestToken) return;

    if (!results.length) {
      const panel = canvas.parentElement;
      if (panel) {
        panel.innerHTML =
          '<div class="t-cap" style="padding:80px 20px;text-align:center">PFZ confidence data is temporarily unavailable.</div>';
      }
      return;
    }

    const labels = results.map(x => {
      const dt = new Date(x.date + 'T00:00:00');
      return MONTHS[dt.getMonth()] + ' ' + String(dt.getFullYear()).slice(2);
    });

    trendChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'High Confidence',
            data: results.map(x => +x.high.toFixed(1)),
            backgroundColor: '#2ECC71',
            stack: 'confidence'
          },
          {
            label: 'Recommended',
            data: results.map(x => +x.recommended.toFixed(1)),
            backgroundColor: '#62E6FF',
            stack: 'confidence'
          },
          {
            label: 'Moderate Opportunity',
            data: results.map(x => +x.moderate.toFixed(1)),
            backgroundColor: '#F4B942',
            stack: 'confidence'
          },
          {
            label: 'Low Potential',
            data: results.map(x => +x.low.toFixed(1)),
            backgroundColor: '#9FB2C6',
            stack: 'confidence'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color:'#AEC0D2' } },
          tooltip: {
            callbacks: {
              label: c => `${c.dataset.label}: ${c.parsed.y}% of usable cells`
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color:'#6E8299' },
            grid: { color:'rgba(255,255,255,.05)' }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            max: 100,
            title: {
              display: true,
              text: 'Confidence-band share of usable cells (%)',
              color:'#6E8299'
            },
            ticks: {
              color:'#6E8299',
              callback: v => v + '%'
            },
            grid: { color:'rgba(255,255,255,.05)' }
          }
        }
      }
    });
  }

  /* ---------------- Data page ---------------- */
  let RECORDS = [], sortKey = 'pfz_probability', sortDir = -1;
  const COLS = [
    ['date','Date'],
    ['h3_cell','H3 Cell'],
    ['source','Phase'],
    ['pfz_probability','PFZ Prob.'],
    ['confidence','Band'],
    ['prediction_status','Status'],
    ['sst_c','SST °C'],
    ['chlorophyll_mg_m3','Chl mg/m³'],
    ['salinity_psu','Salinity'],
    ['current_speed_ms','Curr. m/s'],
    ['mixed_layer_m','MLD m'],
    ['ssh_m','SSH m']
  ];

  async function loadDataRecords(){
    const date = store.get().selectedDate;
    try {
      const grid = await AQ_API.getPFZGrid(date);
      RECORDS = (grid && Array.isArray(grid.cells) ? grid.cells : []).map(cell => ({
        date: grid.date || date,
        h3_cell: String(cell.h3_index || ''),
        source: String(grid.source || 'unavailable'),
        pfz_probability: Number.isFinite(Number(cell.pfz_probability))
          ? Number(cell.pfz_probability) : null,
        confidence: cell.confidence || 'Unavailable',
        prediction_status: cell.prediction_status || 'unavailable',
        sst_c: Number.isFinite(Number(cell.sst_c)) ? Number(cell.sst_c) : null,
        chlorophyll_mg_m3: Number.isFinite(Number(cell.chlorophyll_mg_m3)) ? Number(cell.chlorophyll_mg_m3) : null,
        salinity_psu: Number.isFinite(Number(cell.salinity_psu)) ? Number(cell.salinity_psu) : null,
        current_speed_ms: Number.isFinite(Number(cell.current_speed_ms)) ? Number(cell.current_speed_ms) : null,
        mixed_layer_m: Number.isFinite(Number(cell.mixed_layer_m)) ? Number(cell.mixed_layer_m) : null,
        ssh_m: Number.isFinite(Number(cell.ssh_m)) ? Number(cell.ssh_m) : null
      }));
    } catch (err) {
      console.warn('[AquaGrid Data] PFZ grid unavailable:', err);
      RECORDS = [];
    }
    renderDataPage();
  }

  function renderDataPage(){
    const q = ($('#data-search').value || '').toLowerCase();
    const fc = $('#data-filter-conf').value;
    const fs = $('#data-filter-source').value;

    let rows = RECORDS.filter(r =>
      (!q || r.h3_cell.toLowerCase().includes(q) || r.date.includes(q)) &&
      (!fc || r.confidence === fc) &&
      (!fs || r.source === fs)
    );

    rows.sort((a,b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
    });

    const tb = $('#data-table');
    tb.querySelector('thead').innerHTML =
      '<tr>' +
      COLS.map(([k,l]) =>
        `<th data-sort="${k}">${l}${sortKey===k?(sortDir<0?' ▼':' ▲'):''}</th>`
      ).join('') +
      '</tr>';

    tb.querySelector('tbody').innerHTML = rows.slice(0,200).map(r => `
      <tr>
        <td class="mono">${r.date}</td>
        <td class="mono">${r.h3_cell}</td>
        <td><span class="chip ${r.source==='forecast'?'info':'med'}" style="font-size:11px">${r.source}</span></td>
        <td>${r.pfz_probability == null ? 'Not available' : Math.round(r.pfz_probability*100)+'%'}</td>
        <td><span class="chip ${confClass(r.confidence)}" style="font-size:11px">${r.confidence}</span></td>
        <td>${r.prediction_status}</td>
        <td>${r.sst_c == null ? '—' : Number(r.sst_c).toFixed(2)}</td>
        <td>${r.chlorophyll_mg_m3 == null ? '—' : Number(r.chlorophyll_mg_m3).toFixed(3)}</td>
        <td>${r.salinity_psu == null ? '—' : Number(r.salinity_psu).toFixed(2)}</td>
        <td>${r.current_speed_ms == null ? '—' : Number(r.current_speed_ms).toFixed(3)}</td>
        <td>${r.mixed_layer_m == null ? '—' : Number(r.mixed_layer_m).toFixed(2)}</td>
        <td>${r.ssh_m == null ? '—' : Number(r.ssh_m).toFixed(3)}</td>
      </tr>
    `).join('');

    $('#data-count').textContent =
      `${rows.length} records${rows.length>200?' (showing first 200)':''}`;

    tb.querySelectorAll('[data-sort]').forEach(th =>
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir *= -1;
        else { sortKey = k; sortDir = -1; }
        renderDataPage();
      })
    );
  }

  function exportData(fmt){
    if(!RECORDS.length){
      toast('No real data loaded for the selected date');
      return;
    }

    let blob, name;
    if(fmt === 'json'){
      blob = new Blob([JSON.stringify(RECORDS,null,2)], {type:'application/json'});
      name = 'aquagrid_records.json';
    } else {
      const head = COLS.map(c=>c[0]).join(',');
      const body = RECORDS.map(r =>
        COLS.map(c => {
          const v = r[c[0]];
          return v == null ? '' : String(v).replace(/"/g,'""');
        }).map(v => `"${v}"`).join(',')
      ).join('\n');
      blob = new Blob([head+'\n'+body], {type:'text/csv'});
      name = 'aquagrid_records.csv';
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported '+name);
  }

  /* ---------------- Intelligence ---------------- */
  function renderIntel(){
    const role = store.get().intelRole;
    document.querySelectorAll('.intel-role').forEach(b=>b.classList.toggle('active', b.dataset.role===role));

    const info = (AQ_INTEL.ROLE_INFO||{})[role];
    const desc = $('#intel-desc');
    if (info && desc) {
      desc.innerHTML = `<div class="intel-desc glass">
        <div class="intel-desc-head">
          <div class="mc-icon" style="background:rgba(25,198,200,.14);color:var(--highlight)"><i class="fas ${info.icon}"></i></div>
          <div><h3 style="margin:0">${info.title}</h3><p class="t-cap" style="margin:2px 0 0">${info.tagline}</p></div>
        </div>
        <p class="intel-desc-what">${info.what}</p>
        <div class="intel-desc-grid">
          <div><h5>What you get</h5><ul>${info.gives.map(g=>`<li>${g}</li>`).join('')}</ul></div>
          <div><h5>How to use it</h5><p>${info.how}</p></div>
        </div>
      </div>`;
    }

    const sug = AQ_INTEL.SUGGEST[role]||[];
    $('#intel-suggest').innerHTML = '<span class="t-cap" style="margin-right:4px">Try:</span>' + sug.map(s=>`<button data-q="${s}">${s}</button>`).join('');
    $('#intel-suggest').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ $('#intel-query').value=b.dataset.q; AQ_INTEL.run(role, b.dataset.q); }));
  }

  /* ---------------- Help ---------------- */
  function renderHelp(){
    const sc=[['1','Map'],['2','Overview'],['3','Intelligence'],['4','Data'],['?','Help'],['Space','Play / Pause timeline'],['← / →','Step timeline'],['R','Reset view'],['B','Toggle PFZ / Biodiversity']];
    $('#help-page').innerHTML=`
      <div class="panel glass"><h3>Keyboard Shortcuts</h3><div class="kbd-list">${sc.map(([k,v])=>`<div class="kbd-row"><span>${v}</span><kbd>${k}</kbd></div>`).join('')}</div></div>
      <div class="panel glass"><h3>Map Interactions</h3><ul style="line-height:2;color:var(--text-2)">
        <li><b>Two maps</b> — switch PFZ ↔ Biodiversity in the header (animated crossfade).</li>
        <li><b>Place picker</b> — jump to any point between Mumbai &amp; Goa; <b>Date picker</b> — any past or future date.</li>
        <li><b>Hover</b> glow + tooltip · <b>Click</b> pin telemetry · <b>Double-click</b> fly-to.</li>
        <li>Scroll/pinch zoom · right-drag rotate &amp; pitch (3D globe) · shift-drag box zoom.</li></ul></div>
      <div class="panel glass"><h3>Historical vs Forecast</h3><p style="color:var(--text-2)">Phase is relative to <b>today</b> — no hardcoded years. Dates on/before today show <span class="chip med">Historical</span> advisories &amp; observed PFZ; future dates show <span class="chip info">AI Forecast</span> with forecast confidence.</p></div>
      <div class="panel glass"><h3>Google Earth Engine-ready</h3><p style="color:var(--text-2)">All overlays go through a reusable layer service (<code>AQ_LAYERS.register</code>) supporting raster / vector / image tiles, opacity, ordering &amp; legends. Point a GEE layer at a real tile URL to render live data — no UI changes needed.</p></div>`;
  }

  let toastTimer;
  function toast(html, ms){ const t=$('#toast'); t.innerHTML=html; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'), ms||2400); }

  global.AQ_UI = { renderSidebar, renderLegend, renderMapMode, renderDates, renderTelemetry, renderOverview, renderDataPage, loadDataRecords, exportData, renderIntel, renderHelp, toast, fmtDate };
})(window);
