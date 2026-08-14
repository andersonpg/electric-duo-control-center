(function () {
  "use strict";

  var state = null;      // last payload from /api/state
  var activeTab = "daily";
  var appEl = document.getElementById("app");

  /* ================= data ================= */

  function apiGet(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (res) {
      if (res.status === 401) { window.location.href = "/login.html"; throw new Error("unauthorized"); }
      if (!res.ok) throw new Error("request_failed");
      return res.json();
    });
  }

  function apiPost(url, body) {
    setStatus("Saving…", "busy");
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      if (res.status === 401) { window.location.href = "/login.html"; throw new Error("unauthorized"); }
      if (!res.ok) throw new Error("request_failed");
      return res.json();
    });
  }

  function loadState() {
    return apiGet("/api/state").then(function (data) { state = data; return data; });
  }

  function setStatus(text, cls) {
    var el = document.getElementById("saveState");
    if (el) { el.textContent = text; el.className = cls || ""; }
  }

  /* ================= small helpers ================= */

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso.replace(" ", "T") + "Z");
    if (isNaN(d.getTime())) return "";
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return "today " + time;
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
  }

  /* ================= task rows ================= */

  function taskRow(item, status, onToggle) {
    var isDone = !!(status && status.done);
    var wrap = document.createElement("label");
    wrap.className = "task" + (isDone ? " done" : "");

    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = isDone;
    box.addEventListener("change", function () { onToggle(); });

    var body = document.createElement("div");
    var title = document.createElement("div");
    title.className = "t-title";
    title.innerHTML = item.t + (item.tag ? '<span class="chip' + (item.warn ? " warn" : "") + '">' + item.tag + "</span>" : "");
    body.appendChild(title);

    if (item.d) {
      var det = document.createElement("div");
      det.className = "t-detail";
      det.textContent = item.d;
      body.appendChild(det);
    }

    if (isDone && status.by) {
      var by = document.createElement("div");
      by.className = "t-by";
      by.textContent = "\u2713 " + status.by + (status.at ? " \u00b7 " + fmtTime(status.at) : "");
      body.appendChild(by);
    }

    wrap.appendChild(box);
    wrap.appendChild(body);
    return wrap;
  }

  function toggleTask(taskId) {
    apiPost("/api/toggle", { taskId: taskId }).then(function () {
      return loadState();
    }).then(function () {
      setStatus("Saved", "ok");
      render();
    }).catch(function () {
      setStatus("Save failed \u2014 try again", "warn");
    });
  }

  /* ================= period section ================= */

  function periodSection(periodKey, items, heading, note) {
    var frag = document.createDocumentFragment();
    var doneCount = items.filter(function (i) { return state.taskStatus[i.id] && state.taskStatus[i.id].done; }).length;

    var head = document.createElement("div");
    head.className = "sec-head";
    head.innerHTML = "<h2>" + heading + "</h2>" +
      '<div class="progress"><b>' + doneCount + "</b> of " + items.length + " done</div>";
    frag.appendChild(head);

    if (note) {
      var n = document.createElement("p");
      n.className = "sec-note";
      n.innerHTML = note;
      frag.appendChild(n);
    }

    var bar = document.createElement("div");
    bar.className = "bar";
    items.forEach(function (_, i) {
      var s = document.createElement("span");
      if (i < doneCount) s.className = "on";
      bar.appendChild(s);
    });
    frag.appendChild(bar);

    var list = document.createElement("div");
    items.forEach(function (item) {
      list.appendChild(taskRow(item, state.taskStatus[item.id], function () { toggleTask(item.id); }));
    });
    frag.appendChild(list);
    return frag;
  }

  /* ================= counters ================= */

  function countersBlock() {
    var wrap = document.createElement("div");
    wrap.className = "counters";
    state.content.COUNTERS.forEach(function (c) {
      var v = state.counters[c.id] || 0;
      var el = document.createElement("div");
      el.className = "counter";
      el.innerHTML = '<div class="c-label">' + c.label + '</div><div class="c-num">' + v + " <small>/ " + c.target + "</small></div>";
      var btns = document.createElement("div");
      btns.className = "c-btns";
      var minus = document.createElement("button");
      minus.type = "button"; minus.textContent = "\u2212"; minus.setAttribute("aria-label", "Decrease " + c.label);
      var plus = document.createElement("button");
      plus.type = "button"; plus.textContent = "+"; plus.setAttribute("aria-label", "Increase " + c.label);
      minus.addEventListener("click", function () { bumpCounter(c.id, -1); });
      plus.addEventListener("click", function () { bumpCounter(c.id, 1); });
      btns.appendChild(minus); btns.appendChild(plus);
      el.appendChild(btns);
      wrap.appendChild(el);
    });
    return wrap;
  }

  function bumpCounter(counterId, delta) {
    apiPost("/api/counter", { counterId: counterId, delta: delta }).then(function () {
      return loadState();
    }).then(function () { setStatus("Saved", "ok"); render(); })
      .catch(function () { setStatus("Save failed \u2014 try again", "warn"); });
  }

  /* ================= build tab ================= */

  function buildTab() {
    var frag = document.createDocumentFragment();
    var items = [];
    state.content.BUILD.forEach(function (p) { items = items.concat(p.items); });
    var doneCount = items.filter(function (i) { return state.taskStatus[i.id] && state.taskStatus[i.id].done; }).length;

    var head = document.createElement("div");
    head.className = "sec-head";
    head.innerHTML = "<h2>The 90-day build</h2>" +
      '<div class="progress"><b>' + doneCount + "</b> of " + items.length + " done</div>";
    frag.appendChild(head);

    var note = document.createElement("p");
    note.className = "sec-note";
    note.innerHTML = "One-time work. These don't reset \u2014 once something is built, it stays built and the recurring tabs keep it running.";
    frag.appendChild(note);

    var donutItem = items.find(function (i) { return i.id === "b-donut"; });
    if (donutItem) {
      var pin = document.createElement("div");
      pin.className = "pinned";
      pin.innerHTML = '<div class="eyebrow">Time-sensitive \u2014 do this first</div>';
      pin.appendChild(taskRow(
        { id: "b-donut", t: donutItem.t, tag: "search terms still live", warn: true,
          d: "It's scheduled for weeks 5\u20138, but the search volume is decaying now. This is the rare case where the honest move is also the highest-performing one." },
        state.taskStatus["b-donut"],
        function () { toggleTask("b-donut"); }
      ));
      frag.appendChild(pin);
    }

    state.content.BUILD.forEach(function (p, idx) {
      var sec = document.createElement("div");
      sec.className = "phase";
      sec.innerHTML = '<div class="phase-head"><span class="phase-num">' + pad(idx + 1) + '</span><h3>' + p.phase + "</h3></div>" +
        '<p class="sec-note" style="margin:2px 0 8px">' + p.sub + "</p>";
      p.items.forEach(function (item) {
        sec.appendChild(taskRow(item, state.taskStatus[item.id], function () { toggleTask(item.id); }));
      });
      frag.appendChild(sec);
    });
    return frag;
  }

  /* ================= reference tab ================= */

  function referenceTab() {
    var frag = document.createDocumentFragment();

    var gate = document.createElement("div");
    gate.className = "card";
    gate.innerHTML = '<h3>The gate rule</h3><p class="rule">Recurring revenue alone must cover the combined target for two consecutive quarters before Liv gives notice. A year with a big tentpole looks like success and then doesn\'t repeat. Tentpole income is upside, reserve and reinvestment \u2014 never the basis for the decision.</p>';
    frag.appendChild(gate);

    var kpi = document.createElement("div");
    kpi.className = "card";
    kpi.innerHTML = "<h3>KPIs \u2014 review monthly</h3>";
    var tbl = document.createElement("table");
    var thead = "<tr><th>Metric</th><th class='num'>Baseline</th><th class='num'>Current</th><th class='num'>6 mo</th><th class='num'>12 mo</th></tr>";
    var rows = state.content.KPIS.map(function (k) {
      var val = state.kpis[k.id] || "";
      return "<tr><td>" + k.label + "</td><td class='num dim'>" + k.now +
        "</td><td class='num'><input class='kpi-input' data-kpi='" + k.id + "' value='" + val.replace(/'/g, "&#39;") + "' placeholder='\u2014'></td><td class='num dim'>" +
        k.m6 + "</td><td class='num dim'>" + k.m12 + "</td></tr>";
    }).join("");
    tbl.innerHTML = thead + rows;
    kpi.appendChild(tbl);
    var kpiNote = document.createElement("p");
    kpiNote.className = "sec-note";
    kpiNote.style.margin = "12px 0 0";
    kpiNote.innerHTML = "Subscriber count is deliberately absent. It's a lagging credibility indicator that helps the rate card and nothing else.";
    kpi.appendChild(kpiNote);
    frag.appendChild(kpi);

    var rate = document.createElement("div");
    rate.className = "card";
    rate.innerHTML = "<h3>Rate card \u2014 publish the floor and hold it</h3><table>" +
      state.content.RATES.map(function (r) { return "<tr><td>" + r[0] + "</td><td class='num'>" + r[1] + "</td></tr>"; }).join("") +
      '</table><p class="sec-note" style="margin:12px 0 0">Add-ons priced separately: newsletter feature, FordEVClubs and Mach-E Club distribution, event appearance or hosting, product-tag placement, article on TheElectricDuo.com. Price bundles below the sum of their parts.</p>';
    frag.appendChild(rate);

    var stop = document.createElement("div");
    stop.className = "card";
    stop.innerHTML = "<h3>What to stop</h3><ul class='plain'>" + state.content.STOP.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ul>";
    frag.appendChild(stop);

    return frag;
  }

  /* ================= gauge ================= */

  function gauge() {
    var el = document.createElement("div");
    el.className = "gauge";
    var max = 120000;
    var pct = Math.max(0, Math.min(1, state.runRate / max));
    var cells = 40;
    var on = Math.round(pct * cells);
    var goalCell = Math.round((100000 / max) * cells);

    var top = document.createElement("div");
    top.className = "gauge-top";
    top.innerHTML = '<div class="gauge-label">Recurring revenue run rate</div>' +
      '<div class="gauge-value">$ <input id="runRate" type="number" step="500" value="' + state.runRate + '" aria-label="Current recurring revenue run rate"> / yr</div>';
    el.appendChild(top);

    var row = document.createElement("div");
    row.className = "cells";
    for (var i = 0; i < cells; i++) {
      var c = document.createElement("div");
      c.className = "cell" + (i < on ? " on" : "") + (i < on && i >= goalCell ? " past-goal" : "");
      row.appendChild(c);
    }
    el.appendChild(row);

    var ticks = document.createElement("div");
    ticks.className = "ticks";
    [[44000, "$44K base"], [70000, "$70K \u00b7 6 mo"], [100000, "$100K \u00b7 12 mo"]].forEach(function (t, i) {
      var d = document.createElement("div");
      d.className = "tick" + (i === 2 ? " goal" : "");
      d.style.left = ((t[0] / max) * 100) + "%";
      d.innerHTML = "<i></i>" + t[1];
      ticks.appendChild(d);
    });
    el.appendChild(ticks);
    return el;
  }

  /* ================= tabs ================= */

  var TABS = [
    { id: "daily", label: "Today" },
    { id: "weekly", label: "This week" },
    { id: "monthly", label: "This month" },
    { id: "quarterly", label: "Quarter" },
    { id: "build", label: "90-day build" },
    { id: "reference", label: "Reference" }
  ];

  function tabCount(id) {
    if (id === "reference") return "";
    if (id === "build") {
      var items = [];
      state.content.BUILD.forEach(function (p) { items = items.concat(p.items); });
      var done = items.filter(function (i) { return state.taskStatus[i.id] && state.taskStatus[i.id].done; }).length;
      return done + "/" + items.length;
    }
    var map = {
      daily: state.content.DAILY, weekly: state.content.WEEKLY, monthly: state.content.MONTHLY,
      quarterly: state.content.QUARTERLY.concat(state.content.SEASONAL)
    };
    var items = map[id];
    var done = items.filter(function (i) { return state.taskStatus[i.id] && state.taskStatus[i.id].done; }).length;
    return done + "/" + items.length;
  }

  /* ================= render ================= */

  function render() {
    appEl.innerHTML = "";

    var head = document.createElement("div");
    head.className = "masthead";
    var top = document.createElement("div");
    top.className = "masthead-top";
    top.innerHTML = '<div><div class="eyebrow">The Electric Duo \u00b7 Revenue plan v2 \u00b7 Operating dashboard</div>' +
      "<h1>What to do, and how often</h1></div>";
    var who = document.createElement("div");
    who.className = "who";
    who.innerHTML = "<span>Signed in as <b>" + state.user.name + "</b></span>";
    var logout = document.createElement("button");
    logout.type = "button";
    logout.textContent = "Log out";
    logout.addEventListener("click", function () {
      fetch("/logout", { method: "POST", credentials: "same-origin" }).then(function () {
        window.location.href = "/login.html";
      });
    });
    who.appendChild(logout);
    top.appendChild(who);
    head.appendChild(top);

    var sub = document.createElement("p");
    sub.className = "sub";
    sub.innerHTML = "The gap to $100K is about $56K of recurring revenue. None of it is a subscriber problem \u2014 it's a pricing, pipeline and packaging problem, and every item below is one of those three.";
    head.appendChild(sub);

    if (state.streak > 1) {
      var streakNote = document.createElement("p");
      streakNote.className = "sub";
      streakNote.style.marginTop = "6px";
      streakNote.innerHTML = '<b style="color:var(--cyan)">' + state.streak + " days clean in a row.</b>";
      head.appendChild(streakNote);
    }

    head.appendChild(gauge());
    appEl.appendChild(head);

    var tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.setAttribute("role", "tablist");
    TABS.forEach(function (t) {
      var b = document.createElement("button");
      b.className = "tab";
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", activeTab === t.id ? "true" : "false");
      var c = tabCount(t.id);
      b.innerHTML = t.label + (c ? '<span class="count">' + c + "</span>" : "");
      b.addEventListener("click", function () { activeTab = t.id; render(); });
      tabs.appendChild(b);
    });
    appEl.appendChild(tabs);

    var panel = document.createElement("div");
    panel.setAttribute("role", "tabpanel");

    if (activeTab === "daily") {
      panel.appendChild(periodSection("daily", state.content.DAILY, "Today",
        "Roughly an hour, four days a week. Resets at midnight."));
    } else if (activeTab === "weekly") {
      panel.appendChild(periodSection("weekly", state.content.WEEKLY, "This week",
        "One fixed publishing slot plus the CTR and traffic work that multiplies everything else. Resets Monday."));
    } else if (activeTab === "monthly") {
      panel.appendChild(periodSection("monthly", state.content.MONTHLY, "This month",
        "Output targets and the money hygiene that the transition decision depends on. Resets on the 1st."));
      var ch = document.createElement("div");
      ch.className = "eyebrow";
      ch.style.margin = "26px 0 10px";
      ch.textContent = "Outbound pipeline \u2014 this month";
      panel.appendChild(ch);
      panel.appendChild(countersBlock());
    } else if (activeTab === "quarterly") {
      panel.appendChild(periodSection("quarterly", state.content.QUARTERLY, "This quarter",
        "The reviews that stop you making an irreversible decision on money that isn't there next January."));
      var sh = document.createElement("div");
      sh.style.marginTop = "34px";
      panel.appendChild(sh);
      panel.appendChild(periodSection("seasonal", state.content.SEASONAL, "Fixed points in the year",
        "Two tentpole productions and the outreach window that makes the January one work. Resets each year."));
    } else if (activeTab === "build") {
      panel.appendChild(buildTab());
    } else {
      panel.appendChild(referenceTab());
    }

    appEl.appendChild(panel);

    var foot = document.createElement("div");
    foot.className = "foot";
    foot.innerHTML = '<span id="saveState" class="ok">Saved</span>';
    appEl.appendChild(foot);

    var rr = document.getElementById("runRate");
    if (rr) {
      rr.addEventListener("change", function () {
        var v = parseFloat(rr.value);
        apiPost("/api/runrate", { value: isNaN(v) ? 0 : v }).then(function () {
          return loadState();
        }).then(function () { setStatus("Saved", "ok"); render(); })
          .catch(function () { setStatus("Save failed \u2014 try again", "warn"); });
      });
    }
    Array.prototype.forEach.call(appEl.querySelectorAll(".kpi-input"), function (inp) {
      inp.addEventListener("change", function () {
        apiPost("/api/kpi", { kpiId: inp.getAttribute("data-kpi"), value: inp.value }).then(function () {
          setStatus("Saved", "ok");
        }).catch(function () { setStatus("Save failed \u2014 try again", "warn"); });
      });
    });
  }

  loadState().then(render).catch(function (e) {
    if (e.message !== "unauthorized") {
      appEl.innerHTML = '<div class="boot">Couldn\'t load \u2014 refresh to try again.</div>';
    }
  });
})();
