/* ============================================================
   AquaGrid v2 — Global State (Zustand-style store)
   ============================================================ */
(function (global) {
  'use strict';

  function createStore(initial) {
    let state = initial;
    const listeners = new Set();
    return {
      get: () => state,
      set(patch) {
        const next = typeof patch === 'function' ? patch(state) : patch;
        state = Object.assign({}, state, next);
        listeners.forEach(l => l(state));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
  }

  const layerState = {};
  AQ_DATA.LAYERS.forEach(l => layerState[l.key] = { on: l.on, opacity: l.opacity });
  AQ_DATA.GEE_LAYERS.forEach(l => layerState[l.key] = { on: l.on, opacity: l.opacity });

  // default date = today (drives Historical vs Forecast wording relative to now)
  const today = new Date().toISOString().slice(0, 10);

  const store = createStore({
    currentTab: 'maps',
    mapMode: 'pfz',            // 'pfz' | 'bio'
    basemap: 'ocean',          // 'ocean' | 'satellite' | 'hybrid'
    selectedDate: today,
    selectedPlace: 'all',
    selectedH3: null,
    hoverH3: null,
    activeLayers: layerState,
    playbackState: 'paused',
    playbackSpeed: 1,
    currentsPlaying: true,
    currentsSpeed: 1,
    currentsDensity: 1,
    intelRole: 'fisher',
    mapViewport: { center: AQ_DATA.CENTER, zoom: 6.6, pitch: 0, bearing: 0 },
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    entered: false
  });

  global.AQ_STORE = store;
})(window);
