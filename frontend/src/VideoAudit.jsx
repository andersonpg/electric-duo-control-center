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
  DownloadCloud,
  UploadCloud,
  RefreshCw,
  FileText,
  Check,
  AlertCircle,
  ExternalLink,
  X,
} from "lucide-react";
import AuditReportModal from "./AuditReportModal";

export default function VideoAudit({ currentUser, initialVideoId, onClearInitialVideoId, onSelectVideoForTranscript }) {
  const [videos, setVideos] = useState([]);
  const [auditsSummary, setAuditsSummary] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [auditFilter, setAuditFilter] = useState("all"); // 'all' | 'audited' | 'unaudited'
  const [captionFilter, setCaptionFilter] = useState("all"); // 'all' | 'none' | 'unfixed' | 'fixed' | 'uploaded'
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [retrievingCaptions, setRetrievingCaptions] = useState({});
  const [cleaningCaptions, setCleaningCaptions] = useState({});
  const [uploadingCaptions, setUploadingCaptions] = useState({});
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, video: null, message: "", onConfirm: null });
  const [quickPasteModal, setQuickPasteModal] = useState({ isOpen: false, video: null, youtubeUrl: "", text: "" });
  const [savingPaste, setSavingPaste] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchCatalogAndAudits();
    fetchCategories();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchCategories = async () => {
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

  useEffect(() => {
    if (initialVideoId && videos.length > 0) {
      const match = videos.find((v) => v.youtube_id === initialVideoId);
      if (match) {
        setSelectedVideo(match);
        setIsModalOpen(true);
      }
      if (onClearInitialVideoId) onClearInitialVideoId();
    }
  }, [initialVideoId, videos]);

  const fetchCatalogAndAudits = async () => {
    setLoading(true);
    try {
      const [videosRes, auditsRes] = await Promise.all([
        fetch("/api/videos?status=all&privacy=public&excludeShorts=true", { credentials: "same-origin" }),
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

  const handleRetrieveCaptions = async (video, force = false) => {
    const hasCaptions = video.caption_status && video.caption_status !== "none";
    if (!force && hasCaptions) {
      setConfirmModal({
        isOpen: true,
        video,
        message: `Captions already exist for "${video.title}". Are you sure you want to re-download raw captions from YouTube? Any existing cleaned SRT edits will be overwritten.`,
        onConfirm: () => handleRetrieveCaptions(video, true),
      });
      return;
    }

    setConfirmModal({ isOpen: false, video: null, message: "", onConfirm: null });
    setRetrievingCaptions((prev) => ({ ...prev, [video.youtube_id]: true }));

    try {
      const res = await fetch(`/api/videos/${video.youtube_id}/captions/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite: force }),
        credentials: "same-origin",
      });
      const data = await res.json();

      if (res.status === 409 && data.promptConfirmation) {
        setConfirmModal({
          isOpen: true,
          video,
          message: data.message || `Captions already exist for this video. Overwrite?`,
          onConfirm: () => handleRetrieveCaptions(video, true),
        });
        return;
      }

      if (!res.ok) {
        if (data.isScopeError) {
          setToast({
            type: "error",
            text: data.error || "The YouTube connection is missing the youtube.force-ssl permission and must be reconnected in Admin Settings.",
            actionText: "Reconnect YouTube in Admin Settings",
            actionUrl: "/?module=admin",
          });
          return;
        }
        if (data.canQuickPaste || data.isCloudIpBlock) {
          setQuickPasteModal({
            isOpen: true,
            video,
            youtubeUrl: data.youtubeUrl || `https://www.youtube.com/watch?v=${video.youtube_id}`,
            text: "",
          });
          return;
        }
        throw new Error(data.error || "Failed to retrieve captions");
      }

      const newStatus = data.status || "unfixed";
      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === video.youtube_id ? { ...v, caption_status: newStatus } : v
        )
      );
      setToast({
        type: "success",
        text: `Retrieved ${data.chunkCount || ""} caption chunks from YouTube! Status: ${newStatus === "fixed" ? "Fixed Captions" : "Unfixed Captions"}.`,
      });
    } catch (err) {
      setToast({ type: "error", text: err.message });
    } finally {
      setRetrievingCaptions((prev) => ({ ...prev, [video.youtube_id]: false }));
    }
  };

  const handlePasteCaptions = async (video, text) => {
    if (!text || !text.trim()) {
      setToast({ type: "error", text: "Please paste a transcript before submitting." });
      return;
    }
    setSavingPaste(true);
    try {
      const res = await fetch(`/api/videos/${video.youtube_id}/captions/paste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save transcript");

      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === video.youtube_id ? { ...v, caption_status: "fixed" } : v
        )
      );
      setQuickPasteModal({ isOpen: false, video: null, youtubeUrl: "", text: "" });
      setToast({
        type: "success",
        text: `Successfully converted, saved & cleaned EV terms for ${data.chunkCount || ""} cues! Status: Fixed Captions.`,
      });
    } catch (err) {
      setToast({ type: "error", text: err.message });
    } finally {
      setSavingPaste(false);
    }
  };

  const handleCleanCaptions = async (video) => {
    setCleaningCaptions((prev) => ({ ...prev, [video.youtube_id]: true }));
    try {
      const res = await fetch(`/api/videos/${video.youtube_id}/captions/clean`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to clean captions");

      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === video.youtube_id ? { ...v, caption_status: "fixed" } : v
        )
      );
      const correctionsCount = data.summary?.length || 0;
      setToast({
        type: "success",
        text: `Cleaned captions with EV vocabulary! (${correctionsCount} correction rule${correctionsCount === 1 ? "" : "s"} applied)`,
      });
    } catch (err) {
      setToast({ type: "error", text: err.message });
    } finally {
      setCleaningCaptions((prev) => ({ ...prev, [video.youtube_id]: false }));
    }
  };

  const handleUploadCaptions = async (video) => {
    setUploadingCaptions((prev) => ({ ...prev, [video.youtube_id]: true }));
    try {
      const res = await fetch(`/api/videos/${video.youtube_id}/captions/upload`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload clean captions to YouTube");

      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === video.youtube_id ? { ...v, caption_status: "uploaded" } : v
        )
      );
      setToast({
        type: "success",
        text: `Clean captions uploaded to YouTube as "English (Edited)"!`,
      });
    } catch (err) {
      setToast({ type: "error", text: err.message });
    } finally {
      setUploadingCaptions((prev) => ({ ...prev, [video.youtube_id]: false }));
    }
  };

  const isShortVideo = (v) => {
    const titleLower = (v.title || "").toLowerCase();
    if (titleLower.includes("#shorts") || titleLower.includes("shorts")) return true;
    if (!v.duration) return false;
    const match = v.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (match) {
      const h = parseInt(match[1] || "0", 10);
      const m = parseInt(match[2] || "0", 10);
      const s = parseInt(match[3] || "0", 10);
      const sec = h * 3600 + m * 60 + s;
      if (sec < 240) return true;
    }
    return false;
  };

  // Filtered list of videos
  const filteredVideos = videos.filter((v) => {
    // Strictly exclude unlisted videos and Shorts (< 4 minutes)
    if (v.privacy_status && v.privacy_status !== "public") return false;
    if (isShortVideo(v)) return false;

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

    const cStatus = v.caption_status || "none";
    const matchesCaption =
      captionFilter === "all" ||
      (captionFilter === "none" && (cStatus === "none" || !v.caption_status)) ||
      captionFilter === cStatus;

    return matchesSearch && matchesCategory && matchesAudit && matchesCaption;
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
      {/* Toast Feedback Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce-short">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold backdrop-blur-xl ${
              toast.type === "success"
                ? "bg-emerald-950/90 text-emerald-200 border-emerald-500/40"
                : "bg-rose-950/90 text-rose-200 border-rose-500/40"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{toast.text}</span>
            {toast.actionUrl && (
              <a
                href={toast.actionUrl}
                className="px-2.5 py-1 rounded-lg bg-red-500/30 hover:bg-red-500/40 text-white border border-red-500/50 text-[11px] font-bold underline shrink-0 transition-colors"
              >
                {toast.actionText || "Action"}
              </a>
            )}
            <button
              onClick={() => setToast(null)}
              className="ml-2 text-slate-400 hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Overwriting Captions */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-750 p-6 rounded-3xl max-w-md w-full shadow-2xl border-slate-800 space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Overwrite Captions?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmModal({ isOpen: false, video: null, message: "", onConfirm: null })}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-bold text-slate-950 shadow-md shadow-amber-500/20 transition-all"
              >
                Yes, Retrieve & Overwrite
              </button>
            </div>
          </div>
        </div>
      )}

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

          <div className="flex items-center gap-3">
            <div className="bg-slate-950/80 border border-slate-800 px-4 py-2 rounded-2xl flex flex-col items-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Audited</span>
              <span className="text-base font-extrabold text-cyan-400 font-mono">
                {totalAudited} / {filteredVideos.length}
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
          Evaluate any video across your 500+ back catalog. Includes <b>caption track status</b>, <b>auto-caption retrieval</b>, deterministic <b>EV terminology cleanup</b>, and <b>direct YouTube subtitle track publishing</b>.
        </p>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[240px]">
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
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id || c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Audit Status Filter */}
        <div className="flex items-center gap-2">
          <select
            value={auditFilter}
            onChange={(e) => setAuditFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Audits</option>
            <option value="audited">Audited Only</option>
            <option value="unaudited">Needs Audit Only</option>
          </select>
        </div>

        {/* Caption Status Filter */}
        <div className="flex items-center gap-2">
          <select
            value={captionFilter}
            onChange={(e) => setCaptionFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
          >
            <option value="all">All Captions</option>
            <option value="none">No Captions</option>
            <option value="unfixed">Unfixed Captions</option>
            <option value="fixed">Fixed Captions</option>
            <option value="uploaded">Uploaded to YouTube</option>
          </select>
        </div>
      </div>

      {/* Video Cards Grid */}
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
            const captionStatus = video.caption_status || "none";

            const isRetrieving = !!retrievingCaptions[video.youtube_id];
            const isCleaning = !!cleaningCaptions[video.youtube_id];
            const isUploading = !!uploadingCaptions[video.youtube_id];

            return (
              <div
                key={video.youtube_id}
                className="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4 flex flex-col justify-between gap-3.5 transition-all shadow-lg hover:shadow-cyan-500/5 group"
              >
                <div className="space-y-3">
                  {/* Thumbnail & Badges */}
                  <div className="relative rounded-xl overflow-hidden aspect-video bg-slate-950 border border-slate-800">
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

                  {/* Title & Date */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-100 line-clamp-2 leading-relaxed mb-1.5">
                      {video.title}
                    </h3>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                      <Calendar className="w-3 h-3 text-slate-500" />
                      <span>{formatDate(video.published_at)}</span>
                    </div>
                  </div>

                  {/* Caption Track Status & Quick Actions */}
                  <div className="pt-2.5 pb-1 border-t border-slate-800/80 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase font-bold text-slate-500">Captions:</span>
                        {captionStatus === "none" && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800/90 text-slate-400 border border-slate-700">
                            No Captions
                          </span>
                        )}
                        {captionStatus === "unfixed" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40">
                            <AlertTriangle className="w-2.5 h-2.5" /> Unfixed Captions
                          </span>
                        )}
                        {captionStatus === "fixed" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Fixed Captions
                          </span>
                        )}
                        {captionStatus === "uploaded" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Uploaded
                          </span>
                        )}
                      </div>

                      {onSelectVideoForTranscript && (
                        <button
                          onClick={() => onSelectVideoForTranscript(video.youtube_id)}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium underline-offset-2 hover:underline inline-flex items-center gap-1"
                          title="Open in Transcript Review Studio"
                        >
                          <FileText className="w-2.5 h-2.5" /> Review
                        </button>
                      )}
                    </div>

                    {/* Caption Action Buttons */}
                    <div className="flex items-center gap-1.5">
                      {captionStatus === "none" && (
                        <div className="flex-1 flex items-center gap-1.5">
                          <button
                            onClick={() => handleRetrieveCaptions(video)}
                            disabled={isRetrieving}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 hover:border-slate-600 transition-all disabled:opacity-50"
                          >
                            <DownloadCloud className={`w-3 h-3 text-cyan-400 ${isRetrieving ? "animate-bounce" : ""}`} />
                            <span>{isRetrieving ? "Retrieving…" : "Retrieve Captions"}</span>
                          </button>
                          <button
                            onClick={() =>
                              setQuickPasteModal({
                                isOpen: true,
                                video,
                                youtubeUrl: `https://www.youtube.com/watch?v=${video.youtube_id}`,
                                text: "",
                              })
                            }
                            className="px-2 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 text-[11px] border border-slate-700 transition-all"
                            title="Paste transcript directly from YouTube"
                          >
                            <FileText className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {captionStatus === "unfixed" && (
                        <>
                          <button
                            onClick={() => handleCleanCaptions(video)}
                            disabled={isCleaning}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-semibold border border-amber-500/30 transition-all disabled:opacity-50"
                          >
                            <Sparkles className={`w-3 h-3 text-amber-400 ${isCleaning ? "animate-spin" : ""}`} />
                            <span>{isCleaning ? "Cleaning…" : "Clean Captions"}</span>
                          </button>
                          <button
                            onClick={() => handleRetrieveCaptions(video)}
                            disabled={isRetrieving}
                            className="px-2 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-[11px] border border-slate-700 transition-all"
                            title="Re-download raw captions from YouTube"
                          >
                            <RefreshCw className={`w-3 h-3 ${isRetrieving ? "animate-spin" : ""}`} />
                          </button>
                        </>
                      )}

                      {(captionStatus === "fixed" || captionStatus === "uploaded") && (
                        <>
                          <button
                            onClick={() => handleUploadCaptions(video)}
                            disabled={isUploading}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-50 border ${
                              captionStatus === "uploaded"
                                ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                : "bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border-cyan-500/30 shadow-sm"
                            }`}
                          >
                            <UploadCloud className={`w-3 h-3 ${isUploading ? "animate-bounce" : ""}`} />
                            <span>
                              {isUploading
                                ? "Uploading…"
                                : captionStatus === "uploaded"
                                ? "Re-upload Clean Track"
                                : "Upload Clean Captions"}
                            </span>
                          </button>
                          <button
                            onClick={() => handleRetrieveCaptions(video)}
                            disabled={isRetrieving}
                            className="px-2 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-[11px] border border-slate-700 transition-all"
                            title="Re-download captions from YouTube"
                          >
                            <RefreshCw className={`w-3 h-3 ${isRetrieving ? "animate-spin" : ""}`} />
                          </button>
                        </>
                      )}
                    </div>
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
          onSelectVideoForTranscript={onSelectVideoForTranscript}
        />
      )}

      {/* Quick Paste Modal */}
      {quickPasteModal.isOpen && quickPasteModal.video && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-slate-100 truncate max-w-md">
                  Add Captions: {quickPasteModal.video.title}
                </h3>
              </div>
              <button
                onClick={() => setQuickPasteModal({ isOpen: false, video: null, youtubeUrl: "", text: "" })}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-4 space-y-3">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200/90 leading-relaxed">
                <span className="font-semibold text-amber-300">YouTube Cloud Server Restriction:</span> YouTube restricts automated transcript downloads from cloud servers. You can easily pull the transcript directly from YouTube in seconds:
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 text-xs">
                <div>
                  <span className="font-semibold text-slate-200">Step 1:</span> Open the video on YouTube, click <span className="text-cyan-300 font-medium">"...more"</span> below description $\rightarrow$ <span className="text-cyan-300 font-medium">"Show transcript"</span> and copy it.
                </div>
                <a
                  href={quickPasteModal.youtubeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-semibold text-xs border border-cyan-500/30 transition-all shrink-0 ml-2"
                >
                  <span>Open Video on YouTube</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Step 2: Paste the copied YouTube transcript (with or without timestamps) or .srt file:
                </label>
                <textarea
                  value={quickPasteModal.text}
                  onChange={(e) => setQuickPasteModal((prev) => ({ ...prev, text: e.target.value }))}
                  placeholder="0:00 Hello and welcome&#10;0:05 to Dallas Texas&#10;0:10 with the Mach E..."
                  rows={8}
                  className="w-full bg-slate-950/70 border border-slate-700 rounded-xl p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-all"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                onClick={() => setQuickPasteModal({ isOpen: false, video: null, youtubeUrl: "", text: "" })}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePasteCaptions(quickPasteModal.video, quickPasteModal.text)}
                disabled={savingPaste || !quickPasteModal.text.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{savingPaste ? "Saving & Cleaning…" : "Save & Clean EV Captions"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
