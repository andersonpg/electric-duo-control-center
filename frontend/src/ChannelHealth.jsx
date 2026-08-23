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
  Tag,
  Plus,
  Trash2,
  Eye,
  Clock,
  Users,
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
  Search,
  CheckSquare,
  HelpCircle,
} from "lucide-react";

export default function ChannelHealth({ currentUser, onSelectVideoForAudit }) {
  const [periodDays, setPeriodDays] = useState(28);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);

  // Modals
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);

  // Category Manager State
  const [categories, setCategories] = useState([]);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [newCatColor, setNewCatColor] = useState("#06b6d4");

  // Video Library Catalog State (for manual re-categorization)
  const [catalogVideos, setCatalogVideos] = useState([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogCatFilter, setCatalogCatFilter] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState(0);

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
      const repRes = await fetch(`/api/channel-health/report?period=${periodDays}`, { credentials: "same-origin" });
      if (repRes.ok) setReport(await repRes.json());
    } catch (e) {
      console.error("Error loading channel health:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await fetch("/api/channel-health/categories", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        const sorted = Array.isArray(data)
          ? [...data].sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }))
          : [];
        setCategories(sorted);
      }
    } catch (e) {}
  };

  const loadCatalog = async (search = catalogSearch, category = catalogCatFilter) => {
    setCatalogLoading(true);
    try {
      const query = new URLSearchParams({ page: 1, limit: 100, search, category });
      const res = await fetch(`/api/channel-health/video-catalog?${query.toString()}`, { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setCatalogVideos(data.videos || []);
        setCatalogTotal(data.total || 0);
      }
    } catch (e) {
      console.error("Error loading catalog:", e);
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleOpenLibraryModal = () => {
    setIsLibraryModalOpen(true);
    loadCatalog();
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
        if (isLibraryModalOpen) loadCatalog();
      } else {
        showToast("Reclassification error: " + data.error, "error");
      }
    } catch (err) {
      showToast("Reclassification failed: " + err.message, "error");
    } finally {
      setIsReclassifying(false);
    }
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
        showToast(`Category updated to "${category}".`);
        // Update local state in catalog if modal open
        setCatalogVideos((prev) =>
          prev.map((v) => (v.youtube_id === youtubeId ? { ...v, content_type: category, category_source: "manual" } : v))
        );
        loadData();
      }
    } catch (e) {}
  };

  if (loading && !report) {
    return (
      <div className="w-full max-w-7xl mx-auto px-6 py-16 flex flex-col items-center justify-center text-slate-400 gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-400"></div>
        <div className="text-sm font-semibold text-slate-300">Loading Channel Health & Studio Analytics…</div>
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
              Channel Performance & Health
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-xs text-slate-400">
                Long-form content (excludes &lt; 4 min Shorts) · {periodDays}-day window
              </span>
              {report?.isLiveStudioData && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-[10px] font-bold text-emerald-300">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  Live YouTube Studio Data (OAuth)
                </span>
              )}
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
            <span>{isSnapshotting ? "Saving…" : "Pull Live Snapshot"}</span>
          </button>

          {/* Re-categorize Library Button */}
          <button
            onClick={handleOpenLibraryModal}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <ListFilter className="w-3.5 h-3.5 text-cyan-400" />
            <span>Re-categorize Library</span>
          </button>

          {/* Manage Categories Button */}
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Tag className="w-3.5 h-3.5 text-cyan-400" />
            <span>Categories</span>
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
                    ⚠️ <b>{flags.decliningCategories.map((c) => c.name).join(", ")}</b> trending down relative to channel average.
                  </span>
                )}
                {flags.underperformingCount > 0 && (
                  <span>
                    📉 <b>{flags.underperformingCount} low-traction videos</b> in this period.
                  </span>
                )}
                {flags.pendingAiCount > 0 && (
                  <span>
                    🤖 <b>{flags.pendingAiCount} videos</b> categorized via AI (ready for manual review).
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleOpenLibraryModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-semibold transition-colors"
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>Review / Re-categorize</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Logical 8-Card Scorecard Grid */}
      {scorecard && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Period Performance Scorecard ({scorecard.periodDays}-Day Window)
            </h3>
            <span className="text-[11px] text-slate-500">
              As of: {scorecard.asOfDate}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
            {/* 1. Total Subscribers (Milestone / Size) */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-semibold text-slate-400">Total Subscribers</span>
                <Users className="w-3.5 h-3.5 text-cyan-400/80" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-white">
                  {scorecard.totalSubscribers.value.toLocaleString()}
                </div>
                <div className="text-[10px] text-cyan-400 mt-1 font-semibold">
                  Channel Milestone Total
                </div>
              </div>
            </div>

            {/* 2. Total Views */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-semibold text-slate-400">Total Views</span>
                <Eye className="w-3.5 h-3.5 text-emerald-400/80" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-white">
                  {scorecard.views.value.toLocaleString()}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                      scorecard.views.pctChange > 0
                        ? "bg-emerald-950/80 border border-emerald-500/30 text-emerald-300"
                        : "bg-red-950/80 border border-red-500/30 text-red-300"
                    }`}
                  >
                    {scorecard.views.pctChange > 0 ? <ArrowUpRight className="w-3 h-3 inline mr-0.5" /> : <ArrowDownRight className="w-3 h-3 inline mr-0.5" />}
                    {scorecard.views.pctChange > 0 ? `+${scorecard.views.pctChange}%` : `${scorecard.views.pctChange}%`}
                  </span>
                  <span className="text-[10px] text-slate-500">vs prior period</span>
                </div>
              </div>
            </div>

            {/* 3. Total Impressions */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-semibold text-slate-400">Impressions (Reach)</span>
                <Compass className="w-3.5 h-3.5 text-blue-400/80" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-white">
                  {scorecard.impressions.value.toLocaleString()}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                      scorecard.impressions.pctChange >= 0
                        ? "bg-emerald-950/80 border border-emerald-500/30 text-emerald-300"
                        : "bg-red-950/80 border border-red-500/30 text-red-300"
                    }`}
                  >
                    {scorecard.impressions.pctChange >= 0 ? `+${scorecard.impressions.pctChange}%` : `${scorecard.impressions.pctChange}%`}
                  </span>
                  <span className="text-[10px] text-slate-500">vs prior period</span>
                </div>
              </div>
            </div>

            {/* 4. Channel Avg CTR */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-semibold text-slate-400">Channel Avg CTR</span>
                <TrendingUp className="w-3.5 h-3.5 text-amber-400/80" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-white">
                  {scorecard.avgCtr.value}%
                </div>
                <div className="text-[10px] text-emerald-400 mt-1 font-semibold">
                  5.0% target baseline
                </div>
              </div>
            </div>

            {/* 5. Watch Time (Hours) */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-semibold text-slate-400">Watch Time (Hours)</span>
                <Clock className="w-3.5 h-3.5 text-cyan-400/80" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-white">
                  {scorecard.watchTimeHours.value.toLocaleString()}h
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                      scorecard.watchTimeHours.pctChange >= 0
                        ? "bg-emerald-950/80 border border-emerald-500/30 text-emerald-300"
                        : "bg-red-950/80 border border-red-500/30 text-red-300"
                    }`}
                  >
                    {scorecard.watchTimeHours.pctChange >= 0 ? `+${scorecard.watchTimeHours.pctChange}%` : `${scorecard.watchTimeHours.pctChange}%`}
                  </span>
                  <span className="text-[10px] text-slate-500">vs prior period</span>
                </div>
              </div>
            </div>

            {/* 6. Suggested Video Share % */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-semibold text-slate-400">Suggested Video Share</span>
                <Sparkles className="w-3.5 h-3.5 text-purple-400/80" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-white">
                  {scorecard.suggestedShare.value}%
                </div>
                <div className="text-[10px] text-purple-300 mt-1 font-semibold">
                  Algorithm Recommendations
                </div>
              </div>
            </div>

            {/* 7. Avg % Viewed (Retention) */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-semibold text-slate-400">Avg % Viewed (Retention)</span>
                <Activity className="w-3.5 h-3.5 text-cyan-400/80" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-white">
                  {scorecard.avgRetention.value}%
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  Across long-form library
                </div>
              </div>
            </div>

            {/* 8. Net Subscribers */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-semibold text-slate-400">Net Subscribers</span>
                <Users className="w-3.5 h-3.5 text-emerald-400/80" />
              </div>
              <div>
                <div className="text-2xl font-black tracking-tight text-white">
                  {scorecard.netSubs.value >= 0 ? `+${scorecard.netSubs.value}` : scorecard.netSubs.value}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                      scorecard.netSubs.pctChange >= 0
                        ? "bg-emerald-950/80 border border-emerald-500/30 text-emerald-300"
                        : "bg-red-950/80 border border-red-500/30 text-red-300"
                    }`}
                  >
                    {scorecard.netSubs.pctChange >= 0 ? `+${scorecard.netSubs.pctChange}%` : `${scorecard.netSubs.pctChange}%`}
                  </span>
                  <span className="text-[10px] text-slate-500">period growth</span>
                </div>
              </div>
            </div>
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
              Performance breakdown across your active content categories.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenLibraryModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition-colors shrink-0"
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>Re-categorize Videos</span>
            </button>
            <button
              onClick={() => setIsCategoryModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors shrink-0"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Edit Categories</span>
            </button>
          </div>
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

      {/* 5. Top & Bottom Performers with Direct Video Audit Deep-Linking */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Top 5 by Views */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">Top 5 by Views</h4>
              </div>
              <span className="text-[10px] text-slate-500">Click to Audit</span>
            </div>
            <div className="space-y-3">
              {topByViews &&
                topByViews.map((v, i) => (
                  <div
                    key={v.youtubeId}
                    onClick={() => onSelectVideoForAudit && onSelectVideoForAudit(v.youtubeId)}
                    className="flex items-center gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 hover:border-cyan-500/60 hover:bg-slate-800/50 transition-all cursor-pointer group"
                    title="Open Video Audit"
                  >
                    <span className="text-xs font-black text-slate-500 w-4 text-center group-hover:text-cyan-400">#{i + 1}</span>
                    <img src={v.thumbnailUrl} alt="" className="w-12 h-7 rounded object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white line-clamp-1 group-hover:text-cyan-300">{v.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        <b>{v.views.toLocaleString()}</b> views · {v.retentionRate}% retention
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Top 5 by Watch Time */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">Top 5 by Watch Hours</h4>
              </div>
              <span className="text-[10px] text-slate-500">Click to Audit</span>
            </div>
            <div className="space-y-3">
              {topByWatchTime &&
                topByWatchTime.map((v, i) => (
                  <div
                    key={v.youtubeId}
                    onClick={() => onSelectVideoForAudit && onSelectVideoForAudit(v.youtubeId)}
                    className="flex items-center gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 hover:border-cyan-500/60 hover:bg-slate-800/50 transition-all cursor-pointer group"
                    title="Open Video Audit"
                  >
                    <span className="text-xs font-black text-slate-500 w-4 text-center group-hover:text-cyan-400">#{i + 1}</span>
                    <img src={v.thumbnailUrl} alt="" className="w-12 h-7 rounded object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white line-clamp-1 group-hover:text-cyan-300">{v.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        <b>{v.watchHours.toLocaleString()}h</b> watch time · {v.views.toLocaleString()} views
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Top 5 Underperformers */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">Underperformers for Review</h4>
              </div>
              <span className="text-[10px] text-slate-500">Click to Audit</span>
            </div>
            <div className="space-y-3">
              {bottomUnderperformers &&
                bottomUnderperformers.map((v, i) => (
                  <div
                    key={v.youtubeId}
                    onClick={() => onSelectVideoForAudit && onSelectVideoForAudit(v.youtubeId)}
                    className="flex items-center gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 hover:border-amber-500/60 hover:bg-slate-800/50 transition-all cursor-pointer group"
                    title="Open Video Audit"
                  >
                    <span className="text-xs font-black text-amber-500 w-4 text-center group-hover:text-amber-300">#{i + 1}</span>
                    <img src={v.thumbnailUrl} alt="" className="w-12 h-7 rounded object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white line-clamp-1 group-hover:text-amber-300">{v.title}</div>
                      <div className="text-[10px] text-red-400 font-semibold mt-0.5">
                        {v.views.toLocaleString()} views · {v.category}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* 6. Video Library Re-Categorization Modal */}
      {isLibraryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ListFilter className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">Re-categorize Video Library</h3>
                <span className="text-xs text-slate-400">({catalogTotal} long-form videos)</span>
              </div>
              <button
                onClick={() => setIsLibraryModalOpen(false)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter / Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 p-3 rounded-2xl border border-slate-800">
              <div className="flex flex-1 items-center gap-2 bg-slate-900 px-3 py-2 rounded-xl border border-slate-700 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Search video title..."
                  value={catalogSearch}
                  onChange={(e) => {
                    setCatalogSearch(e.target.value);
                    loadCatalog(e.target.value, catalogCatFilter);
                  }}
                  className="bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none w-full"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={catalogCatFilter}
                  onChange={(e) => {
                    setCatalogCatFilter(e.target.value);
                    loadCatalog(catalogSearch, e.target.value);
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none"
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={handleBulkReclassify}
                  disabled={isReclassifying}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/30 text-cyan-300 text-xs font-semibold"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isReclassifying ? "animate-spin" : ""}`} />
                  <span>{isReclassifying ? "Classifying..." : "Re-classify All with AI"}</span>
                </button>
              </div>
            </div>

            {/* Video List Table */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {catalogLoading ? (
                <div className="py-12 text-center text-slate-400 text-xs">Loading videos...</div>
              ) : catalogVideos.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">No videos match your search.</div>
              ) : (
                catalogVideos.map((v) => (
                  <div
                    key={v.youtube_id}
                    className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <img
                        src={v.thumbnail_url || `https://img.youtube.com/vi/${v.youtube_id}/mqdefault.jpg`}
                        alt=""
                        className="w-16 h-10 rounded-lg object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-white truncate">{v.title}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                          <span><b>{(v.view_count || 0).toLocaleString()}</b> views</span>
                          <span>•</span>
                          <span>{v.duration || "15m"}</span>
                          <span>•</span>
                          <span className={v.category_source === "manual" ? "text-emerald-400 font-semibold" : "text-purple-400"}>
                            {v.category_source === "manual" ? "✓ Manual" : "🤖 AI Tagged"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Category Selector Dropdown */}
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={v.content_type || "Other"}
                        onChange={(e) => handleOverrideCategory(v.youtube_id, e.target.value)}
                        className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-bold text-cyan-300 focus:outline-none focus:border-cyan-500 cursor-pointer"
                      >
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.name}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }}></span>
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

              <div className="flex justify-end gap-2 mt-2">
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
