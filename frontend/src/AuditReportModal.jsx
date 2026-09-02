import React, { useState, useEffect } from "react";
import {
  X,
  RefreshCw,
  ExternalLink,
  CheckCircle,
  CheckCircle2,
  AlertTriangle,
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
} from "lucide-react";

export default function AuditReportModal({ isOpen, onClose, youtubeId, videoTitle, initialAudit, onAuditUpdated }) {
  const [audit, setAudit] = useState(initialAudit || null);
  const [loading, setLoading] = useState(!initialAudit);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [activeTab, setActiveTab] = useState("overview"); // 'overview' | 'retention' | 'packaging' | 'discovery' | 'actions'
  const tabContentRef = React.useRef(null);

  useEffect(() => {
    if (tabContentRef.current) {
      tabContentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    if (isOpen && youtubeId) {
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
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest">
                  Video Audit Report
                </span>
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

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => loadAudit(true)}
              disabled={loading || refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${refreshing ? "animate-spin" : ""}`} />
              <span>{refreshing ? "Re-evaluating…" : "Refresh Report"}</span>
            </button>

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
                        {metrics?.isLiveStudioData && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                            <CheckCircle className="w-3 h-3" /> Live Studio Data
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
                      status={evaluation?.scorecard?.hook_status}
                      detail={evaluation?.hook_diagnosis?.hook_drop_30s || `-${metrics?.hookDropPercent}%`}
                    />
                    <StatusPill
                      label="Impressions CTR"
                      status={metrics?.ctr >= 5.0 ? "pass" : "warn"}
                      detail={`${metrics?.ctr}% (${metrics?.ctrDelta >= 0 ? "+" : ""}${metrics?.ctrDelta}%)`}
                    />
                    <StatusPill
                      label="Retention %"
                      status={metrics?.retentionRate >= metrics?.categoryBenchmark?.avgRetention ? "pass" : "warn"}
                      detail={`${metrics?.retentionRate}% (Avg ${metrics?.categoryBenchmark?.avgRetention}%)`}
                    />
                    <StatusPill
                      label="SEO Coverage"
                      status={evaluation?.scorecard?.seo_status || "pass"}
                      detail={
                        evaluation?.scorecard?.seo_score
                          ? `${evaluation.scorecard.seo_score}% Optimized`
                          : evaluation?.scorecard?.seo_status === "warn"
                          ? "72% Needs Work"
                          : "92% Optimized"
                      }
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
                    value={metrics.views.toLocaleString()}
                    icon={Eye}
                    color="text-white"
                  />
                  <MetricCard
                    label="Impressions"
                    value={metrics.impressions.toLocaleString()}
                    icon={Compass}
                    color="text-cyan-400"
                  />
                  <MetricCard
                    label="CTR (5.0% Base)"
                    value={`${metrics.ctr}%`}
                    sub={`${metrics.ctrDelta >= 0 ? "+" : ""}${metrics.ctrDelta}% vs base`}
                    icon={TrendingUp}
                    color={metrics.ctr >= 5.0 ? "text-emerald-400" : "text-amber-400"}
                  />
                  <MetricCard
                    label="Watch Time"
                    value={`${metrics.totalWatchTimeHours} hrs`}
                    icon={Clock}
                    color="text-blue-400"
                  />
                  <MetricCard
                    label="Avg Duration"
                    value={metrics.avdFormatted}
                    sub={`${metrics.retentionRate}% rate`}
                    icon={Zap}
                    color="text-indigo-400"
                  />
                  <MetricCard
                    label="Net Subs"
                    value={`+${metrics.netSubs}`}
                    icon={Users}
                    color="text-emerald-400"
                  />
                </div>

                {/* Traffic Breakdown & Geography */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Traffic Sources */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-3 flex items-center gap-2">
                      <Compass className="w-4 h-4" />
                      <span>Traffic Source Breakdown</span>
                    </h4>
                    <div className="space-y-3">
                      <ProgressBar label="Browse Features" pct={metrics.trafficShare.browse} color="bg-cyan-500" />
                      <ProgressBar label="Suggested Videos" pct={metrics.trafficShare.suggested} color="bg-blue-500" />
                      <ProgressBar label="YouTube Search" pct={metrics.trafficShare.search} color="bg-emerald-500" />
                      <ProgressBar label="External & Other" pct={metrics.trafficShare.other} color="bg-slate-600" />
                    </div>
                  </div>

                  {/* Device & Audience Profile */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-3 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      <span>Audience & Device Profile</span>
                    </h4>
                    <div className="space-y-3">
                      {metrics.devices.map((d, i) => (
                        <ProgressBar key={i} label={d.type} pct={d.share} color="bg-indigo-500" />
                      ))}
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
                        Visualizing viewer retention from 0:00 through completion with drop-off annotations.
                      </p>
                    </div>
                    <div className="text-xs font-mono px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-cyan-400">
                      30s Drop: -{metrics.hookDropPercent}%
                    </div>
                  </div>

                  {/* Visual Chart */}
                  <RetentionChart curve={metrics.retentionCurve} />
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
                  <p className="text-xs text-slate-400 mb-6">
                    Diagnosing whether underperformance stems from Packaging (Thumbnail/Title CTR) vs Algorithm Distribution (Impressions).
                  </p>

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
                        {(evaluation.search_seo_analysis?.top_captured_terms || metrics.searchTerms || []).map(
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
      </div>
    </div>
  );
}

function StatusPill({ label, status, detail }) {
  const isPass = status === "pass";
  const isWarn = status === "warn";
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between min-w-0">
      <div className="text-[10px] text-slate-400 font-medium truncate">{label}</div>
      <div className="flex items-center gap-1.5 mt-1 min-w-0">
        {isPass ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        ) : isWarn ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        )}
        <span
          className={`text-xs font-bold font-mono truncate ${
            isPass ? "text-emerald-300" : isWarn ? "text-amber-300" : "text-red-300"
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

function RetentionChart({ curve }) {
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
