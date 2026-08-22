import React, { useState, useEffect } from "react";
import {
  Users,
  Search,
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Clock,
  ExternalLink,
  RefreshCw,
  Trash2,
  Download,
  Layers,
  BarChart2,
  Sliders,
  ChevronRight,
  ShieldAlert,
  Zap,
  Info,
  Check,
  X,
  ArrowRight,
  Eye,
  SlidersHorizontal,
} from "lucide-react";

export default function CompetitorComparison({ currentUser }) {
  const [reports, setReports] = useState([]);
  const [activeReportId, setActiveReportId] = useState(null);
  const [activeReport, setActiveReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState("outliers"); // 'outliers' | 'donotcopy' | 'sidebyside'

  // New Report Inputs
  const [channelUrl, setChannelUrl] = useState("");
  const [ourCtr, setOurCtr] = useState(5.0);
  const [ourAvd, setOurAvd] = useState(48.0);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const res = await fetch("/api/comparison/reports", { credentials: "same-origin" });
      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      const data = await res.json();
      setReports(Array.isArray(data) ? data : []);
      if (data && data.length > 0 && !activeReportId) {
        loadReportDetails(data[0].id);
      }
    } catch (e) {
      console.error("Failed to fetch reports:", e);
    }
  };

  const loadReportDetails = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/comparison/reports/${id}`, { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setActiveReport(data);
        setActiveReportId(data.id);
        if (data.analysis?.benchmarks) {
          setOurCtr(data.analysis.benchmarks.ourCtr || 5.0);
          setOurAvd(data.analysis.benchmarks.ourAvd || 48.0);
        }
      }
    } catch (e) {
      console.error("Failed to load report details:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!channelUrl.trim()) return;

    setGenerating(true);
    showToast("Analyzing competitor uploads and calculating rolling baselines...", "info");

    try {
      const res = await fetch("/api/comparison/generate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelUrl: channelUrl.trim(),
          ourCtr: parseFloat(ourCtr) || 5.0,
          ourAvd: parseFloat(ourAvd) || 48.0,
        }),
      });

      const data = await res.json();
      if (data.success && data.reportId) {
        showToast("Comparison report generated successfully!");
        setChannelUrl("");
        await fetchReports();
        await loadReportDetails(data.reportId);
      } else {
        showToast("Error: " + (data.error || "Failed to generate report"), "error");
      }
    } catch (err) {
      showToast("Generation error: " + err.message, "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleRefreshCurrent = async () => {
    if (!activeReportId) return;
    setGenerating(true);
    showToast("Updating report with fresh YouTube uploads...", "info");
    try {
      const res = await fetch(`/api/comparison/reports/${activeReportId}/refresh`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ourCtr, ourAvd }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Report refreshed with latest data!");
        await fetchReports();
        await loadReportDetails(activeReportId);
      } else {
        showToast("Refresh error: " + data.error, "error");
      }
    } catch (e) {
      showToast("Refresh failed: " + e.message, "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteReport = async (id, title) => {
    if (!confirm(`Delete comparison report for "${title}"?`)) return;
    try {
      const res = await fetch(`/api/comparison/reports/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        showToast("Report deleted.");
        setActiveReport(null);
        setActiveReportId(null);
        fetchReports();
      }
    } catch (e) {}
  };

  const analysis = activeReport?.analysis;

  return (
    <div className="max-w-7xl w-full mx-auto px-6 py-8 flex flex-col gap-8 font-sans text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
      {/* 1. Header & Channel Selector / Input */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-lg shadow-cyan-500/20 shrink-0">
              <Users className="w-6 h-6 fill-current" />
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">
                The Electric Duo · Competitive Intelligence
              </div>
              <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
                YouTube Competitor Comparison Tool
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Per-channel relative baseline outlier detection (<span className="text-cyan-300 font-semibold">≥ 3x views</span>), packaging diffs, and replicability diagnostics.
              </p>
            </div>
          </div>

          {/* Past Reports Selector */}
          {reports.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 px-2">Saved Reports:</span>
              <select
                value={activeReportId || ""}
                onChange={(e) => loadReportDetails(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-xs font-bold text-cyan-300 rounded-xl px-3 py-1.5 focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.competitor_title} ({r.competitor_subs ? `${(r.competitor_subs / 1000).toFixed(0)}K subs` : "Saved"}) · {new Date(r.updated_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Input Bar & Controls */}
        <form onSubmit={handleGenerate} className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-4 border-t border-slate-800/80">
          {/* Competitor URL Input */}
          <div className="lg:col-span-6 relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
            <input
              type="text"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              placeholder="Enter competitor YouTube URL, @handle, or Channel ID (e.g. @StateOfCharge)..."
              disabled={generating}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors font-medium placeholder-slate-500 disabled:opacity-50"
            />
          </div>

          {/* Manual CTR Benchmark */}
          <div className="lg:col-span-2 flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">Our CTR:</span>
            <input
              type="number"
              step="0.1"
              value={ourCtr}
              onChange={(e) => setOurCtr(e.target.value)}
              disabled={generating}
              className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-white text-center focus:outline-none focus:border-cyan-500"
            />
            <span className="text-[11px] text-slate-500">%</span>
          </div>

          {/* Actions */}
          <div className="lg:col-span-4 flex items-center gap-2">
            <button
              type="submit"
              disabled={generating || !channelUrl.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold text-xs shadow-md shadow-cyan-500/20 transition-all disabled:opacity-50"
            >
              <Sparkles className={`w-4 h-4 fill-current ${generating ? "animate-spin" : ""}`} />
              <span>{generating ? "Ingesting 12 Months..." : "Compare Channel"}</span>
            </button>

            {activeReport && (
              <>
                <button
                  type="button"
                  onClick={handleRefreshCurrent}
                  disabled={generating}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                  title="Refresh report with latest YouTube data"
                >
                  <RefreshCw className={`w-4 h-4 ${generating ? "animate-spin text-cyan-400" : ""}`} />
                </button>

                <a
                  href={`/api/comparison/reports/${activeReportId}/export-csv`}
                  download
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 transition-colors flex items-center"
                  title="Export Report to CSV"
                >
                  <Download className="w-4 h-4" />
                </a>

                <button
                  type="button"
                  onClick={() => handleDeleteReport(activeReport.id, activeReport.competitorTitle)}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 border border-slate-700 transition-colors"
                  title="Delete Report"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </form>
      </div>

      {/* 2. Main Report Container */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-400"></div>
          <span className="text-xs font-semibold">Loading Competitor Report...</span>
        </div>
      ) : !activeReport || !analysis ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-12 text-center flex flex-col items-center gap-3">
          <Users className="w-12 h-12 text-slate-600" />
          <h3 className="text-base font-bold text-white">No Competitor Selected</h3>
          <p className="text-xs text-slate-400 max-w-md">
            Enter a YouTube channel URL or handle above (e.g. <b className="text-cyan-400">@StateOfCharge</b> or <b className="text-cyan-400">@OutOfSpecReviews</b>) to run a 12-month relative outlier comparison.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Channel Comparison Summary Bar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* The Electric Duo */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-black text-lg">
                  ED
                </div>
                <div>
                  <div className="text-xs font-bold text-white">{analysis.duoChannel.title}</div>
                  <div className="text-[11px] text-slate-400">{analysis.duoChannel.handle}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    <b>{analysis.duoChannel.videoCount12M}</b> long-form uploads (12M) · <b>{analysis.duoChannel.outlierCount}</b> outliers
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-white">
                  {(analysis.duoChannel.subscribers || 24800).toLocaleString()}
                </div>
                <div className="text-[10px] uppercase font-bold tracking-widest text-cyan-400">Subscribers</div>
              </div>
            </div>

            {/* Competitor Channel */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <img
                  src={analysis.competitorChannel.thumbnailUrl || "https://img.youtube.com/vi/mqdefault.jpg"}
                  alt=""
                  className="w-12 h-12 rounded-2xl object-cover border border-slate-700"
                />
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>{analysis.competitorChannel.title}</span>
                    <a
                      href={`https://www.youtube.com/channel/${analysis.competitorChannel.channelId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-500 hover:text-cyan-400"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="text-[11px] text-slate-400">{analysis.competitorChannel.handle}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    <b>{analysis.competitorChannel.videoCount12M}</b> long-form uploads (12M) · <b className="text-cyan-400">{analysis.competitorChannel.outlierCount}</b> outliers
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-white">
                  {(analysis.competitorChannel.subscribers || 0).toLocaleString()}
                </div>
                <div className="text-[10px] uppercase font-bold tracking-widest text-purple-400">
                  {analysis.sideBySide.subscribers.ratio}x Our Size
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <button
              onClick={() => setActiveTab("outliers")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "outliers"
                  ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
                  : "bg-slate-900 text-slate-400 hover:text-white"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 fill-current" />
              <span>Competitor Outliers & Packaging ({analysis.outlierProfiles?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab("donotcopy")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "donotcopy"
                  ? "bg-red-500 text-slate-950 shadow-md shadow-red-500/20"
                  : "bg-slate-900 text-slate-400 hover:text-white"
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>DO NOT COPY / Deprioritize ({analysis.underperformers?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab("sidebyside")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === "sidebyside"
                  ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
                  : "bg-slate-900 text-slate-400 hover:text-white"
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Side-by-Side Summary & Topics</span>
            </button>
          </div>

          {/* TAB 1: Competitor Outliers (Packaging vs Substance + Replicability) */}
          {activeTab === "outliers" && (
            <div className="flex flex-col gap-6">
              <div className="bg-cyan-950/20 border border-cyan-500/30 rounded-2xl p-4 flex items-center gap-3">
                <Info className="w-5 h-5 text-cyan-400 shrink-0" />
                <div className="text-xs text-cyan-200">
                  <b>Relative Outlier Rule:</b> These videos achieved <span className="text-white font-bold">≥ 3.0x views</span> relative to <i>their own channel's rolling 10-video baseline</i>. We compare them against similar non-outlier videos from the same creator to surface the exact packaging/timing triggers that drove the spike.
                </div>
              </div>

              {analysis.outlierProfiles?.length === 0 ? (
                <div className="bg-slate-900/60 p-8 rounded-3xl text-center text-slate-400 text-xs">
                  No statistical outliers (≥ 3.0x baseline) found for this channel in the last 12 months.
                </div>
              ) : (
                <div className="space-y-6">
                  {analysis.outlierProfiles.map((outlier, idx) => (
                    <div
                      key={outlier.youtubeId}
                      className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col gap-5 hover:border-slate-700 transition-all"
                    >
                      {/* Outlier Header */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                        <div className="flex items-start gap-4 min-w-0 flex-1">
                          <div className="relative group rounded-xl overflow-hidden aspect-video w-36 bg-slate-950 border border-slate-800 shrink-0 shadow-md">
                            <img src={outlier.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            <a
                              href={`https://www.youtube.com/watch?v=${outlier.youtubeId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="absolute inset-0 flex items-center justify-center bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <ExternalLink className="w-5 h-5 text-cyan-400" />
                            </a>
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-slate-950/90 text-[9px] font-mono text-slate-300">
                              {outlier.duration}
                            </span>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-300 text-[11px] font-black tracking-wide">
                                🚀 {outlier.multiplier}x THEIR BASELINE
                              </span>
                              <span className="text-[11px] text-slate-400 font-mono">
                                Published: {new Date(outlier.publishedAt).toLocaleDateString()}
                              </span>
                            </div>
                            <h3 className="text-sm font-bold text-white leading-snug">
                              {outlier.title}
                            </h3>
                            <div className="text-xs text-slate-400 mt-1 flex items-center gap-3">
                              <span><b>{outlier.views.toLocaleString()}</b> views</span>
                              <span>•</span>
                              <span>Baseline was <b>{outlier.baselineViews.toLocaleString()}</b></span>
                              <span>•</span>
                              <span>{outlier.likes?.toLocaleString()} likes</span>
                            </div>
                          </div>
                        </div>

                        {/* Replicability Badges */}
                        <div className="flex flex-wrap lg:flex-col items-start lg:items-end gap-1.5 shrink-0">
                          {outlier.replicabilityFlags?.map((f, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-bold border ${
                                f.type === "timing"
                                  ? "bg-cyan-950/80 border-cyan-500/40 text-cyan-300"
                                  : f.type === "momentum"
                                  ? "bg-purple-950/80 border-purple-500/40 text-purple-300"
                                  : f.type === "scale"
                                  ? "bg-amber-950/80 border-amber-500/40 text-amber-300"
                                  : "bg-slate-800 border-slate-700 text-slate-200"
                              }`}
                              title={f.detail}
                            >
                              {f.badge}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Packaging vs Substance Split */}
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                        {/* Packaging Trigger Diagnosis */}
                        <div className="lg:col-span-5 bg-slate-950/70 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 mb-2 flex items-center gap-1.5">
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                              <span>Packaging Structure Diff</span>
                            </div>
                            <div className="space-y-2 text-xs text-slate-300">
                              <div className="flex justify-between py-1 border-b border-slate-800/60">
                                <span className="text-slate-400">Title Length:</span>
                                <span className="font-bold text-white">
                                  {outlier.packagingDiff?.outlierTitleLength} chars ({outlier.packagingDiff?.outlierTitleWords} words)
                                </span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-slate-800/60">
                                <span className="text-slate-400">Contains Numbers / Specs:</span>
                                <span className={outlier.packagingDiff?.hasNumbers ? "text-emerald-400 font-bold" : "text-slate-400"}>
                                  {outlier.packagingDiff?.hasNumbers ? "✓ Yes" : "No"}
                                </span>
                              </div>
                              <div className="flex justify-between py-1 border-b border-slate-800/60">
                                <span className="text-slate-400">Colon / Separator:</span>
                                <span className={outlier.packagingDiff?.hasSeparator ? "text-cyan-400 font-bold" : "text-slate-400"}>
                                  {outlier.packagingDiff?.hasSeparator ? "✓ Two-Part Title" : "Single Clause"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-cyan-300">
                            💡 <b>Packaging takeaway:</b> {outlier.packagingDiff?.keyDiffSummary}
                          </div>
                        </div>

                        {/* Similar Non-Outlier Comparison Videos */}
                        <div className="lg:col-span-7 bg-slate-950/70 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
                              <span>Same Channel Similar Topic (Non-Outliers)</span>
                              <span className="text-[10px] text-slate-500">Substance Benchmark</span>
                            </div>

                            <div className="space-y-2">
                              {outlier.packagingDiff?.similarVideos?.length === 0 ? (
                                <div className="text-xs text-slate-500 py-3">No direct keyword overlap videos found.</div>
                              ) : (
                                outlier.packagingDiff?.similarVideos?.map((sv, sIdx) => (
                                  <div
                                    key={sIdx}
                                    className="p-2 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="text-slate-300 truncate font-medium">{sv.title}</div>
                                      <div className="text-[10px] text-slate-500 mt-0.5">
                                        {sv.duration} · {sv.titleLength} chars
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <span className="font-bold text-slate-400">{sv.views.toLocaleString()}</span>
                                      <div className="text-[10px] text-slate-500 font-mono">{sv.multiplier}x base</div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          {/* Replicability Guidance Summary */}
                          <div className="mt-3 space-y-1">
                            {outlier.replicabilityFlags?.map((rf, rIdx) => (
                              <div key={rIdx} className="text-[11px] text-slate-400">
                                • <b className="text-slate-300">{rf.label}:</b> {rf.detail}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: "DO NOT COPY" & Underperformer Analysis */}
          {activeTab === "donotcopy" && (
            <div className="flex flex-col gap-6">
              <div className="bg-red-950/20 border border-red-500/30 rounded-2xl p-4 flex items-center gap-3">
                <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
                <div className="text-xs text-red-200">
                  <b>Anti-Pattern Diagnosis:</b> These videos fell into the creator's <span className="text-white font-bold">bottom quartile (&lt; 0.6x baseline)</span>. Surface these to avoid copying formats, vague titles, or low-interest concepts that underperformed even with their subscriber base.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.underperformers?.map((video) => (
                  <div
                    key={video.youtubeId}
                    className="bg-slate-900/90 border border-slate-800/80 rounded-3xl p-5 flex flex-col justify-between hover:border-red-500/40 transition-all"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="px-2 py-0.5 rounded-full bg-red-950/80 border border-red-500/30 text-red-300 text-[10px] font-bold">
                          ⚠️ Underperformed ({video.multiplier}x baseline)
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(video.publishedAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="flex items-start gap-3">
                        <img
                          src={video.thumbnailUrl}
                          alt=""
                          className="w-24 h-14 rounded-xl object-cover border border-slate-800 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-bold text-white line-clamp-2 leading-snug">
                            {video.title}
                          </h4>
                          <div className="text-[10px] text-slate-400 mt-1">
                            <b>{video.views.toLocaleString()}</b> views · {video.duration}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 p-3 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-1.5">
                        <div className="text-[11px] text-red-300 font-medium">
                          <b className="text-red-400">Diagnosis:</b> {video.antiPatternDiagnosis}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {video.strategicGuidance}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Side-by-Side Summary & Topics */}
          {activeTab === "sidebyside" && (
            <div className="flex flex-col gap-6">
              {/* Core Metric Comparison Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* 1. Upload Cadence */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between">
                  <div className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-cyan-400" />
                    <span>Upload Cadence</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">The Electric Duo:</span>
                      <span className="font-bold text-white">{analysis.sideBySide.cadence.duo.monthlyAvg} videos / mo</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Competitor:</span>
                      <span className="font-bold text-cyan-300">{analysis.sideBySide.cadence.competitor.monthlyAvg} videos / mo</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-3 pt-2 border-t border-slate-800">
                    Total 12M long-form: {analysis.sideBySide.cadence.duo.total} vs {analysis.sideBySide.cadence.competitor.total}
                  </div>
                </div>

                {/* 2. Average Video Duration */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between">
                  <div className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-purple-400" />
                    <span>Average Long-Form Length</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">The Electric Duo:</span>
                      <span className="font-bold text-white">{analysis.sideBySide.avgDuration.duo.formatted}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Competitor:</span>
                      <span className="font-bold text-purple-300">{analysis.sideBySide.avgDuration.competitor.formatted}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-3 pt-2 border-t border-slate-800">
                    Excludes &lt; 4 min Shorts
                  </div>
                </div>

                {/* 3. Title Length & Numbers */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between">
                  <div className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    <span>Top-Quartile Title Patterns</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Avg Chars in Top Videos:</span>
                      <span className="font-bold text-white">
                        {analysis.sideBySide.titlePatterns.duo.avgLength} vs {analysis.sideBySide.titlePatterns.competitor.avgLength}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Has Specific Numbers:</span>
                      <span className="font-bold text-emerald-400">
                        {analysis.sideBySide.titlePatterns.duo.hasNumberPct}% vs {analysis.sideBySide.titlePatterns.competitor.hasNumberPct}%
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-3 pt-2 border-t border-slate-800">
                    Calculated from top 25% performers
                  </div>
                </div>
              </div>

              {/* Topic Distribution Matrix */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white mb-4 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span>Topic & Content Mix Distribution (12-Month Share)</span>
                </h3>

                <div className="space-y-4">
                  {analysis.sideBySide.topics.duo.map((dTopic) => {
                    const cTopic = analysis.sideBySide.topics.competitor.find((c) => c.name === dTopic.name) || { pct: 0, count: 0 };
                    return (
                      <div key={dTopic.name} className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-200">{dTopic.name}</span>
                          <span className="text-slate-400 text-[11px]">
                            Duo: <b className="text-white">{dTopic.pct}%</b> ({dTopic.count}) · Competitor: <b className="text-cyan-400">{cTopic.pct}%</b> ({cTopic.count})
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 h-2 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
                          {/* Duo Bar */}
                          <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${dTopic.pct}%` }}></div>
                          {/* Competitor Bar */}
                          <div className="h-full bg-purple-500 rounded-full" style={{ width: `${cTopic.pct}%` }}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in">
          <div
            className={`px-5 py-3 rounded-2xl text-xs font-bold shadow-2xl flex items-center gap-2 backdrop-blur-xl border ${
              toast.type === "error"
                ? "bg-red-950/90 border-red-500/40 text-red-300"
                : toast.type === "info"
                ? "bg-cyan-950/90 border-cyan-500/40 text-cyan-300"
                : "bg-emerald-950/90 border-emerald-500/40 text-emerald-300"
            }`}
          >
            {toast.type === "error" ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
