# 🌊 AquaGrid v2 — AI-powered Marine Intelligence Platform

A premium, glassmorphic **marine digital twin** for the **Mumbai–Goa offshore region**. Full-screen 3D map, animated ocean currents, separate **PFZ** and **Biodiversity** maps, a role-based **AI Intelligence** panel, and a Historical/Forecast timeline — styled after Windy × Sentinel Hub × ArcGIS × Apple VisionOS.

> Built as a static site (HTML / CSS / vanilla ES modules). It reproduces the requested React/Vite/Zustand/Framer-Motion experience with an equivalent framework-free stack — the store is a Zustand-style subscribe/set store, transitions use CSS + Web Animations, and MapLibre GL powers the map. Architecture is componentised and **Google Earth Engine-ready**.

---

## ✅ Completed in v2

### Theme & identity
- Complete **ocean-glass redesign**: deep navy `#050B16`, graphite, teal `#19C6C8`, cyan `#62E6FF`, emerald `#2ECC71`, warm gold `#F4B942`.
- **Glassmorphism** everywhere: translucent, blurred, soft-bordered floating panels with hover glow.
- New **AquaGrid logo** (wave + H3 hexagon + subtle grid + teal glow) as `assets/logo.svg` + `favicon.svg`.

### Cinematic entry
- **Landing page** (`#landing`): animated canvas globe (rotating lat/long grid + subcontinent), floating particles, star field, ocean-wave bands, scroll-reveal Problem / Objectives / Technology sections, dual **Enter Dashboard** CTAs.
- **Cinematic dive**: on Enter, the globe/camera dives from world view (zoom 2.4) down into the study area (zoom 6.6, 35° pitch) as glass panels fade in. Respects reduced-motion; has a safety timeout so the loader never sticks.

### Full-screen real map (fixed)
- **MapLibre GL JS**, full viewport, everything floats above it.
- **Real basemap**: Esri **World Ocean** (bathymetry) + **World Imagery** (satellite, dimmed/desaturated for the digital-twin look) + ocean reference labels — **no API key**.
- **3D globe projection**, terrain-style shading, smooth inertia, rotate/pitch/box-zoom, correct resize on tab/mode changes.

### Two maps: PFZ ↔ Biodiversity
- Single-map **crossfade** architecture (reliable, one WebGL context): header switch animates between the cyan **PFZ** heatmap (+ recommended-zone gold pins) and the emerald **Biodiversity** heatmap (+ species-richness dots). Keyboard `B` toggles.

### Ocean currents (Windy-style)
- ~2,400 × density canvas particles, **curved streamlines** with fading trails, velocity-based color ramp (blue→cyan→green→gold→orange). Controls: **Play/Pause**, **speed** (0.5–4×), **density** (sparse/normal/dense).

### Place & date selection
- **Place picker**: 14 locations along the Mumbai–Goa coast (Mumbai, Alibaug, Ratnagiri, Malvan, Sindhudurg, Panaji, …) with animated **fly-to**.
- **Date pickers** in the search bar and timeline; global search flies to a place or H3 cell.

### Timeline (Historical vs Forecast)
- **No hardcoded years.** Phase is relative to **today**: on/before today → **Historical** (advisory + observed PFZ + replay score); after today → **AI Forecast** (probability + forecast confidence). Play/pause/step/now, drag scrub, date picker, `now` marker, historical/forecast track shading, 1–8× playback.

### AI Intelligence panel
- Role tabs **Fisher / Researcher / Policy Maker**, each with a **detailed profile card** (title, tagline, capability paragraph, "What you get" list and "How to use it" guidance) shown above the query box, plus tailored suggestions and computed answers:
  - Fisher → best PFZ zones, confidence, distance, SST, current direction, plain-language advice.
  - Researcher → hotspot score, species richness, Shannon index, environmental drivers.
  - Policy Maker → 12-month SST/salinity trend, anomaly flag, trend chart, downloadable summary.

### Telemetry, cards, data
- Floating glass **telemetry**: animated compass + radial speed gauge, Historical/Forecast metric blocks, biodiversity/richness/Shannon/MLD/SSH.
- **Overview** cards with animated counters, sparklines, hover glow, and a Historical+Forecast trend chart.
- **Data** explorer: search / sort / filter / **CSV + JSON export**.

### Google Earth Engine-ready
- `js/layers-service.js` — reusable `AQ_LAYERS.register/setVisible/setOpacity/setData/moveAbove` API for raster / vector / image / geojson overlays. Sidebar lists placeholder **GEE layers** (Chlorophyll MODIS, SST MUR, Bathymetry GEBCO); point them at a real GEE tile URL to render live data with no UI changes.

### Ocean-currents stay on water only
- `js/coastline.js` exposes a ray-cast land/water mask (`AQ_COAST.isWater(lng,lat)`). The particle engine **spawns and keeps every current streamline strictly over the ocean** — any particle that drifts onto land is instantly respawned on water, so no currents ever render on the coast.
- Swap in real coastline data at runtime with `AQ_COAST.setLandMask(geojson)`; particles re-mask automatically (`aq-landmask-changed`).

