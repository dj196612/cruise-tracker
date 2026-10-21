(() => {
  "use strict";

  const PACKAGE_UPLIFT = { standard: 0, plus: 79, premier: 129 };
  const CABIN_LABELS = { cheapest: "Cheapest", interior: "Interior", oceanview: "Oceanview", balcony: "Balcony", mini_suite: "Mini-Suite", suite: "Suite" };
  const LINE_LABELS = { Princess: "Princess", "Royal Caribbean": "Royal Caribbean", "Celebrity Cruises": "Celebrity", "Norwegian Cruise Line": "NCL", "Carnival Cruise Line": "Carnival" };

  const data = window.CRUISE_DATA || { generated_at: null, cruises: [] };
  const allCruises = Array.isArray(data.cruises) ? data.cruises : [];
  let columnSort = null; // { key, direction }; null uses the Sort dropdown
  const headerColumns = [["cruise", "Cruise"], ["departure", "Departure"], ["port", "From"], ["nights", "Nights"], ["fare", "Fare pp"], ["total", "Total"]];

  const $ = id => document.getElementById(id);
  const els = {
    resultCount: $("resultCount"), updated: $("updated"), passengers: $("passengers"), cabin: $("cabin"), farePackage: $("farePackage"),
    minNights: $("minNights"), maxNights: $("maxNights"), dateFrom: $("dateFrom"), dateTo: $("dateTo"), maxPrice: $("maxPrice"),
    ship: $("ship"), sort: $("sort"), available: $("available"), reset: $("reset"), summary: $("summary"), results: $("results")
  };

  const money = value => value == null || !Number.isFinite(Number(value))
    ? "—"
    : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Number(value));

  const prettyDate = iso => {
    if (!iso) return "—";
    const d = new Date(`${iso}T00:00:00`);
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(d);
  };

  const checkedValues = groupId => [...document.querySelectorAll(`#${groupId} input[type=checkbox]:checked`)].map(x => x.value);

  function basePrice(cruise, passengers, cabin) {
    const p = cruise.prices || {};
    if (passengers === 1) {
      const v = p.one_guest?.[cabin];
      return v == null ? null : { pp: Number(v), total: Number(v) };
    }
    const rec = p.two_guests?.[cabin];
    if (!rec || rec.pp == null) return null;
    const pp = Number(rec.pp);
    const total = rec.total == null ? pp * 2 : Number(rec.total);
    return { pp, total };
  }

  function displayedPrice(cruise, passengers, cabin, farePackage) {
    // Choose the lowest genuinely available fare for this guest count, rather
    // than assuming Interior is always the cheapest cabin category.
    if (cabin === "cheapest") {
      const candidates = Object.keys(CABIN_LABELS)
        .filter(category => category !== "cheapest")
        .map(category => displayedPrice(cruise, passengers, category, farePackage))
        .filter(price => price && Number.isFinite(price.pp) && Number.isFinite(price.total) && price.pp >= 0 && price.total >= 0);
      if (!candidates.length) return null;
      candidates.sort((a, b) => a.pp - b.pp || a.total - b.total);
      return candidates[0];
    }
    const base = basePrice(cruise, passengers, cabin);
    if (!base || !Number.isFinite(base.pp) || !Number.isFinite(base.total)) return null;
    const uplift = cruise.line === "Princess" ? (PACKAGE_UPLIFT[farePackage] || 0) : 0;
    const nights = Number(cruise.nights || 0);
    const upliftPerPerson = uplift * nights;
    return {
      pp: base.pp + upliftPerPerson,
      total: base.total + upliftPerPerson * passengers,
      cabin,
      estimated: cruise.line === "Princess" && farePackage !== "standard",
      base
    };
  }

  function soloPremium(cruise, cabin) {
    const one = cabin === "cheapest" ? displayedPrice(cruise, 1, cabin, "standard")?.pp : basePrice(cruise, 1, cabin)?.pp;
    const two = cabin === "cheapest" ? displayedPrice(cruise, 2, cabin, "standard")?.pp : basePrice(cruise, 2, cabin)?.pp;
    if (one == null || two == null || two <= 0) return Number.POSITIVE_INFINITY;
    return one / two;
  }

  function filters() {
    return {
      lines: checkedValues("cruiseLines"), ports: checkedValues("ports"), passengers: Number(els.passengers.value), cabin: els.cabin.value,
      farePackage: els.farePackage?.value || "standard", minNights: Number(els.minNights.value || 0), maxNights: els.maxNights.value ? Number(els.maxNights.value) : null,
      dateFrom: els.dateFrom.value || null, dateTo: els.dateTo.value || null, maxPrice: els.maxPrice?.value ? Number(els.maxPrice.value) : null,
      ship: els.ship?.value || "", sort: els.sort.value, available: els.available.checked
    };
  }

  function applyFilters() {
    const f = filters();
    const rows = allCruises.filter(c => {
      if (!f.lines.includes(c.line)) return false;
      if (!f.ports.includes(c.departure_port)) return false;
      if (f.ship && c.ship !== f.ship) return false;
      if (Number(c.nights || 0) < f.minNights) return false;
      if (f.maxNights != null && Number(c.nights || 0) > f.maxNights) return false;
      if (f.dateFrom && c.departure_date < f.dateFrom) return false;
      if (f.dateTo && c.departure_date > f.dateTo) return false;
      const price = displayedPrice(c, f.passengers, f.cabin, f.farePackage);
      if (f.available && !price) return false;
      if (f.maxPrice != null && (!price || price.pp > f.maxPrice)) return false;
      return true;
    });

    rows.sort((a, b) => {
      if (columnSort) {
        const key = columnSort.key;
        const ascending = columnSort.direction === "asc";
        const val = cruise => {
          if (key === "cruise") return `${cruise.line || ""} ${cruise.name || ""}`;
          if (key === "departure") return cruise.departure_date || "";
          if (key === "port") return cruise.departure_port || "";
          if (key === "nights") return Number(cruise.nights);
          const price = displayedPrice(cruise, f.passengers, f.cabin, f.farePackage);
          return key === "fare" ? price?.pp : price?.total;
        };
        const va = val(a), vb = val(b);
        // Unknown fares and values always appear last, in both directions.
        const missing = v => v == null || (typeof v === "number" && !Number.isFinite(v)) || v === "";
        if (missing(va) !== missing(vb)) return missing(va) ? 1 : -1;
        if (missing(va)) return 0;
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "en-AU", { numeric: true, sensitivity: "base" });
        return ascending ? cmp : -cmp;
      }
      const pa = displayedPrice(a, f.passengers, f.cabin, f.farePackage)?.pp ?? Number.POSITIVE_INFINITY;
      const pb = displayedPrice(b, f.passengers, f.cabin, f.farePackage)?.pp ?? Number.POSITIVE_INFINITY;
      if (f.sort === "price") return pa - pb;
      if (f.sort === "date") return String(a.departure_date).localeCompare(String(b.departure_date));
      if (f.sort === "lengthDesc") return Number(b.nights || 0) - Number(a.nights || 0);
      if (f.sort === "lengthAsc") return Number(a.nights || 0) - Number(b.nights || 0);
      if (f.sort === "solo") return soloPremium(a, f.cabin) - soloPremium(b, f.cabin);
      const da = a.nights ? pa / Number(a.nights) : Number.POSITIVE_INFINITY;
      const db = b.nights ? pb / Number(b.nights) : Number.POSITIVE_INFINITY;
      return da - db;
    });

    render(rows, f);
  }

  const LINE_SLUGS = { Princess: "princess", "Royal Caribbean": "royal", "Celebrity Cruises": "celebrity", "Norwegian Cruise Line": "ncl", "Carnival Cruise Line": "carnival" };
  const ICONS = {
    ship: '<path d="M3 17c2 1.6 4 1.6 6 0s4-1.6 6 0 4 1.6 6 0M5 13l1.5-5h11L19 13M9 8V5h6v3"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 11h8"/>'
  };

  function summaryCard(label, value, icon, note) {
    return `<div class="stat"><div class="stat-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg></div><div><small>${label}</small><strong>${value}</strong>${note ? `<em>${note}</em>` : ""}</div></div>`;
  }

  function renderSummary(rows, f) {
    const priced = rows.map(c => displayedPrice(c, f.passengers, f.cabin, f.farePackage)).filter(Boolean);
    const lowest = priced.length ? Math.min(...priced.map(x => x.pp)) : null;
    const perNight = rows.map(c => {
      const p = displayedPrice(c, f.passengers, f.cabin, f.farePackage);
      return p && c.nights ? p.pp / c.nights : null;
    }).filter(v => v != null);
    const bestNight = perNight.length ? Math.min(...perNight) : null;
    const ships = new Set(rows.map(c => c.ship).filter(Boolean)).size;
    const cabinNote = `${CABIN_LABELS[f.cabin]} · ${f.passengers === 1 ? "solo" : "2 guests"}`;
    els.summary.innerHTML = [
      summaryCard("Matching cruises", rows.length, "ship", `${priced.length} with a bookable fare`),
      summaryCard("Lowest fare pp", money(lowest), "tag", cabinNote),
      summaryCard("Best pp / night", money(bestNight), "moon", cabinNote)
    ].join("");
  }

  function row(cruise, f) {
    const p = displayedPrice(cruise, f.passengers, f.cabin, f.farePackage);
    const packageName = f.farePackage === "standard" ? "Standard" : f.farePackage === "plus" ? "Plus" : "Premier";
    const openUrl = cruise.links?.[String(f.passengers)] || cruise.url || "#";
    const soloUrl = cruise.links?.["1"] || cruise.url || "#";
    const totalLabel = f.passengers === 1 ? "Solo total" : `${f.passengers}-guest total`;
    const availableClass = p ? "" : " unavailable";
    const fareNote = cruise.line === "Princess"
      ? (p?.estimated ? `${packageName} est. +${money(PACKAGE_UPLIFT[f.farePackage])} pp/night` : "Princess Standard · BESTFARE")
      : (cruise.line === "Celebrity Cruises" ? "Celebrity fare · taxes & fees included" : (cruise.line === "Carnival Cruise Line" ? "Carnival VIFP · AUD incl. taxes & fees" : (cruise.line === "Norwegian Cruise Line" ? "NCL fare · verify checkout taxes" : "Royal Caribbean fare · taxes & fees included")));
    const openLabel = cruise.line === "Royal Caribbean" ? "Open RC" : (cruise.line === "Celebrity Cruises" ? "Open Celebrity" : (cruise.line === "Carnival Cruise Line" ? "Open Carnival" : (cruise.line === "Norwegian Cruise Line" ? "Open NCL" : "Open Princess")));
    const slug = LINE_SLUGS[cruise.line] || "other";
    const dep = cruise.departure_date ? new Date(`${cruise.departure_date}T00:00:00`) : null;
    const dateTile = dep
      ? `<div class="date-tile"><b>${dep.getDate()}</b><div><span>${new Intl.DateTimeFormat("en-AU", { month: "short" }).format(dep)} ${dep.getFullYear()}</span><small>${new Intl.DateTimeFormat("en-AU", { weekday: "long" }).format(dep)}</small></div></div>`
      : `<div class="date-tile"><b>—</b></div>`;
    const perNight = p && cruise.nights ? `<em class="per-night">${money(p.pp / Number(cruise.nights))}<small>/night</small></em>` : "";
    return `
      <article class="cruise-row line-${slug}${availableClass}">
        <div class="row-main">
          <div class="row-text">
            <div class="row-line"><i></i>${LINE_LABELS[cruise.line] || cruise.line}${cruise.voyage_code ? `<span class="row-code">${escapeHtml(cruise.voyage_code)}</span>` : ""}</div>
            <div class="row-title">${escapeHtml(cruise.name || "Cruise")}</div>
            <div class="row-ship">${escapeHtml(cruise.ship || "Ship TBA")}</div>
          </div>
        </div>
        <div class="row-cell cell-date" title="${prettyDate(cruise.departure_date)}">${dateTile}</div>
        <div class="row-cell"><span>From</span><strong>${escapeHtml(cruise.departure_port || "—")}</strong></div>
        <div class="row-cell"><span>Nights</span><strong class="nights">${cruise.nights ?? "—"}</strong></div>
        <div class="row-fare">
          <span>${p ? CABIN_LABELS[p.cabin] : CABIN_LABELS[f.cabin]}${f.cabin === "cheapest" && p ? " · Cheapest" : ""} · ${packageName}</span>
          <strong>${p ? money(p.pp) : "No fare"}${perNight}</strong>
          <small>${p ? fareNote : "No bookable fare"}</small>
        </div>
        <div class="row-total"><span>${totalLabel}</span><strong>${p ? money(p.total) : "—"}</strong></div>
        <div class="row-actions">
          <a class="primary" href="${escapeAttr(openUrl)}" target="_blank" rel="noopener">${openLabel}</a>
          <a class="secondary" href="${escapeAttr(soloUrl)}" target="_blank" rel="noopener">Solo</a>
        </div>
      </article>`;
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  }
  function escapeAttr(v) { return escapeHtml(v); }

  function render(rows, f) {
    els.resultCount.textContent = `${rows.length} cruise${rows.length === 1 ? "" : "s"}`;
    renderSummary(rows, f);
    if (!allCruises.length) {
      els.results.innerHTML = `<div class="empty"><strong>No cruise data loaded yet.</strong>Run <b>RUN_PRINCESS_TRACKER.bat</b>. A successful run will update this page automatically.</div>`;
      return;
    }
    if (!rows.length) {
      els.results.innerHTML = `<div class="empty"><strong>No cruises match these filters.</strong>Try increasing the maximum price, changing cabin type, or resetting the filters.</div>`;
      return;
    }
    const headers = headerColumns.map(([key, label]) => {
      const active = columnSort?.key === key;
      const arrow = active ? (columnSort.direction === "asc" ? "▲" : "▼") : "↕";
      const direction = active ? columnSort.direction : "none";
      return `<button type="button" class="sort-header${active ? " active" : ""}" data-sort-key="${key}" aria-label="Sort by ${label}" aria-pressed="${active}" title="Sort by ${label}, click again to reverse">${label} <span class="sort-arrow" aria-hidden="true">${arrow}</span></button>`;
    }).join("");
    els.results.innerHTML = `<div class="list-head" role="group" aria-label="Sort cruise results">${headers}<div class="actions-header">Actions</div></div>` + rows.map(c => row(c, f)).join("");
  }

  function populateShips() {
    if (!els.ship) return;
    const current = els.ship.value;
    const ships = [...new Set(allCruises.map(c => c.ship).filter(Boolean))].sort((a,b) => a.localeCompare(b));
    els.ship.innerHTML = `<option value="">All ships</option>` + ships.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
    if (ships.includes(current)) els.ship.value = current;
  }

  function reset() {
    document.querySelectorAll("#cruiseLines input, #ports input").forEach(x => x.checked = true);
    els.passengers.value = "1";
    els.cabin.value = "cheapest";
    if (els.farePackage) els.farePackage.value = "standard";
    els.minNights.value = "1";
    els.maxNights.value = "";
    els.dateFrom.value = "";
    els.dateTo.value = "";
    if (els.maxPrice) els.maxPrice.value = "";
    if (els.ship) els.ship.value = "";
    els.sort.value = "dayprice";
    columnSort = null;
    els.available.checked = false;
    applyFilters();
  }

  document.querySelectorAll("input, select").forEach(el => {
    if (el.id === "dropped") return;
    el.addEventListener("change", applyFilters);
    if (el.type === "number") el.addEventListener("input", applyFilters);
  });
  els.reset.addEventListener("click", reset);
  els.sort.addEventListener("change", () => { columnSort = null; applyFilters(); });
  els.results.addEventListener("click", event => {
    const heading = event.target.closest("button[data-sort-key]");
    if (!heading || !els.results.contains(heading)) return;
    const key = heading.dataset.sortKey;
    columnSort = columnSort?.key === key
      ? { key, direction: columnSort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" };
    applyFilters();
  });

  populateShips();
  if (data.generated_at) {
    const d = new Date(data.generated_at);
    els.updated.textContent = `Updated ${new Intl.DateTimeFormat("en-AU", { day:"numeric", month:"short", year:"numeric", hour:"numeric", minute:"2-digit" }).format(d)}`;
  }
  applyFilters();
})();
