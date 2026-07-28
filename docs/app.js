const PRODUCT = "E10";
const PRIMARY_TERMINAL = "Halifax";
const state = { data: null, terminal: PRIMARY_TERMINAL };
const $ = (selector) => document.querySelector(selector);
const price = (value) => `${value.toFixed(2)}\u00A2/L`;
const signed = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}\u00A2`;
const esc = (value) => String(value).replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
}[char]));

function e10Rows(snapshot) {
  return snapshot.prices.filter((row) => row.product === PRODUCT);
}

function latest() {
  return state.data.snapshots.at(-1);
}

async function boot() {
  try {
    const response = await fetch("data/history.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    if (!state.data.snapshots?.length) throw new Error("NO HISTORICAL SNAPSHOTS");
    setupTerminalControl();
    renderAll();
  } catch (error) {
    $("#freshness").textContent = `FEED ERROR / ${error.message}`;
    $("#chartEmpty").hidden = false;
  }
}

function setupTerminalControl() {
  const terminals = [...new Set(state.data.snapshots.flatMap(e10Rows).map((row) => row.terminal))].sort();
  if (!terminals.includes(state.terminal)) state.terminal = terminals[0];
  $("#terminalSelect").innerHTML = terminals.map((terminal) =>
    `<option${terminal === state.terminal ? " selected" : ""}>${esc(terminal)}</option>`
  ).join("");
  $("#terminalSelect").addEventListener("change", (event) => {
    state.terminal = event.target.value;
    renderTrend();
  });
  $("#tableSearch").addEventListener("input", renderTable);
}

function renderAll() {
  renderHeroAndMetrics();
  renderTrend();
  renderTable();
}

function renderHeroAndMetrics() {
  const snapshot = latest();
  const rows = e10Rows(snapshot);
  const halifax = rows.find((row) => row.terminal === PRIMARY_TERMINAL);
  if (!halifax) throw new Error("HALIFAX E10 QUOTE MISSING");

  const previous = [...state.data.snapshots].reverse().slice(1)
    .map((item) => e10Rows(item).find((row) => row.terminal === PRIMARY_TERMINAL))
    .find(Boolean);
  const average = rows.reduce((sum, row) => sum + row.price, 0) / rows.length;
  const low = rows.reduce((a, b) => a.price < b.price ? a : b);
  const high = rows.reduce((a, b) => a.price > b.price ? a : b);

  $("#heroPrice").textContent = halifax.price.toFixed(2);
  $("#effectiveDate").textContent = snapshot.date;
  $("#heroDelta").textContent = previous
    ? `${signed(halifax.price - previous.price)} VS PREVIOUS QUOTE`
    : "BASELINE QUOTE / FIRST OBSERVATION";
  $("#heroDelta").className = previous && halifax.price - previous.price > 0
    ? "delta-up" : previous && halifax.price - previous.price < 0 ? "delta-down" : "";
  $("#metricAverage").textContent = average.toFixed(2);
  $("#metricRange").textContent = (high.price - low.price).toFixed(2);
  $("#metricRangeLabel").textContent = `${low.terminal} ${low.price.toFixed(2)} / ${high.terminal} ${high.price.toFixed(2)}`;
  $("#metricCount").textContent = String(rows.length).padStart(2, "0");

  const collected = new Date(snapshot.collected_at).toLocaleString("en-CA", {
    dateStyle: "medium", timeStyle: "short"
  }).toUpperCase();
  $("#freshness").textContent = `FEED LIVE / ${snapshot.date} / SYNC ${collected}`;
}

function selectedSeries() {
  return state.data.snapshots.map((snapshot) => {
    const row = e10Rows(snapshot).find((item) => item.terminal === state.terminal);
    return row ? { date: snapshot.date, value: row.price } : null;
  }).filter(Boolean);
}

function attachTrendCursor({ svg, points, x, y, width, height, pad }) {
  const cursor = svg.querySelector("#trendCursor");
  const cursorLine = svg.querySelector("#cursorLine");
  const cursorPoint = svg.querySelector("#cursorPoint");
  const cursorTooltip = svg.querySelector("#cursorTooltip");
  const cursorDate = svg.querySelector("#cursorDate");
  const cursorValue = svg.querySelector("#cursorValue");
  const hitbox = svg.querySelector("#chartHitbox");
  const plotWidth = width - pad.left - pad.right;
  let activeIndex = points.length - 1;

  function showPoint(index) {
    activeIndex = Math.max(0, Math.min(points.length - 1, index));
    const point = points[activeIndex];
    const pointX = x(activeIndex);
    const pointY = y(point.value);
    const tooltipWidth = 190;
    const tooltipHeight = 66;
    const tooltipX = pointX > width - pad.right - tooltipWidth - 18
      ? pointX - tooltipWidth - 14
      : pointX + 14;
    const tooltipY = Math.max(
      pad.top + 6,
      Math.min(height - pad.bottom - tooltipHeight - 6, pointY - tooltipHeight / 2)
    );

    cursor.setAttribute("visibility", "visible");
    cursorLine.setAttribute("x1", pointX);
    cursorLine.setAttribute("x2", pointX);
    cursorPoint.setAttribute("cx", pointX);
    cursorPoint.setAttribute("cy", pointY);
    cursorTooltip.setAttribute("transform", `translate(${tooltipX} ${tooltipY})`);
    cursorDate.textContent = `${point.date} / ${state.terminal.toUpperCase()}`;
    cursorValue.textContent = price(point.value);
    hitbox.setAttribute("aria-valuenow", String(activeIndex));
    hitbox.setAttribute("aria-valuetext", `${point.date}, ${state.terminal}, ${price(point.value)}`);
  }

  function hideCursor() {
    cursor.setAttribute("visibility", "hidden");
  }

  function indexFromPointer(event) {
    if (points.length === 1) return 0;
    const bounds = svg.getBoundingClientRect();
    const viewX = (event.clientX - bounds.left) * width / bounds.width;
    return Math.round((viewX - pad.left) / plotWidth * (points.length - 1));
  }

  svg.onpointerenter = (event) => showPoint(indexFromPointer(event));
  svg.onpointermove = (event) => showPoint(indexFromPointer(event));
  svg.onpointerleave = hideCursor;
  hitbox.addEventListener("focus", () => showPoint(activeIndex));
  hitbox.addEventListener("blur", hideCursor);
  hitbox.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    showPoint(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
  });
}

function renderTrend() {
  const points = selectedSeries();
  const svg = $("#trendChart");
  $("#chartEmpty").hidden = points.length > 0;
  if (!points.length) {
    svg.innerHTML = "";
    $("#trendSummary").textContent = "NO SERIES AVAILABLE";
    return;
  }

  const values = points.map((point) => point.value);
  const latestValue = values.at(-1);
  const change = points.length > 1 ? latestValue - values.at(-2) : null;
  $("#trendSummary").innerHTML = `<b>${price(latestValue)}</b><span>${esc(state.terminal)} / ${change === null ? "BASELINE" : `${signed(change)} VS PREVIOUS`}</span>`;

  const width = 1000, height = 380, pad = { left: 76, right: 30, top: 28, bottom: 54 };
  let min = Math.min(...values), max = Math.max(...values);
  const spread = max - min || Math.max(4, max * 0.04);
  min -= spread * 0.2;
  max += spread * 0.2;
  const x = (index) => points.length === 1
    ? width / 2
    : pad.left + index * (width - pad.left - pad.right) / (points.length - 1);
  const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
  const line = points.map((point, index) =>
    `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`
  ).join(" ");
  const area = `${line} L${x(points.length - 1)},${height - pad.bottom} L${x(0)},${height - pad.bottom} Z`;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const yy = pad.top + index * (height - pad.top - pad.bottom) / 4;
    const value = max - index * (max - min) / 4;
    return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"/><text class="chart-axis" x="${pad.left - 14}" y="${yy + 4}" text-anchor="end">${value.toFixed(1)}</text>`;
  }).join("");
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const labels = labelIndexes.map((index) =>
    `<text class="chart-axis" x="${x(index)}" y="${height - 18}" text-anchor="middle">${points[index].date}</text>`
  ).join("");
  const circles = points.map((point, index) =>
    `<circle class="chart-point" cx="${x(index)}" cy="${y(point.value)}" r="5"><title>${point.date}: ${price(point.value)}</title></circle>`
  ).join("");
  const cursor = `
    <g id="trendCursor" class="chart-cursor" visibility="hidden" pointer-events="none">
      <line id="cursorLine" class="chart-cursor-line" y1="${pad.top}" y2="${height - pad.bottom}"/>
      <circle id="cursorPoint" class="chart-cursor-point" r="8"/>
      <g id="cursorTooltip" class="chart-tooltip">
        <rect class="chart-tooltip-box" width="190" height="66"/>
        <text id="cursorDate" class="chart-tooltip-label" x="14" y="22"></text>
        <text id="cursorValue" class="chart-tooltip-value" x="14" y="49"></text>
      </g>
    </g>
    <rect id="chartHitbox" class="chart-hitbox" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${height - pad.top - pad.bottom}" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="${points.length - 1}" aria-label="Explore E10 price history with pointer or arrow keys"/>
  `;
  svg.innerHTML = `<defs><linearGradient id="fuelFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2b544" stop-opacity=".24"/><stop offset="1" stop-color="#f2b544" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${circles}${labels}${cursor}`;
  attachTrendCursor({ svg, points, x, y, width, height, pad });
}

