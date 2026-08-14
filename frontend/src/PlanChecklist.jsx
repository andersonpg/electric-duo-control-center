import React, { useState, useEffect } from "react";
import { CheckSquare, AlertTriangle, TrendingUp, Calendar, Zap, ListChecks, HelpCircle, Layers, CheckCircle2, ChevronRight, Plus, Minus } from "lucide-react";

export default function PlanChecklist({ currentUser }) {
  const [state, setState] = useState(null);
  const [activeTab, setActiveTab] = useState("daily");
  const [statusMessage, setStatusMessage] = useState("Saved");
  const [statusType, setStatusType] = useState("ok"); // 'ok' | 'busy' | 'warn'

  useEffect(() => {
    loadState();
  }, []);

  const loadState = async () => {
    try {
      const res = await fetch("/api/state", { credentials: "same-origin" });
      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      if (!res.ok) throw new Error("Failed to load state");
      const data = await res.json();
      setState(data);
    } catch (err) {
      console.error(err);
      setStatusMessage("Failed to load");
      setStatusType("warn");
    }
  };

  const apiPost = async (url, body) => {
    setStatusMessage("Saving…");
    setStatusType("busy");
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setStatusMessage("Saved");
      setStatusType("ok");
      return data;
    } catch (err) {
      console.error(err);
      setStatusMessage("Save failed — try again");
      setStatusType("warn");
      throw err;
    }
  };

  const handleToggle = async (taskId) => {
    try {
      await apiPost("/api/toggle", { taskId });
      await loadState();
    } catch (e) {}
  };

  const handleCounter = async (counterId, delta) => {
    try {
      await apiPost("/api/counter", { counterId, delta });
      await loadState();
    } catch (e) {}
  };

  const handleKpi = async (kpiId, value) => {
    try {
      await apiPost("/api/kpi", { kpiId, value });
    } catch (e) {}
  };

  const handleRunRate = async (value) => {
    const num = parseFloat(value);
    try {
      await apiPost("/api/runrate", { value: isNaN(num) ? 0 : num });
      await loadState();
    } catch (e) {}
  };

  if (!state) {
    return (
      <div className="flex-1 flex items-center justify-center py-20 text-slate-400">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400 mr-3"></div>
        <span>Loading Plan Checklist…</span>
      </div>
    );
  }

  const { content, taskStatus, counters, kpis, runRate, streak, periodKeys } = state;

  const fmtTime = (iso) => {
    if (!iso) return "";
    const d = new Date(iso.replace(" ", "T") + "Z");
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return "today " + time;
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
  };

  const tabsList = [
    { id: "daily", label: "Today" },
    { id: "weekly", label: "This week" },
    { id: "monthly", label: "This month" },
    { id: "quarterly", label: "Quarter" },
    { id: "build", label: "90-day build" },
    { id: "reference", label: "Reference" },
  ];

  const getTabCount = (id) => {
    if (id === "reference") return "";
    if (id === "build") {
      let items = [];
      content.BUILD.forEach((p) => { items = items.concat(p.items); });
      const done = items.filter((i) => taskStatus[i.id] && taskStatus[i.id].done).length;
      return `${done}/${items.length}`;
    }
    const map = {
      daily: content.DAILY,
      weekly: content.WEEKLY,
      monthly: content.MONTHLY,
      quarterly: content.QUARTERLY.concat(content.SEASONAL),
    };
    const items = map[id] || [];
    const done = items.filter((i) => taskStatus[i.id] && taskStatus[i.id].done).length;
    return `${done}/${items.length}`;
  };

  // Target calculation for gauge
  const target = 100000;
  const current = runRate || 44000;
  const gap = Math.max(0, target - current);
  const pct = Math.min(100, Math.round((current / target) * 100));

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 text-slate-100 flex flex-col gap-6 font-sans">
      {/* Masthead */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400 mb-1">
              The Electric Duo · Plan Checklist · Operating Dashboard
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              What to do, and how often
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-3 py-1 rounded-full font-medium border ${
              statusType === 'ok' ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300' :
              statusType === 'busy' ? 'bg-amber-950/60 border-amber-500/30 text-amber-300' :
              'bg-red-950/60 border-red-500/30 text-red-300'
            }`}>
              {statusMessage}
            </span>
          </div>
        </div>

        <p className="text-slate-400 text-sm mt-4 leading-relaxed">
          The gap to $100K is about ${Math.round(gap / 1000)}K of recurring revenue. None of it is a subscriber problem — it's a pricing, pipeline and packaging problem, and every item below is one of those three.
        </p>

        {streak > 1 && (
          <div className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-cyan-300 bg-cyan-950/50 border border-cyan-500/30 px-3 py-1.5 rounded-xl">
            <Zap className="w-4 h-4 fill-current text-cyan-400" />
            <span>{streak} days clean in a row</span>
          </div>
        )}

        {/* Revenue Run-Rate Gauge */}
        <div className="mt-6 bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Recurring Run Rate Progress
            </span>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-slate-400">Current: $</span>
              <input
                type="number"
                defaultValue={current}
                onBlur={(e) => handleRunRate(e.target.value)}
                className="w-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-cyan-400 font-mono text-sm focus:outline-none focus:border-cyan-500"
              />
              <span className="text-slate-400">/ $100,000 target ({pct}%)</span>
            </div>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700/60">
            <div
              className="bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 h-full rounded-full transition-all duration-500 shadow-sm shadow-cyan-500/50"
              style={{ width: `${pct}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-2 font-mono">
            <span>$0 baseline</span>
            <span>Gap: ${gap.toLocaleString()} to transition gate</span>
            <span>$100K target</span>
          </div>
        </div>
      </div>

      {/* Checklist Sub-Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {tabsList.map((t) => {
          const count = getTabCount(t.id);
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs tracking-wide transition-all ${
                isActive
                  ? "bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 shadow-lg shadow-cyan-500/10"
                  : "bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>{t.label}</span>
              {count && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                  isActive ? "bg-cyan-500/20 text-cyan-300" : "bg-slate-800 text-slate-400"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div className="flex flex-col gap-6">
        {/* TODAY */}
        {activeTab === "daily" && (
          <PeriodSection
            title="Today"
            subtitle="Roughly an hour, four days a week. Resets at midnight."
            items={content.DAILY}
            taskStatus={taskStatus}
            onToggle={handleToggle}
            fmtTime={fmtTime}
          />
        )}

        {/* THIS WEEK */}
        {activeTab === "weekly" && (
          <PeriodSection
            title="This week"
            subtitle="One fixed publishing slot plus the CTR and traffic work that multiplies everything else. Resets Monday."
            items={content.WEEKLY}
            taskStatus={taskStatus}
            onToggle={handleToggle}
            fmtTime={fmtTime}
          />
        )}

        {/* THIS MONTH */}
        {activeTab === "monthly" && (
          <div className="flex flex-col gap-6">
            <PeriodSection
              title="This month"
              subtitle="Output targets and the money hygiene that the transition decision depends on. Resets on the 1st."
              items={content.MONTHLY}
              taskStatus={taskStatus}
              onToggle={handleToggle}
              fmtTime={fmtTime}
            />

            {/* Outbound Pipeline Counters */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
              <div className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                <span>Outbound Pipeline — This Month</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {content.COUNTERS.map((c) => {
                  const val = counters[c.id] || 0;
                  const isMet = val >= c.target;
                  return (
                    <div
                      key={c.id}
                      className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs text-slate-400 font-medium">{c.label}</div>
                        <div className="text-2xl font-extrabold text-white mt-1">
                          {val} <span className="text-xs font-normal text-slate-500">/ {c.target} target</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleCounter(c.id, -1)}
                          className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleCounter(c.id, 1)}
                          className="flex-1 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-lg text-xs font-bold flex items-center justify-center transition-colors shadow-sm shadow-cyan-500/20"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* QUARTER */}
        {activeTab === "quarterly" && (
          <div className="flex flex-col gap-6">
            <PeriodSection
              title="This quarter"
              subtitle="The reviews that stop you making an irreversible decision on money that isn't there next January."
              items={content.QUARTERLY}
              taskStatus={taskStatus}
              onToggle={handleToggle}
              fmtTime={fmtTime}
            />

            <PeriodSection
              title="Fixed points in the year"
              subtitle="Two tentpole productions and the outreach window that makes the January one work. Resets each year."
              items={content.SEASONAL}
              taskStatus={taskStatus}
              onToggle={handleToggle}
              fmtTime={fmtTime}
            />
          </div>
        )}

        {/* 90-DAY BUILD */}
        {activeTab === "build" && (
          <div className="flex flex-col gap-6">
            {content.BUILD.map((phase, pIdx) => {
              const doneCount = phase.items.filter((i) => taskStatus[i.id] && taskStatus[i.id].done).length;
              return (
                <div key={pIdx} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-white">{phase.phase}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">{phase.sub}</p>
                    </div>
                    <span className="text-xs font-mono px-2 py-1 rounded bg-slate-800 text-cyan-400 font-bold">
                      {doneCount}/{phase.items.length} completed
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {phase.items.map((item) => (
                      <TaskRow
                        key={item.id}
                        item={item}
                        status={taskStatus[item.id]}
                        onToggle={() => handleToggle(item.id)}
                        fmtTime={fmtTime}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* REFERENCE */}
        {activeTab === "reference" && (
          <div className="flex flex-col gap-6">
            {/* KPI Tracker */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-base font-bold text-white mb-1">12-Month KPI Targets</h3>
              <p className="text-xs text-slate-400 mb-4">Track progress against operational benchmarks.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-3 font-semibold">Metric</th>
                      <th className="py-2.5 px-3 font-semibold">Baseline</th>
                      <th className="py-2.5 px-3 font-semibold">Current Value</th>
                      <th className="py-2.5 px-3 font-semibold">Month 6 Target</th>
                      <th className="py-2.5 px-3 font-semibold">Month 12 Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {content.KPIS.map((k) => (
                      <tr key={k.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 px-3 font-medium text-slate-200">{k.label}</td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono">{k.now}</td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            defaultValue={kpis[k.id] || ""}
                            placeholder="Enter current"
                            onBlur={(e) => handleKpi(k.id, e.target.value)}
                            className="bg-slate-950 border border-slate-700/80 rounded px-2 py-1 text-xs text-cyan-300 w-28 focus:outline-none focus:border-cyan-500 font-mono"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-cyan-400 font-mono font-semibold">{k.m6}</td>
                        <td className="py-2.5 px-3 text-emerald-400 font-mono font-semibold">{k.m12}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Rate Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-base font-bold text-white mb-1">Standard Rate Card Floor</h3>
              <p className="text-xs text-slate-400 mb-4">Minimum pricing floors for integrations.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {content.RATES.map(([title, price], idx) => (
                  <div key={idx} className="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl flex justify-between items-center">
                    <span className="text-xs font-medium text-slate-300">{title}</span>
                    <span className="text-xs font-bold font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2 py-1 rounded">
                      {price}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* What NOT to do */}
            <div className="bg-red-950/20 border border-red-900/40 rounded-2xl p-6">
              <div className="flex items-center gap-2 text-red-400 font-bold text-sm mb-3">
                <AlertTriangle className="w-4 h-4" />
                <span>What NOT To Do (Guardrails)</span>
              </div>
              <ul className="list-disc list-inside text-xs text-slate-300 space-y-2 leading-relaxed">
                {content.STOP.map((item, idx) => (
                  <li key={idx} className="marker:text-red-500">{item}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PeriodSection({ title, subtitle, items, taskStatus, onToggle, fmtTime }) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
      <div className="border-b border-slate-800 pb-3 mb-4">
        <h3 className="text-base font-bold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <TaskRow
            key={item.id}
            item={item}
            status={taskStatus[item.id]}
            onToggle={() => onToggle(item.id)}
            fmtTime={fmtTime}
          />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ item, status, onToggle, fmtTime }) {
  const isDone = !!(status && status.done);
  return (
    <label
      className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
        isDone
          ? "bg-slate-950/60 border-slate-800/60 opacity-75"
          : "bg-slate-950/90 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90"
      }`}
    >
      <input
        type="checkbox"
        checked={isDone}
        onChange={onToggle}
        className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-950"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold ${isDone ? "line-through text-slate-500" : "text-slate-100"}`}>
            {item.t}
          </span>
          {item.tag && (
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                item.tag === "critical" || item.tag === "highest value" || item.tag === "the rule"
                  ? "bg-red-500/10 border-red-500/30 text-red-300"
                  : "bg-cyan-500/10 border-cyan-500/20 text-cyan-300"
              }`}
            >
              {item.tag}
            </span>
          )}
        </div>
        {item.d && (
          <p className={`text-xs mt-1 leading-relaxed ${isDone ? "text-slate-600" : "text-slate-400"}`}>
            {item.d}
          </p>
        )}
        {isDone && status && status.by && (
          <div className="text-[11px] font-medium text-cyan-400/90 mt-1.5 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Completed by {status.by} · {fmtTime(status.at)}</span>
          </div>
        )}
      </div>
    </label>
  );
}
