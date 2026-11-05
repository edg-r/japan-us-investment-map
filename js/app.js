/* Japanese investment map.
   State color uses the documented subtotal. Blank totals stay undisclosed.
   Arc width uses a square-root scale of the state-allocated amount. */
(function () {
  /* Log ramps: more green means more documented funding. Blank totals use the hatch, not the low stop. */
  const LIGHT = ["#e7f6ec", "#b7e4c7", "#6fbf8d", "#2d9a58", "#15723c", "#08472a"];
  const DARK = ["#143528", "#1d6a40", "#2f9a58", "#6ed492", "#c6f5d4", "#f3fff6"];
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
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const projectsByState = d3.group(data.projects, (p) => p.state);
  for (const list of projectsByState.values()) {
    list.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.firm.localeCompare(b.firm));
  }

  const totals = data.states.map((s) => s.total).filter((v) => v != null);
  const MIN = d3.min(totals);
  const MAX = d3.max(totals);
  const widthScale = d3.scaleSqrt().domain([0, MAX]).range([0.85, 5.4]);
  const opScale = d3.scaleSqrt().domain([MIN, MAX]).range([0.28, 0.7]).clamp(true);

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
  let timers = [];
  let flowEls = [];
  let hits = new Map();
  let centroids = new Map();
  let originNodes = [];
  let labelNodes = [];
  let resizeQueued = false;
  let booted = false;

  document.getElementById("stat-value").textContent = formatLong(data.total);

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
  function formatShort(m) {
    if (m == null) return "—";
    if (Math.abs(m) >= 1000) {
      return "$" + (m / 1000).toFixed(3).replace(/\.?0+$/, "") + "B";
    }
    return "$" + (Math.round(m * 10) / 10).toFixed(1).replace(/\.0$/, "") + "M";
  }
  function formatLabel(m) {
    if (m >= 1000) {
      const b = m / 1000;
      if (b >= 10) return "$" + b.toFixed(1).replace(/\.0$/, "") + "B";
      if (Math.abs(b - Math.round(b)) < 0.05) return "$" + Math.round(b) + "B";
      return "$" + b.toFixed(2).replace(/0$/, "").replace(/\.$/, "") + "B";
    }
    return formatShort(m);
  }
  function formatTick(m) {
    if (m >= 1000) return formatLabel(m);
    if (m >= 100) return "$" + Math.round(m) + "M";
    return formatShort(m);
  }
  function formatLong(m) {
    if (m == null) return "No state total";
    if (Math.abs(m) >= 1000) {
      const text = (m / 1000).toFixed(3).replace(/\.?0+$/, "");
      return "$" + text + " billion";
    }
    const text = (Math.round(m * 10) / 10).toFixed(1).replace(/\.0$/, "");
    return "$" + text + " million";
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
    const mobile = w < 860;
    if (mobile) {
      const top = Math.max(72, Math.round(h * 0.2));
      const bottom = 172;
      return {
        mobile,
        japan: [8, 6, Math.round(w * 0.34), top - 6],
        alaska: [Math.round(w * 0.36), 6, Math.round(w * 0.68), top - 8],
        hawaii: [Math.round(w * 0.7), 8, w - 8, Math.round(top * 0.78)],
        lower: [4, top, w - 4, h - bottom],
      };
    }
    const legendH = 176;
    const pacific = !!selectedCompany;
    const left = pacific
      ? Math.round(w * 0.30)
      : Math.min(220, Math.max(150, Math.round(w * 0.155)));
    const sky = pacific ? Math.round(h * 0.16) : Math.max(120, Math.round(h * 0.22));
    const lowerX = pacific
      ? Math.round(w * 0.46)
      : Math.max(Math.round(w * 0.33), left + 176);
    if (pacific) {
      return {
        mobile,
        pacific,
        lowerX,
        japan: [28, 36, left, h - 40],
        alaska: [left + 14, 12, lowerX - 18, Math.round(h * 0.26)],
        hawaii: [left + 18, Math.round(h * 0.6), lowerX - 20, Math.round(h * 0.6) + 84],
        lower: [lowerX, sky, w - 14, h - 12],
      };
    }
    const japanBottom = Math.round(h * 0.56);
    return {
      mobile,
      pacific,
      lowerX,
      japan: [16, 8, left, japanBottom],
      alaska: [18, japanBottom + 8, left - 2, h - legendH - 4],
      hawaii: [left + 18, Math.round(h * 0.46), lowerX - 16, Math.round(h * 0.46) + Math.min(108, Math.round(h * 0.15))],
      lower: [lowerX, sky, w - 12, h - 10],
    };
  }

  function fit(proj, box, feature, inset) {
    const pad = inset || 0;
    if (box[2] - box[0] < 24 || box[3] - box[1] < 24) return proj;
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
      '<div class="key-row"><span class="strokes" aria-hidden="true"><i style="height:1.5px"></i><i style="height:3px"></i><i style="height:6px"></i></span><span>Width follows amount</span></div>' +
      '<div class="key-row"><span class="dash-sample" aria-hidden="true"></span><span>No amount</span></div>' +
      "</div>";
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
      let op = f.amount == null ? 0.22 : opScale(f.amount);
      let w = f.amount == null ? 0.85 : widthScale(f.amount);
      if ((code || states) && !mine) op = 0.04;
      if (hot) {
        op = Math.min(0.96, op + 0.38);
        w += 0.9;
      }
      if (f.quiet && !f.revealed) op = 0;
      f.path.style.strokeOpacity = String(op);
      f.path.style.strokeWidth = w + "px";
      if (f.mark) f.mark.style.opacity = f.revealed ? String(op) : "0";
      if (hot) f.group.raise();
    }
    for (const o of originNodes) {
      const hot = hotOrigins.has(o.key);
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
    const items = flowEls.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    if (reduced() || mode === "heat") {
      for (const f of items) {
        f.revealed = true;
        f.path.style.transition = "none";
        f.path.style.strokeDasharray = f.quiet ? "2.2 3.4" : "none";
        f.path.style.strokeDashoffset = "0";
      }
      applyFocus();
      return;
    }
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
        const delay = Math.min(i * 20, 1100);
        if (!f.quiet) {
          f.path.style.transition = "stroke-dashoffset 1.05s cubic-bezier(.22,.61,.36,1) " + delay + "ms";
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
        }, delay + (f.quiet ? 280 : 980)));
      });
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
    const s = stateByCode.get(code);
    const rows = projectsByState.get(code) || [];
    const q = stateQualifier(code);
    tip.hidden = false;
    tip.innerHTML =
      '<p class="tip-name">' + esc(s.name) + "</p>" +
      '<p class="tip-total">' + esc((q ? q + " " : "") + formatLong(s.total)) + "</p>" +
      "<ul>" +
      rows.map((p) =>
        "<li><span>" + esc(p.firm) + "</span><span>" + esc(p.amount == null ? "Undisclosed" : formatShort(p.amount)) + "</span></li>"
      ).join("") +
      "</ul>";
  }
  function showFlowTip(id) {
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
      '<div class="grabber" aria-hidden="true"></div>' +
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
          '<span class="logo" aria-hidden="true">' + esc(monogram(company)) + '</span>' +
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
    document.body.classList.add("has-panel");
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("is-in"));
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
      '<div class="grabber" aria-hidden="true"></div>' +
      '<div class="panel-head">' +
      '<button type="button" class="panel-close" data-close aria-label="Close details">×</button>' +
      (back ? '<button type="button" class="text-btn" data-back>Back to ' + esc(back.name) + "</button>" : "") +
      '<p class="kicker">Company</p>' +
      "<h2 id=\"panel-title\" tabindex=\"-1\">" + esc(selectedCompany) + "</h2>" +
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
    document.body.classList.add("has-panel");
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("is-in"));
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
    const reframed = !!selectedCompany;
    selectedCompany = null;
    returnState = null;
    selectedCode = null;
    selectedFlow = null;
    panel.classList.remove("is-in");
    panel.hidden = true;
    document.body.classList.remove("has-panel");
    history.replaceState(null, "", location.pathname + location.search);
    if (reframed) draw();
    else applyFocus();
    const hit = hits.get(lastFocus);
    if (hit) {
      for (const [c, node] of hits) node.setAttribute("tabindex", c === lastFocus ? "0" : "-1");
      hit.focus({ preventScroll: true });
    }
  }

  function curve(a, b, fan, inset) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dist = Math.hypot(dx, dy) || 1;
    // Alaska and Hawaii sit in their own frames, so those routes stay local.
    if (inset) {
      const mx = (a[0] + b[0]) / 2 + fan * 18;
      const my = Math.min(a[1], b[1]) - Math.min(80, Math.max(22, dist * 0.32));
      const c = [mx, Math.max(8, my)];
      return {
        c,
        d: "M" + a[0].toFixed(1) + "," + a[1].toFixed(1) +
          " Q" + c[0].toFixed(1) + "," + c[1].toFixed(1) +
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

  function draw() {
    const w = Math.round(stage.clientWidth);
    const h = Math.round(stage.clientHeight);
    if (w < 40 || h < 40) return;
    clearTimers();
    const box = layout(w, h);
    const usTopo = window.US_ATLAS;
    const collection = topojson.feature(usTopo, usTopo.objects.states);
    const matched = [];
    for (const feature of collection.features) {
      const rec = stateByName.get(feature.properties.name);
      if (!rec) continue;
      feature.properties.code = rec.code;
      feature.properties.total = rec.total;
      matched.push(feature);
    }
    if (matched.length !== 51) {
      stage.insertAdjacentHTML("beforeend", '<p class="noscript">The state shapes did not match the ledger.</p>');
      return;
    }
    const lowerFeatures = matched.filter((f) => f.properties.code !== "AK" && f.properties.code !== "HI");
    const alaskaFeature = matched.find((f) => f.properties.code === "AK");
    const hawaiiFeature = matched.find((f) => f.properties.code === "HI");
    const lowerGeo = { type: "FeatureCollection", features: lowerFeatures };

    const usProj = fit(d3.geoAlbers(), box.lower, lowerGeo, 2);
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
    const jpProj = fit(d3.geoMercator(), box.japan, window.JAPAN, 2);
    const jpFrame = box.japan;
    jpProj.fitExtent(
      [
        [jpFrame[0] + 2, jpFrame[1] + 2],
        [jpFrame[2] - 2, jpFrame[3] - 22],
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

    svg.append("path")
      .attr("class", "japan")
      .attr("d", d3.geoPath(jpProj)(window.JAPAN));
    const jpBounds = d3.geoPath(jpProj).bounds(window.JAPAN);
    svg.append("text")
      .attr("class", "place")
      .attr("text-anchor", "middle")
      .attr("x", (jpBounds[0][0] + jpBounds[1][0]) / 2)
      .attr("y", jpBounds[1][1] + 16)
      .text("Japan");

    const fills = svg.append("g").attr("class", "fills");
    function addStates(features, projection) {
      const path = d3.geoPath(projection);
      fills.selectAll(null)
        .data(features)
        .join("path")
        .attr("class", "state")
        .attr("data-state", (d) => d.properties.code)
        .attr("d", path)
        .each(function (d) {
          const c = path.centroid(d);
          if (Number.isFinite(c[0]) && Number.isFinite(c[1])) centroids.set(d.properties.code, c);
        });
      const obj = subset(features);
      svg.append("path").attr("class", "border").attr("d", path(topojson.mesh(usTopo, obj, (a, b) => a !== b)));
      svg.append("path").attr("class", "coast").attr("d", path(topojson.mesh(usTopo, obj, (a, b) => a === b)));
    }
    addStates(lowerFeatures, usProj);
    addStates([alaskaFeature], akProj);
    addStates([hawaiiFeature], hiProj);

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
      const g = flows.append("g");
      g.append("path")
        .attr("class", "flow-hit")
        .attr("d", shape.d)
        .attr("stroke", "#000")
        .attr("stroke-opacity", 0)
        .attr("stroke-width", 14)
        .on("pointerenter", (event) => {
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
        .node();
      let mark;
      if (d.quiet) {
        mark = g.append("circle")
          .attr("class", "mark")
          .attr("cx", d.xy[0])
          .attr("cy", d.xy[1])
          .attr("r", 2.1)
          .attr("fill", "var(--flow-quiet)")
          .node();
      } else {
        const size = Math.max(4.2, Math.min(12, widthScale(d.amount) * 2));
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

    const seenOrigin = new Set();
    const origins = svg.append("g").attr("class", "origins").attr("aria-hidden", "true");
    let tokyo = null;
    for (const d of flowData) {
      if (seenOrigin.has(d.originKey)) {
        if (!tokyo && /tokyo/i.test(d.originLabel || "")) tokyo = d;
        continue;
      }
      seenOrigin.add(d.originKey);
      const isTokyo = /tokyo/i.test(d.originLabel || "");
      if (isTokyo) tokyo = d;
      const r = isTokyo ? 3.3 : 2.15;
      const node = origins.append("circle")
        .attr("class", "origin")
        .attr("cx", d.origin[0])
        .attr("cy", d.origin[1])
        .attr("r", r)
        .attr("fill", "var(--gold)")
        .node();
      originNodes.push({ key: d.originKey, node, r });
    }
    if (tokyo) {
      origins.append("text")
        .attr("class", "origin-label")
        .attr("text-anchor", "start")
        .attr("x", tokyo.origin[0] + 8)
        .attr("y", tokyo.origin[1] + 14)
        .text("Tokyo");
    }

    const top = data.states.filter((s) => s.total != null).sort((a, b) => b.total - a.total).slice(0, 5);
    const labels = svg.append("g").attr("class", "labels");
    for (const s of top) {
      const c = centroids.get(s.code);
      if (!c) continue;
      const t = norm(s.total);
      const darkInk = theme() === "light" ? t < 0.55 : t > 0.62;
      const fill = darkInk ? "#1a140c" : "#fffdf8";
      const halo = darkInk ? "rgba(255,250,242,0.75)" : "rgba(20,12,8,0.35)";
      const node = labels.append("text")
        .attr("class", "state-label")
        .attr("text-anchor", "middle")
        .attr("x", c[0])
        .attr("y", c[1] + 4)
        .attr("fill", fill)
        .attr("stroke", halo)
        .text(s.code + "  " + formatLabel(s.total))
        .node();
      labelNodes.push({ code: s.code, total: s.total, node });
    }

    const ringUnder = svg.append("path").attr("class", "active-ring").attr("fill", "none")
      .attr("stroke", theme() === "dark" ? "#0c0e13" : "#f4f1ea").attr("stroke-width", 4.5);
    const ring = svg.append("path").attr("class", "active-ring").attr("fill", "none")
      .attr("stroke", theme() === "dark" ? "#f6f1e6" : "#1a140c").attr("stroke-width", 1.5);
    ringUnder.attr("display", "none");
    ring.attr("display", "none");

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
        .attr("aria-expanded", "false")
        .on("pointerenter", (event) => {
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
        .on("focus", () => { lastFocus = code; })
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
    if (!introStarted) {
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
  }

  function schedule() {
    if (resizeQueued) return;
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
    try { localStorage.setItem("ji-theme-v2", next); } catch (e) {}
    document.getElementById("theme").setAttribute(
      "aria-label",
      next === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
    draw();
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
  document.getElementById("about-open").addEventListener("click", () => {
    document.getElementById("notes").showModal();
  });
  panel.addEventListener("click", (event) => {
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
    if (event.key === "Escape" && selectedCode && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      closePanel();
    }
  });
  setMode(mode);
  new ResizeObserver(schedule).observe(stage);
  renderLegend();
  schedule();
})();
