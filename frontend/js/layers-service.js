/* ============================================================
   AquaGrid v2 — Reusable Layer Service (Google Earth Engine-ready)
   A thin abstraction over MapLibre sources/layers so future GEE
   raster/vector/image overlays can be registered declaratively:

     LayerService.register(map, {
       id, type:'raster'|'vector'|'image'|'geojson',
       tiles:[...], url, coordinates, paint, opacity, before
     });

   No data is hardcoded — the UI drives everything through this API.
   ============================================================ */
(function (global) {
  'use strict';

  const registry = new Map(); // id -> descriptor

  function ensureSource(map, id, def) {
    if (map.getSource(id)) return;
    if (def.type === 'raster') {
      map.addSource(id, { type: 'raster', tiles: def.tiles, tileSize: def.tileSize || 256, attribution: def.attribution || '' });
    } else if (def.type === 'image') {
      map.addSource(id, { type: 'image', url: def.url, coordinates: def.coordinates });
    } else if (def.type === 'vector') {
      map.addSource(id, { type: 'vector', tiles: def.tiles });
    } else { // geojson
      map.addSource(id, { type: 'geojson', data: def.data || { type:'FeatureCollection', features:[] } });
    }
  }

  const LayerService = {
    /** Register (or update) a layer on a given map. */
    register(map, def) {
      registry.set(def.id, def);
      ensureSource(map, def.id, def);
      const layerId = def.id + '__layer';
      if (map.getLayer(layerId)) return layerId;

      const opacity = def.opacity != null ? def.opacity : 1;
      let spec;
      if (def.type === 'raster') {
        spec = { id: layerId, type: 'raster', source: def.id, paint: Object.assign({ 'raster-opacity': opacity }, def.paint || {}) };
      } else if (def.type === 'image') {
        spec = { id: layerId, type: 'raster', source: def.id, paint: { 'raster-opacity': opacity } };
      } else if (def.type === 'vector') {
        spec = { id: layerId, type: def.renderType || 'fill', source: def.id, 'source-layer': def.sourceLayer, paint: def.paint || {} };
      } else {
        spec = { id: layerId, type: def.renderType || 'fill', source: def.id, paint: def.paint || {} };
      }
      spec.layout = Object.assign({ visibility: def.visible === false ? 'none' : 'visible' }, def.layout || {});
      map.addLayer(spec, def.before);
      return layerId;
    },

    setVisible(map, id, on) {
      const l = id + '__layer';
      if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
    },

    setOpacity(map, id, op) {
      const l = id + '__layer';
      if (!map.getLayer(l)) return;
      const t = map.getLayer(l).type;
      const prop = t === 'raster' ? 'raster-opacity' : t === 'circle' ? 'circle-opacity' : 'fill-opacity';
      try { map.setPaintProperty(l, prop, op); } catch (e) {}
    },

    setData(map, id, data) {
      const s = map.getSource(id);
      if (s && s.setData) s.setData(data);
    },

    /** Reorder: move a layer above another. */
    moveAbove(map, id, refId) {
      const l = id + '__layer';
      if (map.getLayer(l)) map.moveLayer(l, refId ? refId + '__layer' : undefined);
    },

    list() { return Array.from(registry.values()); },
    get(id) { return registry.get(id); }
  };

  global.AQ_LAYERS = LayerService;
})(window);
