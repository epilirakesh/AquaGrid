/* ============================================================
   AquaGrid — Simplified western-India coastline / landmass
   (approximate polygon for a subtle, self-contained base map —
   no external tiles, no API key). West coast: Mumbai → Goa → Karnataka.
   ============================================================ */
(function (global) {
  'use strict';

  // Land polygon east of the offshore study region.
  // Coordinates are approximate and intended only as a visual backdrop.
  const LAND = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: 'India (west coast)' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [72.60, 19.30], [72.78, 19.20], [72.83, 19.07], [72.87, 18.92],
          [72.86, 18.70], [72.95, 18.40], [73.05, 18.05], [73.10, 17.70],
          [73.20, 17.30], [73.32, 16.98], [73.45, 16.60], [73.55, 16.20],
          [73.68, 15.85], [73.78, 15.50], [73.80, 15.15], [73.85, 14.90],
          // close far east + south to fill land
          [78.50, 14.90], [78.50, 19.30], [72.60, 19.30]
        ]]
      }
    }]
  };

  // A soft "shelf" band just offshore for depth cueing
  const SHELF = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [72.30, 19.30], [72.55, 19.20], [72.62, 18.70], [72.78, 18.05],
          [72.90, 17.30], [73.05, 16.60], [73.25, 15.85], [73.45, 15.15],
          [73.55, 14.90], [72.30, 14.90], [72.30, 19.30]
        ]]
      }
    }]
  };

  // ---- Water / land test -------------------------------------------------
  // Ray-casting point-in-polygon against the LAND polygon. Returns true when
  // the coordinate is OVER WATER (i.e. NOT inside any land polygon). Used to
  // keep ocean-current particles strictly inside the sea.
  // When real coastline/land GeoJSON is integrated later, call
  // AQ_COAST.setLandMask(featureCollection) and every consumer updates.
  let LAND_RINGS = ringsOf(LAND);

  function ringsOf(fc) {
    const rings = [];
    (fc.features || []).forEach(f => {
      const g = f.geometry; if (!g) return;
      if (g.type === 'Polygon') g.coordinates.forEach(r => rings.push(r));
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(poly => poly.forEach(r => rings.push(r)));
    });
    return rings;
  }

  function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function isLand(lng, lat) {
    for (let k = 0; k < LAND_RINGS.length; k++) if (pointInRing(lng, lat, LAND_RINGS[k])) return true;
    return false;
  }
  function isWater(lng, lat) { return !isLand(lng, lat); }

  // Swap in real land data at runtime (keeps everything data-driven).
  function setLandMask(fc) {
    if (!fc) return;
    LAND.features = fc.features;
    LAND_RINGS = ringsOf(fc);
    window.dispatchEvent(new Event('aq-landmask-changed'));
  }

  global.AQ_COAST = { LAND, SHELF, isLand, isWater, setLandMask };
})(window);
