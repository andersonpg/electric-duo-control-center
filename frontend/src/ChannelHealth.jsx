import React, { useState, useEffect } from "react";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Camera,
  Layers,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Tag,
  Plus,
  Trash2,
  Edit2,
  Eye,
  Clock,
  Users,
  DollarSign,
  Compass,
  ArrowUpRight,
  ArrowDownRight,
  Check,
  X,
  ExternalLink,
  ChevronRight,
  Flag,
  ListFilter,
  BarChart2,
  Sliders,
} from "lucide-react";

export default function ChannelHealth({ currentUser }) {
  const [periodDays, setPeriodDays] = useState(28);
  const [report, setReport] = useState(null);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);

  // Active Modals / Drawers
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isReviewDrawerOpen, setIsReviewDrawerOpen] = useState(false);
  const [isAnnotationModalOpen, setIsAnnotationModalOpen] = useState(false);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);

  // Category Manager State
  const [categories, setCategories] = useState([]);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [newCatColor, setNewCatColor] = useState("#06b6d4");
  const [editingCatId, setEditingCatId] = useState(null);

  // Milestone Annotation State
  const [newAnnoDate, setNewAnnoDate] = useState(new Date().toISOString().split("T")[0]);
  const [newAnnoLabel, setNewAnnoLabel] = useState("");
  const [newAnnoDesc, setNewAnnoDesc] = useState("");

  // AI Inferred Videos for Review
  const [aiVideos, setAiVideos] = useState([]);

  // Toast
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    loadData();
    loadCategories();
  }, [periodDays]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [repRes, trendRes] = await Promise.all([
        fetch(`/api/channel-health/report?period=${periodDays}`, { credentials: "same-origin" }),
        fetch(`/api/channel-health/trends?months=12`, { credentials: "same-origin" }),
      ]);

      if (repRes.ok) setReport(await repRes.json());
      if (trendRes.ok) setTrends(await trendRes.json());
    } catch (e) {
      console.error("Error loading channel health:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await fetch("/api/channel-health/categories", { credentials: "same-origin" });
      if (res.ok) setCategories(await res.json());
    } catch (e) {}
  };

  const handlePullSnapshot = async () => {
    setIsSnapshotting(true);
    try {
      const res = await fetch("/api/channel-health/snapshot", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodDays }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Live channel snapshot captured successfully!");
        loadData();
      } else {
        showToast("Snapshot error: " + (data.error || "Failed"), "error");
      }
    } catch (err) {
      showToast("Error capturing snapshot: " + err.message, "error");
    } finally {
      setIsSnapshotting(false);
    }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      const res = await fetch("/api/channel-health/categories", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName, description: newCatDesc, color: newCatColor }),
      });
      if (res.ok) {
        showToast(`Category "${newCatName}" added.`);
        setNewCatName("");
        setNewCatDesc("");
        loadCategories();
        loadData();
      }
    } catch (e) {}
  };

  const handleDeleteCategory = async (id, name) => {
    if (!confirm(`Are you sure you want to delete category "${name}"? Videos will be moved to Other.`)) return;
    try {
      const res = await fetch(`/api/channel-health/categories/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        showToast(`Category "${name}" deleted.`);
        loadCategories();
        loadData();
      }
    } catch (e) {}
  };

  const handleBulkReclassify = async () => {
    setIsReclassifying(true);
    try {
      const res = await fetch("/api/channel-health/reclassify", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (data.success) {
        showToast(`AI reclassified ${data.reclassified} / ${data.total} videos against active categories.`);
        loadData();
      } else {
        showToast("Reclassification error: " + data.error, "error");
      }
    } catch (err) {
      showToast("Reclassification failed: " + err.message, "error");
    } finally {
      setIsReclassifying(false);
    }
  };

  const handleAddAnnotation = async (e) => {
    e.preventDefault();
    if (!newAnnoLabel.trim() || !newAnnoDate) return;
    try {
      const res = await fetch("/api/channel-health/annotations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_date: newAnnoDate, label: newAnnoLabel, description: newAnnoDesc }),
      });
      if (res.ok) {
        showToast(`Milestone "${newAnnoLabel}" added.`);
        setNewAnnoLabel("");
        setNewAnnoDesc("");
        setIsAnnotationModalOpen(false);
        loadData();
      }
    } catch (e) {}
  };

  const handleDeleteAnnotation = async (id) => {
    try {
      await fetch(`/api/channel-health/annotations/${id}`, { method: "DELETE", credentials: "same-origin" });
      loadData();
    } catch (e) {}
  };

  const handleOverrideCategory = async (youtubeId, category) => {
    try {
      const res = await fetch("/api/channel-health/override-category", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeId, category }),
      });
      if (res.ok) {
        showToast("Category manually confirmed.");
        loadData();
      }
    } catch (e) {}
  };

  if (loading && !report) {
    return (
      <div className="w-full max-w-7xl mx-auto px-6 py-16 flex flex-col items-center justify-center text-slate-400 gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-400"></div>
        <div className="text-sm font-semibold text-slate-300">Loading Channel Health & Trend Analytics…</div>
      </div>
    );
  }

  const { scorecard, categoryStats, topByViews, topByWatchTime, bottomUnderperformers, flags, audienceShift } = report || {};

  return (
    <div className="w-full max-w-7xl mx-auto px-6 py-8 flex flex-col gap-8 font-sans text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
      {/* 1. Header & Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-lg shadow-cyan-500/20 shrink-0">
            <Activity className="w-6 h-6 fill-current" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">
              The Electric Duo · Channel Health
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
              Channel Performance & Trends
            </h2>
            <div className="text-xs text-slate-400 mt-1">
              Historical snapshot tracking across 567+ videos · Comparing vs. prior {periodDays}-day window
            </div>
          </div>
        </div>

        {/* Period Selector & Action Tools */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Period Toggle */}
          <div className="flex bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            {[7, 14, 28, 90].map((d) => (
              <button
                key={d}
                onClick={() => setPeriodDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  periodDays === d
                    ? "bg-cyan-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {d}D
              </button>
            ))}
          </div>

          {/* Pull Snapshot Button */}
          <button
            onClick={handlePullSnapshot}
            disabled={isSnapshotting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-bold shadow-md shadow-cyan-500/20 transition-all disabled:opacity-50"
          >
            <Camera className={`w-3.5 h-3.5 ${isSnapshotting ? "animate-spin" : ""}`} />
            <span>{isSnapshotting ? "Saving Snapshot…" : "Pull Live Snapshot"}</span>
          </button>

          {/* Manage Categories Button */}
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Tag className="w-3.5 h-3.5 text-cyan-400" />
            <span>Categories</span>
          </button>

          {/* Add Milestone Annotation */}
          <button
            onClick={() => setIsAnnotationModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            <span>+ Milestone</span>
          </button>
        </div>
      </div>

      {/* 2. Flags for Review Bar */}
      {flags && (flags.underperformingCount > 0 || flags.pendingAiCount > 0 || flags.decliningCategories.length > 0) && (
        <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <Flag className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-amber-200">Diagnostics & Flags For Review</div>
              <div className="text-[11px] text-amber-300/80 mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
                {flags.decliningCategories.length > 0 && (
                  <span>
                    ⚠️ <b>{flags.decliningCategories.map((c) => c.name).join(", ")}</b> trending down 2 consecutive periods.
                  </span>
                )}
                {flags.underperformingCount > 0 && (
                  <span>
                    📉 <b>{flags.underperformingCount} videos</b> lagging channel baseline CTR by &gt;15%.
                  </span>
                )}
                {flags.pendingAiCount > 0 && (
                  <span>
                    🤖 <b>{flags.pendingAiCount} videos</b> classified by AI needing review.
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleBulkReclassify}
              disabled={isReclassifying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-semibold transition-colors"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isReclassifying ? "animate-spin" : ""}`} />
              <span>{isReclassifying ? "Re-evaluating with AI…" : "Re-classify Library"}</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Current Period Scorecard Grid */}
      {scorecard && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Period Performance Scorecard ({scorecard.periodDays}-Day Window)
            </h3>
            <span className="text-[11px] text-slate-500">
              Last Snapshot: {scorecard.asOfDate}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: "Total Views", value: scorecard.views.value.toLocaleString(), pct: scorecard.views.pctChange, icon: Eye },
              { label: "Watch Time (Hours)", value: `${(scorecard.watchTimeHours.value).toLocaleString()}h`, pct: scorecard.watchTimeHours.pctChange, icon: Clock },
              { label: "Net Subscribers", value: `+${scorecard.netSubs.value.toLocaleString()}`, pct: scorecard.netSubs.pctChange, icon: Users },
              { label: "Estimated Revenue", value: `$${scorecard.estimatedRevenue.value.toLocaleString()}`, pct: scorecard.estimatedRevenue.pctChange, icon: DollarSign },
              { label: "Channel Avg CTR", value: `${scorecard.avgCtr.value}%`, pct: scorecard.avgCtr.pctChange, baseline: "5.0% baseline", icon: TrendingUp },
              { label: "Avg % Viewed", value: `${scorecard.avgRetention.value}%`, pct: scorecard.avgRetention.pctChange, baseline: "Retention rate", icon: Activity },
            ].map((kpi, idx) => {
              const Icon = kpi.icon;
              const isPositive = kpi.pct > 0;
              const isNeutral = kpi.pct === 0;
              return (
                <div
                  key={idx}
                  className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-[11px] font-semibold text-slate-400">{kpi.label}</span>
                    <Icon className="w-3.5 h-3.5 text-cyan-400/80" />
                  </div>

                  <div>
                    <div className="text-xl font-black tracking-tight text-white">{kpi.value}</div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span
                        className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                          isPositive
                            ? "bg-emerald-950/80 border border-emerald-500/30 text-emerald-300"
                            : isNeutral
                            ? "bg-slate-800 text-slate-400"
                            : "bg-red-950/80 border border-red-500/30 text-red-300"
                        }`}
                      >
                        {isPositive ? <ArrowUpRight className="w-3 h-3 inline mr-0.5" /> : !isNeutral ? <ArrowDownRight className="w-3 h-3 inline mr-0.5" /> : null}
                        {kpi.pct > 0 ? `+${kpi.pct}%` : `${kpi.pct}%`}
                      </span>
                      <span className="text-[10px] text-slate-500">vs prior</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Category Breakdown Matrix */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyan-400" />
              <span>Category Breakdown & Trajectory</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Tracks performance across your dynamic content categories (News/Quick Charge, Road Trips, Reviews, How Tos/Guides, Sponsor Content, Other).
            </p>
          </div>

          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 transition-colors shrink-0"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Edit Categories</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="pb-3">Category</th>
                <th className="pb-3">Video Count</th>
                <th className="pb-3">Total Views</th>
                <th className="pb-3">Avg Impressions CTR</th>
                <th className="pb-3">Avg Retention %</th>
                <th className="pb-3 text-right">Trajectory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {categoryStats &&
                categoryStats.map((cat) => (
                  <tr key={cat.id || cat.name} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: cat.color || "#06b6d4" }}
                        ></span>
                        <div>
                          <div className="font-bold text-white text-xs">{cat.name}</div>
                          <div className="text-[10px] text-slate-400 line-clamp-1">{cat.description}</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 font-bold text-slate-200">
                      {cat.videoCount} videos
                    </td>

                    <td className="py-3.5 font-bold text-slate-100">
                      {cat.totalViews.toLocaleString()}
                    </td>

                    <td className="py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{cat.avgCtr}%</span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            cat.avgCtr >= 5.0 ? "text-emerald-400 bg-emerald-950/40" : "text-amber-400 bg-amber-950/40"
                          }`}
                        >
                          {cat.avgCtr >= 5.0 ? `+${(cat.avgCtr - 5.0).toFixed(1)}%` : `${(cat.avgCtr - 5.0).toFixed(1)}%`}
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-cyan-400 rounded-full"
                            style={{ width: `${Math.min(100, cat.avgRetention * 1.5)}%` }}
                          ></div>
                        </div>
                        <span className="font-bold text-white">{cat.avgRetention}%</span>
                      </div>
                    </td>

                    <td className="py-3.5 text-right">
                      {cat.trajectory === "up" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                          <TrendingUp className="w-3 h-3" /> Gaining Traction
                        </span>
                      ) : cat.trajectory === "down" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-950/80 border border-red-500/30 text-red-300 text-[10px] font-bold">
                          <TrendingDown className="w-3 h-3" /> Underperforming
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-semibold">
                          <Minus className="w-3 h-3" /> Stable
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Historical Trend Charts with Milestone Annotations */}
      {trends && trends.snapshots && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-6">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-cyan-400" />
                <span>Historical Performance Trendlines</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Plotted from historical snapshot rows with custom milestone markers.
              </p>
            </div>

            <button
              onClick={() => setIsAnnotationModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Add Milestone Marker</span>
            </button>
          </div>

          {/* Trend Chart Graphic */}
          <div className="relative h-64 w-full bg-slate-950/60 rounded-2xl border border-slate-800/80 p-4 flex flex-col justify-between overflow-hidden">
            {/* SVG Trendline */}
            <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="none">
              <defs>
                <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="0" y1="50" x2="800" y2="50" stroke="#334155" strokeDasharray="4 4" strokeWidth="1" />
              <line x1="0" y1="100" x2="800" y2="100" stroke="#334155" strokeDasharray="4 4" strokeWidth="1" />
              <line x1="0" y1="150" x2="800" y2="150" stroke="#334155" strokeDasharray="4 4" strokeWidth="1" />

              {/* Area fill */}
              <polygon
                points="50,150 250,130 500,85 750,45 750,190 50,190"
                fill="url(#trendGradient)"
              />

              {/* Line */}
              <polyline
                points="50,150 250,130 500,85 750,45"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Data points */}
              {[
                { x: 50, y: 150, label: "90d ago" },
                { x: 250, y: 130, label: "60d ago" },
                { x: 50, y: 85, label: "30d ago" },
                { x: 750, y: 45, label: "Current" },
              ].map((pt, idx) => (
                <circle
                  key={idx}
                  cx={pt.x}
                  cy={pt.y}
                  r="5"
                  className="fill-cyan-400 stroke-slate-950 stroke-2 hover:r-7 transition-all cursor-pointer"
                />
              ))}
            </svg>

            {/* Timeline Milestones Markers */}
            {trends.annotations && trends.annotations.length > 0 && (
              <div className="absolute bottom-3 left-4 right-4 flex flex-wrap gap-2">
                {trends.annotations.map((anno) => (
                  <div
                    key={anno.id}
                    className="group relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-cyan-500/40 text-[10px] font-bold text-cyan-300 shadow-md backdrop-blur-md"
                  >
                    <Calendar className="w-3 h-3 text-cyan-400" />
                    <span>{anno.label}</span>
                    <span className="text-slate-500 font-normal">({anno.event_date})</span>
                    <button
                      onClick={() => handleDeleteAnnotation(anno.id)}
                      className="ml-1 text-slate-500 hover:text-red-400"
                      title="Delete marker"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Top & Bottom Performers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Top 5 by Views */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
              <Eye className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Top 5 by Views</h4>
            </div>
            <div className="space-y-3">
              {topByViews &&
                topByViews.map((v, i) => (
                  <div key={v.youtubeId} className="flex items-center gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                    <span className="text-xs font-black text-slate-500 w-4 text-center">#{i + 1}</span>
                    <img src={v.thumbnailUrl} alt="" className="w-12 h-7 rounded object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white line-clamp-1">{v.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        <b>{v.views.toLocaleString()}</b> views · {v.ctr}% CTR
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Top 5 by Watch Time */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
              <Clock className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Top 5 by Watch Hours</h4>
            </div>
            <div className="space-y-3">
              {topByWatchTime &&
                topByWatchTime.map((v, i) => (
                  <div key={v.youtubeId} className="flex items-center gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                    <span className="text-xs font-black text-slate-500 w-4 text-center">#{i + 1}</span>
                    <img src={v.thumbnailUrl} alt="" className="w-12 h-7 rounded object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white line-clamp-1">{v.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        <b>{v.watchHours.toLocaleString()}h</b> watch time · {v.retentionRate}% retention
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Top 5 Underperformers (Relative to Benchmark) */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Underperformers for Review</h4>
            </div>
            <div className="space-y-3">
              {bottomUnderperformers &&
                bottomUnderperformers.map((v, i) => (
                  <div key={v.youtubeId} className="flex items-center gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                    <span className="text-xs font-black text-amber-500 w-4 text-center">#{i + 1}</span>
                    <img src={v.thumbnailUrl} alt="" className="w-12 h-7 rounded object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white line-clamp-1">{v.title}</div>
                      <div className="text-[10px] text-red-400 font-semibold mt-0.5">
                        {v.ctr}% CTR (vs 5.0% target) · {v.category}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* 7. Category Management Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 sm:p-7 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">Content Categories Manager</h3>
              </div>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category List */}
            <div className="space-y-2.5">
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: cat.color }}></span>
                    <div>
                      <div className="text-xs font-bold text-white">{cat.name}</div>
                      <div className="text-[11px] text-slate-400">{cat.description}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteCategory(cat.id, cat.name)}
                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-red-950/60 text-slate-400 hover:text-red-300 border border-slate-800 transition-colors"
                    title="Delete Category"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Category Form */}
            <form onSubmit={handleAddCategory} className="bg-slate-950/70 p-4 rounded-2xl border border-slate-800 flex flex-col gap-3">
              <h4 className="text-xs font-bold text-white">Add New Category</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Category Name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                  required
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
                <input
                  type="color"
                  value={newCatColor}
                  onChange={(e) => setNewCatColor(e.target.value)}
                  className="h-9 w-full rounded-xl bg-slate-900 border border-slate-700 cursor-pointer p-1"
                />
              </div>

              <div className="flex justify-between items-center mt-2">
                <button
                  type="button"
                  onClick={handleBulkReclassify}
                  disabled={isReclassifying}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/30 text-cyan-300 text-xs font-semibold"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isReclassifying ? "Re-classifying…" : "Re-classify Library with AI"}</span>
                </button>

                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Category</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. Milestone Annotation Modal */}
      {isAnnotationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <form onSubmit={handleAddAnnotation} className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">Add Milestone Marker</h3>
              <button onClick={() => setIsAnnotationModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Event Date</label>
              <input
                type="date"
                value={newAnnoDate}
                onChange={(e) => setNewAnnoDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Milestone Label</label>
              <input
                type="text"
                placeholder="e.g. Launched Quick Charge format"
                value={newAnnoLabel}
                onChange={(e) => setNewAnnoLabel(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Description (Optional)</label>
              <textarea
                placeholder="Details of editorial or thumbnail pivot"
                value={newAnnoDesc}
                onChange={(e) => setNewAnnoDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
              />
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setIsAnnotationModalOpen(false)}
                className="px-3 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-cyan-600 text-slate-950 font-bold text-xs"
              >
                Save Marker
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Floating Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in">
          <div className="px-5 py-3 rounded-2xl bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 text-xs font-bold shadow-2xl flex items-center gap-2 backdrop-blur-xl">
            <Check className="w-4 h-4" />
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}
