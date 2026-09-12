/*
 * AquaGrid frontend API layer
 * Connects the static frontend to the real FastAPI backend.
 */

const AQ_API = (() => {
  const BASE_URL = window.AQUAGRID_API_BASE || 'http://127.0.0.1:8000';

  async function request(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Accept': 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.detail) detail = body.detail;
      } catch (_) {}
      throw new Error(detail);
    }

    return response.json();
  }

  function getTimeline() {
    return request('/timeline');
  }

  function getPFZByDate(date, lat, lon) {
    const params = new URLSearchParams({
      date,
      lat: String(lat),
      lon: String(lon)
    });

    return request(`/pfz/date?${params.toString()}`);
  }

  function getPFZCell(h3Index, date) {
    const params = new URLSearchParams({ date });
    return request(`/pfz/cell/${encodeURIComponent(h3Index)}?${params.toString()}`);
  }

  function getPFZStats(date) {
    const params = new URLSearchParams({ date });
    return request(`/pfz/stats?${params.toString()}`);
  }

  function getPFZGrid(date) {
    const params = new URLSearchParams({ date });
    return request(`/pfz/grid?${params.toString()}`);
  }

  function getBiodiversityByDate(date, lat, lon) {
    const params = new URLSearchParams({
      date,
      lat: String(lat),
      lon: String(lon)
    });

    return request(`/biodiversity/date?${params.toString()}`);
  }

  function getBiodiversityCell(h3Index, date) {
    const params = new URLSearchParams({ date });
    return request(`/biodiversity/cell/${encodeURIComponent(h3Index)}?${params.toString()}`);
  }

  return {
    BASE_URL,
    request,
    getTimeline,
    getPFZByDate,
    getPFZCell,
    getPFZStats,
    getPFZGrid,
    getBiodiversityByDate,
    getBiodiversityCell
  };
})();

window.AQ_API = AQ_API;
