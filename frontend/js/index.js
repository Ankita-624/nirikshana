
document.getElementById('year').textContent = new Date().getFullYear();
document.getElementById('api-url').textContent = window.API_URL;

// KPIs
async function loadKpis(){
  const k = await apiGet('/api/kpis');
  document.getElementById('kpi-stations').textContent = k.activeStations ?? '—';
  document.getElementById('kpi-alerts').textContent = k.todaysAlerts ?? '—';
  document.getElementById('kpi-uptime').textContent = k.uptime ?? '—';
}

// Alerts
async function loadAlerts(){
  const list = document.getElementById('alerts');
  list.innerHTML = '';
  const arr = await apiGet('/api/alerts?status=open');
  if (!arr.length){
    list.innerHTML = '<div class="small">No open alerts</div>';
    return;
  }
  arr.slice().reverse().forEach(a=>{
    const el = document.createElement('div');
    el.className = 'card';
    el.style.padding = '10px';
    el.innerHTML = `
      <div style="font-weight:600">${a.message} — <span style="text-transform:capitalize">${a.level}</span></div>
      <div class="small">${a.metric}: ${a.value} (th: ${a.threshold}) • ${new Date(a.ts).toLocaleString()}</div>
    `;
    list.appendChild(el);
  });
}

// Map + Stations
let map, markers = [];
function renderStations(stations){
  // clear markers
  markers.forEach(m => m.remove());
  markers = [];
  stations.forEach(s=>{
    const color = statusColor(s.status);
    const m = L.circleMarker([s.coords.lat, s.coords.lng], { radius:10, color })
      .addTo(map)
      .bindPopup(`
        <div style="font-size:12px">
          <div style="font-weight:600">${s.name}</div>
          <div>Status: <b>${s.status}</b></div>
          <a href="./station.html?id=${encodeURIComponent(s.id)}">Open</a>
        </div>
      `);
    markers.push(m);
  });
}
async function loadStations(){
  const stations = await apiGet('/api/stations');
  renderStations(stations);
}

// Init map
function initMap(){
  map = L.map('map').setView([20.49, 85.88], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);
}

async function init(){
  initMap();
  await Promise.all([loadKpis(), loadStations(), loadAlerts()]);

  // refresh every 15s
  setInterval(loadKpis, 15000);
  setInterval(loadAlerts, 15000);

  // realtime via socket
  const socket = connectSocket();
  socket.on('reading', () => loadStations());
  socket.on('alert',   () => { loadStations(); loadAlerts(); });
}

async function exportAll24h(){
  const stations = await apiGet('/api/stations');
  const since = new Date(Date.now() - 24*3600*1000).toISOString();

  const headers = ['stationId','ts','pH','turbidity','tds','temp','do'];
  const rows = [];

  for (const s of stations){
    const series = await apiGet(`/api/readings?stationId=${encodeURIComponent(s.id)}&from=${encodeURIComponent(since)}&limit=1000`);
    series.forEach(r=>{
      rows.push([s.id, r.ts, r.metrics.pH, r.metrics.turbidity, r.metrics.tds, r.metrics.temp, r.metrics.do]);
    });
  }

  const csv = headers.join(',') + '\n' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `readings_all_last24h.csv`; a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('export-24h')?.addEventListener('click', exportAll24h);
});

document.addEventListener('DOMContentLoaded', init);

