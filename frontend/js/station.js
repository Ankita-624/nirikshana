document.getElementById('year').textContent = new Date().getFullYear();

const params = new URLSearchParams(location.search);
const id = params.get('id');

let chartA, chartB;

const fromEl = document.getElementById('from');
const toEl   = document.getElementById('to');

function localToISO(v){ return v ? new Date(v).toISOString() : ''; }
function rangeParams(){
  const from = localToISO(fromEl.value);
  const to   = localToISO(toEl.value);
  const q = [];
  if (from) q.push('from='+encodeURIComponent(from));
  if (to)   q.push('to='+encodeURIComponent(to));
  q.push('limit=1000'); // safe upper bound
  return q.length ? '&'+q.join('&') : '&limit=120';
}

async function loadStation(){
  const s = await apiGet(`/api/stations/${id}`);
  document.getElementById('st-name').textContent = s.name || id;
  const el = document.getElementById('st-status');
  el.textContent = s.status;
  el.style.color = statusColor(s.status);
}

async function loadSeries(){
  const series = await apiGet(`/api/readings?stationId=${encodeURIComponent(id)}${rangeParams()}`);
  const labels    = series.map(r => new Date(r.ts).toLocaleTimeString());
  const pH        = series.map(r => r.metrics.pH);
  const turbidity = series.map(r => r.metrics.turbidity);
  const tds       = series.map(r => r.metrics.tds);
  const temp      = series.map(r => r.metrics.temp);
  const dO        = series.map(r => r.metrics.do);

  if (!chartA) {
    chartA = new Chart(document.getElementById('chartA'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'pH', data: pH, tension: .3 },
        { label: 'Turbidity', data: turbidity, tension: .3 }
      ]},
      options: { responsive: true, plugins: { legend: { position:'top' } }, scales: { x: { display:false } } }
    });
  } else {
    chartA.data.labels = labels;
    chartA.data.datasets[0].data = pH;
    chartA.data.datasets[1].data = turbidity;
    chartA.update();
  }

  if (!chartB) {
    chartB = new Chart(document.getElementById('chartB'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'TDS', data: tds, tension: .3 },
        { label: 'Temp', data: temp, tension: .3 },
        { label: 'DO',  data: dO,  tension: .3 }
      ]},
      options: { responsive: true, plugins: { legend: { position:'top' } }, scales: { x: { display:false } } }
    });
  } else {
    chartB.data.labels = labels;
    chartB.data.datasets[0].data = tds;
    chartB.data.datasets[1].data = temp;
    chartB.data.datasets[2].data = dO;
    chartB.update();
  }
}

// CSV for current range
async function downloadCSV(){
  const series = await apiGet(`/api/readings?stationId=${encodeURIComponent(id)}${rangeParams()}`);
  const headers = ['ts','pH','turbidity','tds','temp','do'];
  const rows = series.map(r => [r.ts, r.metrics.pH, r.metrics.turbidity, r.metrics.tds, r.metrics.temp, r.metrics.do]);
  const csv = headers.join(',') + '\n' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `readings_${id}.csv`; a.click();
  URL.revokeObjectURL(url);
}

async function init(){
  if (!id) { alert('Missing ?id='); return; }
  await loadStation();
  await loadSeries();

  // refresh (leave as is)
  setInterval(loadStation, 15000);
  setInterval(loadSeries, 15000);

  // realtime (no toast)
  const socket = connectSocket();
  socket.on('reading', (ev) => { if (ev.stationId === id) loadSeries(); });
  socket.on('alert',   (a)  => { if (a.stationId === id) loadStation(); });

  // buttons
  document.getElementById('dl-csv')?.addEventListener('click', downloadCSV);
  document.getElementById('apply-range')?.addEventListener('click', loadSeries);
}

document.addEventListener('DOMContentLoaded', init);
