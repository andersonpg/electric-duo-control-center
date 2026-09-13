import React, { useState, useEffect } from "react";
import {
  X,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  XCircle,
  TrendingUp,
  Sparkles,
  Eye,
  Clock,
  Zap,
  Users,
  Copy,
  Check,
  Search,
  Compass,
  DollarSign,
  Layers,
  ChevronRight,
  FileText,
  DownloadCloud,
  UploadCloud,
  AlertCircle,
  Heart,
} from "lucide-react";

export default function AuditReportModal({ isOpen, onClose, youtubeId, videoTitle, initialAudit, onAuditUpdated, onSelectVideoForTranscript }) {
  const [audit, setAudit] = useState(initialAudit || null);
  const [loading, setLoading] = useState(!initialAudit);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [activeTab, setActiveTab] = useState("overview"); // 'overview' | 'retention' | 'packaging' | 'discovery' | 'actions'
  const [transcriptInfo, setTranscriptInfo] = useState(null);
  const [captionRetrieving, setCaptionRetrieving] = useState(false);
  const [captionUploading, setCaptionUploading] = useState(false);
  const [captionToast, setCaptionToast] = useState(null);
  const [quickPasteOpen, setQuickPasteOpen] = useState(false);
  const [quickPasteText, setQuickPasteText] = useState("");
  const [savingPaste, setSavingPaste] = useState(false);
  const [quickPasteError, setQuickPasteError] = useState("");
  const tabContentRef = React.useRef(null);

  useEffect(() => {
    if (tabContentRef.current) {
      tabContentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const loadTranscriptInfo = async () => {
    if (!youtubeId) return;
    try {
      const res = await fetch(`/api/transcripts/${youtubeId}`, { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setTranscriptInfo(data);
      } else {
        setTranscriptInfo(null);
      }
    } catch (e) {
      setTranscriptInfo(null);
    }
  };

  const handleRetrieveCaptions = async () => {
    setCaptionRetrieving(true);
    try {
      const res = await fetch(`/api/videos/${youtubeId}/captions/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite: true }),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.isScopeError) {
          setCaptionToast({
            type: "error",
            text: data.error || "The YouTube connection is missing the youtube.force-ssl permission and must be reconnected in Admin Settings.",
            actionText: "Reconnect in Admin Settings",
            actionUrl: "/?module=admin",
          });
          return;
        }
        if (data.canQuickPaste) {
          setQuickPasteOpen(true);
        }
        throw new Error(data.error || "Failed to retrieve captions");
      }
      await loadTranscriptInfo();
      setCaptionToast({ type: "success", text: "Auto-captions retrieved from YouTube!" });
      setTimeout(() => setCaptionToast(null), 3500);
    } catch (err) {
      setCaptionToast({ type: "error", text: err.message });
      setTimeout(() => setCaptionToast(null), 6000);
    } finally {
      setCaptionRetrieving(false);
    }
  };

  const handlePasteCaptions = async () => {
    if (!quickPasteText.trim()) {
      setQuickPasteError("Please paste transcript text or SRT content.");
      return;
    }
    setSavingPaste(true);
    setQuickPasteError("");
    try {
      const res = await fetch(`/api/videos/${youtubeId}/captions/paste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: quickPasteText.trim() }),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process pasted captions");
      await loadTranscriptInfo();
      setQuickPasteOpen(false);
      setQuickPasteText("");
      setCaptionToast({
        type: "success",
        text: `Cleaned & saved ${data.chunkCount || ""} cues (${data.summary?.replacementsCount || 0} EV terms fixed)!`,
      });
      setTimeout(() => setCaptionToast(null), 4500);
    } catch (err) {
      setQuickPasteError(err.message);
    } finally {
      setSavingPaste(false);
    }
  };

  const handleUploadCaptions = async () => {
    setCaptionUploading(true);
    try {
      const res = await fetch(`/api/videos/${youtubeId}/captions/upload`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload clean captions");
      await loadTranscriptInfo();
      setCaptionToast({ type: "success", text: "Clean captions uploaded to YouTube as 'English (Edited)'!" });
      setTimeout(() => setCaptionToast(null), 3500);
    } catch (err) {
      setCaptionToast({ type: "error", text: err.message });
      setTimeout(() => setCaptionToast(null), 4000);
    } finally {
      setCaptionUploading(false);
    }
  };

  useEffect(() => {
    if (isOpen && youtubeId) {
      loadTranscriptInfo();
      if (initialAudit && initialAudit.youtubeId === youtubeId) {
        setAudit(initialAudit);
        setLoading(false);
      } else {
        loadAudit();
      }
    }
  }, [isOpen, youtubeId, initialAudit]);

  const loadAudit = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const url = `/api/audit/${youtubeId}${forceRefresh ? "?refresh=true" : ""}`;
      const method = forceRefresh ? "POST" : "GET";
      const res = await fetch(url, { method, credentials: "same-origin" });
      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      const data = await res.json();
      if (!res.ok || data.error || !data.evaluation) {
        throw new Error(data.error || "Audit generation failed.");
      }
      setAudit(data);
      if (onAuditUpdated) onAuditUpdated(youtubeId, data);
    } catch (err) {
      console.error("Failed to load audit:", err);
      if (forceRefresh) {
        setCaptionToast({ type: "error", text: `Refresh failed: ${err.message}` });
        setTimeout(() => setCaptionToast(null), 6000);
        try {
          const fallbackRes = await fetch(`/api/audit/${youtubeId}`, { credentials: "same-origin" });
          if (fallbackRes.ok) {
            const cached = await fallbackRes.json();
            if (cached && cached.evaluation) {
              setAudit(cached);
            }
          }
        } catch (fallbackErr) {}
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const copyToClipboard = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (!isOpen) return null;

  const { metrics, evaluation, healthScore, updatedAt } = audit || {};
  const isHealthy = healthScore >= 80;
  const isModerate = healthScore >= 65 && healthScore < 80;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-xl overflow-y-auto animate-fade-in">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-750 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] border-slate-800">
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/20 shrink-0">
              <Sparkles className="w-5 h-5 fill-current" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest">
                  Video Audit Report
                </span>
                {transcriptInfo && transcriptInfo.status === "uploaded" && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                    Captions Uploaded
                  </span>
                )}
                {transcriptInfo && transcriptInfo.status === "fixed" && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
                    Cleaned Captions
                  </span>
                )}
                {transcriptInfo && transcriptInfo.status === "unfixed" && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-500/40">
                    Unfixed Captions
                  </span>
                )}
                {!transcriptInfo && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                    No Captions
                  </span>
                )}
                {metrics && (
                  <span className="text-xs text-slate-400 font-mono">
                    {metrics.category} · {metrics.durationFormatted}
                  </span>
                )}
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white truncate max-w-xl">
                {videoTitle || (metrics && metrics.title) || youtubeId}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Quick Caption Actions */}
            {!transcriptInfo ? (
              <>
                <button
                  onClick={handleRetrieveCaptions}
                  disabled={captionRetrieving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all disabled:opacity-50"
                  title="Retrieve auto-captions from YouTube"
                >
                  <DownloadCloud className={`w-3.5 h-3.5 text-cyan-400 ${captionRetrieving ? "animate-bounce" : ""}`} />
                  <span>{captionRetrieving ? "Retrieving…" : "Retrieve Captions"}</span>
                </button>
                <button
                  onClick={() => {
                    setQuickPasteOpen(true);
                    setQuickPasteError("");
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition-all shadow-sm"
                  title="Quick paste copied transcript from YouTube"
                >
                  <FileText className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Paste Captions</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setQuickPasteOpen(true);
                  setQuickPasteError("");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-all"
                title="Paste new/updated transcript"
              >
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Paste</span>
              </button>
            )}

            {transcriptInfo && (transcriptInfo.status === "fixed" || transcriptInfo.status === "uploaded") && (
              <button
                onClick={handleUploadCaptions}
                disabled={captionUploading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all disabled:opacity-50 ${
                  transcriptInfo.status === "uploaded"
                    ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : "bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border-cyan-500/30 shadow-sm"
                }`}
                title="Upload cleaned subtitle track to YouTube as 'English (Edited)'"
              >
                <UploadCloud className={`w-3.5 h-3.5 text-cyan-400 ${captionUploading ? "animate-bounce" : ""}`} />
                <span>
                  {captionUploading
                    ? "Uploading…"
                    : transcriptInfo.status === "uploaded"
                    ? "Re-upload Clean Track"
                    : "Upload Clean Captions"}
                </span>
              </button>
            )}

            <button
              onClick={() => loadAudit(true)}
              disabled={loading || refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${refreshing ? "animate-spin" : ""}`} />
              <span>{refreshing ? "Re-evaluating…" : "Refresh Report"}</span>
            </button>

            {onSelectVideoForTranscript && (
              <button
                onClick={() => {
                  onClose();
                  onSelectVideoForTranscript(youtubeId);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all shadow-sm"
                title="Upload and clean subtitles with EV terminology"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>Transcripts Studio</span>
              </button>
            )}

            <a
              href={`https://www.youtube.com/watch?v=${youtubeId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="Open on YouTube"
            >
              <ExternalLink className="w-4 h-4" />
            </a>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Caption Action Feedback Banner */}
        {captionToast && (
          <div
            className={`px-6 py-2.5 text-xs font-semibold flex items-center justify-between transition-all ${
              captionToast.type === "success"
                ? "bg-emerald-950/90 text-emerald-200 border-b border-emerald-500/40"
                : "bg-rose-950/90 text-rose-200 border-b border-rose-500/40"
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {captionToast.type === "success" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              )}
              <span>{captionToast.text}</span>
              {captionToast.actionUrl && (
                <a
                  href={captionToast.actionUrl}
                  className="px-2 py-0.5 rounded-lg bg-red-500/30 hover:bg-red-500/40 text-white border border-red-500/50 text-[11px] font-bold underline shrink-0 transition-colors ml-1"
                >
                  {captionToast.actionText || "Action"}
                </a>
              )}
            </div>
            <button
              onClick={() => setCaptionToast(null)}
              className="text-slate-400 hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Content Body */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-24 text-slate-400 gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-400"></div>
            <div className="text-sm font-semibold text-slate-300">
              Generating Multimodal Video Audit with Gemini AI…
            </div>
            <p className="text-xs text-slate-500 max-w-sm text-center">
              Evaluating retention curves, 2x2 discovery matrix, CTR baselines, and thumbnail visual contrast.
            </p>
          </div>
        ) : !audit ? (
          <div className="flex-1 p-12 text-center text-slate-400">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <p>Could not load audit data for this video.</p>
          </div>
        ) : (
          <>
            {/* Top Scorecard & Health Banner & Navigation Tabs (Fixed Header - Never Scrolled Away!) */}
            <div className="px-6 pt-5 pb-3 bg-slate-950/60 border-b border-slate-800 shrink-0 flex flex-col gap-4">
              {/* Scorecard Box */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 relative">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  {/* Score & Verdict */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div
                      className={`w-16 h-16 sm:w-18 sm:h-18 rounded-2xl flex flex-col items-center justify-center border shadow-xl shrink-0 ${
                        isHealthy
                          ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300 shadow-emerald-500/10"
                          : isModerate
                          ? "bg-cyan-950/60 border-cyan-500/40 text-cyan-300 shadow-cyan-500/10"
                          : "bg-amber-950/60 border-amber-500/40 text-amber-300 shadow-amber-500/10"
                      }`}
                    >
                      <span className="text-xl sm:text-2xl font-black">{healthScore}</span>
                      <span className="text-[9px] uppercase font-bold tracking-wider opacity-80">/ 100</span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm sm:text-base font-extrabold text-white">
                          {evaluation?.health_tier || (isHealthy ? "Strong Performer" : "Optimization Opportunity")}
                        </span>
                        {metrics?.isLiveStudioData ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                            <CheckCircle className="w-3 h-3" /> Measured Analytics
                          </span>
                        ) : metrics?.isOAuthConnected ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-bold text-cyan-400 uppercase tracking-wider"
                            title="YouTube Analytics typically takes 48-72 hours after upload to aggregate video-level metrics. Views are synced from the catalog."
                          >
                            <Clock className="w-3 h-3" /> Awaiting Video Data
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                            <AlertTriangle className="w-3 h-3" /> Analytics Not Connected
                          </span>
                        )}
                        <span className="text-[10px] text-slate-500">
                          · Audited {new Date(updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed line-clamp-2 max-w-2xl">
                        {evaluation?.scorecard?.one_line_verdict ||
                          "Comprehensive analysis of thumbnail packaging, audience drop-off, and distribution potential."}
                      </p>
                    </div>
                  </div>

                  {/* 4 Health Status Badges */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
                    <StatusPill
                      label="Hook Gate (0:30)"
                      status={metrics?.hookDropPercent == null ? "unavailable" : evaluation?.scorecard?.hook_status}
                      detail={
                        metrics?.hookDropPercent == null
                          ? metrics?.isOAuthConnected
                            ? "Awaiting data"
                            : "No retention data"
                          : `-${metrics.hookDropPercent}%`
                      }
                    />
                    <StatusPill
                      label="Impressions CTR"
                      status={metrics?.ctr == null ? "unavailable" : metrics.ctr >= (metrics.channelBaselineCtr ?? 5.0) ? "pass" : "warn"}
                      detail={
                        metrics?.ctr == null
                          ? metrics?.isOAuthConnected
                            ? "Awaiting reach"
                            : "Not connected"
                          : `${metrics.ctr}%${metrics.ctrDelta != null ? ` (${metrics.ctrDelta >= 0 ? "+" : ""}${metrics.ctrDelta}%)` : ""}`
                      }
                    />
                    <StatusPill
                      label="Retention %"
                      status={
                        metrics?.retentionRate == null
                          ? "unavailable"
                          : metrics?.categoryBenchmark?.avgRetention == null
                          ? "pass"
                          : metrics.retentionRate >= metrics.categoryBenchmark.avgRetention
                          ? "pass"
                          : "warn"
                      }
                      detail={
                        metrics?.retentionRate == null
                          ? metrics?.isOAuthConnected
                            ? "Awaiting data"
                            : "Not connected"
                          : `${metrics.retentionRate}%${metrics?.categoryBenchmark?.avgRetention != null ? ` (Avg ${metrics.categoryBenchmark.avgRetention}%)` : ""}`
                      }
                    />
                    <StatusPill
                      label="SEO Coverage"
                      status={evaluation?.scorecard?.seo_status || "pass"}
                      detail={evaluation?.scorecard?.seo_status === "warn" ? "Needs work" : "Optimized"}
                    />
                  </div>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex flex-wrap gap-2 pt-1">
                {[
                  { id: "overview", label: "Core Performance" },
                  { id: "retention", label: "Retention & Hook Diagnosis" },
                  { id: "packaging", label: "Title & Thumbnail Critique" },
                  { id: "discovery", label: "Discovery 2x2 Matrix" },
                  { id: "actions", label: "Action Plan & Next Steps" },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                      activeTab === t.id
                        ? "bg-cyan-500/15 border border-cyan-500/50 text-cyan-300 shadow-md shadow-cyan-500/10"
                        : "bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Tab Content Body */}
            <div ref={tabContentRef} className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 font-sans">

            {/* TAB 1: CORE PERFORMANCE */}
            {activeTab === "overview" && (
              <div className="flex flex-col gap-6">
                {/* Metric Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                  <MetricCard
                    label="Total Views"
                    value={metrics.views != null ? metrics.views.toLocaleString() : "\u2014"}
                    sub={metrics.viewsSource === "catalog_snapshot" ? "From catalog sync" : undefined}
                    icon={Eye}
                    color={metrics.views != null ? "text-white" : "text-slate-600"}
                  />
                  <MetricCard
                    label="Impressions"
                    value={metrics.impressions != null ? metrics.impressions.toLocaleString() : "\u2014"}
                    sub={
                      metrics.impressions != null
                        ? "Reporting API"
                        : metrics.isOAuthConnected
                        ? "Awaiting reach"
                        : "Not connected"
                    }
                    icon={Compass}
                    color={metrics.impressions != null ? "text-cyan-400" : "text-slate-600"}
                  />
                  <MetricCard
                    label="Impressions CTR"
                    value={metrics.ctr != null ? `${metrics.ctr}%` : "\u2014"}
                    sub={
                      metrics.ctr != null
                        ? metrics.ctrDelta != null
                          ? `${metrics.ctrDelta >= 0 ? "+" : ""}${metrics.ctrDelta}% vs base`
                          : "Reporting API"
                        : metrics.isOAuthConnected
                        ? "Awaiting reach"
                        : "Not connected"
                    }
                    icon={TrendingUp}
                    color={metrics.ctr != null ? "text-emerald-400" : "text-slate-600"}
                  />
                  <MetricCard
                    label="Watch Time"
                    value={metrics.totalWatchTimeHours != null ? `${metrics.totalWatchTimeHours} hrs` : "\u2014"}
                    sub={metrics.totalWatchTimeHours == null ? (metrics.isOAuthConnected ? "Awaiting data" : "Not connected") : undefined}
                    icon={Clock}
                    color={metrics.totalWatchTimeHours != null ? "text-blue-400" : "text-slate-600"}
                  />
                  <MetricCard
                    label="Avg Duration"
                    value={metrics.avdFormatted || "\u2014"}
                    sub={metrics.retentionRate != null ? `${metrics.retentionRate}% rate` : (metrics.isOAuthConnected ? "Awaiting data" : "Not connected")}
                    icon={Zap}
                    color={metrics.avdFormatted ? "text-indigo-400" : "text-slate-600"}
                  />
                  <MetricCard
                    label="Net Subs"
                    value={metrics.netSubs != null ? `${metrics.netSubs >= 0 ? "+" : ""}${metrics.netSubs}` : "\u2014"}
                    sub={metrics.netSubs == null ? (metrics.isOAuthConnected ? "Awaiting data" : "Not connected") : undefined}
                    icon={Users}
                    color={metrics.netSubs != null ? "text-emerald-400" : "text-slate-600"}
                  />
                </div>

                {/* Viewer Satisfaction Score */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                        <Heart className="w-4 h-4" />
                        <span>Viewer Satisfaction Score</span>
                      </h4>
                      {metrics.satisfactionScore?.confidence === "low" && (
                        <span className="text-[10px] font-semibold text-amber-400 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded">
                          low confidence &mdash; under 1,000 views
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] text-slate-500 shrink-0 cursor-help"
                      title={metrics.satisfactionScore?.methodology}
                    >
                      Disclosed proxy, not an official YouTube metric
                    </span>
                  </div>

                  {metrics.satisfactionScore?.available &&
                    (!metrics.satisfactionScore?.scoreVersion || metrics.satisfactionScore.scoreVersion < 2) && (
                      <div className="mb-3 px-3 py-2 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between">
                        <span>Scored under an earlier methodology &mdash; refresh this report to update.</span>
                      </div>
                  )}

                  {metrics.satisfactionScore?.available ? (
                    <div className="flex flex-col sm:flex-row gap-4 items-stretch">
                      <SatisfactionBadge score={metrics.satisfactionScore.score} />
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                        <MetricCard
                          label="Avg % Viewed"
                          value={`${metrics.satisfactionScore.components.retention?.value ?? metrics.satisfactionScore.components.retention}%`}
                          sub={
                            metrics.satisfactionScore.components?.retention?.expected != null
                              ? `vs ${metrics.satisfactionScore.components.retention.expected}% expected ${
                                  metrics.durationSec
                                    ? `for a ${Math.round(metrics.durationSec / 60)}-minute video`
                                    : "for this length"
                                }`
                              : null
                          }
                          icon={Zap}
                          color="text-pink-400"
                        />
                        <div className="relative">
                          <div className="absolute top-2.5 right-2 z-10">
                            <span
                              className="text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60 cursor-help"
                              title="Engaged actions per view (likes + comments + shares). Runs inversely to reach and is shown for context rather than folded into the score. Channel p50: 4.81%."
                            >
                              Context
                            </span>
                          </div>
                          <MetricCard
                            label="Core-Audience Intensity"
                            value={
                              metrics.coreAudienceIntensity != null
                                ? `${metrics.coreAudienceIntensity}%`
                                : metrics.satisfactionScore.components?.engagementRate != null
                                ? `${metrics.satisfactionScore.components.engagementRate}%`
                                : "—"
                            }
                            sub="actions / view"
                            icon={Heart}
                            color="text-rose-400"
                          />
                        </div>
                        <MetricCard
                          label="Net Sub Conversion"
                          value={`${
                            metrics.satisfactionScore.components?.subConversion?.value != null
                              ? metrics.satisfactionScore.components.subConversion.value
                              : (metrics.satisfactionScore.components?.subConversionRate ?? "—")
                          }%`}
                          sub={metrics.satisfactionScore.partial ? "calibrated neutral (no sub data)" : "subs / view"}
                          icon={Users}
                          color="text-teal-400"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {metrics.views != null && metrics.views < 250
                        ? "Video has under 250 views. Viewer Satisfaction Score requires a minimum of 250 views to avoid denominator noise."
                        : metrics?.isOAuthConnected
                        ? "YouTube Analytics typically takes 48–72 hours after upload to aggregate watch time and retention. Refresh this report once analytics data is processed."
                        : "Not enough measured data for this video to compute a satisfaction score. Connect YouTube Analytics in Admin Settings, or refresh this report once analytics data is available."}
                    </p>
                  )}
                </div>

                {/* Traffic Breakdown & Geography */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Traffic Sources */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-3 flex items-center gap-2">
                      <Compass className="w-4 h-4" />
                      <span>Traffic Source Breakdown</span>
                    </h4>
                    {metrics.trafficShare ? (
                      <div className="space-y-3">
                        <ProgressBar label="Browse Features" pct={metrics.trafficShare.browse} color="bg-cyan-500" />
                        <ProgressBar label="Suggested Videos" pct={metrics.trafficShare.suggested} color="bg-blue-500" />
                        <ProgressBar label="YouTube Search" pct={metrics.trafficShare.search} color="bg-emerald-500" />
                        <ProgressBar label="External & Other" pct={metrics.trafficShare.other} color="bg-slate-600" />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {metrics?.isOAuthConnected
                          ? "Traffic source breakdown is still processing in YouTube Analytics (typically takes 48–72 hours for new uploads)."
                          : "Traffic source data is not available. Connect YouTube Analytics in Admin Settings to populate this."}
                      </p>
                    )}
                  </div>

                  {/* Device & Audience Profile */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-3 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      <span>Data Provenance</span>
                    </h4>
                    <div className="space-y-2">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {metrics.isLiveStudioData
                          ? "Metrics below were measured via the YouTube Analytics API."
                          : metrics.isOAuthConnected
                          ? "YouTube Analytics is connected. Video-level watch time, retention, and traffic metrics are still aggregating in YouTube's 48–72h processing window; views are synced from the video catalog."
                          : "YouTube Analytics is not connected, so most performance metrics are unavailable for this video."}
                      </p>
                      {Array.isArray(metrics.unavailableMetrics) && metrics.unavailableMetrics.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1.5">
                            Not available
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {metrics.unavailableMetrics.map((m, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: RETENTION & HOOK DIAGNOSIS */}
            {activeTab === "retention" && (
              <div className="flex flex-col gap-6">
                {/* SVG Retention Graph */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-white">Audience Retention Curve</h3>
                      <p className="text-xs text-slate-400">
                        {metrics.retentionCurve
                          ? "Measured retention across the video, plotted as percentage of video elapsed."
                          : "Retention data is not available for this video."}
                      </p>
                    </div>
                    {metrics.hookDropPercent != null && (
                      <div className="text-xs font-mono px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-cyan-400">
                        30s Drop: -{metrics.hookDropPercent}%
                      </div>
                    )}
                  </div>

                  {/* Visual Chart */}
                  {metrics.retentionCurve ? (
                    <RetentionChart
                      curve={metrics.retentionCurve}
                      cliff={metrics.retentionCliff?.detected ? metrics.retentionCliff : null}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-40 rounded-xl border border-dashed border-slate-800 bg-slate-950/40">
                      <p className="text-xs text-slate-500 text-center px-6">
                        {metrics?.isOAuthConnected
                          ? "Audience retention curve is still processing in YouTube Analytics. YouTube typically takes 48–72 hours after upload to generate retention data."
                          : "No measured retention curve. Connect YouTube Analytics in Admin Settings to see the real curve for this video."}
                      </p>
                    </div>
                  )}
                </div>

                {/* Hook & Pacing Diagnosis */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                    <div className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-2">
                      Hook Verdict (First 30 Seconds)
                    </div>
                    <div className="text-sm font-bold text-white mb-1">
                      {evaluation.hook_diagnosis?.diagnosis_type || "Intro Assessment"}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {evaluation.hook_diagnosis?.analysis ||
                        evaluation.hook_diagnosis?.verdict ||
                        "Analyze the intro hook to ensure the premise is stated in the first 10 seconds."}
                    </p>
                  </div>

                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                    <div className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-2">
                      Mid-Video & Sponsor Read Retention
                    </div>
                    <div className="text-sm font-bold text-white mb-1">Pacing & Engagement Flow</div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {evaluation.monetization_insights?.ad_read_retention ||
                        "Retention stabilizes throughout the middle segment, demonstrating strong topic commitment."}
                    </p>
                  </div>
                </div>

                {/* Mid-Video Retention Cliff: steepest drop anywhere after the
                    first minute, paired with the transcript at that moment. */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Mid-Video Retention Cliff</span>
                  </div>
                  {!metrics.retentionCurve ? (
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Retention curve is not available for this video, so no drop-off point beyond the intro could be measured.
                    </p>
                  ) : metrics.retentionCliff === undefined ? (
                    <p className="text-xs text-amber-300/80 leading-relaxed">
                      This audit was generated before mid-video cliff detection was added. Click "Refresh Report" above to compute it for this video.
                    </p>
                  ) : !metrics.retentionCliff.detected ? (
                    <p className="text-xs text-slate-300 leading-relaxed">
                      No significant drop-off (5+ points within a 5% span) was measured after the first minute. Retention declines gradually rather than falling off a cliff.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">
                          -{metrics.retentionCliff.dropPoints} points between {metrics.retentionCliff.startFormatted} and {metrics.retentionCliff.endFormatted}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-500/30 text-amber-300 font-mono">
                          {metrics.retentionCliff.videoPercentStart}%–{metrics.retentionCliff.videoPercentEnd}% through the video
                        </span>
                      </div>

                      {metrics.retentionCliff.transcriptSegment ? (
                        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">
                            What was said at this point
                          </div>
                          <p className="text-xs text-slate-300 italic leading-relaxed">
                            "{metrics.retentionCliff.transcriptSegment}"
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          No transcript could be aligned to this timestamp.
                        </p>
                      )}

                      <p className="text-xs text-slate-300 leading-relaxed">
                        {evaluation.retention_cliff?.diagnosis ||
                          "Regenerate this audit to have Gemini diagnose this drop against the transcript."}
                      </p>

                      {evaluation.retention_cliff?.fix && evaluation.retention_cliff.fix !== "No action needed" && (
                        <div className="flex items-start gap-2 bg-cyan-950/30 border border-cyan-500/20 rounded-xl p-3">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-cyan-200 leading-relaxed">{evaluation.retention_cliff.fix}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: TITLE & THUMBNAIL CRITIQUE */}
            {activeTab === "packaging" && (
              <div className="flex flex-col gap-6">
                {/* Current Packaging Inspection */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-white mb-4">Current Packaging Visual Analysis</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Thumbnail Image */}
                    <div className="flex flex-col gap-2">
                      <div className="relative rounded-xl overflow-hidden border border-slate-700 shadow-xl aspect-video bg-slate-900">
                        <img
                          src={
                            metrics.thumbnail_url ||
                            `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`
                          }
                          alt={videoTitle}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.target.src = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
                          }}
                        />
                        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-slate-950/90 text-[10px] font-mono text-slate-200 font-bold">
                          {metrics.durationFormatted}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 text-center font-mono">
                        CTR: {metrics.ctr}% vs 5.0% channel baseline
                      </span>
                    </div>

                    {/* AI Vision Critique */}
                    <div className="md:col-span-2 space-y-3">
                      <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl">
                        <div className="text-xs font-bold text-cyan-400 mb-1">Thumbnail Vision Critique</div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {evaluation.title_thumb_critique?.thumbnail_critique?.mobile_legibility ||
                            "Text size is legible on desktop, but contrast against dark backgrounds can be improved for mobile feed scrolling."}
                        </p>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl">
                        <div className="text-xs font-bold text-blue-400 mb-1">Title Curiosity & Value Prop</div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {evaluation.title_thumb_critique?.title_critique?.value_prop ||
                            "Accurately informs existing subscribers, but adding a curiosity hook increases Browse click-through."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3-5 Alternative Title / Thumbnail Concepts */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-bold text-white">AI-Generated Alternative Concepts</h3>
                    <span className="text-[10px] text-slate-400 font-mono">(Grounded in CTR & Retention Data)</span>
                  </div>

                  <div className="space-y-4">
                    {(evaluation.title_thumb_critique?.alternative_concepts || []).map((concept, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 p-4 rounded-xl transition-all"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-cyan-300">Concept {idx + 1}</span>
                              {concept.thumbnail_text && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-yellow-300 border border-yellow-500/30">
                                  Thumb Text: "{concept.thumbnail_text}"
                                </span>
                              )}
                            </div>
                            <div className="text-sm font-bold text-white">{concept.title}</div>
                            <p className="text-xs text-slate-400 leading-relaxed">{concept.rationale}</p>
                            {concept.thumbnail_visual && (
                              <div className="text-[11px] text-slate-400 italic bg-slate-950/60 px-3 py-1.5 rounded-lg border border-slate-800">
                                🎨 Visual: {concept.thumbnail_visual}
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => copyToClipboard(concept.title, idx)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors shrink-0"
                          >
                            {copiedIndex === idx ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-400">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy Title</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: DISCOVERY 2x2 MATRIX */}
            {activeTab === "discovery" && (
              <div className="flex flex-col gap-6">
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-white mb-2">Discovery 2x2 Performance Matrix</h3>
                  <p className="text-xs text-slate-400 mb-4">
                    Diagnosing whether underperformance stems from Packaging (Thumbnail/Title CTR) vs Algorithm Distribution (Impressions).
                  </p>

                  {(metrics?.impressions == null || metrics?.ctr == null) && (
                    <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-950/30 p-4">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-amber-300 mb-1">
                            {metrics?.isOAuthConnected
                              ? "Awaiting YouTube Reporting API reach compilation"
                              : "Quadrant cannot be determined"}
                          </div>
                          <p className="text-xs text-amber-200/80 leading-relaxed">
                            {metrics?.isOAuthConnected
                              ? "This matrix requires impressions and impressions click-through rate. Google compiles these bulk reach reports daily via the YouTube Reporting API (channel_reach_basic_a1). Once Google compiles reach data for this video, refreshing this report will unlock the matrix."
                              : "This matrix requires impressions and impressions click-through rate. Connect YouTube Analytics in Admin Settings to ingest daily reach reports from Google."}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Quadrant 1 */}
                    <div
                      className={`p-4 rounded-2xl border transition-all ${
                        evaluation.discovery_matrix?.quadrant_number === 1
                          ? "bg-emerald-950/50 border-emerald-500/50 shadow-lg shadow-emerald-500/10"
                          : "bg-slate-900/40 border-slate-800 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-emerald-300">Q1: High Impressions / High CTR</span>
                        {evaluation.discovery_matrix?.quadrant_number === 1 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            Current Match
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-white">Star Performer</div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Packaging converts browse traffic at scale. Double down with series playlists.
                      </p>
                    </div>

                    {/* Quadrant 2 */}
                    <div
                      className={`p-4 rounded-2xl border transition-all ${
                        evaluation.discovery_matrix?.quadrant_number === 2
                          ? "bg-amber-950/50 border-amber-500/50 shadow-lg shadow-amber-500/10"
                          : "bg-slate-900/40 border-slate-800 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-amber-300">Q2: High Impressions / Low CTR</span>
                        {evaluation.discovery_matrix?.quadrant_number === 2 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            Current Match
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-white">Packaging Bottleneck</div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Algorithm is pushing the video, but thumbnail/title is failing to convert clicks. Retitle & re-thumbnail.
                      </p>
                    </div>

                    {/* Quadrant 3 */}
                    <div
                      className={`p-4 rounded-2xl border transition-all ${
                        evaluation.discovery_matrix?.quadrant_number === 3
                          ? "bg-blue-950/50 border-blue-500/50 shadow-lg shadow-blue-500/10"
                          : "bg-slate-900/40 border-slate-800 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-blue-300">Q3: Low Impressions / High CTR</span>
                        {evaluation.discovery_matrix?.quadrant_number === 3 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">
                            Current Match
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-white">Distribution Bottleneck</div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Packaging is strong, but algorithm isn't testing it. Push via search keywords, end-screens, and community posts.
                      </p>
                    </div>

                    {/* Quadrant 4 */}
                    <div
                      className={`p-4 rounded-2xl border transition-all ${
                        evaluation.discovery_matrix?.quadrant_number === 4
                          ? "bg-red-950/50 border-red-500/50 shadow-lg shadow-red-500/10"
                          : "bg-slate-900/40 border-slate-800 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-red-300">Q4: Low Impressions / Low CTR</span>
                        {evaluation.discovery_matrix?.quadrant_number === 4 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">
                            Current Match
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-white">Niche / Topic Overhaul</div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Topic has low search intent or weak hook. Evergreen guide repositioning required.
                      </p>
                    </div>
                  </div>

                  {/* Diagnosis Commentary */}
                  <div className="mt-5 p-4 rounded-xl bg-slate-900/90 border border-slate-800">
                    <div className="text-xs font-bold text-cyan-400 mb-1">Strategy Recommendation</div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {evaluation.discovery_matrix?.strategy ||
                        evaluation.discovery_matrix?.diagnosis ||
                        "Focus on increasing thumbnail contrast and keyword placement in the description."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: ACTION PLAN & SEARCH SEO */}
            {activeTab === "actions" && (
              <div className="flex flex-col gap-6">
                {/* 3-5 Concrete Action Items */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-white mb-4">Prioritized Action Items</h3>
                  <div className="space-y-3">
                    {(evaluation.action_items || []).map((item, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl flex items-start gap-3.5"
                      >
                        <div className="w-6 h-6 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                          {item.priority || idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {item.category}
                            </span>
                            {item.impact && (
                              <span className="text-[10px] font-bold text-emerald-400">
                                {item.impact}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-200 leading-relaxed font-medium">{item.action}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Search & SEO Intelligence */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-white mb-2">Search & Keyword Intelligence</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                    <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                      <div className="text-xs font-bold text-cyan-400 mb-2">Top Search Queries Driving Views</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(evaluation.search_seo_analysis?.top_captured_terms || []).map(
                          (t, i) => (
                            <span
                              key={i}
                              className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-950 text-slate-300 border border-slate-800"
                            >
                              🔍 {t}
                            </span>
                          )
                        )}
                      </div>
                    </div>

                    <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                      <div className="text-xs font-bold text-blue-400 mb-2">SEO Optimization Tip</div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {evaluation.search_seo_analysis?.actionable_seo_tip ||
                          "Ensure primary search keywords appear in the title, first 2 lines of the description, and thumbnail filename."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          </>
        )}

        {/* Quick Paste Modal */}
        {quickPasteOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
            <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-base font-bold text-white">Quick Paste Transcript</h3>
                </div>
                <button
                  onClick={() => setQuickPasteOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="text-xs text-slate-300 bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col gap-2">
                <div className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>How to copy from YouTube:</span>
                  <a
                    href={`https://www.youtube.com/watch?v=${youtubeId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-cyan-400 hover:underline font-mono text-[11px]"
                  >
                    Open on YouTube <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                  <li>Click <b>... (More)</b> under the video &rarr; <b>Show transcript</b></li>
                  <li>Click the 3 dots in the transcript box &rarr; toggle timestamps off or on</li>
                  <li>Select all text in the transcript box, copy, and paste below:</li>
                </ol>
              </div>

              {quickPasteError && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-800/60 p-2.5 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{quickPasteError}</span>
                </div>
              )}

              <textarea
                value={quickPasteText}
                onChange={(e) => setQuickPasteText(e.target.value)}
                placeholder="0:00 In this video we test the Porsche Taycan...&#10;0:15 With 800-volt charging architecture..."
                rows={8}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl p-3 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setQuickPasteOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePasteCaptions}
                  disabled={savingPaste || !quickPasteText.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{savingPaste ? "Cleaning EV terms…" : "Save & Clean EV Captions"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Headline badge for a single video's Viewer Satisfaction Score. Colors by
// band (>=70 strong, >=40 mixed, below that soft) since the underlying scale
// is a disclosed heuristic, not an official cutoff -- mirrors the Channel
// Health version of this badge.
function SatisfactionBadge({ score }) {
  const band = score >= 70 ? "emerald" : score >= 40 ? "amber" : "red";
  const bandClasses = {
    emerald: "from-emerald-500/25 to-emerald-500/5 border-emerald-500/40",
    amber: "from-amber-500/25 to-amber-500/5 border-amber-500/40",
    red: "from-red-500/25 to-red-500/5 border-red-500/40",
  }[band];

  return (
    <div
      className={`w-full sm:w-28 shrink-0 rounded-xl bg-gradient-to-br ${bandClasses} border flex flex-col items-center justify-center p-4 gap-1`}
    >
      <div className="text-3xl font-black tracking-tight text-white">{score}</div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-300/80">out of 100</div>
    </div>
  );
}

function StatusPill({ label, status, detail }) {
  const isUnavailable = status === "unavailable";
  const isPass = status === "pass";
  const isWarn = status === "warn";
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between min-w-0">
      <div className="text-[10px] text-slate-400 font-medium truncate">{label}</div>
      <div className="flex items-center gap-1.5 mt-1 min-w-0">
        {isUnavailable ? (
          <MinusCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        ) : isPass ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        ) : isWarn ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        )}
        <span
          className={`text-xs font-bold font-mono truncate ${
            isUnavailable ? "text-slate-500" : isPass ? "text-emerald-300" : isWarn ? "text-amber-300" : "text-red-300"
          }`}
          title={detail}
        >
          {detail}
        </span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-[11px] font-medium">{label}</span>
        <Icon className="w-3.5 h-3.5 opacity-60" />
      </div>
      <div className="mt-2">
        <div className={`text-base sm:text-lg font-black font-mono ${color}`}>{value}</div>
        {sub && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function ProgressBar({ label, pct, color }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1 font-medium">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400 font-mono font-bold">{pct}%</span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
        <div className={`${color} h-full rounded-full transition-all`} style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
}

function RetentionChart({ curve, cliff }) {
  if (!curve || curve.length === 0) return null;

  // Simple clean SVG line chart for retention curve
  const points = curve.map((c, i) => {
    const x = (i / (curve.length - 1)) * 100;
    const y = 100 - c.pct; // 0% at bottom (y=100), 100% at top (y=0)
    return `${x},${y}`;
  });
  const polylineStr = points.join(" ");

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="relative w-full h-40 bg-slate-900/60 rounded-xl border border-slate-800 p-2 overflow-hidden">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          {/* Grid lines */}
          <line x1="0" y1="25" x2="100" y2="25" stroke="#334155" strokeDasharray="2,2" strokeWidth="0.5" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="#334155" strokeDasharray="2,2" strokeWidth="0.5" />
          <line x1="0" y1="75" x2="100" y2="75" stroke="#334155" strokeDasharray="2,2" strokeWidth="0.5" />

          {/* Mid-video retention cliff highlight, drawn behind the curve */}
          {cliff && (
            <rect
              x={cliff.videoPercentStart}
              y="0"
              width={Math.max(1, cliff.videoPercentEnd - cliff.videoPercentStart)}
              height="100"
              fill="#f59e0b"
              opacity="0.18"
            />
          )}

          {/* Area fill */}
          <polygon
            points={`0,100 ${polylineStr} 100,100`}
            fill="url(#retentionGradient)"
            opacity="0.25"
          />

          {/* Line */}
          <polyline
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2.5"
            points={polylineStr}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <defs>
            <linearGradient id="retentionGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Axis Labels */}
      <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
        {curve.map((c, idx) => (
          <span key={idx} className="truncate">
            {c.time}: {c.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}
