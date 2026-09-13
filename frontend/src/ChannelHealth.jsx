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
  MousePointerClick,
  Shuffle,
  UserPlus,
  MinusCircle,
  FileText,
  Loader2,
  RotateCcw,
  ChevronLeft,
  Heart,
  Info,
} from "lucide-react";

export default function ChannelHealth({ currentUser, onSelectVideoForAudit }) {
  const [periodDays, setPeriodDays] = useState(28);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [isDerivingBenchmarks, setIsDerivingBenchmarks] = useState(false);
  const [classifyPreview, setClassifyPreview] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [narrativeError, setNarrativeError] = useState(null);
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);
  const [isSyncingReach, setIsSyncingReach] = useState(false);

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
  const [catalogSourceFilter, setCatalogSourceFilter] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogLimit, setCatalogLimit] = useState(100);
  const [catalogTotalPages, setCatalogTotalPages] = useState(1);
  const [catalogSourceCounts, setCatalogSourceCounts] = useState({
    all: 0,
    ai_inferred: 0,
    manual: 0,
    needs_review: 0,
    migrated: 0,
  });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState(0);

  // Staged Manual Overrides (youtubeId -> newCategory)
  const [stagedCategories, setStagedCategories] = useState({});
  const [isSavingAll, setIsSavingAll] = useState(false);

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

  const loadCatalog = async (
    search = catalogSearch,
    category = catalogCatFilter,
    source = catalogSourceFilter,
    page = catalogPage,
    limit = catalogLimit
  ) => {
    setCatalogLoading(true);
    try {
      const query = new URLSearchParams({ page, limit, search, category, source });
      const res = await fetch(`/api/channel-health/video-catalog?${query.toString()}`, { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setCatalogVideos(data.videos || []);
        setCatalogTotal(data.total || 0);
        setCatalogTotalPages(data.totalPages || 1);
        if (data.sourceCounts) {
          setCatalogSourceCounts(data.sourceCounts);
        }
      }
    } catch (e) {
      console.error("Error loading catalog:", e);
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleOpenLibraryModal = (initialSource = null) => {
    // If an explicit source is provided, use it. Otherwise, if there are pending AI tags, default to "ai_inferred"
    const src = initialSource !== null
      ? initialSource
      : (report?.flags?.pendingAiCount > 0 ? "ai_inferred" : "");
    setCatalogSourceFilter(src);
    setCatalogPage(1);
    setStagedCategories({});
    setIsLibraryModalOpen(true);
    loadCatalog(catalogSearch, catalogCatFilter, src, 1, catalogLimit);
  };

  const handleStageCategory = (youtubeId, newCategory, originalCategory) => {
    setStagedCategories((prev) => {
      const updated = { ...prev };
      if (newCategory === originalCategory) {
        delete updated[youtubeId];
      } else {
        updated[youtubeId] = newCategory;
      }
      return updated;
    });
  };

  const handleRevertStage = (youtubeId) => {
    setStagedCategories((prev) => {
      const updated = { ...prev };
      delete updated[youtubeId];
      return updated;
    });
  };

  const handleSaveAll = async () => {
    const stagedCount = Object.keys(stagedCategories).length;
    const aiCount = catalogSourceCounts.ai_inferred ?? report?.flags?.pendingAiCount ?? 0;

    if (stagedCount === 0 && aiCount === 0) {
      showToast("All videos are already verified and manual.", "info");
      return;
    }

    const parts = [];
    if (stagedCount > 0) parts.push(`• ${stagedCount} manual adjustment${stagedCount === 1 ? "" : "s"}`);
    if (aiCount > 0) parts.push(`• Accept ${aiCount} AI-categorized video${aiCount === 1 ? "" : "s"} as verified manual entries`);

    const confirmMsg = `Save All Categories?\n\n${parts.join("\n")}\n\nThis will lock in all categories as verified and manual.`;
    if (!window.confirm(confirmMsg)) return;

    setIsSavingAll(true);
    try {
      const manualOverrides = Object.entries(stagedCategories).map(([youtubeId, category]) => ({
        youtubeId,
        category,
      }));

      const res = await fetch("/api/channel-health/save-all", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualOverrides,
          acceptAllAi: true,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        showToast("Save error: " + (data.error || "Failed to save"), "error");
        return;
      }

      showToast(data.message || "All categories saved and AI tags accepted!", "success");
      setStagedCategories({});
      loadCatalog(catalogSearch, catalogCatFilter, catalogSourceFilter, catalogPage, catalogLimit);
      loadData();
    } catch (err) {
      showToast("Save failed: " + err.message, "error");
    } finally {
      setIsSavingAll(false);
    }
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

  const handleSyncReach = async () => {
    setIsSyncingReach(true);
    try {
      const res = await fetch("/api/channel-health/sync-reach", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!data.success) {
        showToast("Reach sync error: " + (data.error || "failed"), "error");
      } else {
        showToast(data.message || "Reach sync complete", "success");
        loadData();
      }
    } catch (e) {
      showToast("Reach sync failed: " + e.message, "error");
    } finally {
      setIsSyncingReach(false);
    }
  };

  const handleSaveBenchmark = async (cat, patch) => {
    const body = {
      avg_ctr: cat.avg_ctr,
      avg_retention: cat.avg_retention,
      avg_view_duration: cat.avg_view_duration,
      ...patch,
    };
    try {
      const res = await fetch(`/api/channel-health/categories/${cat.id}/benchmarks`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast(`Benchmarks saved for "${cat.name}".`);
        loadCategories();
      }
    } catch (e) {
      showToast("Could not save benchmarks: " + e.message, "error");
    }
  };

  const handleDeriveBenchmarks = async () => {
    setIsDerivingBenchmarks(true);
    try {
      const res = await fetch("/api/channel-health/categories/derive-benchmarks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodDays: 365 }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Derived retention for ${data.updated.length} categor${data.updated.length === 1 ? "y" : "ies"}. CTR still needs Studio.`);
        loadCategories();
      } else {
        showToast(data.error || "Could not derive benchmarks.", "error");
      }
    } catch (e) {
      showToast("Could not derive benchmarks: " + e.message, "error");
    } finally {
      setIsDerivingBenchmarks(false);
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

  // Dry run first: nothing is written until the preview is accepted.
  const handleBulkReclassify = async (dryRun = true) => {
    setIsReclassifying(true);
    try {
      const res = await fetch("/api/channel-health/reclassify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast("Classification error: " + (data.error || data.message || "unknown"), "error");
        return;
      }

      if (dryRun) {
        setClassifyPreview(data);
        if (data.failedBatches > 0) {
          showToast(`Warning: ${data.failedBatches} batch(es) failed${data.lastError ? `: ${data.lastError}` : ""}`, "error");
        }
      } else {
        setClassifyPreview(null);
        const parts = [
          `${data.by_playlist ?? data.byPlaylist ?? 0} from playlists`,
          `${data.byAi ?? 0} from AI`,
          `${data.needsReview ?? 0} need review`,
        ];
        if (data.failedBatches > 0) parts.push(`${data.failedBatches} batch(es) FAILED`);
        showToast(parts.join(" · "), data.failedBatches > 0 ? "error" : "success");
        loadData();
        if (isLibraryModalOpen) loadCatalog();
      }
    } catch (err) {
      showToast("Classification failed: " + err.message, "error");
    } finally {
      setIsReclassifying(false);
    }
  };

  const handleGenerateNarrative = async () => {
    setIsGeneratingNarrative(true);
    setNarrativeError(null);
    try {
      const res = await fetch("/api/channel-health/narrative", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodDays }),
      });
      const data = await res.json();
      if (data.narrative) {
        setNarrative(data.narrative);
        showToast("Channel health narrative generated and archived.");
      } else {
        setNarrativeError(data.narrativeError || data.error || "The narrative could not be generated.");
      }
    } catch (err) {
      setNarrativeError(err.message);
    } finally {
      setIsGeneratingNarrative(false);
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

  const { scorecard, categoryStats, topByViews, topByWatchTime, bottomUnderperformers, flags, audienceShift, satisfactionScore } = report || {};

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

          {/* Sync Reach (Reporting API) Button */}
          <button
            onClick={handleSyncReach}
            disabled={isSyncingReach}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-950/40 hover:bg-purple-900/50 text-purple-300 text-xs font-semibold border border-purple-500/30 transition-colors disabled:opacity-50"
            title="Ingest Impressions & CTR reports from YouTube Reporting API"
          >
            <Compass className={`w-3.5 h-3.5 text-purple-400 ${isSyncingReach ? "animate-spin" : ""}`} />
            <span>{isSyncingReach ? "Syncing Reach…" : "Sync Reach"}</span>
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
      {flags && (flags.underperformingCount > 0 || flags.pendingAiCount > 0 || flags.needsReviewCount > 0 || flags.uncategorisedCount > 0 || flags.unknownDurationCount > 0 || flags.decliningCategories.length > 0) && (
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
                    ⚠️ <b>{flags.decliningCategories.map((c) => c.name).join(", ")}</b> had fewer uploads than the prior period.
                  </span>
                )}
                {flags.underperformingCount > 0 && (
                  <span>
                    📉 <b>{flags.underperformingCount} low-traction videos</b> in this period.
                  </span>
                )}
                {flags.needsReviewCount > 0 && (
                  <span>
                    🔍 <b>{flags.needsReviewCount} videos</b> the classifier could not place confidently.
                  </span>
                )}
                {flags.uncategorisedCount > 0 && (
                  <span>
                    🏷️ <b>{flags.uncategorisedCount} long-form videos</b> have no category, so category totals are incomplete.
                  </span>
                )}
                {flags.unknownDurationCount > 0 && (
                  <span>
                    ⏱️ <b>{flags.unknownDurationCount} videos</b> have an unknown duration and are excluded from all figures.
                  </span>
                )}
                {flags.pendingAiCount > 0 && (
                  <span>
                    🤖 <b>{flags.pendingAiCount} videos</b> categorized by AI (ready for manual review).
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
            <ScoreCard metric={scorecard.totalSubscribers} icon={Users} accent="text-cyan-400/80" />
            <ScoreCard metric={scorecard.views} icon={Eye} accent="text-blue-400/80" />
            <ScoreCard metric={scorecard.impressions} icon={Compass} accent="text-purple-400/80" />
            <ScoreCard metric={scorecard.avgCtr} icon={MousePointerClick} accent="text-amber-400/80" suffix="%" />
            <ScoreCard metric={scorecard.watchTimeHours} icon={Clock} accent="text-emerald-400/80" suffix="h" />
            <ScoreCard metric={scorecard.suggestedShare} icon={Shuffle} accent="text-indigo-400/80" suffix="%" />
            <ScoreCard metric={scorecard.avgRetention} icon={Activity} accent="text-pink-400/80" suffix="%" />
            <ScoreCard metric={scorecard.netSubs} icon={UserPlus} accent="text-teal-400/80" signed />
          </div>
        </div>
      )}

      {/* 3a. Viewer Satisfaction Score (long-form only) */}
      {satisfactionScore && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-800 pb-4 mb-6">
            <div className="flex items-start gap-2.5">
              <Heart className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-white">Viewer Satisfaction Score</h3>
                <p className="text-xs text-slate-400 mt-0.5 max-w-2xl leading-relaxed">
                  YouTube never exposes its internal viewer-satisfaction survey score to creators. This is a
                  disclosed proxy calibrated to our long-form catalogue: retention scored against a duration-adjusted
                  baseline (70%) and net subscriber conversion (30%) &mdash; not an official YouTube metric.
                </p>
              </div>
            </div>
            <div
              className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-500 shrink-0 mt-1 cursor-help"
              title={satisfactionScore.methodology}
            >
              <Info className="w-3.5 h-3.5" />
              <span>Methodology</span>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 items-stretch">
            <SatisfactionScoreBadge
              score={satisfactionScore.score}
              scoreDelta={satisfactionScore.scoreDelta}
              available={satisfactionScore.available}
              videosScored={satisfactionScore.videosScored}
              coverage={satisfactionScore.coverage}
              scoreVersion={satisfactionScore.scoreVersion}
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
              <ScoreCard metric={satisfactionScore.components.retention} icon={Activity} accent="text-pink-400/80" suffix="%" />
              <ScoreCard metric={satisfactionScore.components.coreAudienceIntensity || satisfactionScore.components.engagementRate} icon={Heart} accent="text-rose-400/80" suffix="%" />
              <ScoreCard metric={satisfactionScore.components.subConversionRate} icon={UserPlus} accent="text-teal-400/80" suffix="%" />
            </div>
          </div>

          <p className="sm:hidden text-[10px] text-slate-500 mt-4 leading-relaxed">{satisfactionScore.methodology}</p>
        </div>
      )}

      {/* 3b. AI Channel Health Narrative */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-5">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyan-400" />
              <span>Channel Health Narrative</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Written by Gemini from the measured data above. Instructions are editable in Admin Settings.
            </p>
          </div>
          <button
            onClick={handleGenerateNarrative}
            disabled={isGeneratingNarrative}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition-colors shrink-0 disabled:opacity-50"
          >
            {isGeneratingNarrative ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{isGeneratingNarrative ? "Generating…" : narrative ? "Regenerate" : "Generate Narrative"}</span>
          </button>
        </div>

        {narrativeError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 mb-4 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200/90 leading-relaxed">{narrativeError}</p>
          </div>
        )}

        {narrative ? (
          <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{narrative}</div>
        ) : (
          !narrativeError && (
            <p className="text-xs text-slate-500 leading-relaxed">
              No narrative generated for this period yet. Every figure it cites comes from the scorecard above, and
              metrics that are unavailable are named rather than estimated.
            </p>
          )
        )}
      </div>

      {/* 4. Category Breakdown Matrix */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyan-400" />
              <span>Category Breakdown & Trajectory</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Catalog and upload cadence per category. Retention is shown only where it was measured.
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
                <th className="pb-3">Lifetime Views</th>
                <th className="pb-3">Uploads This Period</th>
                <th className="pb-3">Measured Avg Retention</th>
                <th className="pb-3 text-right">Upload Trajectory</th>
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
                        <span className="font-bold text-white">{cat.uploadsThisPeriod}</span>
                        <span className="text-[10px] text-slate-500">
                          prior: {cat.uploadsPriorPeriod}
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5">
                      {cat.avgRetention != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-cyan-400 rounded-full"
                              style={{ width: `${Math.min(100, cat.avgRetention * 1.5)}%` }}
                            ></div>
                          </div>
                          <span className="font-bold text-white">{cat.avgRetention}%</span>
                          <span className="text-[10px] text-slate-500">n={cat.retentionSampleSize}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600">&mdash;</span>
                      )}
                    </td>

                    <td className="py-3.5 text-right">
                      {cat.trajectory === "up" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                          <TrendingUp className="w-3 h-3" /> More uploads
                        </span>
                      ) : cat.trajectory === "down" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-950/80 border border-red-500/30 text-red-300 text-[10px] font-bold">
                          <TrendingDown className="w-3 h-3" /> Fewer uploads
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-semibold">
                          <Minus className="w-3 h-3" /> {cat.trajectory === "unknown" ? "No data" : "Unchanged"}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl flex flex-col gap-3.5 max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ListFilter className="w-5 h-5 text-cyan-400 shrink-0" />
                <h3 className="text-base font-bold text-white truncate">Re-categorize Video Library</h3>
                <span className="text-xs text-slate-400 hidden sm:inline shrink-0">({catalogTotal} videos)</span>
                {Object.keys(stagedCategories).length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold shrink-0">
                    {Object.keys(stagedCategories).length} edited
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleSaveAll}
                  disabled={isSavingAll}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 text-xs font-bold shadow-lg shadow-cyan-500/20 disabled:opacity-50 transition-all cursor-pointer"
                  title="Save all manual adjustments and accept AI categorizations as verified manual entries"
                >
                  {isSavingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckSquare className="w-3.5 h-3.5" />}
                  <span>
                    {isSavingAll
                      ? "Saving..."
                      : Object.keys(stagedCategories).length > 0
                        ? `Save All (${Object.keys(stagedCategories).length} edits)`
                        : "Save All & Accept AI"}
                  </span>
                </button>
                <button
                  onClick={() => setIsLibraryModalOpen(false)}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Source Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs border-b border-slate-800/60 shrink-0">
              <span className="text-[11px] font-semibold text-slate-400 mr-1 shrink-0">Filter:</span>
              {[
                { id: "", label: "All Videos", count: catalogSourceCounts.all || catalogTotal },
                { id: "ai_inferred", label: "🤖 AI Tagged", count: catalogSourceCounts.ai_inferred },
                { id: "needs_review", label: "⚠️ Needs Review", count: catalogSourceCounts.needs_review },
                { id: "manual", label: "✓ Manual", count: catalogSourceCounts.manual },
                { id: "migrated", label: "📦 Migrated", count: catalogSourceCounts.migrated },
              ].map((tab) => {
                const isActive = catalogSourceFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setCatalogSourceFilter(tab.id);
                      setCatalogPage(1);
                      loadCatalog(catalogSearch, catalogCatFilter, tab.id, 1, catalogLimit);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-xl font-medium transition-all shrink-0 ${
                      isActive
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold"
                        : "bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? "bg-cyan-500/30 text-cyan-200" : "bg-slate-800 text-slate-400"}`}>
                      {tab.count ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Filter / Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-950 p-2.5 rounded-2xl border border-slate-800 shrink-0">
              <div className="flex flex-1 items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-700 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Search video title..."
                  value={catalogSearch}
                  onChange={(e) => {
                    setCatalogSearch(e.target.value);
                    setCatalogPage(1);
                    loadCatalog(e.target.value, catalogCatFilter, catalogSourceFilter, 1, catalogLimit);
                  }}
                  className="bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none w-full"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={catalogCatFilter}
                  onChange={(e) => {
                    setCatalogCatFilter(e.target.value);
                    setCatalogPage(1);
                    loadCatalog(catalogSearch, e.target.value, catalogSourceFilter, 1, catalogLimit);
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none"
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  value={catalogLimit}
                  onChange={(e) => {
                    const l = parseInt(e.target.value, 10);
                    setCatalogLimit(l);
                    setCatalogPage(1);
                    loadCatalog(catalogSearch, catalogCatFilter, catalogSourceFilter, 1, l);
                  }}
                  className="px-2 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-300 focus:outline-none"
                >
                  <option value="50">50 / page</option>
                  <option value="100">100 / page</option>
                  <option value="250">250 / page</option>
                  <option value="0">Show All</option>
                </select>

                <button
                  onClick={() => handleBulkReclassify(true)}
                  disabled={isReclassifying}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/30 text-cyan-300 text-xs font-semibold shrink-0"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isReclassifying ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">{isReclassifying ? "Classifying..." : "Preview AI Reclassify"}</span>
                </button>
              </div>
            </div>

            {/* Dry-run preview: nothing has been written yet */}
            {classifyPreview && (
              <div className="mb-2 rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-3 shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="text-xs font-bold text-cyan-200 mb-0.5">
                      Preview only &mdash; nothing has been written
                    </div>
                    <div className="text-[11px] text-cyan-300/80 flex flex-wrap gap-x-3 gap-y-1">
                      <span><b>{classifyPreview.byPlaylist}</b> from playlist mapping</span>
                      <span><b>{classifyPreview.byAi}</b> from AI</span>
                      <span><b>{classifyPreview.needsReview}</b> need review</span>
                      {classifyPreview.failedBatches > 0 && (
                        <span className="text-red-300">
                          <b>{classifyPreview.failedBatches}</b> of {classifyPreview.totalBatches} batches failed
                          {classifyPreview.lastError && (
                            <span className="block text-red-400/90 font-mono text-[10px] mt-0.5 max-w-md truncate" title={classifyPreview.lastError}>
                              {classifyPreview.lastError}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setClassifyPreview(null)}
                      className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                    >
                      Discard
                    </button>
                    <button
                      onClick={() => handleBulkReclassify(false)}
                      disabled={isReclassifying}
                      className="px-2.5 py-1 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold disabled:opacity-50"
                    >
                      Apply {classifyPreview.byPlaylist + classifyPreview.byAi} changes
                    </button>
                  </div>
                </div>

                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
                  <table className="w-full text-left text-[11px]">
                    <tbody className="divide-y divide-slate-800/60">
                      {(classifyPreview.changes || []).slice(0, 100).map((c) => (
                        <tr key={c.youtube_id}>
                          <td className="px-3 py-1.5 text-slate-300 max-w-xs truncate" title={c.title}>{c.title}</td>
                          <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{c.from || "\u2014"}</td>
                          <td className="px-3 py-1.5 text-slate-500">&rarr;</td>
                          <td className={`px-3 py-1.5 font-semibold whitespace-nowrap ${c.to ? "text-cyan-300" : "text-amber-400"}`}>
                            {c.to || "needs review"}
                          </td>
                          <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                            {c.source}
                            {c.confidence != null && ` (${c.confidence.toFixed(2)})`}
                          </td>
                          <td className="px-3 py-1.5 text-slate-500 max-w-xs truncate" title={c.reason}>{c.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Video List Table */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[250px]">
              {catalogLoading ? (
                <div className="py-16 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                  <span>Loading videos...</span>
                </div>
              ) : catalogVideos.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs">No videos match your search or filter.</div>
              ) : (
                catalogVideos.map((v) => {
                  const staged = stagedCategories[v.youtube_id];
                  const isModified = staged !== undefined && staged !== v.content_type;
                  const displayCategory = staged !== undefined ? staged : (v.content_type || "Other");

                  return (
                    <div
                      key={v.youtube_id}
                      className={`bg-slate-950/80 p-3 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isModified
                          ? "border-cyan-500/60 shadow-md shadow-cyan-500/10 bg-cyan-950/20"
                          : "border-slate-800/80 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <img
                          src={v.thumbnail_url || `https://img.youtube.com/vi/${v.youtube_id}/mqdefault.jpg`}
                          alt=""
                          className="w-16 h-10 rounded-lg object-cover shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-white truncate" title={v.title}>
                            {v.title}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
                            <span><b>{(v.view_count || 0).toLocaleString()}</b> views</span>
                            <span>•</span>
                            <span>{v.duration || "15m"}</span>
                            <span>•</span>
                            {isModified ? (
                              <span className="text-cyan-300 font-bold bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-500/40 flex items-center gap-1">
                                ✏️ Manual Adjust (Pending)
                              </span>
                            ) : v.category_source === "manual" ? (
                              <span className="text-emerald-400 font-semibold">✓ Manual</span>
                            ) : v.category_source === "ai_inferred" ? (
                              <span className="text-purple-400 font-medium">🤖 AI Tagged</span>
                            ) : v.category_source === "needs_review" ? (
                              <span className="text-amber-400 font-medium">⚠️ Needs Review</span>
                            ) : (
                              <span className="text-slate-400">📦 Migrated</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Quick Category Selector Dropdown & Revert */}
                      <div className="flex items-center gap-2 shrink-0">
                        {isModified && (
                          <button
                            onClick={() => handleRevertStage(v.youtube_id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            title="Revert category adjustment"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <select
                          value={displayCategory}
                          onChange={(e) => handleStageCategory(v.youtube_id, e.target.value, v.content_type)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-bold focus:outline-none cursor-pointer transition-colors ${
                            isModified
                              ? "bg-cyan-950 border-cyan-400 text-cyan-200"
                              : "bg-slate-900 border-slate-700 text-cyan-300 focus:border-cyan-500"
                          }`}
                        >
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.name}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer with Pagination & Save All */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800 text-xs shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-[11px]">
                  {catalogTotal > 0
                    ? `Showing ${((catalogPage - 1) * (catalogLimit || catalogTotal)) + 1}–${Math.min(catalogPage * (catalogLimit || catalogTotal), catalogTotal)} of ${catalogTotal}`
                    : "0 videos"}
                </span>
                {catalogLimit > 0 && catalogTotalPages > 1 && (
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      disabled={catalogPage <= 1}
                      onClick={() => {
                        const prev = Math.max(1, catalogPage - 1);
                        setCatalogPage(prev);
                        loadCatalog(catalogSearch, catalogCatFilter, catalogSourceFilter, prev, catalogLimit);
                      }}
                      className="p-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[11px] text-slate-400 px-1">
                      {catalogPage} / {catalogTotalPages}
                    </span>
                    <button
                      disabled={catalogPage >= catalogTotalPages}
                      onClick={() => {
                        const next = Math.min(catalogTotalPages, catalogPage + 1);
                        setCatalogPage(next);
                        loadCatalog(catalogSearch, catalogCatFilter, catalogSourceFilter, next, catalogLimit);
                      }}
                      className="p-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {Object.keys(stagedCategories).length > 0 && (
                  <button
                    onClick={() => setStagedCategories({})}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                  >
                    Discard Edits
                  </button>
                )}
                <button
                  onClick={handleSaveAll}
                  disabled={isSavingAll}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 text-xs font-bold shadow-lg shadow-cyan-500/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {isSavingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckSquare className="w-3.5 h-3.5" />}
                  <span>
                    {isSavingAll
                      ? "Saving..."
                      : `Save All (${Object.keys(stagedCategories).length} edits, accept AI)`}
                  </span>
                </button>
              </div>
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
                <div key={cat.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
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

                  {/* Benchmarks. Retention and view duration can be derived from
                      Analytics; CTR has no API equivalent and must come from Studio. */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80">
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                        Avg CTR % <span className="text-amber-500/80">(Studio)</span>
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        defaultValue={cat.avg_ctr ?? ""}
                        placeholder="—"
                        onBlur={(e) => handleSaveBenchmark(cat, { avg_ctr: e.target.value })}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Avg Retention %</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        defaultValue={cat.avg_retention ?? ""}
                        placeholder="—"
                        onBlur={(e) => handleSaveBenchmark(cat, { avg_retention: e.target.value })}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Avg View Duration</span>
                      <input
                        type="text"
                        defaultValue={cat.avg_view_duration ?? ""}
                        placeholder="8:15"
                        onBlur={(e) => handleSaveBenchmark(cat, { avg_view_duration: e.target.value })}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-500"
                      />
                    </label>
                  </div>
                  {cat.benchmarks_updated_at && (
                    <div className="text-[9px] text-slate-600">
                      Benchmarks updated {new Date(cat.benchmarks_updated_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Auto-derive what the Analytics API actually exposes */}
            <div className="bg-slate-950/70 p-4 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white mb-0.5">Derive benchmarks from Analytics</div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Fills average retention and view duration per category from measured data, weighted by views.
                  Click-through rate is not exposed by the YouTube Analytics API and must be typed in from Studio.
                </p>
              </div>
              <button
                onClick={handleDeriveBenchmarks}
                disabled={isDerivingBenchmarks}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition-colors shrink-0 disabled:opacity-50"
              >
                {isDerivingBenchmarks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>{isDerivingBenchmarks ? "Deriving…" : "Derive from Analytics"}</span>
              </button>
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


// Headline badge for the Viewer Satisfaction Score. Colors by band (>=70
// strong, >=40 mixed, below that soft) rather than a fixed pass/fail line,
// since the underlying scale is a disclosed heuristic, not an official cutoff.
function SatisfactionScoreBadge({ score, scoreDelta, available, videosScored, coverage, scoreVersion }) {
  const isLegacy = available && score != null && (!scoreVersion || scoreVersion < 2);

  if (!available || score == null) {
    return (
      <div className="w-full lg:w-48 shrink-0 rounded-3xl bg-slate-950/60 border border-slate-800 flex flex-col items-center justify-center text-center p-5 gap-2">
        <MinusCircle className="w-6 h-6 text-slate-600" />
        <span className="text-[11px] text-slate-500 leading-snug">Not enough measured long-form data yet</span>
      </div>
    );
  }

  const band =
    score >= 70 ? "emerald" :
    score >= 40 ? "amber" :
    "red";

  const bandClasses = {
    emerald: "from-emerald-500/25 to-emerald-500/5 border-emerald-500/40",
    amber: "from-amber-500/25 to-amber-500/5 border-amber-500/40",
    red: "from-red-500/25 to-red-500/5 border-red-500/40",
  }[band];

  const deltaClasses =
    scoreDelta == null ? null :
    scoreDelta >= 0 ? "text-emerald-300 bg-emerald-950/40" :
    "text-red-300 bg-red-950/40";

  return (
    <div
      className={`w-full lg:w-48 shrink-0 rounded-3xl bg-gradient-to-br ${bandClasses} border flex flex-col items-center justify-center text-center p-5 gap-1.5`}
    >
      <div className="text-4xl font-black tracking-tight text-white">{score}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300/80">out of 100</div>
      {isLegacy ? (
        <span className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded px-2 py-1 mt-1 font-medium leading-tight">
          Scored under earlier methodology &mdash; refresh to update
        </span>
      ) : scoreDelta != null ? (
        <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${deltaClasses}`}>
          {scoreDelta >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {scoreDelta >= 0 ? `+${scoreDelta}` : scoreDelta} pts vs prior
        </span>
      ) : (
        <span className="text-[10px] text-slate-500 mt-1">No prior period to compare</span>
      )}
      {!isLegacy && videosScored != null && coverage != null && (
        <div className="text-[10px] text-slate-400 mt-2 border-t border-slate-800/80 pt-2 w-full text-center leading-tight">
          Across {videosScored} long-form videos &middot; {Math.round(coverage * 100)}% of window views
        </div>
      )}
    </div>
  );
}

// A scorecard tile that renders a metric's availability honestly. A metric with
// no measured value shows an em dash and the reason, never a filled-in number.
function ScoreCard({ metric, icon: Icon, accent, suffix = "", signed = false }) {
  if (!metric) return null;

  const available = metric.available && metric.value != null;
  const formatted = available
    ? `${signed && metric.value >= 0 ? "+" : ""}${typeof metric.value === "number" ? metric.value.toLocaleString() : metric.value}${suffix}`
    : "\u2014";

  const change = metric.pctChange;
  const hasChange = available && change != null;
  const isContext = metric.isContextOnly;

  return (
    <div className={`bg-slate-900/80 border ${isContext ? "border-slate-800/80 bg-slate-900/50" : "border-slate-800"} rounded-2xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition-colors relative`}>
      <div className="flex items-center justify-between text-slate-400 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold text-slate-400 truncate">{metric.label}</span>
          {isContext && (
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.2 rounded bg-slate-800/90 text-slate-400 border border-slate-700/60 shrink-0 cursor-help"
              title="Display-only context metric. Not factored into the satisfaction composite score."
            >
              Context
            </span>
          )}
        </div>
        {available ? (
          <Icon className={`w-3.5 h-3.5 ${accent} shrink-0`} />
        ) : (
          <MinusCircle className="w-3.5 h-3.5 text-slate-600 shrink-0" />
        )}
      </div>
      <div>
        <div className={`text-2xl font-black tracking-tight ${available ? "text-white" : "text-slate-600"}`}>
          {formatted}
        </div>
        {hasChange ? (
          <div className="flex items-center gap-1 mt-1">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                change >= 0 ? "text-emerald-400 bg-emerald-950/40" : "text-red-400 bg-red-950/40"
              }`}
            >
              {change >= 0 ? <ArrowUpRight className="w-3 h-3 inline mr-0.5" /> : <ArrowDownRight className="w-3 h-3 inline mr-0.5" />}
              {change >= 0 ? `+${change}%` : `${change}%`}
            </span>
            <span className="text-[10px] text-slate-500">vs prior period</span>
          </div>
        ) : (
          <div className="text-[10px] text-slate-500 mt-1 leading-snug">
            {metric.note || (available ? "No prior period to compare" : "Not available")}
          </div>
        )}
      </div>
    </div>
  );
}
