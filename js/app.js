/* Japanese investment map.
   State color uses the documented subtotal. Blank totals stay undisclosed.
   Arc width uses a square-root scale of the state-allocated amount. */
(function () {
  /* Log ramps: more green means more documented funding. Blank totals use the hatch, not the low stop. */
  const LIGHT = ["#e7f6ec", "#b7e4c7", "#6fbf8d", "#2d9a58", "#15723c", "#08472a"];
  const DARK = ["#143528", "#20573c", "#328254", "#4eaf76", "#75cf99", "#9be5b4"];
  const BASIS = {
    announced_project_total: "Announced commitment",
    completed_project_total: "Completed project",
    acquisition_price: "Acquisition",
  };
  const STATUS = {
    announced: "Announced",
    operating: "Operating",
    completed: "Completed",
    unknown: "Status unresolved",
    under_construction: "Under construction",
    "closed subsequently": "Later closed",
    "status uncertain; models canceled": "Plans later canceled",
  };
  const ROUTE = {
    "target headquarters; deal not state-allocated":
      "Headquarters marker. This deal is not allocated to the state.",
    "company reference; spending not state-allocated":
      "Company reference. Spending is not allocated to the state.",
    "existing presence; no investment amount established":
      "Operating presence. No investment amount is established.",
    "cooperation agreement; no investment amount established":
      "Cooperation agreement. No investment amount is established.",
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const data = window.MAP_DATA;
  const svg = d3.select("#map");
  const stage = document.getElementById("stage");
  const panel = document.getElementById("panel");
  const tip = document.getElementById("tip");
  const legend = document.getElementById("legend");

  const stateByCode = new Map(data.states.map((s) => [s.code, s]));
  const stateByName = new Map(data.states.map((s) => [s.name, s]));
  // Decode static geography once, rather than during each camera transition.
  const stateFeatures = topojson.feature(window.US_ATLAS, window.US_ATLAS.objects.states).features
    .filter((feature) => stateByName.has(feature.properties.name));
  for (const feature of stateFeatures) {
    const record = stateByName.get(feature.properties.name);
    feature.properties.code = record.code;
    feature.properties.total = record.total;
  }
  const meshCache = new Map();
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const projectsByState = d3.group(data.projects, (p) => p.state);
  for (const list of projectsByState.values()) {
    list.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.firm.localeCompare(b.firm));
  }

  const totals = data.states.map((s) => s.total).filter((v) => v != null);
  const MIN = d3.min(totals);
  const MAX = d3.max(totals);
  const maxFlow = d3.max(data.projects, (p) => p.amount) || MAX;
  const widthScale = d3.scaleSqrt().domain([0, maxFlow]).range([0.65, 4]);
  const touchInput = window.matchMedia("(hover: none), (pointer: coarse)");

  const qMode = new URLSearchParams(location.search).get("mode");
  let mode = qMode === "heat" || qMode === "flows" || qMode === "both" ? qMode : "both";
  let hoverCode = null;
  let hoverFlow = null;
  let selectedCode = null;
  let selectedFlow = null;
  let selectedCompany = null;
  let returnState = null;
  let lastFocus = "NC";
  let introStarted = false;
  let introRunning = false;
  let renderedFrame = "";
  let timers = [];
  let flowEls = [];
  let hits = new Map();
  let centroids = new Map();
  let originNodes = [];
  let labelNodes = [];
  const labelMetrics = new Map();
  let resizeQueued = false;
  let fontsReady = false;
  let booted = false;
  let panelView = "details";
  let rankingSort = "amount";
  let rankingAscending = false;
  let sheetHeight = null;
  let sheetFraction = 0.4;
  let sheetDrag = null;
  const rankingButton = document.getElementById("ranking-open");

  document.getElementById("stat-value").textContent = formatLong(data.total);
  document.getElementById("methods-total").textContent = "The " + formatLong(data.total);
  const largestProject = data.projects.filter((p) => p.amount != null).sort((a, b) => b.amount - a.amount)[0];
  if (largestProject && data.total > 0) {
    const share = largestProject.amount / data.total;
    const fraction = Math.abs(share - 1 / 3) < 0.035 ? "about a third" : "about " + Math.round(share * 100) + "%";
    const isBattery = /batter/i.test(largestProject.project);
    document.getElementById("headline").textContent = "One " + (largestProject.firmGroup || largestProject.firm) +
      (isBattery ? " battery campus in " : " project in ") + stateByCode.get(largestProject.state).name +
      " is " + fraction + " of the total.";
  }

  function theme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function reduced() {
    return reducedMotion.matches;
  }
  function norm(value) {
    return Math.log(value / MIN) / Math.log(MAX / MIN);
  }
  function colorFor(total) {
    if (total == null) return "url(#unquantified)";
    const t = Math.max(0, Math.min(1, norm(total)));
    return d3.interpolateRgbBasis(theme() === "light" ? LIGHT : DARK)(t);
  }
  function formatAmount(m, long = false, tick = false) {
    if (m == null) return long ? "No state total" : "Not disclosed";
    const billions = Math.abs(m) >= 1000;
    const text = billions ? (Math.round(m / 10) / 100).toFixed(2) : tick && m >= 100
      ? String(Math.round(m)) : (Math.round(m * 10) / 10).toFixed(1).replace(/\.0$/, "");
    return "$" + text + (long ? (billions ? " billion" : " million") : (billions ? "B" : "M"));
  }
  function formatShort(m) { return formatAmount(m); }
  function formatLabel(m) { return formatAmount(m); }
  function formatTick(m) {
    return formatAmount(m, false, true);
  }
  function formatLong(m) {
    return formatAmount(m, true);
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }
  function stateQualifier(code) {
    const priced = (projectsByState.get(code) || []).filter((p) => p.amount != null);
    const kinds = new Set(priced.map((p) => p.qualifier));
    if (priced.length && kinds.size === 1) {
      const q = [...kinds][0];
      if (q === "at least") return "At least";
      if (q === "about") return "About";
    }
    return "";
  }
  function chipsFor(p) {
    const chips = [];
    const basis = BASIS[p.basis];
    if (basis) chips.push({ strong: true, text: basis });
    const status = STATUS[p.status];
    const repeat =
      (p.status === "announced" && p.basis === "announced_project_total") ||
      (p.status === "completed" && p.basis === "completed_project_total");
    if (status && !repeat) chips.push({ text: status });
    if (p.qualifier === "at least") chips.push({ text: "At least" });
    if (p.qualifier === "about") chips.push({ text: "About" });
    if (p.recordKind === "existing presence") chips.push({ text: "Presence only" });
    if (p.recordKind === "cooperation agreement") chips.push({ text: "Cooperation" });
    if (p.recordKind === "ownership transfer between Japanese-affiliated parties") {
      chips.push({ text: "Ownership transfer" });
    }
    if (p.year) chips.push({ text: p.year });
    return chips;
  }
  function routeLine(p) {
    const state = stateByCode.get(p.state);
    const special = ROUTE[p.route];
    if (special) return special;
    if (p.destKind === "state") {
      return (p.originLabel || "Japan") + " → " + state.name + ". No city in the source, so the arc ends at the state center.";
    }
    const place = p.city ? p.city : state.name;
    return (p.originLabel || "Japan") + " → " + place;
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function layout(w, h) {
    const mobile = w <= 860;
    const legendH = legend.getBoundingClientRect().height + 24;
    if (mobile) {
      const available = panel.hidden ? h : Math.max(180, window.innerHeight -
        (sheetHeight || window.innerHeight * 0.4) - stage.getBoundingClientRect().top - 12);
      const top = Math.max(168, Math.min(180, available * 0.3));
      return {
        mobile,
        japan: [18, 20, w - 18, top - 50],
        lower: [8, top, w - 8, Math.max(top + 100, available - (panel.hidden ? legendH : 12))],
      };
    }
    const pacific = !!selectedCompany;
    const available = w - (panel.hidden ? 0 : panel.getBoundingClientRect().width);
    const left = panel.hidden ? Math.min(pacific ? 310 : 280, w * 0.22) : 300;
    return {
      mobile,
      pacific,
      japan: [20, 24, panel.hidden ? 278 : 220, Math.max(150, Math.min(h - legendH - 110, 310))],
      lower: [left + 20, Math.max(84, h * 0.12), available - 20, h - 24],
    };
  }

  function fit(proj, box, feature, inset) {
    const pad = inset || 0;
    if (box[2] - box[0] < 4 || box[3] - box[1] < 4) return proj;
    proj.fitExtent(
      [
        [box[0] + pad, box[1] + pad],
        [box[2] - pad, box[3] - pad],
      ],
      feature
    );
    return proj;
  }

  function activeCode() {
    return hoverCode || selectedCode;
  }

  function renderLegend() {
    const previousGradient = legend.querySelector(".bar")?.style.background;
    const range = theme() === "light" ? LIGHT : DARK;
    const stops = [0, 0.25, 0.5, 0.75, 1]
      .map((t) => d3.interpolateRgbBasis(range)(t) + " " + t * 100 + "%")
      .join(", ");
    const at = (t) => MIN * Math.pow(MAX / MIN, t);
    legend.innerHTML =
      '<div class="heat-key">' +
      '<p class="legend-title">Amount, log scale</p>' +
      '<div class="bar" style="background:linear-gradient(90deg,' + stops + ')"></div>' +
      '<div class="ticks"><span>' + formatTick(at(0)) + "</span><span>" + formatTick(at(0.5)) + "</span><span>" + formatTick(at(1)) + "</span></div>" +
      '<div class="key-row"><span class="swatch"></span><span>No state total</span></div>' +
      "</div>" +
      '<div class="flow-key">' +
      '<div class="key-row"><span class="strokes" aria-hidden="true"><i style="height:0.65px"></i><i style="height:2px"></i><i style="height:4px"></i></span><span>Width follows amount</span></div>' +
      '<div class="key-row"><span class="dash-sample" aria-hidden="true"></span><span>No amount</span></div>' +
      "</div>";
    const bar = legend.querySelector(".bar");
    if (previousGradient && previousGradient !== bar.style.background && !reduced()) {
      const fading = document.createElement("span");
      fading.style.cssText = "position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:" + previousGradient;
      bar.appendChild(fading);
      fading.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease" })
        .onfinish = () => fading.remove();
    }
    legend.classList.toggle("is-heat-off", mode === "flows");
    legend.classList.toggle("is-flow-off", mode === "heat");
  }

  function companyStates() {
    if (!selectedCompany) return null;
    return new Set(
      data.projects
        .filter((p) => (p.firmGroup || p.firm) === selectedCompany)
        .map((p) => p.state)
    );
  }

  function applyFocus() {
    const states = companyStates();
    const code = states ? null : activeCode();
    const flowId = states ? null : (hoverFlow || selectedFlow);
    svg.selectAll(".state").each(function (d) {
      const id = d.properties.code;
      const on = states ? states.has(id) : !code || id === code;
      this.style.opacity = on ? "1" : "0.22";
    });
    svg.selectAll(".active-ring").attr("display", code ? null : "none");
    if (code) {
      const visual = svg.select('.state[data-state="' + code + '"]');
      if (!visual.empty()) {
        svg.selectAll(".active-ring").attr("d", visual.attr("d"));
        visual.node().parentNode.appendChild(visual.node());
      }
    }
    const hotOrigins = new Set();
    for (const f of flowEls) {
      const mine = states ? f.firmGroup === selectedCompany : !code || f.state === code;
      const hot = flowId ? f.id === flowId : mine && (!!code || !!states);
      if (hot) hotOrigins.add(f.originKey);
      let op = 0.27;
      let w = f.amount == null ? 0.8 : widthScale(f.amount);
      if ((code || states) && !mine) op = 0.04;
      if (hot) {
        op = 1;
        w += 1;
      }
      if (f.quiet && !f.revealed) op = 0;
      f.path.style.strokeOpacity = String(op);
      f.path.style.strokeWidth = w + "px";
      if (f.mark) f.mark.style.opacity = f.revealed ? String(op) : "0";
      if (hot) f.group.raise();
    }
    for (const o of originNodes) {
      const hot = o.keys.some((key) => hotOrigins.has(key));
      const idle = !code && !states;
      o.node.style.opacity = idle || hot ? "1" : "0.25";
      o.node.setAttribute("r", String(hot && (code || states) ? o.r + 1.5 : o.r));
    }
    const showFlows = mode !== "heat";
    svg.select(".flows").attr("visibility", showFlows ? "visible" : "hidden");
    svg.select(".flows").style("pointer-events", showFlows ? "auto" : "none");
    svg.selectAll(".state").each(function (d) {
      if (d.properties.total == null) this.style.fill = "url(#unquantified)";
      else if (mode === "flows") this.style.fill = "var(--flat)";
      else this.style.fill = colorFor(d.properties.total);
    });
    svg.selectAll(".state-dot").each(function () {
      const s = stateByCode.get(this.getAttribute("data-state"));
      this.setAttribute("fill", s.total == null ? "url(#unquantified)" : mode === "flows" ? "var(--flat)" : colorFor(s.total));
    });
    for (const hit of hits.values()) {
      hit.setAttribute("aria-expanded", hit.getAttribute("data-state") === selectedCode ? "true" : "false");
    }
    legend.classList.toggle("is-heat-off", mode === "flows");
    legend.classList.toggle("is-flow-off", mode === "heat");
  }

  function armAnimation() {
    clearTimers();
    introRunning = !reduced();
    const items = flowEls.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    const stateLayers = svg.selectAll(".fills,.border,.coast,.japan,.origins,.place,.inset-label,.state-dot").interrupt("intro");
    const labels = svg.select(".labels").interrupt("intro");
    if (reduced()) {
      stateLayers.style("opacity", null);
      labels.style("opacity", null);
      for (const f of items) {
        f.revealed = true;
        f.path.style.transition = "none";
        f.path.style.strokeDasharray = f.quiet ? "2.2 3.4" : "none";
        f.path.style.strokeDashoffset = "0";
      }
      applyFocus();
      return;
    }
    stateLayers.style("opacity", 0).transition("intro").duration(360).style("opacity", null);
    labels.style("opacity", 0).transition("intro").delay(380)
      .duration(240).style("opacity", 1);
    items.forEach((f) => {
      f.revealed = false;
      const len = f.path.getTotalLength();
      f.path.style.transition = "none";
      if (f.quiet) {
        f.path.style.strokeDasharray = "2.2 3.4";
        f.path.style.strokeDashoffset = "0";
      } else {
        f.path.style.strokeDasharray = String(len);
        f.path.style.strokeDashoffset = String(len);
      }
    });
    applyFocus();
    requestAnimationFrame(() => {
      items.forEach((f, i) => {
        const delay = 360 + i / Math.max(1, items.length - 1) * 650;
        if (!f.quiet) {
          f.path.style.transition = "stroke-dashoffset 820ms cubic-bezier(.22,.61,.36,1) " + delay +
            "ms, stroke-opacity 150ms ease, stroke-width 150ms ease, stroke 260ms ease";
          f.path.style.strokeDashoffset = "0";
        }
        timers.push(setTimeout(() => {
          f.revealed = true;
          if (!f.quiet) {
            f.path.style.transition = "";
            f.path.style.strokeDasharray = "none";
            f.path.style.strokeDashoffset = "0";
          }
          applyFocus();
        }, delay + 820));
      });
      timers.push(setTimeout(() => { introRunning = false; }, 2100));
    });
  }

  function neighbor(code, dir) {
    const cur = centroids.get(code);
    if (!cur) return null;
    const v = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[dir];
    let best = null;
    let bestScore = Infinity;
    for (const [c, p] of centroids) {
      if (c === code) continue;
      const dx = p[0] - cur[0];
      const dy = p[1] - cur[1];
      const along = dx * v[0] + dy * v[1];
      if (along < 10) continue;
      const cross = Math.abs(dx * v[1] - dy * v[0]);
      const score = cross * 1.35 + along;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  function focusState(code) {
    const hit = hits.get(code);
    if (!hit) return;
    lastFocus = code;
    for (const [c, node] of hits) node.setAttribute("tabindex", c === code ? "0" : "-1");
    hit.focus({ preventScroll: true });
    hoverFlow = null;
    hoverCode = code;
    applyFocus();
    showStateTip(code);
    const box = hit.getBoundingClientRect();
    moveTip({ clientX: box.left + box.width / 2, clientY: box.top + Math.min(24, box.height / 2) });
  }

  function showStateTip(code) {
    if (touchInput.matches) return;
    const s = stateByCode.get(code);
    const q = stateQualifier(code);
    tip.hidden = false;
    tip.innerHTML =
      '<p class="tip-name">' + esc(s.name) + "</p>" +
      '<p class="tip-total">' + esc((q ? q + " " : "") + formatLong(s.total)) + "</p>" +
      '<p class="tip-meta">' + s.records + (s.records === 1 ? " record" : " records") + "</p>";
  }
  function showFlowTip(id) {
    if (touchInput.matches) return;
    const p = projectById.get(id);
    const s = stateByCode.get(p.state);
    const where = p.city || (p.destKind === "state" ? "State reference" : s.name);
    tip.hidden = false;
    tip.innerHTML =
      '<p class="tip-name">' + esc(p.firm) + "</p>" +
      '<p class="tip-total">' + esc(p.amount == null ? "Undisclosed" : (p.qualifier === "about" ? "About " : p.qualifier === "at least" ? "At least " : "") + formatLong(p.amount)) + "</p>" +
      '<p class="tip-meta">' + esc(p.project) + "</p>" +
      '<p class="tip-meta">' + esc(where) + ", " + esc(s.name) + "</p>";
  }
  function moveTip(event) {
    if (tip.hidden) return;
    const rect = tip.getBoundingClientRect();
    let x = event.clientX + 16;
    let y = event.clientY + 18;
    if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - 14;
    if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - 12;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() {
    tip.hidden = true;
  }

  function sheetHandle() {
    return '<button type="button" class="grabber" aria-label="Expand details; drag or use arrow keys to resize" aria-expanded="false"></button>';
  }

  function frameBesidePanel() {
    if (renderedFrame !== frameKey()) draw(!sheetDrag);
  }

  function frameKey() {
    return [stage.clientWidth, stage.clientHeight, panel.hidden,
      stage.clientWidth <= 860 ? Math.round(sheetHeight || 0) : panel.offsetWidth,
      selectedCompany || ""].join(":");
  }

  // Read the shared panel timing so subsequent CSS changes keep the camera in sync.
  function panelMotion() {
    const style = getComputedStyle(panel);
    const index = Math.max(0, style.transitionProperty.split(",").map((s) => s.trim()).indexOf("transform"));
    const durations = style.transitionDuration.split(",");
    const duration = durations[index % durations.length].trim();
    const easings = style.transitionTimingFunction.match(/cubic-bezier\([^)]+\)|[a-z-]+/g) || ["ease"];
    const easing = easings[index % easings.length];
    const presets = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1],
      "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] };
    const controls = presets[easing] || (easing.match(/[\d.]+/g) || []).map(Number);
    return { duration: parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000),
      ease: (t) => panelEase(t, ...(controls.length === 4 ? controls : presets.ease)) };
  }

  // Interpolate screen coordinates, never type size, with the panel's cubic Bezier.
  function panelEase(t, x1, y1, x2, y2) {
    const bezier = (s, a, b) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
    let low = 0, high = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      if (bezier(mid, x1, x2) < t) low = mid;
      else high = mid;
    }
    return bezier((low + high) / 2, y1, y2);
  }

  function mapGeometry() {
    const counts = new Map();
    return [...svg.node().querySelectorAll("path,rect,circle,line,text")]
      .filter((node) => !node.closest("defs"))
      .map((node) => {
        const base = [node.tagName, node.getAttribute("class"), node.getAttribute("data-state"),
          node.parentNode.getAttribute("data-flow"), node.tagName === "text" ? node.textContent : ""].join(":");
        const n = counts.get(base) || 0;
        counts.set(base, n + 1);
        const attrs = {};
        for (const attr of ["d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "width", "height", "opacity"]) {
          if (node.hasAttribute(attr)) attrs[attr] = node.getAttribute(attr);
        }
        return [base + ":" + n, { node, attrs }];
      });
  }

  function setSheetHeight(height) {
    sheetHeight = Math.max(window.innerHeight * 0.2, Math.min(window.innerHeight * 0.94, height));
    sheetFraction = sheetHeight / window.innerHeight;
    panel.style.setProperty("--sheet-height", sheetHeight + "px");
    const expanded = sheetHeight > window.innerHeight * 0.65;
    const handle = panel.querySelector(".grabber");
    if (handle) {
      handle.setAttribute("aria-expanded", String(expanded));
      handle.setAttribute("aria-label", expanded ? "Collapse details; drag or use arrow keys to resize" : "Expand details; drag or use arrow keys to resize");
    }
    frameBesidePanel();
  }

  function showPanel(view) {
    const wasHidden = panel.hidden;
    const changedView = panelView !== view;
    panelView = view;
    rankingButton.setAttribute("aria-expanded", String(view === "ranking"));
    document.body.classList.add("has-panel");
    panel.hidden = false;
    if (wasHidden || changedView) sheetHeight = null;
    setSheetHeight(sheetHeight || window.innerHeight * 0.4);
    // Commit the offscreen position before starting the opaque slide.
    if (wasHidden) panel.getBoundingClientRect();
    requestAnimationFrame(() => { if (!panel.hidden) panel.classList.add("is-in"); });
  }

  function renderRanking(focusTitle = true) {
    const rows = data.states.slice().sort((a, b) => {
      if ((a.total == null) !== (b.total == null)) return a.total == null ? 1 : -1;
      const diff = rankingSort === "state" ? a.name.localeCompare(b.name) :
        rankingSort === "records" ? a.records - b.records : (a.total || 0) - (b.total || 0);
      return (rankingAscending ? diff : -diff) || a.name.localeCompare(b.name);
    });
    const column = (key, label) => '<th scope="col" aria-sort="' +
      (rankingSort === key ? (rankingAscending ? "ascending" : "descending") : "none") +
      '"><button type="button" data-sort="' + key + '">' + label +
      (rankingSort === key ? (rankingAscending ? " ↑" : " ↓") : "") + '</button></th>';
    panel.innerHTML = sheetHandle() + '<div class="panel-head">' +
      '<button type="button" class="panel-close" data-close aria-label="Close ranking">×</button>' +
      '<h2 id="panel-title" tabindex="-1">State ranking</h2>' +
      '<p class="quiet">Select a state to explore its records. Sort with the column buttons.</p></div>' +
      '<div class="panel-scroll"><table class="ranking-table"><caption class="sr">States ranked by documented amount. States without a total follow quantified states.</caption><thead><tr>' +
      column("state", "State") + column("amount", "Amount") + column("records", "Records") +
      '</tr></thead><tbody>' + rows.map((s) => '<tr data-ranking-state="' + s.code + '"><td><button type="button" data-select-state="' + s.code +
        '" aria-label="Open ' + esc(s.name) + ', ' + esc(formatLong(s.total)) + ', ' + s.records + ' records">' + esc(s.name) +
        '</button></td><td class="ranking-amount' + (s.total == null ? ' no-total' : '') + '">' + esc(s.total == null ? "No state total" : formatShort(s.total)) +
        (s.total == null ? '' : '<span class="ranking-bar" aria-hidden="true"><i style="width:' + (s.total / MAX * 100) + '%"></i></span>') +
        '</td><td>' + s.records + '</td></tr>').join("") + '</tbody></table></div>';
    showPanel("ranking");
    if (focusTitle) document.getElementById("panel-title").focus({ preventScroll: true });
  }

  function openRanking() {
    if (!panel.hidden && panelView === "ranking") { closePanel(); return; }
    const reframed = !!selectedCompany;
    selectedCode = selectedFlow = selectedCompany = returnState = null;
    hideTip();
    history.replaceState(null, "", location.pathname + location.search);
    renderRanking();
    if (reframed) draw();
    else applyFocus();
  }

  function renderPanel(focusTitle) {
    const s = stateByCode.get(selectedCode);
    const rows = projectsByState.get(selectedCode) || [];
    const q = stateQualifier(selectedCode);
    const parts = [
      ["Announced", s.announced, "var(--mix-ann)"],
      ["Completed", s.completed, "var(--mix-comp)"],
      ["Acquisition", s.acquisition, "var(--mix-acq)"],
    ].filter((d) => d[1]);
    let count = rows.length + " record" + (rows.length === 1 ? "" : "s");
    if (s.total != null && s.unpriced) count += " · " + s.unpriced + " not in the total";
    const mix = parts.length > 1
      ? '<div class="mix">' + parts.map((d) =>
          '<span style="width:' + (d[1] / s.total) * 100 + "%;background:" + d[2] + '"></span>'
        ).join("") + "</div>" +
        '<p class="mix-label">' + parts.map((d) => esc(formatShort(d[1]) + " " + d[0].toLowerCase())).join(" · ") + "</p>"
      : "";
    panel.innerHTML =
      sheetHandle() +
      '<div class="panel-head">' +
      '<button type="button" class="panel-close" data-close aria-label="Close details">×</button>' +
      "<h2 id=\"panel-title\" tabindex=\"-1\">" + esc(s.name) + "</h2>" +
      (q ? '<p class="kicker">' + esc(q) + "</p>" : "") +
      '<p class="big" id="panel-total">' + esc(formatLong(s.total)) + "</p>" +
      '<p class="quiet">' + esc(count) + "</p>" +
      mix +
      "</div>" +
      '<div class="panel-scroll">' +
      rows.map((p) => {
        const chipHtml = chipsFor(p).map((c) =>
          '<li class="chip' + (c.strong ? " strong" : "") + '">' + esc(c.text) + "</li>"
        ).join("");
        const company = p.firmGroup || p.firm;
        return (
          '<article class="record' + (p.id === selectedFlow ? " is-current" : "") + '" id="rec-' + esc(p.id) + '">' +
          '<div class="record-top">' +
          '<button type="button" class="company-btn" data-company="' + esc(company) + '" aria-label="Show ' + esc(company) + ' across the Pacific">' +
          logoMark(company) +
          '<span class="name">' + esc(company) + "</span></button>" +
          '<p class="amt">' + esc(p.amount == null ? "Undisclosed" : formatLong(p.amount)) + "</p></div>" +
          '<p class="project">' + esc(p.project) + "</p>" +
          (p.firm && p.firm !== company ? '<p class="parent">' + esc(p.firm) + "</p>" : "") +
          '<ul class="chips">' + chipHtml + "</ul>" +
          '<a class="source" href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(p.sourceTitle) + "</a>" +
          "</article>"
        );
      }).join("") +
      "</div>";
    showPanel("details");
    if (focusTitle) {
      const title = document.getElementById("panel-title");
      if (title) title.focus({ preventScroll: true });
    }
    if (selectedFlow) {
      const el = document.getElementById("rec-" + selectedFlow);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }

  function monogram(name) {
    const parts = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
    return ((parts[0] || "?").slice(0, 1) + (parts[1] ? parts[1].slice(0, 1) : "")).toUpperCase();
  }

  const LOGO_READY = new Set("ajinomoto astellas astemo daikin denso etria fujifilm fujitsu hitachi honda kawasaki kikkoman kubota mazda-toyota mitsubishi-corporation mitsubishi-electric mitsubishi-heavy-industries mitsui-fudosan mitsui-jera mori-trust nippn nippon-steel nissui-corporation ntt olympus omron otsuka panasonic recruit resorttrust sekisui-chemical sekisui-house-reit softbank spiber sumitomo-rubber terumo tokyo-century tokyo-ohka-hamamatsu toray toyota yamato-kogyo yokohama-rubber".split(" "));

  function logoSlug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function logoMark(company) {
    const mono = esc(monogram(company));
    const slug = logoSlug(company);
    if (!LOGO_READY.has(slug)) {
      return '<span class="logo is-fallback" aria-hidden="true"><span class="mono">' + mono + "</span></span>";
    }
    return '<span class="logo" data-logo="' + slug + '" aria-hidden="true"><img src="logos/' + slug + '.png" width="88" height="52" alt="" onerror="this.parentNode.classList.add(\'is-fallback\')"><span class="mono">' + mono + "</span></span>";
  }

  function projectsForCompany(name) {
    return data.projects
      .filter((p) => (p.firmGroup || p.firm) === name)
      .slice()
      .sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.state.localeCompare(b.state));
  }

  function renderCompanyPanel(focusTitle) {
    const rows = projectsForCompany(selectedCompany);
    const total = d3.sum(rows, (p) => p.amount || 0);
    const states = new Set(rows.map((p) => p.state));
    const back = returnState ? stateByCode.get(returnState) : null;
    panel.innerHTML =
      sheetHandle() +
      '<div class="panel-head">' +
      '<button type="button" class="panel-close" data-close aria-label="Close details">×</button>' +
      (back ? '<button type="button" class="text-btn" data-back>Back to ' + esc(back.name) + "</button>" : "") +
      '<p class="kicker">Company</p>' +
      '<div class="company-lockup">' + logoMark(selectedCompany) +
      "<h2 id=\"panel-title\" tabindex=\"-1\">" + esc(selectedCompany) + "</h2></div>" +
      '<p class="big">' + esc(total > 0 ? formatLong(total) : "Undisclosed") + "</p>" +
      '<p class="quiet">' + states.size + (states.size === 1 ? " state" : " states") + " · " + rows.length + (rows.length === 1 ? " record" : " records") + "</p>" +
      "</div>" +
      '<div class="panel-scroll">' +
      rows.map((p) => {
        const state = stateByCode.get(p.state);
        const chipHtml = chipsFor(p).map((c) =>
          '<li class="chip' + (c.strong ? " strong" : "") + '">' + esc(c.text) + "</li>"
        ).join("");
        return (
          '<article class="record">' +
          '<div class="record-top"><h3>' + esc(state ? state.name : p.state) + "</h3>" +
          '<p class="amt">' + esc(p.amount == null ? "Undisclosed" : formatLong(p.amount)) + "</p></div>" +
          '<p class="project">' + esc(p.project) + "</p>" +
          '<ul class="chips">' + chipHtml + "</ul>" +
          '<a class="source" href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(p.sourceTitle) + "</a>" +
          "</article>"
        );
      }).join("") +
      "</div>";
    showPanel("details");
    if (focusTitle) {
      const title = document.getElementById("panel-title");
      if (title) title.focus({ preventScroll: true });
    }
  }

  function openCompany(name, focusTitle) {
    if (!projectsForCompany(name).length) return;
    if (!selectedCompany) returnState = selectedCode;
    selectedCompany = name;
    selectedFlow = null;
    hideTip();
    renderCompanyPanel(focusTitle !== false);
    history.replaceState(null, "", "#co-" + encodeURIComponent(name));
    draw();
  }

  function openState(code, focusTitle) {
    const reframed = !!selectedCompany;
    selectedCompany = null;
    selectedCode = code;
    selectedFlow = null;
    lastFocus = code;
    hideTip();
    renderPanel(focusTitle !== false);
    history.replaceState(null, "", "#" + code);
    if (reframed) draw();
    else applyFocus();
  }
  function openRecord(id, focusTitle) {
    const p = projectById.get(id);
    if (!p) return;
    const reframed = !!selectedCompany;
    selectedCompany = null;
    selectedCode = p.state;
    selectedFlow = id;
    lastFocus = p.state;
    hideTip();
    renderPanel(focusTitle !== false);
    history.replaceState(null, "", "#" + encodeURIComponent(id));
    if (reframed) draw();
    else applyFocus();
  }
  function closePanel() {
    const wasRanking = panelView === "ranking";
    const reframed = !!selectedCompany;
    selectedCompany = null;
    returnState = null;
    selectedCode = null;
    selectedFlow = null;
    panel.classList.remove("is-in");
    panel.hidden = true;
    document.body.classList.remove("has-panel");
    rankingButton.setAttribute("aria-expanded", "false");
    frameBesidePanel();
    history.replaceState(null, "", location.pathname + location.search);
    if (reframed) draw();
    else applyFocus();
    const hit = hits.get(lastFocus);
    if (wasRanking) rankingButton.focus({ preventScroll: true });
    else if (hit) {
      for (const [c, node] of hits) node.setAttribute("tabindex", c === lastFocus ? "0" : "-1");
      hit.focus({ preventScroll: true });
    }
  }

  function curve(a, b, fan, inset) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dist = Math.hypot(dx, dy) || 1;
    // Leave the Japan inset to the right before turning toward the western insets.
    if (inset || stage.clientWidth <= 860) {
      const bend = Math.min(80, dist * 0.25);
      const outer = stage.clientWidth <= 860 ? stage.clientWidth - 24 : Math.max(318, a[0] + 135);
      const turn = [outer, a[1] + 90];
      const c1 = [a[0] + 65, a[1] - 42];
      const c = [b[0] + bend + fan * 18, b[1] - bend];
      return {
        c,
        d: "M" + a[0].toFixed(1) + "," + a[1].toFixed(1) +
          " C" + c1[0].toFixed(1) + "," + c1[1].toFixed(1) +
          " " + outer.toFixed(1) + "," + (a[1] - 50).toFixed(1) +
          " " + turn[0].toFixed(1) + "," + turn[1].toFixed(1) +
          " C" + outer.toFixed(1) + "," + (a[1] + 180).toFixed(1) +
          " " + c[0].toFixed(1) + "," + c[1].toFixed(1) +
          " " + b[0].toFixed(1) + "," + b[1].toFixed(1),
      };
    }
    const band = 14 + (fan + 0.5) * Math.min(78, stage.clientHeight * 0.12);
    const c1 = [a[0] + dx * 0.22, band];
    const c2 = [a[0] + dx * 0.78 + fan * 24, band];
    return {
      c: c2,
      d: "M" + a[0].toFixed(1) + "," + a[1].toFixed(1) +
        " C" + c1[0].toFixed(1) + "," + c1[1].toFixed(1) +
        " " + c2[0].toFixed(1) + "," + c2[1].toFixed(1) +
        " " + b[0].toFixed(1) + "," + b[1].toFixed(1),
    };
  }
  function arrowPath(c, b, size) {
    const tx = b[0] - c[0];
    const ty = b[1] - c[1];
    const len = Math.hypot(tx, ty) || 1;
    const ux = tx / len;
    const uy = ty / len;
    const px = -uy;
    const py = ux;
    const bx = b[0] - ux * size;
    const by = b[1] - uy * size;
    const w = size * 0.42;
    return "M" + b[0].toFixed(1) + "," + b[1].toFixed(1) +
      " L" + (bx + px * w).toFixed(1) + "," + (by + py * w).toFixed(1) +
      " L" + (bx - px * w).toFixed(1) + "," + (by + py * w).toFixed(1) + " Z";
  }

  function draw(animateRefit = false) {
    const w = Math.round(stage.clientWidth);
    const h = Math.round(stage.clientHeight);
    if (w < 40 || h < 40) return;
    const previous = animateRefit && !reduced() ? new Map(mapGeometry()) : null;
    renderedFrame = frameKey();
    clearTimers();
    const box = layout(w, h);
    const usTopo = window.US_ATLAS;
    const matched = stateFeatures;
    if (matched.length !== 51) {
      stage.insertAdjacentHTML("beforeend", '<p class="noscript">The state shapes did not match the ledger.</p>');
      return;
    }
    const lowerFeatures = matched.filter((f) => f.properties.code !== "AK" && f.properties.code !== "HI");
    const alaskaFeature = matched.find((f) => f.properties.code === "AK");
    const hawaiiFeature = matched.find((f) => f.properties.code === "HI");
    const lowerGeo = { type: "FeatureCollection", features: lowerFeatures };

    const usProj = fit(d3.geoAlbers(), box.lower, lowerGeo, 2);
    // Reserve the space above the desktop legend, independently of the map camera.
    const usBounds = d3.geoPath(usProj).bounds(lowerGeo);
    const usW = usBounds[1][0] - usBounds[0][0];
    const usH = usBounds[1][1] - usBounds[0][1];
    const insetBottom = usBounds[1][1] - 6;
    box.alaska = [usBounds[0][0] + usW * 0.01, insetBottom - usH * 0.23,
      usBounds[0][0] + usW * 0.20, insetBottom];
    box.hawaii = [usBounds[0][0] + usW * 0.22, insetBottom - usH * 0.13,
      usBounds[0][0] + usW * 0.33, insetBottom];
    if (!box.mobile) {
      const bottom = legend.getBoundingClientRect().top - stage.getBoundingClientRect().top - 30;
      box.alaska = [24, bottom - 78, 142, bottom];
      box.hawaii = [174, bottom - 43, 222, bottom];
    }
    const akProj = fit(
      d3.geoConicEqualArea().rotate([154, 0]).center([-2, 58.5]).parallels([55, 65]),
      box.alaska,
      alaskaFeature,
      1
    );
    const hiProj = fit(
      d3.geoConicEqualArea().rotate([157, 0]).center([-3, 19.9]).parallels([8, 18]),
      box.hawaii,
      hawaiiFeature,
      1
    );
    const jpProj = d3.geoMercator();
    const jpFrame = box.japan;
    jpProj.fitExtent(
      [
        [jpFrame[0] + (box.mobile ? 70 : 12), jpFrame[1] + 28],
        [jpFrame[2] - (box.mobile ? 70 : 12), jpFrame[3] - 14],
      ],
      window.JAPAN
    );

    function projFor(code) {
      if (code === "AK") return akProj;
      if (code === "HI") return hiProj;
      return usProj;
    }
    function subset(features) {
      const ids = new Set(features.map((f) => String(f.id).padStart(2, "0")));
      return {
        type: "GeometryCollection",
        geometries: usTopo.objects.states.geometries.filter((g) => ids.has(String(g.id).padStart(2, "0"))),
      };
    }

    svg.attr("viewBox", "0 0 " + w + " " + h).attr("width", w).attr("height", h);
    svg.selectAll("*").remove();
    hits = new Map();
    centroids = new Map();
    originNodes = [];
    labelNodes = [];
    flowEls = [];

    const defs = svg.append("defs");
    const pattern = defs.append("pattern")
      .attr("id", "unquantified")
      .attr("width", 6)
      .attr("height", 6)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", "rotate(32)");
    pattern.append("rect").attr("width", 6).attr("height", 6).attr("fill", "var(--unq)");
    pattern.append("line")
      .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
      .attr("stroke", "var(--unq-line)").attr("stroke-width", 1.35);

    svg.append("rect")
      .attr("class", "ocean-hit")
      .attr("width", w)
      .attr("height", h)
      .attr("fill", "transparent")
      .on("click", () => { if (selectedCode) closePanel(); });

    svg.append("rect")
      .attr("class", "japan-frame")
      .attr("x", jpFrame[0]).attr("y", jpFrame[1])
      .attr("width", jpFrame[2] - jpFrame[0]).attr("height", jpFrame[3] - jpFrame[1])
      .attr("rx", 12);
    svg.append("path")
      .attr("class", "japan")
      .attr("d", d3.geoPath(jpProj)(window.JAPAN));
    svg.append("text")
      .attr("class", "place")
      .attr("text-anchor", "middle")
      .attr("x", (jpFrame[0] + jpFrame[2]) / 2)
      .attr("y", jpFrame[1] + 17)
      .text("Japan");

    const fills = svg.append("g").attr("class", "fills");
    function addStates(features, projection) {
      const path = d3.geoPath(projection);
      fills.selectAll(null)
        .data(features)
        .join("path")
        .attr("class", "state")
        .attr("data-state", (d) => d.properties.code)
        .attr("fill", (d) => d.properties.total == null ? "url(#unquantified)" :
          mode === "flows" ? "var(--flat)" : colorFor(d.properties.total))
        .attr("d", path)
        .each(function (d) {
          const c = path.centroid(d);
          if (Number.isFinite(c[0]) && Number.isFinite(c[1])) centroids.set(d.properties.code, c);
        });
      const meshKey = features.map((f) => f.id).join(",");
      if (!meshCache.has(meshKey)) {
        const obj = subset(features);
        meshCache.set(meshKey, [topojson.mesh(usTopo, obj, (a, b) => a !== b),
          topojson.mesh(usTopo, obj, (a, b) => a === b)]);
      }
      const [border, coast] = meshCache.get(meshKey);
      svg.append("path").attr("class", "border").attr("d", path(border));
      svg.append("path").attr("class", "coast").attr("d", path(coast));
    }
    addStates(lowerFeatures, usProj);
    addStates([alaskaFeature], akProj);
    addStates([hawaiiFeature], hiProj);
    for (const code of ["AK", "HI"]) {
      const feature = code === "AK" ? alaskaFeature : hawaiiFeature;
      const bounds = d3.geoPath(projFor(code)).bounds(feature);
      svg.append("text").attr("class", "inset-label")
        .attr("x", bounds[1][0] + (box.mobile ? 3 : 7))
        .attr("y", (bounds[0][1] + bounds[1][1]) / 2 + 4).text(code);
    }

    const flowData = [];
    for (const p of data.projects) {
      const origin = jpProj(p.origin);
      if (!origin) continue;
      let dest = null;
      if (p.dest) dest = projFor(p.state)(p.dest);
      if (!dest || !Number.isFinite(dest[0])) dest = centroids.get(p.state);
      if (!dest) continue;
      flowData.push({
        id: p.id,
        state: p.state,
        firmGroup: p.firmGroup || p.firm,
        amount: p.amount,
        quiet: p.amount == null,
        originKey: p.origin.map((n) => n.toFixed(2)).join(","),
        originLabel: p.originLabel,
        origin,
        xy: dest.slice(),
      });
    }
    // Representative cities keep the five merged regions attached to real geography.
    const regions = d3.group(flowData, (d) => {
      const p = projectById.get(d.id).origin;
      return p[1] >= 37 ? "Tsuruoka" : p[0] >= 138 ? "Tokyo area" :
        p[0] >= 136 ? "Nagoya area" : p[0] >= 134 ? "Osaka area" : "Western Japan";
    });
    const ports = [...regions].sort((a, b) => d3.mean(a[1], (d) => d.origin[1]) - d3.mean(b[1], (d) => d.origin[1]));
    const portLocations = {
      "Tsuruoka": [139.830214, 38.700414], "Tokyo area": [139.749462, 35.686963],
      "Nagoya area": [136.913046, 35.156943], "Osaka area": [135.503754, 34.691095],
      "Western Japan": [132.440967, 34.389781],
    };
    ports.forEach(([name, rows]) => {
      const port = jpProj(portLocations[name]);
      rows.forEach((d) => { d.origin = port; d.originRegion = name; });
    });
    const piles = d3.group(flowData, (d) => Math.round(d.xy[0] / 2) + ":" + Math.round(d.xy[1] / 2));
    for (const arr of piles.values()) {
      if (arr.length < 2) continue;
      arr.forEach((d, i) => {
        d.xy[0] += (i - (arr.length - 1) / 2) * 6;
      });
    }
    const fans = d3.group(flowData, (d) => d.originKey);
    for (const arr of fans.values()) {
      arr.sort((a, b) => a.xy[0] - b.xy[0] || a.xy[1] - b.xy[1]);
      arr.forEach((d, i) => {
        d.fan = arr.length === 1 ? 0 : i / (arr.length - 1) - 0.5;
      });
    }
    flowData.sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));

    const flows = svg.append("g").attr("class", "flows").attr("aria-hidden", "true");
    const flowColor = theme() === "light" ? "var(--flow)" : "var(--flow)";
    for (const d of flowData) {
      const shape = curve(d.origin, d.xy, d.fan, d.state === "AK" || d.state === "HI");
      const g = flows.append("g").attr("data-flow", d.id).attr("data-state", d.state);
      g.append("path")
        .attr("class", "flow-hit")
        .attr("d", shape.d)
        .attr("stroke", "#000")
        .attr("stroke-opacity", 0)
        .attr("stroke-width", 10)
        .on("pointerenter", (event) => {
          if (touchInput.matches || event.pointerType === "touch") return;
          hoverFlow = d.id;
          hoverCode = d.state;
          applyFocus();
          showFlowTip(d.id);
          moveTip(event);
        })
        .on("pointermove", moveTip)
        .on("pointerleave", () => {
          hoverFlow = null;
          hoverCode = null;
          applyFocus();
          hideTip();
        })
        .on("click", (event) => {
          event.stopPropagation();
          if (selectedFlow === d.id) closePanel();
          else openRecord(d.id);
        });
      const path = g.append("path")
        .attr("class", "flow-line")
        .attr("d", shape.d)
        .attr("stroke", d.quiet ? "var(--flow-quiet)" : flowColor)
        .attr("stroke-opacity", 0.27)
        .attr("stroke-width", d.quiet ? 0.8 : widthScale(d.amount))
        .node();
      let mark;
      if (d.quiet) {
        mark = g.append("circle")
          .attr("class", "mark")
          .attr("cx", d.xy[0])
          .attr("cy", d.xy[1])
          .attr("r", 2.2)
          .attr("fill", "var(--flow-quiet)")
          .node();
      } else {
        const size = Math.max(4, Math.min(9, widthScale(d.amount) * 1.8));
        mark = g.append("path")
          .attr("class", "arrow mark")
          .attr("d", arrowPath(shape.c, d.xy, size))
          .attr("fill", flowColor)
          .node();
      }
      flowEls.push({
        id: d.id,
        state: d.state,
        firmGroup: d.firmGroup,
        amount: d.amount,
        quiet: d.quiet,
        originKey: d.originKey,
        path,
        mark,
        group: g,
        revealed: introStarted || reduced(),
      });
    }

    const origins = svg.append("g").attr("class", "origins").attr("aria-hidden", "true");
    const southernPort = d3.max(ports, ([, rows]) => rows[0].origin[1]);
    // The three Kansai/western labels fan below their dots. Their leaders leave
    // the south side, away from the arc bundle, in separate left-to-right lanes.
    const originOffsets = {
      "Tsuruoka": [-80, -18], "Tokyo area": [box.mobile ? 42 : 18, box.mobile ? 5 : -4],
      "Nagoya area": [34, southernPort + 30],
      "Osaka area": [0, southernPort + 60],
      "Western Japan": [18, southernPort + 30],
    };
    for (const [name, rows] of ports) {
      const d = rows[0];
      const r = 2.5;
      const node = origins.append("circle")
        .attr("class", "origin")
        .attr("data-origin", name)
        .attr("cx", d.origin[0])
        .attr("cy", d.origin[1])
        .attr("r", r)
        .attr("fill", "var(--japan-line)")
        .node();
      originNodes.push({ keys: rows.map((d) => d.originKey), node, r });
      const [dx, dy] = originOffsets[name];
      const southern = ["Western Japan", "Osaka area", "Nagoya area"].includes(name);
      const text = origins.append("text")
        .attr("class", "origin-label")
        .attr("data-origin", name)
        .attr("text-anchor", name === "Osaka area" ? "middle" : "start")
        .attr("x", name === "Western Japan" || (name === "Tokyo area" && !box.mobile) ? dx : d.origin[0] + dx)
        .attr("y", southern ? dy : d.origin[1] + dy)
        .text(name);
      // Clamp measured text, including its halo, to a safe screen-pixel inset.
      let b = text.node().getBBox();
      const shift = Math.max(0, 18 - b.x) - Math.max(0, b.x + b.width - (w - 18));
      text.attr("x", +text.attr("x") + shift);
      b = text.node().getBBox();
      const end = southern ? [b.x + b.width / 2, b.y - 6] :
        [name === "Tsuruoka" || (name === "Tokyo area" && !box.mobile) ? b.x + b.width + 6 : b.x - 6, b.y + b.height / 2];
      const vx = end[0] - d.origin[0], vy = end[1] - d.origin[1];
      const distance = Math.hypot(vx, vy);
      origins.insert("line", "circle")
        .attr("class", "origin-leader").attr("data-origin", name)
        .attr("x1", d.origin[0] + vx / distance * 6).attr("y1", d.origin[1] + vy / distance * 6)
        .attr("x2", end[0]).attr("y2", end[1]);
    }

    const top = data.states.filter((s) => s.total != null).sort((a, b) => b.total - a.total).slice(0, w < 600 ? 3 : 10);
    const labels = svg.append("g").attr("class", "labels");
    const placedLabels = [];
    const placedLeaders = [];
    const crosses = (a, z, b, pad = 5) => {
      for (let t = 0; t <= 1; t += 0.025) {
        const x = a[0] + (z[0] - a[0]) * t, y = a[1] + (z[1] - a[1]) * t;
        if (x > b.x - pad && x < b.x + b.width + pad && y > b.y - pad && y < b.y + b.height + pad) return true;
      }
      return false;
    };
    for (const s of top) {
      const c = centroids.get(s.code);
      if (!c) continue;
      const statePath = svg.select('.state[data-state="' + s.code + '"]').node();
      const node = labels.append("text")
        .attr("class", "state-label")
        .attr("data-state", s.code)
        .attr("text-anchor", "middle")
        .attr("x", c[0])
        .attr("y", c[1] + 4)
        .attr("fill", "var(--ink)")
        .attr("stroke", "var(--bg)")
        .text(s.code + "  " + formatLabel(s.total))
        .node();
      // Measure once per text size. Candidate placement is numeric, so moving
      // the camera does not force SVG text layout for every trial position.
      const metricKey = (w < 600 ? "small:" : "desktop:") + node.textContent;
      let metrics = labelMetrics.get(metricKey);
      if (!metrics) {
        const b = node.getBBox();
        metrics = { left: b.x - c[0], top: b.y - (c[1] + 4), width: b.width, height: b.height };
        labelMetrics.set(metricKey, metrics);
      }
      const preferred = { OH: [8, -10], IN: [0, 0], KY: [22, 8], TN: [-15, 14], AL: [0, 8] }[s.code] || [0, 0];
      const candidates = [preferred, [0, 0], [0, -32], [0, 32], [-44, 0], [44, 0],
        [0, -56], [0, 56], [-48, -32], [48, 32], [-72, 0], [72, 0], [-48, 32], [48, -32],
        ...[56, 80, 104, 128, 152, 176, 200].flatMap((radius) => d3.range(8).map((n) =>
          [Math.round(Math.cos(n * Math.PI / 4) * radius), Math.round(Math.sin(n * Math.PI / 4) * radius)]))];
      let placed = false;
      for (const [dx, dy] of candidates) {
        const b = { x: c[0] + dx + metrics.left, y: c[1] + 4 + dy + metrics.top,
          width: metrics.width, height: metrics.height };
        // Keep every top state's anchor available for its own label/leader.
        if (top.some((other) => {
          const anchor = centroids.get(other.code);
          return other.code !== s.code && anchor && anchor[0] > b.x - 6 && anchor[0] < b.x + b.width + 6 &&
            anchor[1] > b.y - 6 && anchor[1] < b.y + b.height + 6;
        })) continue;
        if (b.x < 16 || b.x + b.width > box.lower[2] - 4 || placedLabels.some((p) =>
          b.x < p.x + p.width + 12 && b.x + b.width + 12 > p.x &&
          b.y < p.y + p.height + 12 && b.y + b.height + 12 > p.y)) continue;
        // Check the whole text rectangle against the actual state path, rather
        // than its bounding box. Narrow states get an explicit callout instead.
        const inside = [0, 0.5, 1].every((x) => [0, 0.5, 1].every((y) =>
          statePath.isPointInFill(new DOMPoint(b.x - 2 + (b.width + 4) * x, b.y - 2 + (b.height + 4) * y))));
        if (!inside && Math.hypot(dx, dy) < 32) continue;
        const center = [b.x + b.width / 2, b.y + b.height / 2];
        const vx = c[0] - center[0], vy = c[1] - center[1];
        const edge = Math.min((b.width / 2 + 6) / (Math.abs(vx) || 1e-6), (b.height / 2 + 6) / (Math.abs(vy) || 1e-6));
        const end = [center[0] + vx * edge, center[1] + vy * edge];
        if (placedLeaders.some(([a, z]) => crosses(a, z, b))) continue;
        if (!inside && placedLabels.some((p) => crosses(c, end, p))) continue;
        placedLabels.push(b);
        placed = true;
        node.setAttribute("x", c[0] + dx);
        node.setAttribute("y", c[1] + 4 + dy);
        node.setAttribute("data-contained", String(inside));
        // Retain invisible leaders for contained labels. Their coordinates and
        // opacity can then interpolate with the camera on panel open/close.
        labels.insert("line", "text")
          .attr("class", "label-leader").attr("data-state", s.code).attr("opacity", inside ? 0 : 1)
          .attr("x1", c[0]).attr("y1", c[1]).attr("x2", inside ? c[0] : end[0]).attr("y2", inside ? c[1] : end[1]);
        labels.insert("circle", "text").attr("class", "label-anchor").attr("data-state", s.code)
          .attr("cx", c[0]).attr("cy", c[1]).attr("r", 2).attr("fill", "var(--ink)").attr("opacity", inside ? 0 : 1);
        if (!inside) placedLeaders.push([c, end]);
        break;
      }
      if (!placed) { node.remove(); continue; }
      labelNodes.push({ code: s.code, total: s.total, node });
    }

    const ringUnder = svg.append("path").attr("class", "active-ring").attr("fill", "none")
      .attr("stroke", "var(--bg)").attr("stroke-width", 4.5);
    const ring = svg.append("path").attr("class", "active-ring").attr("fill", "none")
      .attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
    ringUnder.attr("display", "none");
    ring.attr("display", "none");
    labels.raise();

    const interaction = svg.append("g").attr("class", "interaction");
    svg.selectAll(".state").each(function (d) {
      const code = d.properties.code;
      const s = stateByCode.get(code);
      const q = stateQualifier(code);
      const label = s.name + ", " + (q ? q + " " : "") + formatLong(s.total) + ", " +
        s.records + (s.records === 1 ? " record" : " records");
      const hit = interaction.append("path")
        .attr("class", "hit")
        .attr("data-state", code)
        .attr("d", this.getAttribute("d"))
        .attr("fill", "transparent")
        .attr("role", "button")
        .attr("tabindex", code === lastFocus ? 0 : -1)
        .attr("aria-label", label)
        .attr("aria-describedby", "tip")
        .attr("aria-expanded", "false")
        .on("pointerenter", (event) => {
          if (touchInput.matches || event.pointerType === "touch") return;
          hoverFlow = null;
          hoverCode = code;
          applyFocus();
          showStateTip(code);
          moveTip(event);
        })
        .on("pointermove", moveTip)
        .on("pointerleave", () => {
          if (hoverCode === code) hoverCode = null;
          applyFocus();
          hideTip();
        })
        .on("click", (event) => {
          event.stopPropagation();
          lastFocus = code;
          if (selectedCode === code && !selectedFlow) closePanel();
          else openState(code);
        })
        .on("keydown", (event) => {
          const dir = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" }[event.key];
          if (dir) {
            event.preventDefault();
            const next = neighbor(code, dir);
            if (next) focusState(next);
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (selectedCode === code && !selectedFlow) closePanel();
            else openState(code);
          }
        })
        .on("focus", () => {
          lastFocus = code;
          hoverCode = code;
          hoverFlow = null;
          applyFocus();
          showStateTip(code);
          const b = hit.getBoundingClientRect();
          moveTip({ clientX: b.left + b.width / 2, clientY: b.top + Math.min(24, b.height / 2) });
        })
        .on("blur", () => {
          if (hoverCode === code) hoverCode = null;
          applyFocus();
          hideTip();
        })
        .node();
      hits.set(code, hit);
      const box = this.getBBox();
      if (box.width < 16 || box.height < 16) {
        const c = centroids.get(code);
        if (!c) return;
        fills.append("circle")
          .attr("class", "state-dot")
          .attr("data-state", code)
          .attr("cx", c[0]).attr("cy", c[1]).attr("r", 3.2)
          .attr("fill", mode === "flows" && s.total != null ? "var(--flat)" : colorFor(s.total))
          .attr("stroke", "var(--line-strong)").attr("stroke-width", 0.6)
          .attr("pointer-events", "none");
        interaction.append("circle")
          .attr("cx", c[0]).attr("cy", c[1]).attr("r", 11)
          .attr("fill", "transparent")
          .attr("role", "presentation")
          .on("pointerenter", (event) => {
            if (touchInput.matches || event.pointerType === "touch") return;
            hoverCode = code;
            hoverFlow = null;
            applyFocus();
            showStateTip(code);
            moveTip(event);
          })
          .on("pointermove", moveTip)
          .on("pointerleave", () => {
            if (hoverCode === code) hoverCode = null;
            applyFocus();
            hideTip();
          })
          .on("click", (event) => {
            event.stopPropagation();
            lastFocus = code;
            if (selectedCode === code && !selectedFlow) closePanel();
            else openState(code);
          });
      }
    });

    applyFocus();
    if (!introStarted || introRunning) {
      introStarted = true;
      armAnimation();
    } else {
      for (const f of flowEls) {
        f.revealed = true;
        f.path.style.strokeDasharray = f.quiet ? "2.2 3.4" : "none";
      }
      applyFocus();
    }

    if (!booted) {
      booted = true;
      const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
      if (hash.startsWith("co-")) openCompany(decodeURIComponent(hash.slice(3)), false);
      else if (hash && projectById.has(hash)) openRecord(hash, false);
      else if (hash && stateByCode.has(hash)) openState(hash, false);
    } else if (selectedCode) {
      applyFocus();
    }
    if (previous) {
      const motion = panelMotion();
      for (const [key, { node, attrs }] of mapGeometry()) {
        const old = previous.get(key);
        if (!old) continue;
        const transition = d3.select(node).transition("frame").duration(motion.duration).ease(motion.ease);
        for (const [attr, target] of Object.entries(attrs)) {
          if (old.attrs[attr] == null || old.attrs[attr] === target) continue;
          node.setAttribute(attr, old.attrs[attr]);
          transition.attr(attr, target);
        }
      }
    }
    frameBesidePanel();
  }

  function schedule() {
    if (!fontsReady || resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      draw();
      renderLegend();
    });
  }

  function setMode(next) {
    mode = next;
    document.querySelectorAll(".seg button").forEach((btn) => {
      btn.setAttribute("aria-checked", btn.getAttribute("data-mode") === mode ? "true" : "false");
    });
    if (mode !== "heat" && flowEls.some((f) => !f.revealed)) armAnimation();
    applyFocus();
    renderLegend();
  }

  function setTheme(next) {
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ji-theme-v3", next); } catch (e) {}
    document.getElementById("theme").setAttribute(
      "aria-label",
      next === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
    applyFocus();
    renderLegend();
  }

  document.querySelectorAll(".seg button").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.getAttribute("data-mode")));
  });
  document.querySelector(".seg").addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...document.querySelectorAll(".seg button")];
    let i = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    i = (i + (forward ? 1 : buttons.length - 1)) % buttons.length;
    buttons[i].click();
    buttons[i].focus();
  });
  document.getElementById("theme").addEventListener("click", () => {
    setTheme(theme() === "dark" ? "light" : "dark");
  });
  document.getElementById("theme").setAttribute(
    "aria-label",
    theme() === "dark" ? "Switch to light theme" : "Switch to dark theme"
  );
  document.getElementById("replay").addEventListener("click", () => {
    if (mode === "heat") setMode("both");
    introStarted = true;
    armAnimation();
  });
  rankingButton.addEventListener("click", openRanking);
  // Reuse map focus styling while keeping keyboard focus inside the ranking.
  function highlightRankingRow(event) {
    const row = event.target.closest("[data-ranking-state]");
    if (!row || panelView !== "ranking") return;
    hoverCode = row.getAttribute("data-ranking-state");
    hoverFlow = null;
    applyFocus();
  }
  function clearRankingHighlight(event) {
    const row = event.target.closest("[data-ranking-state]");
    if (!row || row.contains(event.relatedTarget)) return;
    const focused = event.type === "focusout" ? event.relatedTarget?.closest?.("[data-ranking-state]") : panel.querySelector("[data-ranking-state]:focus-within");
    hoverCode = focused ? focused.getAttribute("data-ranking-state") : null;
    applyFocus();
  }
  panel.addEventListener("pointerover", highlightRankingRow);
  panel.addEventListener("focusin", highlightRankingRow);
  panel.addEventListener("pointerout", clearRankingHighlight);
  panel.addEventListener("focusout", clearRankingHighlight);
  let suppressHandleClick = false;
  panel.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".grabber") || window.innerWidth > 860) return;
    sheetDrag = { y: event.clientY, height: panel.getBoundingClientRect().height, moved: false };
    suppressHandleClick = false;
    event.target.closest(".grabber").setPointerCapture(event.pointerId);
    panel.classList.add("is-dragging");
  });
  panel.addEventListener("pointermove", (event) => {
    if (!sheetDrag) return;
    const distance = sheetDrag.y - event.clientY;
    if (Math.abs(distance) > 6) sheetDrag.moved = true;
    setSheetHeight(sheetDrag.height + distance);
  });
  function finishSheetDrag(event) {
    if (!sheetDrag) return;
    const drag = sheetDrag;
    sheetDrag = null;
    panel.classList.remove("is-dragging");
    const handle = panel.querySelector(".grabber");
    if (handle && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    suppressHandleClick = drag.moved;
    if (!drag.moved || event.type === "pointercancel") { setSheetHeight(drag.height); return; }
    if (sheetHeight < window.innerHeight * 0.28) closePanel();
    else {
      const upward = drag.y - event.clientY > 35;
      const downward = event.clientY - drag.y > 35;
      setSheetHeight(window.innerHeight * (upward ? 0.94 : downward ? 0.4 : sheetHeight > window.innerHeight * 0.67 ? 0.94 : 0.4));
    }
  }
  panel.addEventListener("pointerup", finishSheetDrag);
  panel.addEventListener("pointercancel", finishSheetDrag);
  panel.addEventListener("keydown", (event) => {
    if (event.target.closest(".grabber") && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowDown" && sheetHeight <= window.innerHeight * 0.41) closePanel();
      else setSheetHeight(window.innerHeight * (["ArrowUp", "End"].includes(event.key) ? 0.94 : 0.4));
      return;
    }
    const row = event.target.closest("[data-select-state]");
    if (!row || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...panel.querySelectorAll("[data-select-state]")];
    const index = buttons.indexOf(row);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next].focus();
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest(".grabber")) {
      if (!suppressHandleClick) setSheetHeight(window.innerHeight * (sheetHeight > window.innerHeight * 0.65 ? 0.4 : 0.94));
      suppressHandleClick = false;
      return;
    }
    const sort = event.target.closest("[data-sort]");
    if (sort) {
      const key = sort.getAttribute("data-sort");
      rankingAscending = rankingSort === key ? !rankingAscending : key === "state";
      rankingSort = key;
      renderRanking(false);
      panel.querySelector('[data-sort="' + key + '"]').focus({ preventScroll: true });
      return;
    }
    const stateRow = event.target.closest("[data-ranking-state]");
    if (stateRow) { openState(stateRow.getAttribute("data-ranking-state")); return; }
    if (event.target.closest("[data-close]")) {
      closePanel();
      return;
    }
    if (event.target.closest("[data-back]")) {
      const back = returnState;
      selectedCompany = null;
      if (back) openState(back);
      else closePanel();
      return;
    }
    const company = event.target.closest("[data-company]");
    if (company) openCompany(company.getAttribute("data-company"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      closePanel();
    }
    if (event.key === "Escape") hideTip();
  });
  setMode(mode);
  new ResizeObserver(schedule).observe(stage);
  Promise.all([document.fonts.ready, document.fonts.load("600 12.5px Inter")]).then(() => {
    fontsReady = true;
    schedule();
  });
  const panelObserver = new ResizeObserver(frameBesidePanel);
  panelObserver.observe(stage);
  panelObserver.observe(panel);
  reducedMotion.addEventListener("change", () => {
    if (reduced()) { svg.selectAll("*").interrupt("frame"); draw(); armAnimation(); }
  });
  window.addEventListener("resize", () => {
    if (!panel.hidden && window.innerWidth <= 860) setSheetHeight(window.innerHeight * sheetFraction);
    else frameBesidePanel();
  });
  renderLegend();
  schedule();
})();