### Dynamically-sized H3 cells + live-data ingestion (frontend-ready)
Cell **area is data-driven** and everything re-renders on live updates — no hardcoded geometry:
```js
// 1) Per-cell overrides (merged over the model). `scale` 0.12–1.15 resizes the
//    cell; `polygon` (GeoJSON ring) sets explicit real H3 geometry.
AQ_DATA.setLiveData([
  { id:'8a1b…', values:{ pfz_probability:0.87, sst_c:28.9 }, scale:0.9 },
  { id:'8a9f…', values:{ biodiversity:0.71 }, polygon:[[[lng,lat],…]] }
]);

// 2) How cell AREA is derived
AQ_DATA.setCellSizeMode('value');   // 'fixed' | 'value' (default) | 'custom'

// 3) Register an async provider (poll / WebSocket) then pull
AQ_DATA.registerProvider(async ctx => fetch('/api/pfz?date='+ctx.date).then(r=>r.json()));
AQ_DATA.refresh({ date: '2026-01-15' });

AQ_DATA.clearLiveData();            // revert to the built-in model
```
Each call fires `aq-data-updated`; the map rebuilds cell polygons + values and telemetry/legend follow. Cell polygons are computed on demand via `AQ_DATA.cellPolygon(cell,value)`, so switching modes or pushing data instantly changes rendered cell size.

### Layout integrity & controls
- Floating panels are geometrically separated (compact search top-left, Controls sidebar left, telemetry right, currents+legend bottom-left, timeline bottom) — **no overlap**. Study-location / Date / Basemap pickers now live inside the sidebar so they never overlap the layers.
- **Collapsible panels**: the Controls (layers) sidebar, the Cell-Telemetry sidebar **and the Date-Player (timeline)** can each be closed via their header buttons and reopened from small floating edge tabs (left, right, and bottom-right clock tab) — controls respond instantly, independent of map load.
- **Adaptive legend**: the PFZ-Confidence / Current-Speed legend automatically repositions as panels collapse — it shifts **left** when the layers sidebar closes, drops **down** when the date player closes, and tucks into the **bottom-left corner** when both are collapsed.
- **Basemap toggle**: Normal (Ocean) · Satellite · Hybrid.
- **Coastal place labels** (Mumbai → Goa towns) render on their own always-on symbol layer, so names stay visible at every zoom level.
- Full-page views (Overview / Intelligence / Data / Help) use a **glassy translucent backdrop**; the map's floating panels are hidden while a page tab is open, and the header stays on top for navigation.
- **Playback** base rate slowed and defaulting to 1× (with a 0.5× option) for a gentler time-warp.
- Responsive: sidebar & telemetry become slide-in drawers; controls collapse on phones.

---

## 🗂️ Architecture
```
index.html            Landing + dashboard shell
favicon.svg, assets/logo.svg
css/style.css         Ocean-glass design system + responsive + landing
js/
  coastline.js        Fallback land/coast GeoJSON
  data.js             H3 grid, date-aware mock model, PLACES, LAYERS, GEE_LAYERS, phase()
  store.js            Zustand-style global store
  layers-service.js   GEE-ready reusable layer API
  particles.js        Windy-style current particle engine
  map.js              MapLibre controller (single-map PFZ/Bio crossfade)
  ui.js               Sidebar, legend, telemetry, gauges, cards, table, intel/help render
  intelligence.js     Role-based AI answer engine
  landing.js          Animated globe/particles + scroll reveal
  app.js              Enter flow, routing, timeline, pickers, shortcuts
```
**State**: `currentTab, mapMode, selectedDate, selectedPlace, selectedH3, activeLayers, playbackState/Speed, currentsPlaying/Speed/Density, intelRole, mapViewport`.

## ⌨️ Shortcuts
`1` Map · `2` Overview · `3` Intelligence · `4` Data · `?` Help · `Space` play/pause · `←/→` step · `R` reset view · `B` PFZ↔Biodiversity.

## 🔗 Entry URIs
`index.html` (landing) · `index.html?enter=1` (skip to dashboard) · `#maps` `#overview` `#intel` `#data` `#help`.

---

## 🚧 Not yet implemented
- Live GEE tiles (API is ready; needs a real tile endpoint / auth proxy).
- Real H3 indexing (uses H3-style hexagons) and live WebSocket data (polling simulated).
- Persisted preferences / offline caching.

## ▶️ Next steps
1. Register real GEE raster URLs through `AQ_LAYERS.register`.
2. Swap `js/data.js` generators for live PFZ / biodiversity / oceanography APIs.
3. Add `h3-js` for authentic cell IDs; add loading skeletons & error states.

## 🌐 Deploy
Static site — publish from the **Publish tab**. No keys or server required.

## 🛠️ Tech
MapLibre GL JS (globe) · Chart.js · Canvas particle engine · Font Awesome · Google Fonts (Inter / IBM Plex) · CSS design tokens · Zustand-style store.
