/* ============================================================
   AquaGrid v2 — AI Intelligence Panel
   Role-based, query-driven answers computed from the mock data
   model (fisher / researcher / policy). Output = cards + narrative.
   ============================================================ */
(function (global) {
  'use strict';
  const D = AQ_DATA, store = AQ_STORE;

  const SUGGEST = {
    fisher: ['Find PFZ near Ratnagiri', 'Best zones near Malvan', 'Currents near Mumbai'],
    researcher: ['Biodiversity near Sindhudurg', 'Species richness near Vengurla', 'Ecosystem near Devgad'],
    policy: ['Show climate trend', 'SST anomaly this year', 'Salinity trend near Goa']
  };

  // Detailed role profiles shown above the query box.
  const ROLE_INFO = {
    fisher: {
      icon:'fa-fish-fins', title:'Fisher — Catch & Safety Advisor',
      tagline:'Turn ocean data into a safe, fuel-efficient fishing plan.',
      what:'AquaGrid fuses sea-surface temperature fronts, chlorophyll productivity and current convergence into a Potential Fishing Zone (PFZ) probability for every H3 cell. As a fisher you get the shortest route to the most promising water, plus the sea state to expect when you get there.',
      gives:['Top 3 recommended zones ranked by confidence','Distance & bearing from your landing point','Sea-surface temperature and current speed/direction','Plain-language go / caution advisory'],
      how:'Ask about a port (e.g. “Find PFZ near Ratnagiri”). Historical dates replay what was actually observed; future dates give an AI forecast you should verify with local conditions before sailing.'
    },
    researcher: {
      icon:'fa-flask', title:'Researcher — Ecosystem & Biodiversity Analyst',
      tagline:'Quantify hotspots and the conditions that create them.',
      what:'For any patch of coast, AquaGrid summarises biodiversity hotspot probability, species richness and the Shannon diversity index, then links them to the physical drivers — temperature, salinity, chlorophyll and mixed-layer depth — so you can reason about *why* an ecosystem is productive.',
      gives:['Hotspot score & average species richness','Shannon diversity index across the local grid','Environmental drivers (SST, salinity, chlorophyll, MLD)','Comparison against the wider study area'],
      how:'Ask about a location (e.g. “Biodiversity near Sindhudurg”). Switch the map to Biodiversity mode to see the emerald hotspot heatmap and richness markers for the same date.'
    },
    policy: {
      icon:'fa-landmark', title:'Policy Maker — Climate & Trend Intelligence',
      tagline:'Spot anomalies and build the evidence base for action.',
      what:'AquaGrid rolls the grid up into time-series trends — 12-month change in sea-surface temperature and salinity — and flags anomalies that could shift fish distributions or stress sensitive habitats, supporting marine spatial planning and early-warning decisions.',
      gives:['12-month SST & salinity change with anomaly flag','Interactive dual-axis trend chart','Watch / stable status for the selected area','Downloadable text summary for reports'],
      how:'Ask for a trend (e.g. “Show climate trend”). Combine with the timeline to compare historical baselines against AI-forecast dates.'
    }
  };

  function findPlace(q) {
    q = (q||'').toLowerCase();
    return D.PLACES.find(p => p.id!=='all' && q.includes(p.id)) ||
           D.PLACES.find(p => p.id!=='all' && q.includes(p.name.toLowerCase().split(' ')[0]));
  }

  function findH3(q) {
    const match = String(q || '').match(/\b[0-9a-f]{15}\b/i);
    if (!match || !Array.isArray(D.GRID)) return null;
    return D.GRID.find(c => String(c.id).toLowerCase() === match[0].toLowerCase()) || null;
  }
  function nearestCells(lng, lat, n) {
    return D.GRID.map(c => ({ c, d: Math.hypot(c.lng-lng, c.lat-lat) }))
      .sort((a,b)=>a.d-b.d).slice(0, n||6).map(x=>x.c);
  }
  function km(deg){ return Math.round(deg*111); }

  function card(icon, label, value, cls){
    return `<div class="intel-card glass"><div class="mc-icon" style="background:rgba(25,198,200,.12);color:var(--highlight)"><i class="fas ${icon}"></i></div>
      <div class="mc-metric" style="font-size:24px">${value}</div><div class="mc-label">${label}</div>${cls||''}</div>`;
  }

  async function answer(role, query) {
    const date = store.get().selectedDate;
    let timeline = window.AQ_TIMELINE;
    try {
      if (window.AQ_API && AQ_API.getTimeline) {
        timeline = await AQ_API.getTimeline();
        window.AQ_TIMELINE = timeline;
      }
    } catch (e) {
      console.warn('[AquaGrid Intelligence] timeline refresh failed:', e);
    }

    const meta = (timeline && Array.isArray(timeline.dates))
      ? timeline.dates.find(x => x.date === date)
      : null;
    const ph = meta && meta.source === 'forecast'
      ? 'forecast'
      : meta && meta.source === 'observed'
        ? 'observed'
        : 'historical';
    const exactH3 = findH3(query);
    const place = findPlace(query) || D.PLACES.find(p=>p.id===store.get().selectedPlace) || D.PLACES[6];
    const cells = exactH3
      ? [exactH3]
      : nearestCells(place.lng, place.lat, 8);
    let vals = cells
      .map(c => ({ c, v: D.cellValues(c, date) }))
      .filter(x => x.v && (
        Number.isFinite(Number(x.v.pfz_probability)) ||
        Number.isFinite(Number(x.v.biodiversity)) ||
        Number.isFinite(Number(x.v.sst_c)) ||
        Number.isFinite(Number(x.v.chl_mg))
      ));

    // Intelligence reads the same live backend values already used by the map.
    // Do not fall back to the mock model when a live value is present.
    for (const item of vals) {
      const live = D.cellValues(item.c, date);
      if (live) item.v = Object.assign({}, live);
    }

    if (!vals.length) {
      return {
        cards: card('fa-circle-exclamation','Data status','Not available'),
        narrative: `<div class="intel-narrative glass">
          <p><b>No real AquaGrid data is available for ${date}</b> at the requested location.</p>
          <p>Choose a historical, observed, or generated forecast date with available backend data.</p>
        </div>`
      };
    }

    if (role === 'fisher') {
      const best = vals.slice().sort((a,b)=>b.v.pfz_probability-a.v.pfz_probability).slice(0,3);

      // /pfz/grid provides ranking fields only. Fetch exact-cell telemetry
      // for the three winning H3 cells from /pfz/cell/{h3_index}.
      await Promise.all(best.map(async (b) => {
        try {
          const detail = await AQ_API.getPFZCell(b.c.id, date);
          const e = detail && detail.environment ? detail.environment : {};
          b.v.sst_c = Number.isFinite(Number(e.sst_c)) ? Number(e.sst_c) : b.v.sst_c;
          b.v.current_u_ms = Number.isFinite(Number(e.current_u_ms)) ? Number(e.current_u_ms) : b.v.current_u_ms;
          b.v.current_v_ms = Number.isFinite(Number(e.current_v_ms)) ? Number(e.current_v_ms) : b.v.current_v_ms;
          b.v.current_speed_ms = Number.isFinite(Number(e.current_speed_ms)) ? Number(e.current_speed_ms) : b.v.current_speed_ms;
          b.v.salinity_psu = Number.isFinite(Number(e.salinity_psu)) ? Number(e.salinity_psu) : b.v.salinity_psu;
          b.v.mld_m = Number.isFinite(Number(e.mixed_layer_m)) ? Number(e.mixed_layer_m) : b.v.mld_m;
          b.v.ssh_m = Number.isFinite(Number(e.ssh_m)) ? Number(e.ssh_m) : b.v.ssh_m;
          b.v.chl_mg = Number.isFinite(Number(e.chlorophyll_mg_m3)) ? Number(e.chlorophyll_mg_m3) : b.v.chl_mg;

          if (b.v.current_dir_deg == null &&
              Number.isFinite(b.v.current_u_ms) &&
              Number.isFinite(b.v.current_v_ms)) {
            b.v.current_dir_deg =
              (Math.atan2(b.v.current_u_ms, b.v.current_v_ms) * 180 / Math.PI + 360) % 360;
          }
        } catch (err) {
          console.warn('[AquaGrid Intelligence] exact-cell telemetry unavailable:', b.c.id, err);
        }
      }));

      const top = best[0];
      const dist = km(Math.hypot(top.c.lng-place.lng, top.c.lat-place.lat));
      const cards = best.map((b,i)=> card('fa-location-dot', `Zone ${i+1} · ${b.c.id.slice(0,8)}`, Math.round(b.v.pfz_probability*100)+'%',
        `<div class="t-cap" style="margin-top:6px">${b.v.confidence} · ${km(Math.hypot(b.c.lng-place.lng,b.c.lat-place.lat))} km · SST ${b.v.sst_c}°C</div>`)).join('');
      const topPct = safePercent(top.v.pfz_probability);
      const direction = Number.isFinite(Number(top.v.current_dir_deg))
        ? D.dirFull(top.v.current_dir_deg)
        : 'Not available';
      const narrative = `<div class="intel-narrative glass">
        <p>For a trip out of <b>${place.name}</b>, the strongest ${ph==='forecast'?'forecast':'observed'} fishing potential is about <b>${dist} km offshore</b> at cell <b>${top.c.id.slice(0,10)}</b>${topPct == null ? '' : ` with <b>${topPct}% ${String(top.v.confidence || 'available').toLowerCase()} confidence</b>`}.</p>
        <p>Surface temperature there is <b>${displayValue(top.v.sst_c,'°C')}</b> with currents flowing <b>${direction}</b> at <b>${displayValue(top.v.current_speed_ms,' m/s')}</b>. Head out on a bearing toward the highlighted zones and verify forecast conditions locally before sailing.</p>
        <p class="t-cap">${ph==='forecast'?'AI forecast — verify with local conditions before sailing.':'Historical advisory replay.'}</p></div>`;
      return { cards, narrative, fly: top.c };
    }

    if (role === 'researcher') {
      const isForecast = ph === 'forecast';

      if (isForecast) {
        // Forecast biodiversity is a suitability/hotspot prediction.
        // Species richness and Shannon diversity are not forecast by M9.
        // Read the authoritative biodiversity forecast grid and select
        // the nearest populated forecast cells to the requested place.
        try {
          const bioGrid = await AQ_API.request(
            `/biodiversity/grid?date=${encodeURIComponent(date)}`
          );

          const bioCells = bioGrid && Array.isArray(bioGrid.cells)
            ? bioGrid.cells
            : [];

          vals = bioCells
            .filter(cell =>
              String(cell.prediction_status || '').toLowerCase() === 'complete_features' &&
              Number.isFinite(Number(cell.center_lat)) &&
              Number.isFinite(Number(cell.center_lon)) &&
              Number.isFinite(Number(cell.predicted_biodiversity_index))
            )
            .map(cell => {
              const c = {
                id: String(cell.h3_index),
                lat: Number(cell.center_lat),
                lng: Number(cell.center_lon)
              };

              return {
                c,
                d: Math.hypot(c.lng - place.lng, c.lat - place.lat),
                v: {
                  biodiversity: Number(cell.predicted_biodiversity_index),
                  biodiversity_hotspot_likelihood: Number.isFinite(Number(cell.biodiversity_hotspot_likelihood))
                    ? Number(cell.biodiversity_hotspot_likelihood)
                    : null,
                  mess_similarity: Number.isFinite(Number(cell.mess_similarity))
                    ? Number(cell.mess_similarity)
                    : null,
                  confidence_score: Number.isFinite(Number(cell.confidence_score))
                    ? Number(cell.confidence_score)
                    : null,
                  prediction_status: cell.prediction_status,
                  sst_c: Number.isFinite(Number(cell.sst_c)) ? Number(cell.sst_c) : null,
                  salinity_psu: Number.isFinite(Number(cell.salinity_psu)) ? Number(cell.salinity_psu) : null,
                  mld_m: Number.isFinite(Number(cell.mixed_layer_m)) ? Number(cell.mixed_layer_m) : null,
                  chl_mg: Number.isFinite(Number(cell.chlorophyll_mg_m3)) ? Number(cell.chlorophyll_mg_m3) : null
                }
              };
            })
            .sort((a, b) => a.d - b.d)
            .slice(0, 8);


        } catch (err) {
          console.warn('[AquaGrid Researcher] biodiversity forecast grid unavailable:', err);
          vals = [];
        }

        // Biodiversity grid rows do not carry PFZ environment telemetry,
        // so hydrate the nearby cells from the exact PFZ cell endpoint.
        await Promise.all(vals.map(async (item) => {
          try {
            const detail = await AQ_API.getPFZCell(item.c.id, date);
            const e = detail && detail.environment ? detail.environment : {};
            item.v.sst_c = Number.isFinite(Number(e.sst_c)) ? Number(e.sst_c) : item.v.sst_c;
            item.v.salinity_psu = Number.isFinite(Number(e.salinity_psu)) ? Number(e.salinity_psu) : item.v.salinity_psu;
            item.v.mld_m = Number.isFinite(Number(e.mixed_layer_m)) ? Number(e.mixed_layer_m) : item.v.mld_m;
            item.v.chl_mg = Number.isFinite(Number(e.chlorophyll_mg_m3)) ? Number(e.chlorophyll_mg_m3) : item.v.chl_mg;
            item.v.mess_similarity = Number.isFinite(Number(item.v.mess_similarity))
              ? Number(item.v.mess_similarity)
              : null;
            item.v.confidence_score = Number.isFinite(Number(item.v.confidence_score))
              ? Number(item.v.confidence_score)
              : null;
          } catch (err) {
            console.warn('[AquaGrid Researcher] PFZ telemetry unavailable for', item.c.id, err);
          }
        }));

        const sorted = vals
          .filter(x => x.v.biodiversity != null &&
            Number.isFinite(Number(x.v.biodiversity)))
          .sort((a,b) => Number(b.v.biodiversity) - Number(a.v.biodiversity));

        if (!sorted.length) {
          return {
            cards: card('fa-circle-exclamation','Data status','Not available'),
            narrative: `<div class="intel-narrative glass">
              <p><b>No forecast biodiversity score is available for ${date}</b> at the requested location.</p>
            </div>`
          };
        }

        const bio = sorted[0];
        const low = sorted[sorted.length - 1];
        const avgBio = avg(sorted.map(x => x.v.biodiversity));
        const avgChl = avg(vals.map(x => x.v.chl_mg));
        const avgSST = avg(vals.map(x => x.v.sst_c));
        const avgSal = avg(vals.map(x => x.v.salinity_psu));
        const avgMld = avg(vals.map(x => x.v.mld_m));
        const avgMess = avg(vals.map(x => x.v.mess_similarity));
        const avgConf = avg(vals.map(x => x.v.confidence_score));

        const hotspotStatus = avgBio >= 0.66
          ? ['high','High hotspot likelihood']
          : avgBio >= 0.45
            ? ['med','Moderate hotspot likelihood']
            : ['low','Lower hotspot likelihood'];

        const cards = [
          card('fa-dna','Peak hotspot likelihood', displayValue(Number(bio.v.biodiversity) * 100, '%'),
            `<div class="chip ${hotspotStatus[0]}" style="margin-top:8px">${hotspotStatus[1]}</div>`),
          card('fa-bullseye','Mean hotspot likelihood', displayValue(Number(avgBio) * 100, '%')),
          card('fa-temperature-half','Mean SST', displayValue(avgSST, '°C')),
          card('fa-flask','Chlorophyll-a', displayValue(avgChl, ' mg/m³')),
          card('fa-water','Mean salinity', displayValue(avgSal, ' PSU')),
          card('fa-layer-group','Mean MLD', displayValue(avgMld, ' m'))
        ].join('');

        const confidenceText = Number.isFinite(Number(avgConf))
          ? displayValue(Number(avgConf) * 100, '%')
          : 'Not available';

        const messText = Number.isFinite(Number(avgMess))
          ? displayValue(avgMess)
          : 'Not available';

        const narrative = `<div class="intel-narrative glass">
          <h4 style="margin:0 0 8px;color:var(--text-1)">Forecast ecosystem assessment · ${place.name}</h4>
          <p><b>Forecast hotspot.</b> The local forecast has a mean biodiversity hotspot likelihood of <b>${displayValue(Number(avgBio) * 100, '%')}</b>, with a peak of <b>${displayValue(Number(bio.v.biodiversity) * 100, '%')}</b> at cell ${bio.c.id.slice(0,8)} and a local low of <b>${displayValue(Number(low.v.biodiversity) * 100, '%')}</b>.</p>
          <p><b>Environmental context.</b> The forecast patch is associated with <b>${displayValue(avgSST, '°C')}</b> SST, <b>${displayValue(avgSal, ' PSU')}</b> salinity, <b>${displayValue(avgChl, ' mg/m³')}</b> chlorophyll and a <b>${displayValue(avgMld, ' m')}</b> mixed layer. These are environmental conditions associated with the forecast, not proof of future species abundance.</p>
          <p><b>Model confidence.</b> Mean MESS similarity is <b>${messText}</b> and mean model confidence is <b>${confidenceText}</b>. Lower similarity indicates greater extrapolation beyond the model's training environment.</p>
          <p><b>Important limitation.</b> Species richness, Shannon diversity and Pielou evenness are <b>not predicted for this forecast date</b>. They should not be inferred from the hotspot score.</p>
          <p><b>Recommendation.</b> ${avgBio >= 0.6
            ? 'Prioritise this patch for ecological verification or repeat sampling, especially around the peak forecast cell.'
            : 'Use this patch as a forecast candidate for targeted verification and compare it with observed biodiversity records when available.'}</p>
          <p><button class="btn ghost" onclick="AQ_INTEL.exportSummary()"><i class="fas fa-download"></i> Download assessment</button></p>
        </div>
        <div class="panel glass" style="margin-top:14px">
          <h3 style="margin:0 0 6px;font-size:15px">Forecast biodiversity &amp; chlorophyll profile</h3>
          <div style="height:240px"><canvas id="intel-trend"></canvas></div>
        </div>`;

        const series = [{
          dd: date,
          sst: Number.isFinite(Number(avgBio)) ? Number(avgBio) * 100 : null,
          sal: avgChl
        }];

        return { cards, narrative, chart: series, chartMode:'bio', fly: bio.c };
      }

      // Observed biodiversity: use the authoritative biodiversity archive.
      // Do not restrict observations to the nearest PFZ cells because
      // biodiversity sampling is sparse and may be tens of km offshore.
      let observed = [];

      try {
        const bioGrid = await AQ_API.request(
          `/biodiversity/grid?date=${encodeURIComponent(date)}`
        );

        const cells = bioGrid && Array.isArray(bioGrid.cells)
          ? bioGrid.cells
          : [];

        observed = cells
          .filter(cell =>
            String(cell.observation_status || '').toLowerCase() === 'observed' &&
            (
              Number.isFinite(Number(cell.species_richness)) ||
              Number.isFinite(Number(cell.species_count)) ||
              Number.isFinite(Number(cell.shannon_index))
            ) &&
            Number.isFinite(Number(cell.center_lat)) &&
            Number.isFinite(Number(cell.center_lon))
          )
          .map(cell => {
            const c = {
              id: String(cell.h3_index),
              lat: Number(cell.center_lat),
              lng: Number(cell.center_lon)
            };

            return {
              c,
              d: Math.hypot(c.lng - place.lng, c.lat - place.lat),
              v: {
                species_richness: Number.isFinite(Number(cell.species_richness))
                  ? Number(cell.species_richness)
                  : Number.isFinite(Number(cell.species_count))
                    ? Number(cell.species_count)
                    : null,
                shannon_index: Number.isFinite(Number(cell.shannon_index))
                  ? Number(cell.shannon_index)
                  : null,
                occurrence_count: Number.isFinite(Number(cell.occurrence_count))
                  ? Number(cell.occurrence_count)
                  : null,
                observation_status: cell.observation_status
              }
            };
          })
          .sort((a, b) => a.d - b.d)
          .slice(0, 8);

        // Hydrate environmental context from the exact PFZ H3/date.
        await Promise.all(observed.map(async item => {
          try {
            const detail = await AQ_API.getPFZCell(item.c.id, date);
            const e = detail && detail.environment ? detail.environment : {};

            item.v.sst_c = Number.isFinite(Number(e.sst_c)) ? Number(e.sst_c) : null;
            item.v.salinity_psu = Number.isFinite(Number(e.salinity_psu)) ? Number(e.salinity_psu) : null;
            item.v.mld_m = Number.isFinite(Number(e.mixed_layer_m)) ? Number(e.mixed_layer_m) : null;
            item.v.chl_mg = Number.isFinite(Number(e.chlorophyll_mg_m3)) ? Number(e.chlorophyll_mg_m3) : null;
          } catch (err) {
            console.warn('[AquaGrid Researcher] PFZ telemetry unavailable for', item.c.id, err);
          }
        }));

      } catch (err) {
        console.warn('[AquaGrid Researcher] observed biodiversity grid unavailable:', err);
      }

      if (!observed.length) {
        return {
          cards: card('fa-circle-exclamation','Observation status','No observation'),
          narrative: `<div class="intel-narrative glass">
            <p><b>No observed biodiversity record is available for ${place.name} on ${date}.</b></p>
            <p>Observed biodiversity metrics are only reported where the backend contains an observation.</p>
          </div>`
        };
      }

      const avgRich = avg(observed.map(x => x.v.species_richness));
      const avgSh = avg(observed.map(x => x.v.shannon_index));
      const avgOcc = avg(observed.map(x => x.v.occurrence_count));
      const avgSST = avg(observed.map(x => x.v.sst_c));
      const avgChl = avg(observed.map(x => x.v.chl_mg));
      const avgSal = avg(observed.map(x => x.v.salinity_psu));
      const avgMld = avg(observed.map(x => x.v.mld_m));

      const evenness = Number.isFinite(Number(avgSh)) && Number(avgRich) > 1
        ? Number((Number(avgSh) / Math.log(Number(avgRich))).toFixed(2))
        : null;

      const nearest = observed[0];

      const cards = [
        card('fa-fish','Avg species richness', displayValue(avgRich)),
        card('fa-leaf','Shannon index (H′)', displayValue(avgSh)),
        card('fa-list-ol','Avg occurrence count', displayValue(avgOcc)),
        card('fa-temperature-half','Mean SST', displayValue(avgSST, '°C')),
        card('fa-flask','Chlorophyll-a', displayValue(avgChl, ' mg/m³')),
        card('fa-water','Mean salinity', displayValue(avgSal, ' PSU'))
      ].join('');

      const narrative = `<div class="intel-narrative glass">
        <h4 style="margin:0 0 8px;color:var(--text-1)">Observed ecosystem assessment · ${place.name}</h4>
        <p><b>Observed diversity.</b> The nearest available biodiversity observations on ${date} show mean species richness of <b>${displayValue(avgRich)}</b> taxa and a mean Shannon diversity index (H′) of <b>${displayValue(avgSh)}</b>. Average recorded occurrence count is <b>${displayValue(avgOcc)}</b>.</p>
        <p><b>Sampling context.</b> The nearest observed biodiversity cell is <b>${nearest.c.id}</b>, approximately <b>${km(nearest.d)} km</b> from ${place.name}. Biodiversity observations are sparse, so this represents the nearest available sampled patch rather than an unsampled-cell estimate.</p>
        <p><b>Environmental context.</b> The sampled patch has <b>${displayValue(avgSST, '°C')}</b> SST, <b>${displayValue(avgSal, ' PSU')}</b> salinity, <b>${displayValue(avgChl, ' mg/m³')}</b> chlorophyll and a <b>${displayValue(avgMld, ' m')}</b> mixed layer where matching PFZ telemetry is available.</p>
        <p><b>Evenness.</b> ${evenness !== null
          ? `The calculated Pielou evenness is <b>${displayValue(evenness)}</b>.`
          : 'Pielou evenness is <b>Not available</b> because the observed richness is insufficient for a meaningful calculation.'}</p>
        <p><b>Interpretation.</b> These are observed biodiversity measurements for the selected date, not AI forecasts. Use the Biodiversity layer and repeated observations to assess spatial or seasonal persistence.</p>
        <p><button class="btn ghost" onclick="AQ_INTEL.exportSummary()"><i class="fas fa-download"></i> Download assessment</button></p>
      </div>
      <div class="panel glass" style="margin-top:14px">
        <h3 style="margin:0 0 6px;font-size:15px">Observed biodiversity profile</h3>
        <div style="height:240px"><canvas id="intel-trend"></canvas></div>
      </div>`;

      const bioSeries = [{
        dd: date,
        sst: Number.isFinite(Number(avgRich)) ? Number(avgRich) : null,
        sal: avgChl
      }];

      return { cards, narrative, chart: bioSeries, chartMode:'bio', fly: nearest.c };
    // policy — climate trends over time
    }

    const now = new Date(date);
    const series = [];
    for (let m = -11; m <= 0; m++) {
      const dd = new Date(now.getFullYear(), now.getMonth()+m, 15).toISOString().slice(0,10);
      const a = vals.map(x => D.cellValues(x.c, dd));
      series.push({ dd, sst: avg(a.map(v=>v.sst_c)), sal: avg(a.map(v=>v.salinity_psu)) });
    }
    const sstTrend = +(series[series.length-1].sst - series[0].sst).toFixed(2);
    const salTrend = +(series[series.length-1].sal - series[0].sal).toFixed(2);
    const sstMax = Math.max.apply(null, series.map(s=>s.sst)), sstMin = Math.min.apply(null, series.map(s=>s.sst));
    const sstRange = +(sstMax-sstMin).toFixed(1);
    const avgSSTp = avg(series.map(s=>s.sst));
    const perDecade = +(sstTrend*10).toFixed(1); // extrapolated °C/decade
    const chlNow = avg(vals.map(x=>x.v.chl_mg));
    const sev = Math.abs(sstTrend)>0.8?['low','Severe','red']:Math.abs(sstTrend)>0.5?['med','Elevated','amber']:['high','Normal','green'];
    const rec = Math.abs(sstTrend)>0.8
      ? 'Trigger an early-warning review: rapid warming of this magnitude can drive fish stocks poleward/offshore, bleach sensitive habitats and disrupt local fisher livelihoods. Recommend a seasonal advisory and habitat-stress monitoring.'
      : Math.abs(sstTrend)>0.5
        ? 'Flag for watch-listing. The warming signal is above natural seasonal noise; pair with catch and biodiversity records before committing to management action.'
        : 'No intervention indicated. Trends sit within the expected seasonal envelope; continue routine monitoring.';

    const cards = [
      card('fa-temperature-arrow-up','12-mo SST change', (sstTrend>0?'+':'')+sstTrend+'°C', `<div class="chip ${sev[0]}" style="margin-top:8px">${sev[1]}</div>`),
      card('fa-droplet','12-mo Salinity change', (salTrend>0?'+':'')+salTrend+' PSU'),
      card('fa-gauge','Seasonal SST range', sstRange+'°C'),
      card('fa-arrow-trend-up','Extrapolated rate', (perDecade>0?'+':'')+perDecade+'°C/decade'),
      card('fa-flask','Chlorophyll now', chlNow+' mg/m³')
    ].join('');
    const narrative = `<div class="intel-narrative glass">
      <h4 style="margin:0 0 8px;color:var(--text-1)">Climate &amp; ocean trend brief · ${place.name}</h4>
      <p><b>Temperature.</b> Over the last 12 months mean SST moved by <b>${(sstTrend>0?'+':'')+sstTrend}°C</b> (from ${series[0].sst}°C to ${series[series.length-1].sst}°C), within a seasonal range of <b>${sstRange}°C</b> around a <b>${avgSSTp}°C</b> average. Linearly extrapolated that is roughly <b>${(perDecade>0?'+':'')+perDecade}°C per decade</b> — ${Math.abs(perDecade)>2?'well above':'broadly in line with'} regional warming expectations.</p>
      <p><b>Salinity &amp; productivity.</b> Salinity changed by <b>${(salTrend>0?'+':'')+salTrend} PSU</b> and surface chlorophyll currently reads <b>${chlNow} mg/m³</b>. ${salTrend<-0.2?'A freshening signal can indicate increased runoff/monsoon influence and altered stratification.':salTrend>0.2?'A saltier signal may reflect reduced freshwater input or stronger evaporation.':'Salinity is effectively stable.'}</p>
      <p><b>Anomaly assessment.</b> Status: <b>${sev[1]}</b>. ${Math.abs(sstTrend)>0.5?'The temperature signal exceeds typical month-to-month variability for this stretch of coast.':'The signal is consistent with normal seasonal variability.'}</p>
      <p><b>Recommended action.</b> ${rec}</p>
      <p><button class="btn ghost" onclick="AQ_INTEL.exportSummary()"><i class="fas fa-download"></i> Download policy summary</button></p></div>
      <div class="panel glass" style="margin-top:14px"><h3 style="margin:0 0 6px;font-size:15px">SST &amp; salinity — 12-month trend</h3><div style="height:240px"><canvas id="intel-trend"></canvas></div></div>`;
    return { cards, narrative, chart: series };
  }
  function finiteValues(a){
    return (a || []).map(Number).filter(Number.isFinite);
  }

  function avg(a){
    const v = finiteValues(a);
    return v.length ? +(v.reduce((s,x)=>s+x,0)/v.length).toFixed(2) : null;
  }

  function displayValue(v, suffix=''){
    if (v === null || v === undefined || v === '') return 'Not available';
    const n = Number(v);
    if (!Number.isFinite(n)) return 'Not available';
    const digits = Math.abs(n) >= 10 ? 2 : 3;
    return `${Number(n.toFixed(digits))}${suffix}`;
  }

  function safePercent(v){
    return Number.isFinite(Number(v)) ? Math.round(Number(v)*100) : null;
  }

  let lastSummary = '';
  async function run(role, query) {
    const out = document.getElementById('intel-output');
    if (!out) return;

    out.innerHTML = `<div class="intel-narrative glass">
      <p><b>Loading AquaGrid data…</b></p>
      <p>Refreshing the real backend values for the selected date.</p>
    </div>`;

    try {
      // Ensure the real PFZ + biodiversity providers populate LIVE
      // before the existing Intelligence calculations read cellValues().
      await D.refresh({ date: store.get().selectedDate });
    } catch (e) {
      console.warn('[AquaGrid Intelligence] live refresh failed:', e);
    }

    const res = await answer(role, query);
    lastSummary = query + '\n\n' + res.narrative.replace(/<[^>]+>/g,'').replace(/\n{3,}/g,'\n\n').trim();
    out.innerHTML = `<div class="intel-answer">${res.cards}</div>${res.narrative}`;
    if (res.chart) drawTrend(res.chart, res.chartMode);
    if (res.fly && window.AQ_MAP) AQ_MAP.flyTo(res.fly.lng, res.fly.lat, 9);
  }

  let trendChart;
  function drawTrend(series, mode){
    const ctx = document.getElementById('intel-trend'); if(!ctx) return;
    if (trendChart) trendChart.destroy();
    const bio = mode==='bio';
    const d1 = bio ? { label:'Biodiversity %', c:'#2ECC71', bg:'rgba(46,204,113,.14)' } : { label:'SST °C', c:'#FF8A3D', bg:'rgba(255,138,61,.12)' };
    const d2 = bio ? { label:'Chlorophyll mg/m³', c:'#62E6FF' } : { label:'Salinity PSU', c:'#8B9BFF' };
    trendChart = new Chart(ctx, { type:'line', data:{ labels: series.map(s=>s.dd.slice(0,7)), datasets:[
      { label:d1.label, data: series.map(s=>s.sst), borderColor:d1.c, backgroundColor:d1.bg, tension:.35, fill:true, pointRadius:0, yAxisID:'y' },
      { label:d2.label, data: series.map(s=>s.sal), borderColor:d2.c, tension:.35, pointRadius:0, yAxisID:'y1' }
    ]}, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#AEC0D2' } } },
      scales:{ x:{ ticks:{ color:'#6E8299' }, grid:{ color:'rgba(255,255,255,.05)' } },
        y:{ position:'left', ticks:{ color:d1.c }, grid:{ color:'rgba(255,255,255,.05)' } },
        y1:{ position:'right', ticks:{ color:d2.c }, grid:{ display:false } } } } });
  }

  function exportSummary(){
    const blob = new Blob([lastSummary || 'AquaGrid summary'], { type:'text/plain' });
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='aquagrid_summary.txt'; a.click(); URL.revokeObjectURL(url);
  }

  global.AQ_INTEL = { run, exportSummary, SUGGEST, ROLE_INFO };
})(window);
