/* ============================================================
   AquaGrid v2 — App orchestrator
   Landing → cinematic dive → dashboard; routing; place/date
   pickers; timeline (Historical/Forecast); map modes; shortcuts.
   ============================================================ */
(function () {
  'use strict';
  const store = AQ_STORE, UI = AQ_UI, D = AQ_DATA;
  const $ = s => document.querySelector(s);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Timeline domain is supplied by the real backend.
  let T_START = new Date('2023-01-01').getTime();
  let T_END = T_START;
  let T_NOW = Date.now();
  let T_SPAN = T_END - T_START;

  const dateToFrac = s => (new Date(s).getTime()-T_START)/T_SPAN;
  const fracToDate = f => new Date(
    T_START + Math.max(0,Math.min(1,f))*T_SPAN
  ).toISOString().slice(0,10);

  let AQ_TIMELINE = null;
  let AQ_TIMELINE_BY_DATE = new Map();
  let AQ_PFZ_STATS = null;
  let AQ_PFZ_STATS_DATE = null;
  let AQ_DATE_REQUEST_TOKEN = 0;

  function dateAvailability(dateStr){
    const meta = AQ_TIMELINE_BY_DATE.get(dateStr);
    if (meta) return meta;

    // Conservative fallback while the backend timeline is loading.
    if (dateStr <= '2025-12-31') {
      return { date: dateStr, source: 'historical', status: 'available' };
    }

    return { date: dateStr, source: 'unavailable', status: 'unavailable' };
  }

  window.AQ_DATE_STATUS = dateAvailability;

  async function loadBackendTimeline() {
    try {
      AQ_TIMELINE = await AQ_API.getTimeline();

      AQ_TIMELINE_BY_DATE = new Map(
        (AQ_TIMELINE?.dates || []).map(item => [item.date, item])
      );

      // Expose the backend timeline for browser QA and UI consumers.
      window.AQ_TIMELINE = AQ_TIMELINE;

      if (AQ_TIMELINE?.start_date && AQ_TIMELINE?.end_date) {
        T_START = new Date(AQ_TIMELINE.start_date).getTime();
        T_END = new Date(AQ_TIMELINE.end_date).getTime();
        T_SPAN = T_END - T_START;

        const maxDate = AQ_TIMELINE.end_date;
        const minDate = AQ_TIMELINE.start_date;
        const dateInput = $('#date-input');
        const timelineDateInput = $('#tl-datepick');

        if (dateInput) {
          dateInput.min = minDate;
          dateInput.max = maxDate;
        }
        if (timelineDateInput) {
          timelineDateInput.min = minDate;
          timelineDateInput.max = maxDate;
        }
      }

      renderTimelineStatic();
      renderTimeline();
      UI.renderDates();
      UI.renderMapMode();

      console.log('[AquaGrid] Backend timeline loaded:', {
        start: AQ_TIMELINE?.start_date,
        end: AQ_TIMELINE?.end_date,
        totalDays: AQ_TIMELINE?.total_days
      });
    } catch (err) {
      console.error('[AquaGrid] Failed to load backend timeline:', err);
    }
  }

  /* ---------------- Landing / Enter ---------------- */
  let entered = false, booted = false;
  function enterDashboard() {
    if (entered) return; entered = true;
    const dive = $('#dive'); dive.classList.add('on');
    $('#landing').classList.add('exit');
    setTimeout(() => {
      $('#dashboard').classList.add('live');
      // sidebar collapse controls work immediately (independent of map load)
      initSidebars();
      AQ_MAP.init();
      // cinematic camera dive: start high, fly down into the study area
      const reduce = store.get().reducedMotion;
      window.addEventListener('aq-map-ready', () => {
        const m = AQ_MAP.getMap();
        if (reduce) {
          m.jumpTo({ center: D.CENTER, zoom: 6.6, pitch: 0 });
        } else {
          m.jumpTo({ center: D.CENTER, zoom: 2.4, pitch: 0 });
          setTimeout(() => { m.flyTo({ center: D.CENTER, zoom: 6.6, pitch: 35, bearing: -8, duration: 2600, essential:true }); if(AQ_MAP.getBioMap()) AQ_MAP.getBioMap().flyTo({ center:D.CENTER, zoom:6.6, pitch:35, bearing:-8, duration:2600 }); }, 200);
        }
        setTimeout(() => dive.classList.remove('on'), reduce?200:900);
        boot();
      }, { once:true });
      // dive spinner is purely cosmetic — always clear it on a fixed timer,
      // never wait on (possibly slow) map tiles.
      setTimeout(() => dive.classList.remove('on'), reduce?300:2600);
      // ensure the dashboard is fully rendered even if map tiles are slow
      setTimeout(() => { if (!booted) boot(); }, 3000);
      AQ_LANDING.stop();
    }, 700);
    store.set({ entered:true });
  }
  $('#enter-btn').addEventListener('click', enterDashboard);
  $('#enter-top').addEventListener('click', enterDashboard);
  $('#btn-home').addEventListener('click', () => { location.reload(); });

  /* ---------------- Tabs ---------------- */
  const TABS=['maps','overview','intel','data','help'];
  function switchTab(tab, skipHash){
    if(!TABS.includes(tab)) tab='maps';
    store.set({ currentTab:tab });
    document.querySelectorAll('.topnav button').forEach(b=>{ const on=b.dataset.tab===tab; b.classList.toggle('active',on); });
    document.querySelectorAll('.page-view').forEach(v=>v.classList.remove('active'));
    if(tab!=='maps'){ const v=$('#view-'+tab); if(v) v.classList.add('active'); }
    // hide the map's floating panels when a full-page tab is open
    document.body.classList.toggle('page-open', tab!=='maps');
    if(!skipHash) location.hash=tab;
    if(tab==='overview') UI.renderOverview();
    if(tab==='intel') UI.renderIntel();
    if(tab==='data') UI.loadDataRecords();
    if(tab==='help') UI.renderHelp();
    if(tab==='maps') AQ_MAP.resizeAll();
  }
  document.querySelectorAll('.topnav button').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  window.addEventListener('hashchange',()=>{ if(entered) switchTab(location.hash.slice(1)||'maps',true); });

  /* ---------------- Map mode switch ---------------- */
  document.querySelectorAll('[data-mapmode]').forEach(b=>b.addEventListener('click',()=>setMapMode(b.dataset.mapmode)));
  function setMapMode(mode){
    store.set({ mapMode:mode });
    AQ_MAP.setMapMode(mode);
    UI.renderSidebar(); UI.renderLegend(); UI.renderMapMode();
  }

  /* ---------------- Place & date pickers ---------------- */
  function initPickers(){
    const ps=$('#place-select');
    ps.innerHTML = D.PLACES.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    ps.value = store.get().selectedPlace;
    ps.addEventListener('change', ()=>{ const p=D.PLACES.find(x=>x.id===ps.value); store.set({selectedPlace:ps.value}); if(p){ if(p.id==='all') AQ_MAP.resetView(); else AQ_MAP.flyTo(p.lng,p.lat,p.zoom,40); UI.toast('Flying to '+p.name); } });

    const di=$('#date-input'); di.value=store.get().selectedDate; di.addEventListener('change',()=>setDate(di.value));
    const tp=$('#tl-datepick'); tp.value=store.get().selectedDate; tp.addEventListener('change',()=>setDate(tp.value));

    const bm=$('#basemap-select'); if(bm){ bm.value=store.get().basemap||'ocean'; bm.addEventListener('change',()=>{ store.set({basemap:bm.value}); AQ_MAP.setBasemap(bm.value); UI.toast('Basemap: '+bm.options[bm.selectedIndex].text); }); }
  }

  /* ---------------- Collapsible panels (layers / telemetry / date player) ---------------- */
  let sidebarsInit = false;
  function initSidebars(){
    if (sidebarsInit) return; sidebarsInit = true;
    const sb=$('#sidebar'), tel=$('#telemetry'), tl=$('#timeline'),
          oSb=$('#open-sidebar'), oTel=$('#open-telemetry'), oTl=$('#open-timeline');
    function syncTabs(){
      oSb.style.display  = sb.classList.contains('collapsed')?'grid':'none';
      oTel.style.display = tel.classList.contains('collapsed')?'grid':'none';
      document.body.classList.toggle('sidebar-collapsed', sb.classList.contains('collapsed'));
      document.body.classList.toggle('timeline-collapsed', tl.classList.contains('collapsed'));
      setTimeout(()=>{ try{ AQ_MAP.resizeAll(); }catch(e){} },50);
    }
    $('#close-sidebar').addEventListener('click',()=>{ sb.classList.add('collapsed'); syncTabs(); });
    oSb.addEventListener('click',()=>{ sb.classList.remove('collapsed'); syncTabs(); });
    $('#close-telemetry').addEventListener('click',()=>{ tel.classList.add('collapsed'); syncTabs(); });
    oTel.addEventListener('click',()=>{ tel.classList.remove('collapsed'); syncTabs(); });
    $('#close-timeline').addEventListener('click',()=>{ tl.classList.add('collapsed'); syncTabs(); });
    oTl.addEventListener('click',()=>{ tl.classList.remove('collapsed'); syncTabs(); });
    syncTabs();
  }

  /* ---------------- Timeline ---------------- */
  function renderTimelineStatic(){
    const nowFrac = Math.max(0, Math.min(1, (T_NOW-T_START)/T_SPAN));
    $('#tl-hist').style.width = (nowFrac*100)+'%';
    $('#tl-now').style.left = (nowFrac*100)+'%';
    const endFrac = Math.max(0, Math.min(1, (T_END-T_START)/T_SPAN));
    const endEl = $('#tl-end');
    if (endEl) {
      endEl.style.left = (endFrac*100)+'%';
      endEl.setAttribute('data-date', new Date(T_END).toISOString().slice(0,10));
    }
  }
  function renderTimeline(){
    const f=dateToFrac(store.get().selectedDate);
    $('#tl-progress').style.width=(f*100)+'%';
    $('#tl-handle').style.left=(f*100)+'%';
    $('#tl-handle').setAttribute('aria-valuenow', UI.fmtDate(store.get().selectedDate));
  }
  async function loadPFZStats(date) {
    try {
      const stats = await AQ_API.getPFZStats(date);
      AQ_PFZ_STATS = stats;
      AQ_PFZ_STATS_DATE = date;
      window.AQ_PFZ_STATS = stats;
      window.AQ_PFZ_STATS_DATE = date;

      if (store.get().selectedDate === date &&
          store.get().currentTab === 'overview') {
        UI.renderOverview();
      }

      console.log('[AquaGrid] PFZ stats loaded:', {
        date,
        totalCells: stats?.total_cells,
        usableCells: stats?.usable_cells,
        pfzCells: stats?.pfz_cells,
        averageProbability: stats?.average_probability
      });

      return stats;
    } catch (err) {
      AQ_PFZ_STATS = null;
      AQ_PFZ_STATS_DATE = date;
      window.AQ_PFZ_STATS = null;
      window.AQ_PFZ_STATS_DATE = date;
      console.error('[AquaGrid] PFZ stats failed:', err);
      if (store.get().selectedDate === date &&
          store.get().currentTab === 'overview') {
        UI.renderOverview();
      }
      return null;
    }
  }

  async function setDate(str){
    const token = ++AQ_DATE_REQUEST_TOKEN;

    const minDate = AQ_TIMELINE?.start_date || '2023-01-01';
    const maxDate = AQ_TIMELINE?.end_date || null;

    if (str < minDate || str > maxDate) {
      UI.toast(`Date unavailable: ${UI.fmtDate(str)}. Supported range ends ${UI.fmtDate(maxDate)}.`);
      UI.renderDates();
      renderTimeline();
      return;
    }

    const meta = dateAvailability(str);

    store.set({ selectedDate:str });

    // Never retain values belonging to the previously selected date.
    if (typeof AQ_DATA.clearLiveData === 'function') {
      AQ_DATA.clearLiveData();
    }

    UI.renderDates();
    renderTimeline();
    UI.renderMapMode();
    AQ_MAP.refreshData();
    UI.renderTelemetry();

    // Only dates advertised by the authoritative backend timeline
    // are allowed through the frontend date-selection flow.
    try {
      await AQ_DATA.refresh({ date: str });

      // Ignore a slower response belonging to an older selected date.
      if (token !== AQ_DATE_REQUEST_TOKEN ||
          store.get().selectedDate !== str) {
        return;
      }

      // Use the successful backend response as the authoritative date
      // status. This replaces the provisional "Forecast Pending" state.
      const liveMeta = window.AQ_LAST_PFZ_GRID_META;

      if (liveMeta && liveMeta.date === str) {
        AQ_TIMELINE_BY_DATE.set(str, {
          date: str,
          source: liveMeta.source,
          status: liveMeta.status
        });
      }

      UI.renderDates();
      renderTimeline();
      UI.renderMapMode();

      AQ_MAP.refreshData();
      UI.renderTelemetry();

      if (store.get().currentTab === 'overview') {
        UI.renderOverview();
      }

      await loadPFZStats(str);
    } catch (err) {
      if (token !== AQ_DATE_REQUEST_TOKEN) return;

      console.error('[AquaGrid] PFZ refresh failed:', err);

      AQ_PFZ_STATS = null;
      AQ_PFZ_STATS_DATE = str;
      window.AQ_PFZ_STATS = null;
      window.AQ_PFZ_STATS_DATE = str;

      if (store.get().currentTab === 'overview') {
        UI.renderOverview();
      }
    }
  }

  // Browser QA hook: use the same production date-selection path as the UI.
  window.AQ_SET_DATE = setDate;

  const wrap=$('#tl-track-wrap'); let dragging=false;
  const ptDate=x=>{ const r=wrap.getBoundingClientRect(); return fracToDate((x-r.left)/r.width); };
  wrap.addEventListener('pointerdown',e=>{ dragging=true; wrap.setPointerCapture(e.pointerId); setDate(ptDate(e.clientX)); });
  wrap.addEventListener('pointermove',e=>{ if(dragging) setDate(ptDate(e.clientX)); });
  wrap.addEventListener('pointerup',()=>dragging=false);
  $('#tl-handle').addEventListener('keydown',e=>{ const step=6048e5; const t=new Date(store.get().selectedDate).getTime(); if(e.key==='ArrowLeft')setDate(new Date(Math.max(T_START,t-step)).toISOString().slice(0,10)); if(e.key==='ArrowRight')setDate(new Date(Math.min(T_END,t+step)).toISOString().slice(0,10)); });

  let playRaf=null,lastT=0;
  function play(){ store.set({playbackState:'playing'}); $('#tl-play').innerHTML='<i class="fas fa-pause"></i>'; lastT=performance.now();
    const loop=now=>{ const dt=(now-lastT)/1000; lastT=now; const per=0.008*store.get().playbackSpeed; let f=dateToFrac(store.get().selectedDate)+per*dt; if(f>=1){ setDate(fracToDate(1)); pause(); return; } setDate(fracToDate(f)); playRaf=requestAnimationFrame(loop); };
    playRaf=requestAnimationFrame(loop); }
  function pause(){ store.set({playbackState:'paused'}); $('#tl-play').innerHTML='<i class="fas fa-play"></i>'; if(playRaf)cancelAnimationFrame(playRaf); playRaf=null; }
  function togglePlay(){ store.get().playbackState==='playing'?pause():play(); }
  $('#tl-play').addEventListener('click',togglePlay);
  $('#tl-prev').addEventListener('click',()=>{ const t=new Date(store.get().selectedDate).getTime(); setDate(new Date(Math.max(T_START,t-2592e6)).toISOString().slice(0,10)); });
  $('#tl-next').addEventListener('click',()=>{ const t=new Date(store.get().selectedDate).getTime(); setDate(new Date(Math.min(T_END,t+2592e6)).toISOString().slice(0,10)); });
  $('#tl-today').addEventListener('click',()=>setDate(new Date().toISOString().slice(0,10)));
  $('#tl-speed').addEventListener('change',e=>store.set({playbackSpeed:+e.target.value}));

  /* ---------------- Current controls ---------------- */
  $('#cur-play').addEventListener('click',function(){ const p=window.AQ_PARTICLES; if(!p)return; p.playing=!p.playing; this.innerHTML=p.playing?'<i class="fas fa-pause"></i>':'<i class="fas fa-play"></i>'; store.set({currentsPlaying:p.playing}); });
  $('#cur-speed').addEventListener('change',e=>{ if(window.AQ_PARTICLES)window.AQ_PARTICLES.speedMul=+e.target.value; store.set({currentsSpeed:+e.target.value}); });
  $('#cur-density').addEventListener('change',e=>{ if(window.AQ_PARTICLES)window.AQ_PARTICLES.setDensity(+e.target.value); store.set({currentsDensity:+e.target.value}); });

  /* ---------------- Search ---------------- */
  $('#global-search').addEventListener('keydown',e=>{ if(e.key!=='Enter')return; const q=e.target.value.trim().toLowerCase(); if(!q)return;
    const place=D.PLACES.find(p=>p.id!=='all'&&(q.includes(p.id)||p.name.toLowerCase().includes(q)));
    if(place){ AQ_MAP.flyTo(place.lng,place.lat,place.zoom,40); UI.toast('Flying to '+place.name); return; }
    const cell=D.GRID.find(c=>c.id.toLowerCase().includes(q)); if(cell){ AQ_MAP.selectCell(cell.id); AQ_MAP.flyTo(cell.lng,cell.lat,9); UI.toast('Located cell '+cell.id); } else UI.toast('No match. Try a place (e.g. Ratnagiri) or H3 id.',2800); });

  /* ---------------- Intelligence ---------------- */
  document.querySelectorAll('.intel-role').forEach(b=>b.addEventListener('click',()=>{ store.set({intelRole:b.dataset.role}); UI.renderIntel(); }));
  $('#intel-ask').addEventListener('click',()=>{ const q=$('#intel-query').value.trim()||AQ_INTEL.SUGGEST[store.get().intelRole][0]; AQ_INTEL.run(store.get().intelRole,q); });
  $('#intel-query').addEventListener('keydown',e=>{ if(e.key==='Enter'){ const q=e.target.value.trim(); if(q) AQ_INTEL.run(store.get().intelRole,q);} });

  /* ---------------- Notifications, drawers ---------------- */
  $('#btn-notif').addEventListener('click',()=>UI.toast('<b>3 alerts</b><br><span style="color:var(--text-2)">New high-confidence PFZ near Ratnagiri · Strong current front detected off Malvan</span>',4200));
  $('#btn-drawer').addEventListener('click',()=>$('#telemetry').classList.toggle('open'));
  $('#btn-mobile-nav').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));

  /* ---------------- Data page ---------------- */
  ['data-search','data-filter-conf','data-filter-source'].forEach(id=>{ const el=$('#'+id); el.addEventListener('input',()=>UI.renderDataPage()); el.addEventListener('change',()=>UI.renderDataPage()); });
  $('#data-export-csv').addEventListener('click',()=>UI.exportData('csv'));
  $('#data-export-json').addEventListener('click',()=>UI.exportData('json'));

  /* ---------------- Keyboard ---------------- */
  document.addEventListener('keydown',e=>{ if(!entered) return; if(e.target.matches('input,select,textarea'))return;
    const m={'1':'maps','2':'overview','3':'intel','4':'data'}; if(m[e.key])switchTab(m[e.key]);
    else if(e.key==='?'||e.key==='/')switchTab('help');
    else if(e.key===' '){ e.preventDefault(); togglePlay(); }
    else if(e.key.toLowerCase()==='r') AQ_MAP.resetView();
    else if(e.key.toLowerCase()==='b') setMapMode(store.get().mapMode==='pfz'?'bio':'pfz');
  });

  /* ---------------- Live loop ---------------- */
  function liveLoop(){ setInterval(()=>{ const s=$('#header-status'); if(s){ s.textContent='Syncing…'; setTimeout(()=>s.textContent='Live',600);} if(store.get().selectedH3) UI.renderTelemetry(); }, 20000); }

  store.subscribe(()=>UI.renderLegend());

  /* ---------------- Boot dashboard ---------------- */
  function boot(){
    if (booted) return; booted = true;
    renderTimelineStatic(); renderTimeline(); UI.renderDates(); UI.renderMapMode();
    UI.renderSidebar(); UI.renderLegend(); UI.renderTelemetry();
    initPickers(); initSidebars();
    loadBackendTimeline();
    loadPFZStats(store.get().selectedDate || '2026-09-05');

    // Register the real PFZ provider. It overrides mock cell values with
    // values returned by the backend for the currently requested date.
    AQ_DATA.registerProvider(async (ctx) => {
      const date = ctx.date || '2026-09-05';
      const grid = await AQ_API.getPFZGrid(date);

      if (!grid || !Array.isArray(grid.cells)) {
        throw new Error('Invalid PFZ grid response');
      }

      // Remember the authoritative backend status for this date.
      // This lets the UI move from "Forecast Pending" to "Forecast"
      // after an on-demand forecast is successfully generated.
      window.AQ_LAST_PFZ_GRID_META = {
        date,
        source: grid.source || 'forecast',
        status: grid.source === 'forecast' ? 'prediction' : 'available'
      };

      return grid.cells.map(cell => ({
        id: cell.h3_index,
        values: {
          pfz_probability: cell.pfz_probability,
          pfz_prediction: cell.pfz_prediction,
          confidence: cell.confidence,
          prediction_status: cell.prediction_status,
          sst_c: cell.sst_c,
          current_u_ms: cell.current_u_ms,
          current_v_ms: cell.current_v_ms,
          current_speed_ms: cell.current_speed_ms,
          salinity_psu: cell.salinity_psu,
          mld_m: cell.mixed_layer_m,
          ssh_m: cell.ssh_m,
          chl_mg: cell.chlorophyll_mg_m3
        }
      }));
    });

    // Register the real biodiversity provider.
    // It uses one full-grid request per date, keeping PFZ and biodiversity
    // synchronized on the same H3 grid without per-cell HTTP requests.
    AQ_DATA.registerProvider(async (ctx) => {
      const date = ctx.date || '2026-09-05';
      const grid = await AQ_API.request(
        `/biodiversity/grid?date=${encodeURIComponent(date)}`
      );

      if (!grid || !Array.isArray(grid.cells)) {
        throw new Error('Invalid biodiversity grid response');
      }

      return grid.cells.map(cell => ({
        id: cell.h3_index,
        values: {
          biodiversity: cell.predicted_biodiversity_index != null
            ? cell.predicted_biodiversity_index
            : cell.species_richness,
          biodiversity_hotspot_likelihood: cell.biodiversity_hotspot_likelihood,
          mess_similarity: cell.mess_similarity,
          confidence_score: cell.confidence_score,
          prediction_status: cell.prediction_status,
          observation_status: cell.observation_status,
          species_richness: cell.species_richness,
          occurrence_count: cell.occurrence_count,
          shannon_index: cell.shannon_index
        }
      }));
    });

    // Load the real 20,029-cell H3 grid from the backend.
    (async function loadBackendGrid(){
      try {
        const date = '2026-09-05';
        const grid = await AQ_API.request(
          `/pfz/grid?date=${encodeURIComponent(date)}`
        );

        if (!grid || !Array.isArray(grid.cells)) {
          throw new Error('Invalid PFZ grid response');
        }

        AQ_DATA.setBackendGrid(grid.cells);

        console.log('[AquaGrid] Backend PFZ grid loaded:', {
          date: grid.date,
          source: grid.source,
          totalCells: grid.total_cells,
          loadedCells: grid.cells.length
        });

        // Refresh map/UI after the real grid becomes available.
        if (typeof refreshData === 'function') {
          refreshData();
        }
      } catch (err) {
        console.error('[AquaGrid] Failed to load backend PFZ grid:', err);
      }
    })();

    let lastSel=null;
    store.subscribe(st=>{ if(st.selectedH3!==lastSel){ lastSel=st.selectedH3; UI.renderTelemetry(); } });
    if(location.hash && location.hash.slice(1)!=='maps') switchTab(location.hash.slice(1),true);
    liveLoop();
  }

  /* ---------------- Init landing ---------------- */
  document.addEventListener('DOMContentLoaded',()=>{
    AQ_LANDING.start(); AQ_LANDING.initReveal();
    // deep-link: ?enter=1 opens the dashboard directly (skips landing)
    if (new URLSearchParams(location.search).get('enter') === '1') enterDashboard();
  });
})();