function renderTable() {
  const query = $("#tableSearch").value.trim().toLowerCase();
  const rows = e10Rows(latest());
  const halifax = rows.find((row) => row.terminal === PRIMARY_TERMINAL);
  const average = rows.reduce((sum, row) => sum + row.price, 0) / rows.length;
  const filtered = rows
    .filter((row) => row.terminal.toLowerCase().includes(query))
    .sort((a, b) => a.terminal === PRIMARY_TERMINAL ? -1 : b.terminal === PRIMARY_TERMINAL ? 1 : a.terminal.localeCompare(b.terminal));

  $("#priceRows").innerHTML = filtered.map((row) => {
    const vsHalifax = row.price - halifax.price;
    const vsAverage = row.price - average;
    const deltaClass = (value) => value > 0.005 ? "delta-up" : value < -0.005 ? "delta-down" : "delta-flat";
    return `<tr class="${row.terminal === PRIMARY_TERMINAL ? "featured-row" : ""}"><td><span class="terminal-dot"></span>${esc(row.terminal)}${row.terminal === PRIMARY_TERMINAL ? '<small>PRIMARY</small>' : ""}</td><td>${price(row.price)}</td><td class="${deltaClass(vsHalifax)}">${signed(vsHalifax)}</td><td class="${deltaClass(vsAverage)}">${signed(vsAverage)}</td></tr>`;
  }).join("");
}

boot();
