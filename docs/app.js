const state = { data: null, product: "E10", terminal: "Halifax", limit: 30 };
const $ = (selector) => document.querySelector(selector);
const fmt = (value) => `${value.toFixed(2)}¢`;
const esc = (value) => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function boot() {
  try {
    const response = await fetch("data/history.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    if (!state.data.snapshots?.length) throw new Error("No historical snapshots found");
    setupControls();
    renderAll();
  } catch (error) {
    $("#freshness").textContent = `Data unavailable · ${error.message}`;
    $("#chartEmpty").hidden = false;
  }
}

function latest() { return state.data.snapshots.at(-1); }

function setupControls() {
  const rows = state.data.snapshots.flatMap(s => s.prices);
  const products = [...new Set(rows.map(r => r.product))].sort();
  const terminals = [...new Set(rows.map(r => r.terminal))].sort();
  if (!products.includes(state.product)) state.product = products[0];
  if (!terminals.includes(state.terminal)) state.terminal = terminals[0];
  $("#productSelect").innerHTML = products.map(v => `<option${v === state.product ? " selected" : ""}>${esc(v)}</option>`).join("");
  $("#terminalSelect").innerHTML = terminals.map(v => `<option${v === state.terminal ? " selected" : ""}>${esc(v)}</option>`).join("");
  $("#productSelect").addEventListener("change", e => { state.product = e.target.value; renderTrend(); });
  $("#terminalSelect").addEventListener("change", e => { state.terminal = e.target.value; renderTrend(); });
  $("#tableSearch").addEventListener("input", () => { state.limit = 30; renderTable(); });
  $("#showMore").addEventListener("click", () => { state.limit += 50; renderTable(); });
}

function renderAll() { renderMetrics(); renderTrend(); renderTable(); }

function renderMetrics() {
  const snapshot = latest();
  const rows = snapshot.prices;
  const average = rows.reduce((sum, row) => sum + row.price, 0) / rows.length;
  const low = rows.reduce((a, b) => a.price < b.price ? a : b);
  const high = rows.reduce((a, b) => a.price > b.price ? a : b);
  $("#metricDate").textContent = snapshot.date;
  $("#metricCount").textContent = `${rows.length} available quotes`;
  $("#metricAverage").textContent = fmt(average);
  $("#metricLow").textContent = fmt(low.price);
  $("#metricLowLabel").textContent = `${low.product} · ${low.terminal}`;
  $("#metricHigh").textContent = fmt(high.price);
  $("#metricHighLabel").textContent = `${high.product} · ${high.terminal}`;
  const collected = new Date(snapshot.collected_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
  $("#freshness").textContent = `Latest ${snapshot.date} · collected ${collected}`;
}

function series() {
  return state.data.snapshots.map(snapshot => {
    const row = snapshot.prices.find(r => r.product === state.product && r.terminal === state.terminal);
    return row ? { date: snapshot.date, value: row.price } : null;
  }).filter(Boolean);
}

function renderTrend() {
  const points = series();
  const svg = $("#trendChart");
  $("#chartEmpty").hidden = points.length > 0;
  if (!points.length) { svg.innerHTML = ""; $("#trendSummary").textContent = ""; return; }
  const values = points.map(p => p.value);
  const latestValue = values.at(-1);
  const change = points.length > 1 ? latestValue - values.at(-2) : 0;
  $("#trendSummary").innerHTML = `<strong>${fmt(latestValue)}/L</strong> ${state.product} · ${state.terminal} · vs. previous ${change >= 0 ? "+" : ""}${change.toFixed(2)}¢`;
  const W = 1000, H = 360, pad = { l: 68, r: 28, t: 22, b: 50 };
  let min = Math.min(...values), max = Math.max(...values);
  const spread = max - min || Math.max(4, max * .04);
  min -= spread * .18; max += spread * .18;
  const x = i => points.length === 1 ? W / 2 : pad.l + i * (W - pad.l - pad.r) / (points.length - 1);
  const y = v => pad.t + (max - v) * (H - pad.t - pad.b) / (max - min);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const grid = Array.from({length: 5}, (_, i) => {
    const yy = pad.t + i * (H - pad.t - pad.b) / 4;
    const value = max - i * (max - min) / 4;
    return `<line class="chart-grid" x1="${pad.l}" x2="${W-pad.r}" y1="${yy}" y2="${yy}"/><text class="chart-axis" x="${pad.l-12}" y="${yy+4}" text-anchor="end">${value.toFixed(1)}</text>`;
  }).join("");
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const labels = labelIndexes.map(i => `<text class="chart-axis" x="${x(i)}" y="${H-18}" text-anchor="middle">${points[i].date}</text>`).join("");
  const circles = points.map((p, i) => `<circle class="chart-point" cx="${x(i)}" cy="${y(p.value)}" r="5"><title>${p.date}: ${fmt(p.value)}/L</title></circle>`).join("");
  svg.innerHTML = `<defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ee5b2b" stop-opacity=".24"/><stop offset="1" stop-color="#ee5b2b" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${circles}${labels}`;
}

function renderTable() {
  const query = $("#tableSearch").value.trim().toLowerCase();
  const rows = latest().prices;
  const means = Object.fromEntries([...new Set(rows.map(r => r.product))].map(product => {
    const group = rows.filter(r => r.product === product);
    return [product, group.reduce((sum, r) => sum + r.price, 0) / group.length];
  }));
  const filtered = rows.filter(r => `${r.product} ${r.terminal}`.toLowerCase().includes(query));
  $("#priceRows").innerHTML = filtered.slice(0, state.limit).map(row => {
    const delta = row.price - means[row.product];
    const cls = delta > .005 ? "delta-up" : delta < -.005 ? "delta-down" : "";
    return `<tr><td>${esc(row.product)}</td><td>${esc(row.terminal)}</td><td>${fmt(row.price)}/L</td><td class="${cls}">${delta >= 0 ? "+" : ""}${delta.toFixed(2)}¢</td></tr>`;
  }).join("");
  $("#showMore").hidden = filtered.length <= state.limit;
}

boot();
