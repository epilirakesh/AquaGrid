/* ============================================================
   AquaGrid — Mock Data Layer
   Generates an H3-style hexagon grid over the Mumbai–Goa offshore
   region with deterministic, date-aware values, a current vector
   field, layer definitions and a record set.
   ============================================================ */
(function (global) {
  'use strict';

  // Region of interest (offshore Mumbai ~19N to Goa ~15N, Arabian Sea)
  const REGION = { minLng: 70.4, maxLng: 73.4, minLat: 14.9, maxLat: 19.3 };
  const CENTER = [72.0, 17.0];

  // The eastern edge of the study area follows the coastline: for a given
  // latitude, water lies WEST of this longitude. This is the single source of
  // truth used to (a) drop land-side hex cells and (b) keep ocean currents
  // strictly inside the offshore region of interest.
  function coastLngAt(lat){ return 73.0 - (lat - 14.9) * 0.05; }
  // small offshore buffer so currents never touch the coast
  const COAST_BUFFER = 0.06;

  // Region-of-interest polygon (offshore box, clipped to the coast on the east).
  // Currents render ONLY inside this ring; everything else (land + open sea
  // outside the study area) is left clear.
  function buildROI(){
    const ring = [];
    // west + south + north edges from the region box
    const steps = 24;
    for (let i = 0; i <= steps; i++){                     // south → north along the coast (east edge)
      const lat = REGION.minLat + (REGION.maxLat - REGION.minLat) * (i/steps);
      ring.push([ coastLngAt(lat) - COAST_BUFFER, lat ]);
    }
    ring.push([ REGION.minLng, REGION.maxLat ]);          // NW corner
    ring.push([ REGION.minLng, REGION.minLat ]);          // SW corner
    ring.push(ring[0]);                                   // close
    return [ring];
  }
  const ROI = buildROI();

  function pointInRing(lng, lat, ring){
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      const hit = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }
  // Is a coordinate inside the offshore region of interest (i.e. water we model)?
  function inRegion(lng, lat){
    if (lat < REGION.minLat || lat > REGION.maxLat || lng < REGION.minLng) return false;
    return lng < (coastLngAt(lat) - COAST_BUFFER) && pointInRing(lng, lat, ROI[0]);
  }

  // Coastal places along the Mumbai–Goa coast (for the place picker).
  // Coordinates are nudged slightly offshore so fly-to lands on water.
  const PLACES = [
    { id:'all',        name:'Full study area',  lng:71.9, lat:17.1, zoom:6.6 },
    { id:'mumbai',     name:'Mumbai',           lng:72.55, lat:18.95, zoom:8.2 },
    { id:'alibaug',    name:'Alibaug',          lng:72.65, lat:18.64, zoom:8.4 },
    { id:'murud',      name:'Murud-Janjira',    lng:72.83, lat:18.30, zoom:8.4 },
    { id:'harnai',     name:'Harnai',           lng:72.90, lat:17.82, zoom:8.4 },
    { id:'dabhol',     name:'Dabhol',           lng:73.05, lat:17.58, zoom:8.4 },
    { id:'ratnagiri',  name:'Ratnagiri',        lng:73.20, lat:16.98, zoom:8.3 },
    { id:'vijaydurg',  name:'Vijaydurg',        lng:73.28, lat:16.56, zoom:8.4 },
    { id:'devgad',     name:'Devgad',           lng:73.35, lat:16.38, zoom:8.4 },
    { id:'malvan',     name:'Malvan',           lng:73.42, lat:16.06, zoom:8.4 },
    { id:'sindhudurg', name:'Sindhudurg',       lng:73.45, lat:16.04, zoom:8.4 },
    { id:'vengurla',   name:'Vengurla',         lng:73.55, lat:15.86, zoom:8.4 },
    { id:'panaji',     name:'Panaji (Goa)',     lng:73.70, lat:15.50, zoom:8.2 },
    { id:'vasco',      name:'Vasco da Gama',    lng:73.75, lat:15.36, zoom:8.3 }
  ];

  // ---- deterministic pseudo-random ----
  function hash(n){ let x = Math.sin(n) * 43758.5453; return x - Math.floor(x); }
  function noise2(x, y, seed){
    const n = Math.sin(x*12.9898 + y*78.233 + seed*37.719) * 43758.5453;
    return n - Math.floor(n);
  }
  function smoothField(lng, lat, seed){
    // layered value noise for organic patterns
    let v = 0, amp = 0.6, f = 1.2;
    for (let o=0;o<4;o++){
      v += amp * noise2(lng*f, lat*f, seed+o);
      f *= 2.1; amp *= 0.5;
    }
    return Math.min(1, Math.max(0, v));
  }

  // ---- flat-top hexagon grid (approximating H3 res-6 look) ----
  function buildHexGrid(){
    const cells = [];
    const R = 0.11;                 // hex "radius" in degrees
    const w = Math.sqrt(3) * R;     // horizontal spacing
    const h = 1.5 * R;              // vertical spacing
    let row = 0;
    for (let lat = REGION.minLat; lat <= REGION.maxLat; lat += h, row++){
      const offset = (row % 2) ? w/2 : 0;
      for (let lng = REGION.minLng + offset; lng <= REGION.maxLng; lng += w){
        // keep cells strictly inside the offshore region of interest
        if (!inRegion(lng, lat)) continue; // drop land-side / out-of-ROI cells
        cells.push(makeCell(lng, lat));
      }
    }
    return cells;
  }

  const HEX_R = 0.11;               // base hex radius (deg)
  // Build a hexagon polygon around a centre. `scale` (0..1) shrinks the cell
  // so its rendered AREA can change dynamically per data value.
  function pointyHex(cLng, cLat, R, scale){
    const s = (scale == null ? 1 : Math.max(0.12, Math.min(1.15, scale)));
    const rr = R * s;
    const pts = [];
    for (let i=0;i<6;i++){
      const a = Math.PI/180 * (60*i - 30);
      pts.push([ cLng + rr*Math.cos(a)*0.87, cLat + rr*Math.sin(a) ]);
    }
    pts.push(pts[0]);
    return [pts];
  }

  let CELL_SEQ = 0;

  // Real AquaGrid H3 cells loaded from the FastAPI backend.
  // The initial grid remains empty until the backend response arrives.
  let GRID = [];

  function setBackendGrid(cells){
    if (!Array.isArray(cells)) {
      console.warn('[AquaGrid] Invalid backend grid payload');
      return;
    }

    // Keep the exported GRID array reference stable.
    // Other frontend modules already hold AQ_DATA.GRID.
    GRID.length = 0;

    cells.forEach((cell, index) => {
      GRID.push({
        id: cell.h3_index,
        seq: index,
        lng: Number(cell.center_lon),
        lat: Number(cell.center_lat)
      });
    });

    CELL_SEQ = GRID.length;

    console.log('[AquaGrid] Real H3 grid loaded:', GRID.length);
  }

  /* ======================================================================
     DYNAMIC CELL SIZING + LIVE DATA HOOKS
     ----------------------------------------------------------------------
     Cell rendered AREA is driven by data. Three modes:
       'fixed'  → every cell uses the full hex (scale = 1)
       'value'  → scale grows with the layer value (default; bigger = stronger)
       'custom' → use an explicit scale/polygon supplied via live data
     Real integrated data can override any cell through setLiveData().
     ====================================================================== */
  let CELL_SIZE_MODE = 'fixed';                 // H3 cells keep their true geographic footprint
  const LIVE = {};                              // id -> { values{}, scale, polygon }
  const dataProviders = [];                     // optional async fetchers

  function setCellSizeMode(mode){ CELL_SIZE_MODE = mode; emit(); }

  // Scale a cell for the currently displayed value (0..1) → area factor.
  function scaleForValue(val){
    if (val == null) return 0.55;
    return 0.35 + 0.65 * Math.max(0, Math.min(1, val));  // 0.35 .. 1.0
  }

  // Resolve the polygon for a cell + the value being visualised.
  function cellPolygon(cell, val){
    const live = LIVE[cell.id];
    if (live && live.polygon) return live.polygon;

    // Use the exact geographic boundary of the real H3 cell.
    // h3.cellToBoundary() returns [lat, lon] pairs.
    if (window.h3 && typeof window.h3.cellToBoundary === 'function') {
      try {
        const boundary = window.h3.cellToBoundary(cell.id);
        if (Array.isArray(boundary) && boundary.length >= 6) {
          const ring = boundary.map(([lat, lon]) => [lon, lat]);
          ring.push(ring[0]);
          return [ring];
        }
      } catch (e) {
        console.warn('[AquaGrid] H3 boundary failed for', cell.id, e);
      }
    }

    // Safe fallback only if H3-JS cannot resolve the cell.
    return pointyHex(cell.lng, cell.lat, HEX_R, 1);
  }

  // ---- date helpers ----
  function dateSeed(dateStr){
    const d = new Date(dateStr);
    return d.getFullYear()*100 + (d.getMonth()+1) + d.getDate()*0.03;
  }
  // Phase is relative to "today" — no hardcoded years. Anything after
  // today is a Forecast; anything on/before today is Historical.
  const TODAY = new Date(); TODAY.setHours(0,0,0,0);
  function isForecast(dateStr){ return new Date(dateStr).getTime() > TODAY.getTime(); }
  function phase(dateStr){ return isForecast(dateStr) ? 'forecast' : 'historical'; }
  // kept for backwards-compat with older callers
  function isPredictionYear(dateStr){ return isForecast(dateStr); }

  const SPEED_RAMP = [
    { max: 0.10, color: '#1E63C8', label: 'Slow' },
    { max: 0.25, color: '#19C6C8', label: 'Moderate' },
    { max: 0.45, color: '#2ECC71', label: 'Fast' },
    { max: 0.70, color: '#F4B942', label: 'Strong' },
    { max: 99,   color: '#FF8A3D', label: 'Extreme' }
  ];
  function speedColor(v){ for (const s of SPEED_RAMP) if (v<=s.max) return s.color; return '#FF8A3D'; }
  function speedLabel(v){ for (const s of SPEED_RAMP) if (v<=s.max) return s.label; return 'Extreme'; }

  function confBand(p){ return p>=0.66 ? 'High' : p>=0.4 ? 'Medium' : 'Low'; }

  // Compute the built-in (mock) per-cell values for a given date.
  // Real integrated data is merged on top of this by cellValues().
  function mockValues(cell, dateStr){
    const seed = dateSeed(dateStr);
    const t = (new Date(dateStr).getMonth())/11; // seasonality
    const base = smoothField(cell.lng, cell.lat, seed*0.13);
    const monsoon = Math.sin((t+0.25)*Math.PI*2)*0.15;

    const pfz = Math.min(0.98, Math.max(0.05, base*0.7 + monsoon + noise2(cell.lng,cell.lat,seed)*0.25));
    const sst = 26.5 + smoothField(cell.lng+3, cell.lat, seed*0.2)*4.5 + monsoon*3;    // 26–31C
    const chl = 0.2 + smoothField(cell.lng-2, cell.lat+1, seed*0.3)*3.4;               // mg/m3
    const sal = 34.6 + smoothField(cell.lng+1, cell.lat-1, seed*0.4)*1.6;              // psu
    const ssh = -0.15 + smoothField(cell.lng, cell.lat+2, seed*0.5)*0.5;              // m
    const mld = 15 + smoothField(cell.lng-1, cell.lat, seed*0.6)*55;                  // m
    const bio = Math.min(0.97, Math.max(0.02, smoothField(cell.lng+4, cell.lat-2, seed*0.7)*0.9 + chl*0.05));
    const richness = Math.round(8 + bio*34);
    const shannon = +(1.2 + bio*2.0).toFixed(2);

    // current vector field
    const ang = noise2(cell.lng*0.7, cell.lat*0.7, seed*0.9)*Math.PI*2;
    const spd = 0.05 + smoothField(cell.lng, cell.lat, seed*1.1)*0.6;

    return {
      pfz_probability: +pfz.toFixed(2),
      confidence: confBand(pfz),
      sst_c: +sst.toFixed(1),
      chl_mg: +chl.toFixed(2),
      salinity_psu: +sal.toFixed(2),
      ssh_m: +ssh.toFixed(2),
      mld_m: Math.round(mld),
      biodiversity: +bio.toFixed(2),
      species_richness: richness,
      shannon_index: shannon,
      current_speed_ms: +spd.toFixed(2),
      current_dir_deg: Math.round(ang*180/Math.PI + 180) % 360
    };
  }

  // Public value accessor.
  // Real backend data is authoritative. Mock values are used only when
  // explicitly enabled for development; they must never appear for an
  // unavailable real date.
  function cellValues(cell, dateStr){
    const live = LIVE[cell.id];

    if (live && live.values) {
      return Object.assign({}, live.values);
    }

    return {
      pfz_probability: null,
      pfz_prediction: null,
      confidence: 'Unavailable',
      prediction_status: 'unavailable',
      sst_c: null,
      chl_mg: null,
      salinity_psu: null,
      ssh_m: null,
      mld_m: null,
      biodiversity: null,
      species_richness: null,
      shannon_index: null,
      current_speed_ms: null,
      current_dir_deg: null
    };
  }

  function dirName(deg){
    const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg/22.5)%16];
  }
  function dirFull(deg){
    const map={N:'North',NNE:'North-North-East',NE:'North-East',ENE:'East-North-East',E:'East',ESE:'East-South-East',SE:'South-East',SSE:'South-South-East',S:'South',SSW:'South-South-West',SW:'South-West',WSW:'West-South-West',W:'West',WNW:'West-North-West',NW:'North-West',NNW:'North-North-West'};
    return map[dirName(deg)];
  }

  // Map a short layer key to the actual cellValues property
  const VALUE_KEY = {
    pfz: 'pfz_probability', bio: 'biodiversity',
    sst_c: 'sst_c', chl_mg: 'chl_mg', salinity_psu: 'salinity_psu',
    ssh_m: 'ssh_m', mld_m: 'mld_m'
  };

  // Build a GeoJSON FeatureCollection of PFZ / biodiversity for a date
  function toGeoJSON(dateStr, valueKey){
    const realKey = VALUE_KEY[valueKey] || valueKey;

    const features = [];

    GRID.forEach(c => {
      const v = cellValues(c, dateStr);
      const val = v[realKey];

      // Do not render empty/null real-data cells. In particular, an
      // unavailable PFZ date must produce no PFZ polygons rather than
      // a field of black/null-valued H3 cells.
      if (val === null || val === undefined || !Number.isFinite(Number(val))) {
        return;
      }

      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: cellPolygon(c, val) },
        properties: {
          id: c.id, seq: c.seq, lng: c.lng, lat: c.lat,
          value: val,
          pfz: v.pfz_probability, bio: v.biodiversity,
          confidence: v.confidence, sst: v.sst_c
        }
      });
    });

    return {
      type: 'FeatureCollection',
      features
    };
  }

  // Marker points — top PFZ recommended zones for a date
  function topZones(dateStr, n){
    return GRID.map(c => ({ c, v: cellValues(c, dateStr) }))
      .sort((a,b)=> b.v.pfz_probability - a.v.pfz_probability)
      .slice(0, n||8);
  }

  // Aggregate metrics for a date (Overview cards)
  function aggregate(dateStr){
    let hi=0, sstSum=0, maxSpd=0, bioHot=0, recCount=0;
    GRID.forEach(c=>{
      const v = cellValues(c, dateStr);
      if (v.confidence==='High') hi++;
      if (v.pfz_probability>=0.55) recCount++;
      sstSum += v.sst_c;
      if (v.current_speed_ms>maxSpd) maxSpd=v.current_speed_ms;
      if (v.biodiversity>=0.6) bioHot++;
    });
    return {
      highCells: hi,
      recommended: recCount,
      avgSST: +(sstSum/GRID.length).toFixed(1),
      maxSpeed: +maxSpd.toFixed(2),
      bioHotspots: bioHot,
      totalCells: GRID.length
    };
  }

  // A flat record set for the Data page (sampled cells across dates
  // spanning the past and future, relative to today — no hardcoded years).
  function buildRecords(){
    const now = new Date();
    const y = now.getFullYear();
    const dates = [
      (y-2)+'-08-15', (y-1)+'-03-15', (y-1)+'-11-15',
      y+'-'+String(now.getMonth()+1).padStart(2,'0')+'-15',
      (y+1)+'-02-15'
    ];
    const recs = [];
    dates.forEach(d=>{
      const ph = phase(d);
      topZones(d, 40).forEach(({c,v})=>{
        recs.push({
          date: d,
          source: ph,
          h3_cell: c.id,
          lat: c.lat, lng: c.lng,
          pfz_probability: v.pfz_probability,
          confidence: v.confidence,
          sst_c: v.sst_c,
          chl_mg: v.chl_mg,
          salinity_psu: v.salinity_psu,
          current_speed_ms: v.current_speed_ms
        });
      });
    });
    return recs;
  }

  // Layer definitions (new ocean palette). `map` = which map mode shows it.
  const LAYERS = [
    { key:'pfz',     name:'PFZ',                on:true,  opacity:0.85, color:'#62E6FF', type:'H3 Heatmap', map:'pfz',
      info:'Potential Fishing Zone probability derived from SST fronts, chlorophyll and current convergence.' },
    { key:'bio',     name:'Biodiversity',       on:true,  opacity:0.8,  color:'#2ECC71', type:'H3 Heatmap', map:'bio',
      info:'Biodiversity hotspot probability combining species richness and Shannon diversity index.' },
    { key:'currents',name:'Ocean Currents',     on:true,  opacity:1.0,  color:'#19C6C8', type:'Animated Particles', map:'both',
      info:'Windy-style animated particle streamlines driven by the surface current vector field.' },
    { key:'sst',     name:'SST',                on:false, opacity:0.6,  color:'#FF8A3D', type:'Raster', map:'both',
      info:'Sea Surface Temperature (°C).' },
    { key:'chl',     name:'Chlorophyll',        on:false, opacity:0.6,  color:'#2ECC71', type:'Raster', map:'both',
      info:'Chlorophyll-a concentration (mg/m³) — a proxy for phytoplankton productivity.' },
    { key:'sal',     name:'Salinity',           on:false, opacity:0.6,  color:'#8B9BFF', type:'Raster', map:'both',
      info:'Sea surface salinity (PSU).' },
    { key:'mld',     name:'Mixed Layer Depth',  on:false, opacity:0.6,  color:'#9FB2C6', type:'Raster', map:'both',
      info:'Ocean mixed layer depth (m).' },
    { key:'ssh',     name:'SSH',                on:false, opacity:0.6,  color:'#62E6FF', type:'Raster', map:'both',
      info:'Sea Surface Height anomaly (m).' },
    { key:'markers', name:'Recommended Zones',  on:true,  opacity:1.0,  color:'#F4B942', type:'Vector Markers', map:'pfz',
      info:'Top recommended fishing zones (marker pins) for the selected date.' }
  ];

  // Google Earth Engine-ready layer descriptors (reusable layer API).
  // These are placeholders wired to the layer service; swap `tiles` with a
  // real GEE tile endpoint later without touching UI code.
  const GEE_LAYERS = [
    { key:'gee_chl',  name:'Chlorophyll (MODIS)', provider:'GEE', on:false, opacity:0.7, color:'#2ECC71', type:'GEE Raster',
      info:'NASA/OCEANDATA MODIS-Aqua chlorophyll — connect a GEE tile URL to activate.' },
    { key:'gee_sst',  name:'SST (MUR)',           provider:'GEE', on:false, opacity:0.7, color:'#FF8A3D', type:'GEE Raster',
      info:'NASA JPL MUR sea-surface temperature — connect a GEE tile URL to activate.' },
    { key:'gee_bath', name:'Bathymetry (GEBCO)',  provider:'GEE', on:false, opacity:0.6, color:'#62E6FF', type:'GEE Raster',
      info:'GEBCO seafloor bathymetry — connect a GEE tile URL to activate.' }
  ];

  /* ======================================================================
     LIVE DATA INGESTION API  (frontend-ready; nothing is hardcoded)
     ----------------------------------------------------------------------
     Integrate real data later without touching the map/UI:

       // 1) Point-value overrides per H3 cell (merged over the mock model)
       AQ_DATA.setLiveData([
         { id:'8a1b2c3d…', values:{ pfz_probability:0.87, sst_c:28.9 }, scale:0.9 },
         { id:'8a9f0e1d…', values:{ biodiversity:0.71 } }
         // `polygon` (GeoJSON ring array) may also be supplied to set an
         // explicit cell shape/area coming from real H3 geometry.
       ]);

       // 2) Choose how cell AREA is derived
       AQ_DATA.setCellSizeMode('value');   // 'fixed' | 'value' | 'custom'

       // 3) Register an async provider that returns rows like above; call
       //    AQ_DATA.refresh() (e.g. on a poll / WebSocket message) to pull.
       AQ_DATA.registerProvider(async (ctx)=> fetch('/api/pfz?date='+ctx.date).then(r=>r.json()));

     Any of these fire an 'aq-data-updated' event; the map re-renders live.
     ====================================================================== */
  function emit(){ try { window.dispatchEvent(new Event('aq-data-updated')); } catch(e){} }

  function setLiveData(rows){
    (rows||[]).forEach(r => {
      if (!r || !r.id) return;
      const cur = LIVE[r.id] || (LIVE[r.id] = {});
      if (r.values) cur.values = Object.assign({}, cur.values, r.values);
      if (r.scale != null) cur.scale = r.scale;
      if (r.polygon) cur.polygon = r.polygon;
    });
    emit();
  }
  function clearLiveData(){ for (const k in LIVE) delete LIVE[k]; emit(); }
  function registerProvider(fn){ if (typeof fn === 'function') dataProviders.push(fn); }
  async function refresh(ctx){
    ctx = ctx || {};
    for (const fn of dataProviders) {
      try { const rows = await fn(ctx); if (rows) setLiveData(rows); }
      catch (e) { console.warn('AQ_DATA provider failed', e); }
    }
    emit();
  }
  // Look up a cell by id (handy for live updates keyed on H3 index)
  function getCell(id){ return GRID.find(c => c.id === id); }

  global.AQ_DATA = {
    REGION, CENTER, PLACES, GRID, LAYERS, GEE_LAYERS, SPEED_RAMP, HEX_R,
    setBackendGrid,
    ROI, inRegion, coastLngAt,
    cellValues, mockValues, toGeoJSON, cellPolygon, pointyHex, topZones, aggregate,
    speedColor, speedLabel, confBand, dirName, dirFull,
    isForecast, phase, isPredictionYear, buildRecords, VALUE_KEY, getCell,
    // live-data + dynamic sizing API
    setLiveData, clearLiveData, setCellSizeMode, registerProvider, refresh
  };
})(window);
