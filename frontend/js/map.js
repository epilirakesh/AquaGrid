/* ============================================================
   AquaGrid v2 — MapLibre controller (single-map architecture)
   Real satellite + ocean basemap (Esri, no API key), 3D globe
   projection, PFZ + Biodiversity layers on ONE map crossfaded by
   mode, H3 interactions, and GEE-ready layer service hooks.
   ============================================================ */
(function (global) {
  'use strict';

  const store = AQ_STORE;
  let map, particles, tooltip;
  let ready = false;

  function baseStyle() {
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        sat: { type:'raster', tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize:256, attribution:'Esri, Maxar, Earthstar Geographics' },
        ocean: { type:'raster', tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'], tileSize:256, attribution:'Esri Ocean' },
        oceanref: { type:'raster', tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}'], tileSize:256 }
      },
      layers: [
        { id:'bg', type:'background', paint:{ 'background-color':'#050B16' } },
        { id:'ocean', type:'raster', source:'ocean', paint:{ 'raster-opacity':0.95, 'raster-saturation':-0.08, 'raster-brightness-min':0.02, 'raster-brightness-max':0.74 } },
        { id:'sat', type:'raster', source:'sat', paint:{ 'raster-opacity':0.4, 'raster-saturation':-0.35, 'raster-brightness-max':0.7, 'raster-contrast':0.05 } },
        { id:'oceanref', type:'raster', source:'oceanref', paint:{ 'raster-opacity':0.32 } }
      ]
    };
  }

  function init() {
    tooltip = document.getElementById('map-tooltip');
    map = new maplibregl.Map({
      container: 'map', style: baseStyle(), center: AQ_DATA.CENTER,
      zoom: 6.6, pitch: 0, bearing: 0, attributionControl:{ compact:true },
      dragRotate: true, maxZoom: 12, minZoom: 2
    });
    map.on('style.load', () => { try { map.setProjection({ type:'globe' }); } catch(e){} });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch:true }), 'bottom-right');
    map.touchZoomRotate.enableRotation();
    map.boxZoom.enable();

    map.on('load', () => {
      addLayers();
      ready = true;
      refreshData();
      applyLayerVisibility();
      applyMapMode(store.get().mapMode, true);
      setBasemap(store.get().basemap || 'ocean');

      const canvas = document.getElementById('particle-canvas');
      particles = new ParticleField(canvas, map);
      particles.setDate(store.get().selectedDate);
      particles.speedMul = store.get().currentsSpeed;
      particles.density = store.get().currentsDensity;
      particles.start();
      global.AQ_PARTICLES = particles;

      map.on('resize', () => particles && particles.resize());
      window.addEventListener('resize', () => particles && particles.resize());
      // keep the current field locked to the region of interest as the camera moves
      map.on('move', () => particles && particles.refreshBounds());
      map.on('moveend', () => { const c=map.getCenter(); if(particles) particles.refreshBounds(); store.set({ mapViewport:{ center:[c.lng,c.lat], zoom:map.getZoom(), pitch:map.getPitch(), bearing:map.getBearing() } }); });

      // Live-data ready: any setLiveData()/refresh()/size-mode change re-renders
      // the cells instantly (dynamic area + values), and telemetry follows.
      window.addEventListener('aq-data-updated', () => { refreshData(); try{ AQ_UI.renderTelemetry(); AQ_UI.renderLegend(); }catch(e){} });
      // If a real coastline/land mask is swapped in, respawn particles on water.
      window.addEventListener('aq-landmask-changed', () => { if (particles) particles.respawn(); });

      bindInteractions();
      global.dispatchEvent(new Event('aq-map-ready'));
    });
  }

  function addLayers() {
    // PFZ
    map.addSource('pfz', { type:'geojson', data: emptyFC() });
    map.addLayer({ id:'pfz-fill', type:'fill', source:'pfz', paint:{
      'fill-color':['interpolate',['linear'],['get','value'], 0,'#0e4a63', 0.25,'#127fa6', 0.45,'#19c6c8', 0.65,'#48e0d8', 0.85,'#8ff0ea', 1,'#c9fbf6'],
      'fill-opacity':0 } });
    map.addLayer({ id:'pfz-line', type:'line', source:'pfz', paint:{ 'line-color':'rgba(98,230,255,0.22)', 'line-width':0.5, 'line-opacity':0 } });

    // Biodiversity
    map.addSource('bio', { type:'geojson', data: emptyFC() });
    map.addLayer({ id:'bio-fill', type:'fill', source:'bio', paint:{
      'fill-color':['interpolate',['linear'],['get','value'], 0,'#0c2a17', 0.3,'#15803d', 0.55,'#2ECC71', 0.75,'#7ef0a6', 0.9,'#d7ffe6'],
      'fill-opacity':0 } });
    map.addLayer({ id:'bio-line', type:'line', source:'bio', paint:{ 'line-color':'rgba(46,204,113,0.22)', 'line-width':0.5, 'line-opacity':0 } });

    // shared hover / selected outline
    map.addSource('hoverfc', { type:'geojson', data: emptyFC() });
    map.addLayer({ id:'cell-hover', type:'line', source:'hoverfc', paint:{ 'line-color':'#ffffff', 'line-width':2, 'line-opacity':0.7 } });
    map.addLayer({ id:'cell-selected', type:'line', source:'pfz', paint:{ 'line-color':'#ffffff', 'line-width':3 }, filter:['==','id','__none__'] });

    // env raster-style layers
    ['sst','chl','sal','ssh','mld'].forEach(k => {
      map.addSource(k, { type:'geojson', data: emptyFC() });
      map.addLayer({ id:k+'-fill', type:'fill', source:k, layout:{ visibility:'none' }, paint:{ 'fill-color':rasterRamp(k), 'fill-opacity':0.6, 'fill-antialias':false } });
    });

    // species richness dots (bio mode)
    map.addSource('rich', { type:'geojson', data: emptyFC() });
    map.addLayer({ id:'rich-dot', type:'circle', source:'rich', layout:{ visibility:'none' }, paint:{
      'circle-radius':['interpolate',['linear'],['get','value'],0.5,3,1,10], 'circle-color':'#F4B942', 'circle-opacity':0.55, 'circle-blur':0.3 } });

    // recommended-zone markers (pfz mode)
    map.addSource('markers', { type:'geojson', data: emptyFC() });
    map.addLayer({ id:'markers-glow', type:'circle', source:'markers', paint:{ 'circle-radius':16, 'circle-color':'#F4B942', 'circle-opacity':0.18, 'circle-blur':0.6 } });
    map.addLayer({ id:'markers-dot', type:'circle', source:'markers', paint:{ 'circle-radius':['interpolate',['linear'],['get','value'],0.5,5,1,9], 'circle-color':'#F4B942', 'circle-stroke-color':'#fff', 'circle-stroke-width':1.5 } });

    // coastal place labels — always visible (own layer, never dropped by basemap zoom)
    map.addSource('places', { type:'geojson', data: {
      type:'FeatureCollection',
      features: AQ_DATA.PLACES.filter(p=>p.id!=='all').map(p=>({ type:'Feature', geometry:{ type:'Point', coordinates:[p.lng,p.lat] }, properties:{ name:p.name } }))
    }});
    map.addLayer({ id:'places-dot', type:'circle', source:'places', paint:{
      'circle-radius':4, 'circle-color':'#ffffff', 'circle-stroke-color':'#19C6C8', 'circle-stroke-width':2, 'circle-opacity':0.9 } });
    map.addLayer({ id:'places-label', type:'symbol', source:'places',
      layout:{ 'text-field':['get','name'], 'text-font':['Open Sans Regular','Arial Unicode MS Regular'], 'text-size':12, 'text-offset':[0,1.1], 'text-anchor':'top', 'text-allow-overlap':true, 'text-ignore-placement':true },
      paint:{ 'text-color':'#EAF6FF', 'text-halo-color':'#03101c', 'text-halo-width':1.6 } });
  }

  const BASEMAPS = {
    ocean:     { ocean:0.95, sat:0.0,  oceanref:0.35 },
    satellite: { ocean:0.0,  sat:0.95, oceanref:0.0  },
    hybrid:    { ocean:0.55, sat:0.55, oceanref:0.35 }
  };
  function setBasemap(kind) {
    if (!ready) return;
    const b = BASEMAPS[kind] || BASEMAPS.ocean;
    try {
      map.setPaintProperty('ocean','raster-opacity', b.ocean);
      map.setPaintProperty('sat','raster-opacity', kind==='satellite'?0.95:(kind==='hybrid'?0.6:0.35));
      map.setPaintProperty('sat','raster-saturation', kind==='satellite'?0:-0.35);
      map.setPaintProperty('sat','raster-brightness-max', kind==='satellite'?1:0.7);
      map.setPaintProperty('oceanref','raster-opacity', b.oceanref);
    } catch(e){}
  }

  function rasterRamp(key) {
    const r = {
      sst: ['interpolate',['linear'],['get','value'], 26,'#123a8a', 28,'#7c3aed', 29,'#FF8A3D', 31,'#ffd36b'],
      chl: ['interpolate',['linear'],['get','value'], 0.2,'#052e16', 1,'#166534', 2,'#2ECC71', 3.5,'#ecffd6'],
      sal: ['interpolate',['linear'],['get','value'], 34.6,'#26308a', 35.4,'#6a7bff', 36.2,'#c7d2fe'],
      ssh: ['interpolate',['linear'],['get','value'], -0.15,'#0c4a6e', 0.1,'#19c6c8', 0.35,'#c9fbf6'],
      mld: ['interpolate',['linear'],['get','value'], 15,'#1e293b', 40,'#64748b', 70,'#e2e8f0']
    };
    return r[key];
  }
  function emptyFC(){ return { type:'FeatureCollection', features:[] }; }
  function varFC(dateStr, key){ return { type:'FeatureCollection', features: AQ_DATA.GRID.map(c => { const v=AQ_DATA.cellValues(c,dateStr); const val=v[key]; return { type:'Feature', geometry:{ type:'Polygon', coordinates:AQ_DATA.cellPolygon(c,val) }, properties:{ id:c.id, value:val } }; }) }; }
  function buildCellInfo(cell, dateStr){ const v=AQ_DATA.cellValues(cell,dateStr); return Object.assign({ id:cell.id, lng:cell.lng, lat:cell.lat, date:dateStr, forecast:AQ_DATA.isForecast(dateStr) }, v); }

  function refreshData() {
    if (!ready) return;
    const d = store.get().selectedDate;
    map.getSource('pfz').setData(AQ_DATA.toGeoJSON(d, 'pfz'));
    map.getSource('bio').setData(AQ_DATA.toGeoJSON(d, 'bio'));
    map.getSource('sst').setData(varFC(d,'sst_c'));
    map.getSource('chl').setData(varFC(d,'chl_mg'));
    map.getSource('sal').setData(varFC(d,'salinity_psu'));
    map.getSource('ssh').setData(varFC(d,'ssh_m'));
    map.getSource('mld').setData(varFC(d,'mld_m'));

    const zones = AQ_DATA.topZones(d, 8);
    map.getSource('markers').setData({ type:'FeatureCollection', features: zones.map(z=>({ type:'Feature', geometry:{ type:'Point', coordinates:[z.c.lng,z.c.lat] }, properties:{ id:z.c.id, value:z.v.pfz_probability } })) });
    const rich = AQ_DATA.isForecast(d) ? AQ_DATA.GRID.map(c=>({c,v:AQ_DATA.cellValues(c,d)})).filter(x=>Number.isFinite(x.v.biodiversity) && x.v.biodiversity>=0.55).map(x=>({ type:'Feature', geometry:{ type:'Point', coordinates:[x.c.lng,x.c.lat] }, properties:{ value:x.v.biodiversity } })) : [];
    map.getSource('rich').setData({ type:'FeatureCollection', features: rich });

    if (particles) particles.setDate(d);
    const sel = store.get().selectedH3;
    if (sel){ const cell=AQ_DATA.GRID.find(c=>c.id===sel.id); if(cell) store.set({ selectedH3: buildCellInfo(cell, d) }); }
  }

  function applyLayerVisibility() {
    if (!ready) return;
    const al = store.get().activeLayers, mode = store.get().mapMode;
    const setF = (id,on,op)=>{ if(!map.getLayer(id))return; map.setLayoutProperty(id,'visibility',on?'visible':'none'); if(op!=null){ try{ map.setPaintProperty(id, id.endsWith('-fill')?'fill-opacity':'circle-opacity', op);}catch(e){} } };
    ['sst','chl','sal','ssh','mld'].forEach(k=>setF(k+'-fill', al[k].on, al[k].opacity));
    const mk = (al.markers.on && mode==='pfz')?'visible':'none';
    map.setLayoutProperty('markers-dot','visibility',mk); map.setLayoutProperty('markers-glow','visibility',mk);
    map.setLayoutProperty('rich-dot','visibility', mode==='bio'?'visible':'none');
    if (particles) particles.setVisible(al.currents.on);
    // pfz/bio fill opacities respect mode + toggle
    applyMapMode(mode, false);
    global.dispatchEvent(new Event('aq-layers-changed'));
  }

  // Crossfade PFZ <-> Bio fills on the single map
  function applyMapMode(mode, instant) {
    if (!ready) return;
    const al = store.get().activeLayers;
    const pfzOp = (mode==='pfz' && al.pfz.on) ? al.pfz.opacity : 0;
    const bioOp = (mode==='bio' && al.bio.on) ? al.bio.opacity : 0;
    try {
      map.setPaintProperty('pfz-fill','fill-opacity-transition',{ duration: instant?0:600 });
      map.setPaintProperty('bio-fill','fill-opacity-transition',{ duration: instant?0:600 });
      map.setPaintProperty('pfz-fill','fill-opacity', pfzOp);
      map.setPaintProperty('bio-fill','fill-opacity', bioOp);
      map.setPaintProperty('pfz-line','line-opacity', mode==='pfz'?1:0);
      map.setPaintProperty('bio-line','line-opacity', mode==='bio'?1:0);
    } catch(e){}
    // selected outline follows the active source
    if (map.getLayer('cell-selected')) {
      const src = mode==='bio' ? 'bio' : 'pfz';
      // recreate selected layer bound to the right source
      const filt = map.getFilter('cell-selected');
      map.removeLayer('cell-selected');
      map.addLayer({ id:'cell-selected', type:'line', source:src, paint:{ 'line-color':'#ffffff','line-width':3 }, filter: filt || ['==','id','__none__'] });
    }
  }

  function bindInteractions() {
    ['pfz-fill','bio-fill'].forEach(layer=>{
      map.on('mousemove', layer, (e)=>{ const f=e.features[0]; if(!f)return;
        // reuse the feature's own (dynamically-sized) geometry for the outline
        map.getSource('hoverfc').setData({ type:'FeatureCollection', features:[{ type:'Feature', geometry:f.geometry, properties:{} }] });
        map.getCanvas().style.cursor='pointer'; showTooltip(e.point, f.properties); store.set({ hoverH3:f.properties.id });
      });
      map.on('mouseleave', layer, ()=>{ map.getSource('hoverfc').setData(emptyFC()); map.getCanvas().style.cursor=''; tooltip.style.display='none'; });
      map.on('click', layer, (e)=>{ const f=e.features[0]; if(f) selectCell(f.properties.id); });
      map.on('dblclick', layer, (e)=>{ e.preventDefault(); const f=e.features[0]; if(!f)return; const cell=AQ_DATA.GRID.find(c=>c.id===f.properties.id); if(cell) flyTo(cell.lng,cell.lat,9.2); selectCell(f.properties.id); });
    });
    map.on('click','markers-dot',(e)=>{ const f=e.features[0]; if(f) selectCell(f.properties.id); });
  }

  async function selectCell(id) {
    const cell = AQ_DATA.GRID.find(c=>c.id===id); if(!cell) return;
    const date = store.get().selectedDate;
    if (map.getLayer('cell-selected')) map.setFilter('cell-selected',['==','id',id]);

    const localInfo = buildCellInfo(cell, date);
    store.set({ selectedH3: localInfo });
    document.getElementById('telemetry').classList.add('open');

    try {
      const [pfz, bio] = await Promise.all([
        AQ_API.getPFZCell(id, date),
        AQ_API.getBiodiversityCell(id, date)
      ]);

      if (store.get().selectedDate !== date) return;

      store.set({
        selectedH3: Object.assign({}, localInfo, {
          pfz_probability: pfz?.probability ?? localInfo.pfz_probability,
          pfz_prediction: pfz?.prediction ?? localInfo.pfz_prediction,
          confidence: pfz?.confidence ?? localInfo.confidence,
          current_speed_ms: pfz?.environment?.current_speed_ms ?? localInfo.current_speed_ms,
          current_dir_deg: (pfz?.environment?.current_u_ms != null && pfz?.environment?.current_v_ms != null)
            ? (Math.round((Math.atan2(pfz.environment.current_v_ms, pfz.environment.current_u_ms) * 180 / Math.PI + 180) % 360))
            : localInfo.current_dir_deg,
          sst_c: pfz?.environment?.sst_c ?? localInfo.sst_c,
          salinity_psu: pfz?.environment?.salinity_psu ?? localInfo.salinity_psu,
          chl_mg: pfz?.environment?.chlorophyll_mg_m3 ?? localInfo.chl_mg,
          mld_m: pfz?.environment?.mixed_layer_m ?? localInfo.mld_m,
          ssh_m: pfz?.environment?.ssh_m ?? localInfo.ssh_m,
          biodiversity: bio?.predicted_biodiversity_index ?? bio?.biodiversity_hotspot_likelihood ?? localInfo.biodiversity,
          biodiversity_hotspot_likelihood: bio?.biodiversity_hotspot_likelihood ?? localInfo.biodiversity_hotspot_likelihood,
          mess_similarity: bio?.mess_similarity ?? localInfo.mess_similarity,
          confidence_score: bio?.confidence_score ?? localInfo.confidence_score,
          species_richness: bio?.species_richness ?? localInfo.species_richness,
          occurrence_count: bio?.occurrence_count ?? localInfo.occurrence_count,
          shannon_index: bio?.shannon_index ?? localInfo.shannon_index,
          prediction_status: bio?.prediction_status ?? localInfo.prediction_status,
          observation_status: bio?.observation_status ?? localInfo.observation_status
        })
      });
    } catch (e) {
      console.warn('Exact-H3 telemetry fetch failed; using grid data.', e);
    }
  }

  function showTooltip(pt, p) {
    const mode = store.get().mapMode;
    tooltip.style.display='block';
    tooltip.style.left=(pt.x+70)+'px'; tooltip.style.top=(pt.y+90)+'px';
    const v = p.value!=null ? Math.round(p.value*100)+'%' : '—';
    tooltip.innerHTML = '<div class="tt-title">'+(p.id||'')+'</div>'+
      '<div class="tt-row"><span>'+(mode==='bio'?'Biodiversity':'PFZ')+'</span><b>'+v+'</b></div>'+
      (p.confidence?'<div class="tt-row"><span>Confidence</span><b>'+p.confidence+'</b></div>':'')+
      (p.sst!=null?'<div class="tt-row"><span>SST</span><b>'+p.sst+'°C</b></div>':'');
  }

  function flyTo(lng, lat, z, pitch){ if(map) map.flyTo({ center:[lng,lat], zoom:z||9, pitch:pitch!=null?pitch:40, duration:1500, essential:true }); }
  function resetView(){ flyTo(AQ_DATA.CENTER[0], AQ_DATA.CENTER[1], 6.6, 0); }
  function setMapMode(mode){ applyMapMode(mode, false); applyLayerVisibility(); }
  function resizeAll(){ setTimeout(()=>{ map&&map.resize(); particles&&particles.resize(); }, 60); }

  global.AQ_MAP = { init, refreshData, applyLayerVisibility, flyTo, resetView, selectCell, setMapMode, setBasemap, resizeAll, getMap:()=>map, getBioMap:()=>null };
})(window);
