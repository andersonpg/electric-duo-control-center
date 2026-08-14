import React, { useState, useEffect } from "react";
import {
  Search,
  Filter,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Play,
  Calendar,
  Compass,
  Zap,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import AuditReportModal from "./AuditReportModal";

export default function VideoAudit({ currentUser }) {
  const [videos, setVideos] = useState([]);
  const [auditsSummary, setAuditsSummary] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [auditFilter, setAuditFilter] = useState("all"); // 'all' | 'audited' | 'unaudited'
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCatalogAndAudits();
  }, []);

  const fetchCatalogAndAudits = async () => {
    setLoading(true);
    try {
      const [videosRes, auditsRes] = await Promise.all([
        fetch("/api/videos?status=all", { credentials: "same-origin" }),
        fetch("/api/audits/summary", { credentials: "same-origin" }),
      ]);

      if (videosRes.status === 401 || auditsRes.status === 401) {
        window.location.href = "/login.html";
        return;
      }

      const videosData = await videosRes.json();
      const auditsData = await auditsRes.json();

      setVideos(Array.isArray(videosData) ? videosData : []);
      setAuditsSummary(auditsData || {});
    } catch (err) {
      console.error("Failed to load catalog or audits:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAudit = (video) => {
    setSelectedVideo(video);
    setIsModalOpen(true);
  };

  const handleAuditUpdated = (youtubeId, auditData) => {
    setAuditsSummary((prev) => ({
      ...prev,
      [youtubeId]: {
        healthScore: auditData.healthScore,
        updatedAt: auditData.updatedAt,
      },
    }));
  };

  // Filtered list of videos
  const filteredVideos = videos.filter((v) => {
    const matchesSearch =
      !searchQuery ||
      v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (v.description && v.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = categoryFilter === "all" || v.content_type === categoryFilter;

    const isAudited = !!auditsSummary[v.youtube_id];
    const matchesAudit =
      auditFilter === "all" ||
      (auditFilter === "audited" && isAudited) ||
      (auditFilter === "unaudited" && !isAudited);

    return matchesSearch && matchesCategory && matchesAudit;
  });

  // Calculate high-level stats
  const totalAudited = Object.keys(auditsSummary).length;
  const auditedScores = Object.values(auditsSummary).map((a) => a.healthScore).filter(Boolean);
  const avgHealthScore =
    auditedScores.length > 0
      ? Math.round(auditedScores.reduce((a, b) => a + b, 0) / auditedScores.length)
      : "--";

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-6 py-8 flex flex-col gap-6 font-sans">
      {/* Masthead Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400 mb-1 flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4" />
              <span>The Electric Duo · Diagnostic Video Audit Hub</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Video Audit & Diagnostics
            </h2>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-3">
            <div className="bg-slate-950/80 border border-slate-800 px-4 py-2 rounded-2xl flex flex-col items-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Audited</span>
              <span className="text-base font-extrabold text-cyan-400 font-mono">
                {totalAudited} / {videos.length}
              </span>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 px-4 py-2 rounded-2xl flex flex-col items-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Avg Score</span>
              <span className="text-base font-extrabold text-emerald-400 font-mono">
                {avgHealthScore} {avgHealthScore !== "--" && "/ 100"}
              </span>
            </div>
          </div>
        </div>

        <p className="text-slate-400 text-xs sm:text-sm mt-4 leading-relaxed max-w-3xl">
          Evaluate any video across your 500+ back catalog. Generates deep diagnostic evaluations including <b>30-second hook drop-off analysis</b>, <b>2x2 discovery matrix</b> (packaging vs algorithm bottleneck), <b>Gemini Vision thumbnail contrast inspection</b>, and 3-5 grounded alternative title concepts.
        </p>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[280px]">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search catalog videos by title or topic..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-medium"
          />
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Content Types</option>
            <option value="Review">Review</option>
            <option value="How-To / Instructional">How-To / Instructional</option>
            <option value="EV News">EV News</option>
            <option value="Road Trip / Vlog">Road Trip / Vlog</option>
          </select>
        </div>

        {/* Audit Status Filter */}
        <div className="flex items-center gap-2">
          <select
            value={auditFilter}
            onChange={(e) => setAuditFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Videos</option>
            <option value="audited">Audited Only</option>
            <option value="unaudited">Needs Audit Only</option>
          </select>
        </div>
      </div>

      {/* Video Cards Grid / Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400"></div>
          <span className="text-sm">Loading video catalog & audits…</span>
        </div>
      ) : filteredVideos.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <p className="text-sm font-medium">No videos found matching the current search filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVideos.map((video) => {
            const auditInfo = auditsSummary[video.youtube_id];
            const hasAudit = !!auditInfo;
            const score = auditInfo ? auditInfo.healthScore : null;

            return (
              <div
                key={video.youtube_id}
                className="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4 flex flex-col justify-between gap-4 transition-all shadow-lg hover:shadow-cyan-500/5 group"
              >
                <div>
                  {/* Thumbnail & Badges */}
                  <div className="relative rounded-xl overflow-hidden aspect-video bg-slate-950 border border-slate-800 mb-3">
                    <img
                      src={
                        video.thumbnail_url ||
                        `https://img.youtube.com/vi/${video.youtube_id}/maxresdefault.jpg`
                      }
                      alt={video.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        e.target.src = `https://img.youtube.com/vi/${video.youtube_id}/hqdefault.jpg`;
                      }}
                    />

                    {/* Content Type Badge */}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-slate-950/80 backdrop-blur-md text-[10px] font-bold text-cyan-300 border border-cyan-500/30">
                      {video.content_type || "Review"}
                    </span>

                    {/* Audit Health Score Badge */}
                    {hasAudit && (
                      <span
                        className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold backdrop-blur-md border ${
                          score >= 80
                            ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/40"
                            : score >= 65
                            ? "bg-cyan-950/90 text-cyan-300 border-cyan-500/40"
                            : "bg-amber-950/90 text-amber-300 border-amber-500/40"
                        }`}
                      >
                        Score: {score}
                      </span>
                    )}
                  </div>

                  {/* Title & Metadata */}
                  <h3 className="text-xs font-bold text-slate-100 line-clamp-2 leading-relaxed mb-1.5">
                    {video.title}
                  </h3>

                  <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                    <Calendar className="w-3 h-3 text-slate-500" />
                    <span>{formatDate(video.published_at)}</span>
                  </div>
                </div>

                {/* Audit Action Button */}
                <div>
                  <button
                    onClick={() => handleOpenAudit(video)}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md ${
                      hasAudit
                        ? "bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700"
                        : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-cyan-500/20"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-current" />
                    <span>{hasAudit ? "View Video Audit Report" : "Run Video Audit"}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Audit Modal */}
      {selectedVideo && (
        <AuditReportModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          youtubeId={selectedVideo.youtube_id}
          videoTitle={selectedVideo.title}
          onAuditUpdated={handleAuditUpdated}
        />
      )}
    </div>
  );
}
