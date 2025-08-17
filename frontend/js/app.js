
// ====== CONFIG ======
window.API_URL = (new URLSearchParams(location.search).get('api')) || 'http://localhost:5174';

// Simple GET helper
async function apiGet(path) {
  const res = await fetch(`${window.API_URL}${path}`);
  if (!res.ok) throw new Error('API error');
  return res.json();
}

// Socket.IO (CDN attaches `io` to window)
function connectSocket() {
  return window.io(window.API_URL, { transports: ['websocket'] });
}

// Status color for map pins/badges
function statusColor(status) {
  if (status === 'unsafe') return 'red';
  if (status === 'caution') return 'orange';
  return 'green';
}

