import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const allow = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map(s => s.trim());

app.use(cors({ origin: allow }));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: allow } });

// --- thresholds (rule-based mock) ---
const TH = {
  pH: { min: 6.5, max: 8.5 },
  turbidity: { max: 6 },
  tds: { max: 500 },
  temp: { max: 35 },
  do: { min: 5 }
};

// --- in-memory store (seeded from json) ---
let stations = JSON.parse(fs.readFileSync("./data/stations.json", "utf-8"));
let alerts = JSON.parse(fs.readFileSync("./data/alerts.json", "utf-8"));
let readings = {}; // stationId -> [{ ts, metrics }]
stations.forEach((s) => (readings[s.id] = []));

// helpers
const jitter = (v, j) => +(v + (Math.random() * 2 - 1) * j).toFixed(2);
function simulateMetrics(prev = {}) {
  return {
    pH: Math.max(5.5, Math.min(9.5, jitter(prev.pH ?? 7.2, 0.15))),
    turbidity: Math.max(0.5, jitter(prev.turbidity ?? 3.2, 0.6)),
    tds: Math.max(50, jitter(prev.tds ?? 210, 30)),
    temp: Math.max(10, jitter(prev.temp ?? 28, 0.7)),
    do: Math.max(2.5, jitter(prev.do ?? 6.1, 0.5))
  };
}
function evaluateStatus(m) {
  let status = "safe";
  const near = (val, low, high, pct = 0.1) => {
    if (low != null && val < low * (1 + pct)) return true;
    if (high != null && val > high * (1 - pct)) return true;
    return false;
  };
  if (
    m.turbidity > TH.turbidity.max ||
    m.tds > TH.tds.max ||
    m.temp > TH.temp.max ||
    m.pH < TH.pH.min ||
    m.pH > TH.pH.max ||
    m.do < TH.do.min
  ) {
    status = "unsafe";
  } else if (
    near(m.pH, TH.pH.min, TH.pH.max) ||
    near(m.turbidity, null, TH.turbidity.max) ||
    near(m.tds, null, TH.tds.max) ||
    near(m.temp, null, TH.temp.max) ||
    near(m.do, TH.do.min, null)
  ) {
    status = "caution";
  }
  return status;
}
function maybeAlert(stationId, m) {
  const items = [];
  const push = (ok, metric, value, threshold, level) => {
    if (!ok) {
      items.push({
        id: "al-" + Math.random().toString(36).slice(2, 10),
        stationId,
        metric,
        value,
        threshold,
        message: `${metric} threshold breach`,
        level,
        ts: new Date().toISOString(),
        resolved: false
      });
    }
  };
  push(m.turbidity <= TH.turbidity.max, "turbidity", m.turbidity, TH.turbidity.max, "high");
  push(m.tds <= TH.tds.max, "tds", m.tds, TH.tds.max, "medium");
  push(m.temp <= TH.temp.max, "temp", m.temp, TH.temp.max, "medium");
  push(m.pH >= TH.pH.min && m.pH <= TH.pH.max, "pH", m.pH, `${TH.pH.min}-${TH.pH.max}`, "medium");
  push(m.do >= TH.do.min, "do", m.do, TH.do.min, "high");
  return items;
}

// seed one reading per station
stations.forEach((s) => {
  const m = simulateMetrics();
  readings[s.id].push({ ts: new Date(Date.now() - 600000).toISOString(), metrics: m });
});

// ---- API ----
app.get("/api/kpis", (req, res) => {
  const activeStations = stations.length;
  const todaysAlerts = alerts.filter((a) => Date.now() - Date.parse(a.ts) < 24 * 3600 * 1000).length;
  const uptime = "99.2%";
  res.json({ activeStations, todaysAlerts, uptime });
});

app.get("/api/stations", (req, res) => {
  res.json(stations);
});

app.get("/api/stations/:id", (req, res) => {
  const s = stations.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  const latest = readings[s.id][readings[s.id].length - 1];
  res.json({ ...s, latest });
});

app.get("/api/readings", (req, res) => {
  const { stationId, from, to, limit = 200 } = req.query;
  if (!stationId) return res.status(400).json({ error: "stationId required" });
  let arr = readings[stationId] || [];
  const fromTs = from ? Date.parse(from) : -Infinity;
  const toTs = to ? Date.parse(to) : Infinity;
  arr = arr.filter((r) => Date.parse(r.ts) >= fromTs && Date.parse(r.ts) <= toTs);
  res.json(arr.slice(-Number(limit)));
});

app.get("/api/alerts", (req, res) => {
  const { stationId, status } = req.query;
  let arr = alerts;
  if (stationId) arr = arr.filter((a) => a.stationId === stationId);
  if (status === "open") arr = arr.filter((a) => !a.resolved);
  if (status === "resolved") arr = arr.filter((a) => a.resolved);
  res.json(arr.slice(-200));
});

// ---- realtime simulation ----
setInterval(() => {
  stations = stations.map((s) => {
    const prev = readings[s.id][readings[s.id].length - 1]?.metrics || {};
    const m = simulateMetrics(prev);
    const status = evaluateStatus(m);
    const ts = new Date().toISOString();
    readings[s.id].push({ ts, metrics: m });
    s.status = status;
    s.lastReadingAt = ts;

    const newAlerts = maybeAlert(s.id, m);
    if (newAlerts.length) {
      alerts.push(...newAlerts);
      newAlerts.forEach((a) => io.emit("alert", a));
    }
    io.emit("reading", { stationId: s.id, ts, metrics: m, status });
    return s;
  });
}, 8000);

const PORT = process.env.PORT || 5174;
httpServer.listen(PORT, () => console.log("Backend running on http://localhost:" + PORT));
