import React, { useState, useEffect, useRef } from "react";
import {
  Newspaper,
  Globe,
  ExternalLink,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Search,
  Calendar,
  User,
  Plus,
  ArrowUpRight,
  Copy,
  Check,
  Filter,
  Trash2,
  FileText,
  Link as LinkIcon,
  ChevronLeft,
  ChevronRight,
  Zap,
  Play,
  Video,
} from "lucide-react";

// Clean YouTube SVG Icon
function YoutubeIcon({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

export default function FathomNews({ currentUser }) {
  // Submission Form State
  const [urlInput, setUrlInput] = useState("");
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [canManualEntry, setCanManualEntry] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  // Editable Draft Fields
  const [sourceType, setSourceType] = useState("article"); // 'article' | 'video'
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [youtubeVideoId, setYoutubeVideoId] = useState("");
  const [theTake, setTheTake] = useState("");
  const [previewLoaded, setPreviewLoaded] = useState(false);

  // Success / Result State
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // History & Table State
  const [historyItems, setHistoryItems] = useState([]);
  const [totalHistory, setTotalHistory] = useState(0);
  const [historyLimit] = useState(15);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("all");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSyncingStatus, setIsSyncingStatus] = useState(false);

  const previewCardRef = useRef(null);

  // Load history on mount and when filters/pagination change
  useEffect(() => {
    fetchHistory();
  }, [historyOffset, historySearch, historyStatusFilter, historyTypeFilter]);

  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.append("limit", String(historyLimit));
      params.append("offset", String(historyOffset));
      if (historySearch.trim()) params.append("search", historySearch.trim());
      if (historyStatusFilter !== "all") params.append("status", historyStatusFilter);
      if (historyTypeFilter !== "all") params.append("sourceType", historyTypeFilter);

      const res = await fetch(`/api/fathom-news/history?${params.toString()}`, {
        credentials: "same-origin",
      });

      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }

      const data = await res.json();
      if (data && Array.isArray(data.items)) {
        setHistoryItems(data.items);
        setTotalHistory(data.total || 0);
      }
    } catch (err) {
      console.error("Failed to fetch fathom news history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleSyncStatus = async () => {
    setIsSyncingStatus(true);
    try {
      await fetch("/api/fathom-news/sync-status", {
        method: "POST",
        credentials: "same-origin",
      });
      await fetchHistory();
    } catch (err) {
      console.error("Failed to sync statuses with WordPress:", err);
    } finally {
      setIsSyncingStatus(false);
    }
  };

  const handleFetchPreview = async (e) => {
    if (e) e.preventDefault();
    if (!urlInput.trim()) return;

    setIsFetchingPreview(true);
    setPreviewError(null);
    setPublishError(null);
    setPublishResult(null);
    setDuplicateWarning(null);

    try {
      const res = await fetch("/api/fathom-news/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });

      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        let errMsg = `Server returned HTTP ${res.status}`;
        try {
          const json = JSON.parse(text);
          if (json.error) errMsg = json.error;
        } catch (e) {}
        setPreviewError(`${errMsg}. You can enter details manually below.`);
        setCanManualEntry(true);
        setPreviewLoaded(true);
        return;
      }

      const data = await res.json();

      if (data.alreadyExists && data.existingRecord) {
        setDuplicateWarning(data.existingRecord);
      }

      if (data.ok) {
        setSourceType(data.sourceType || "article");
        setTitle(data.title || "");
        setSummary(data.summary || "");
        setImageUrl(data.imageUrl || "");
        setYoutubeVideoId(data.youtubeVideoId || "");
        setPreviewLoaded(true);
        setCanManualEntry(false);
      } else {
        // Scrape failure with manual fallback
        setPreviewError(data.error || "Could not auto-fetch page content.");
        setCanManualEntry(true);
        setSourceType(data.sourceType || "article");
        setYoutubeVideoId(data.youtubeVideoId || "");
        setPreviewLoaded(true);
      }

      // Scroll preview card into view smoothly
      setTimeout(() => {
        if (previewCardRef.current) {
          previewCardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    } catch (err) {
      setPreviewError(`Network error while connecting to server (${err.message}). You can enter details manually below.`);
      setCanManualEntry(true);
      setPreviewLoaded(true);
    } finally {
      setIsFetchingPreview(false);
    }
  };

  const handlePublish = async (e) => {
    if (e) e.preventDefault();

    if (!title.trim()) {
      setPublishError("Please enter a title for the post.");
      return;
    }
    if (!theTake.trim()) {
      setPublishError("The Electric Duo's Take is required before creating a draft.");
      return;
    }

    setIsPublishing(true);
    setPublishError(null);

    try {
      const payload = {
        url: urlInput.trim(),
        sourceType,
        title: title.trim(),
        summary: summary.trim(),
        imageUrl: imageUrl.trim(),
        youtubeVideoId: sourceType === "video" ? youtubeVideoId : null,
        theTake: theTake.trim(),
      };

      const res = await fetch("/api/fathom-news/publish", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }

      const data = await res.json();

      if (data.ok && data.success) {
        setPublishResult(data);
        // Refresh history
        fetchHistory();
      } else {
        setPublishError(data.error || "Failed to publish draft to WordPress.");
        fetchHistory();
      }
    } catch (err) {
      setPublishError("Error communicating with publishing server: " + err.message);
      fetchHistory();
    } finally {
      setIsPublishing(false);
    }
  };

  const handleReset = () => {
    setUrlInput("");
    setPreviewLoaded(false);
    setTitle("");
    setSummary("");
    setImageUrl("");
    setYoutubeVideoId("");
    setTheTake("");
    setPreviewError(null);
    setPublishError(null);
    setPublishResult(null);
    setDuplicateWarning(null);
    setCanManualEntry(false);
  };

  const handleCopyWpLink = (url) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  const handleDeleteHistory = async (id) => {
    if (!confirm("Are you sure you want to remove this history log entry?")) return;
    try {
      const res = await fetch(`/api/fathom-news/history/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        fetchHistory();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const totalPages = Math.ceil(totalHistory / historyLimit) || 1;
  const currentPage = Math.floor(historyOffset / historyLimit) + 1;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 right-1/4 -mb-16 w-60 h-60 rounded-full bg-blue-600/10 blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 shadow-lg shadow-cyan-500/25">
                <Newspaper className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                    Ford Fathom News
                  </h1>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 uppercase tracking-wider">
                    WP Publisher
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-0.5">
                  Curate EV news articles & YouTube videos into WordPress drafts with The Electric Duo's unique Take.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs font-semibold text-slate-300">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
              <span>Category: <b className="text-cyan-400">Ford Fathom News</b></span>
            </div>
            <button
              onClick={() => fetchHistory()}
              className="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition-colors"
              title="Refresh History"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingHistory ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Submission & Studio Card */}
      <div className="rounded-3xl bg-slate-900/70 border border-slate-800/90 shadow-xl backdrop-blur-xl p-6 sm:p-8 space-y-6">
        <div className="border-b border-slate-800/80 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-5 h-5 text-cyan-400" />
              <span>News Link Ingestion</span>
            </h2>
            <p className="text-xs text-slate-400">
              Enter any news article URL or YouTube video link to extract metadata and write your take.
            </p>
          </div>
          {previewLoaded && (
            <button
              onClick={handleReset}
              className="text-xs font-semibold text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition-all self-start"
            >
              Reset / New Item
            </button>
          )}
        </div>

        {/* URL Input Bar */}
        <form onSubmit={handleFetchPreview} className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
            Source URL (Article or YouTube)
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
                <LinkIcon className="w-4 h-4" />
              </div>
              <input
                type="url"
                required
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://insideevs.com/... or https://www.youtube.com/watch?v=..."
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 text-slate-100 text-sm placeholder-slate-500 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={isFetchingPreview || !urlInput.trim()}
              className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg ${
                isFetchingPreview || !urlInput.trim()
                  ? "bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed"
                  : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-cyan-500/25 active:scale-[0.98]"
              }`}
            >
              {isFetchingPreview ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Fetching Preview...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 fill-current" />
                  <span>Fetch Preview</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Duplicate URL Warning Banner */}
        {duplicateWarning && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 text-amber-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-amber-300">
                Notice: You've added this URL before on {new Date(duplicateWarning.created_at).toLocaleDateString()}
              </p>
              <p className="text-amber-200/80">
                Previous title: "{duplicateWarning.title || "Untitled"}". You can still publish another draft or review previous drafts below.
              </p>
              {duplicateWarning.wp_post_url && (
                <a
                  href={duplicateWarning.wp_post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-cyan-400 hover:text-cyan-300 underline mt-1"
                >
                  <span>Edit Existing WP Draft #{duplicateWarning.wp_post_id}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Scraping Warning with Manual Fallback Notice */}
        {previewError && (
          <div className="rounded-2xl bg-blue-500/10 border border-blue-500/30 p-4 text-blue-200 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-blue-300">Automated Extraction Notice</p>
              <p className="text-blue-200/80">{previewError}</p>
            </div>
          </div>
        )}

        {/* Success Banner */}
        {publishResult && publishResult.success && (
          <div className="rounded-3xl bg-emerald-500/10 border border-emerald-500/30 p-6 text-emerald-200 space-y-4 shadow-xl">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-emerald-300">
                  WordPress Draft Created Successfully!
                </h3>
                <p className="text-xs text-emerald-200/90">
                  Post titled <b>"{title}"</b> was published as a draft in category <b>Ford Fathom News</b>.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href={publishResult.wpPostUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20"
              >
                <span>Edit Draft in WordPress</span>
                <ExternalLink className="w-4 h-4" />
              </a>

              <button
                onClick={() => handleCopyWpLink(publishResult.wpPostUrl)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 font-semibold text-xs border border-slate-700/80 transition-colors"
              >
                {copiedUrl ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-400" />
                    <span>Copy WP Admin Link</span>
                  </>
                )}
              </button>

              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 font-semibold text-xs border border-slate-700/80 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add Another News Item</span>
              </button>
            </div>
          </div>
        )}

        {/* Failure Banner */}
        {publishError && (
          <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4 text-rose-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-rose-300">Publishing Failed</p>
              <p className="text-rose-200/80">{publishError}</p>
              <p className="text-[11px] text-rose-300/70">
                Your entered content has been preserved below so you can correct and retry.
              </p>
            </div>
          </div>
        )}

        {/* Editable Preview Card & Duo's Take Editor */}
        {previewLoaded && (
          <div ref={previewCardRef} className="space-y-6 pt-2 border-t border-slate-800/80">
            {/* Header with Source Type Switcher */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Content Type:
                </span>
                <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSourceType("article")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      sourceType === "article"
                        ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Article</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType("video")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      sourceType === "video"
                        ? "bg-red-500 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <YoutubeIcon className="w-3.5 h-3.5" />
                    <span>YouTube Video</span>
                  </button>
                </div>
              </div>

              {sourceType === "video" && youtubeVideoId && (
                <div className="text-xs text-slate-400 font-mono flex items-center gap-1.5">
                  <span className="text-slate-500">Video ID:</span>
                  <b className="text-cyan-400">{youtubeVideoId}</b>
                </div>
              )}
            </div>

            {/* Title Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                  Post Title <span className="text-rose-400">*</span>
                </label>
                <span className="text-[11px] text-slate-500">{title.length} characters</span>
              </div>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter post title..."
                className="w-full px-4 py-3 rounded-2xl bg-slate-950/80 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 text-slate-100 text-sm font-semibold placeholder-slate-500 transition-all"
              />
            </div>

            {/* Summary Textarea */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                  Lead Summary / Overview
                </label>
                <span className="text-[11px] text-slate-500">{summary.length} characters</span>
              </div>
              <textarea
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Short lead paragraph summarizing the news or key points..."
                className="w-full px-4 py-3 rounded-2xl bg-slate-950/80 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 text-slate-100 text-sm placeholder-slate-500 transition-all leading-relaxed"
              />
            </div>

            {/* Media & Embed Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Left Column: Image URL & Thumbnail Preview */}
              <div className="space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                  Featured Image / Thumbnail URL
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://.../image.jpg"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 focus:border-cyan-500 text-slate-200 text-xs font-mono placeholder-slate-600 transition-all"
                />

                <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt="News preview"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
                      <FileText className="w-8 h-8 opacity-40" />
                      <span className="text-xs">No image preview</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: YouTube Player (if Video) or Link Preview Card (if Article) */}
              <div className="space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                  {sourceType === "video" ? "Embedded Video Preview" : "Source Link Info"}
                </label>

                {sourceType === "video" && youtubeVideoId ? (
                  <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video shadow-lg">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId}`}
                      title={title}
                      className="w-full h-full border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-5 space-y-3">
                    <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                      <Globe className="w-4 h-4" />
                      <span>Article Destination</span>
                    </div>
                    <p className="text-xs text-slate-400 break-all">{urlInput}</p>
                    <a
                      href={urlInput}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300 underline"
                    >
                      <span>Open original source article</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* THE ELECTRIC DUO'S TAKE (Card) */}
            <div className="rounded-3xl bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border-2 border-cyan-500/40 p-6 sm:p-7 space-y-4 shadow-2xl shadow-cyan-950/40 relative overflow-hidden">
              <div className="absolute top-0 right-0 -mr-10 -mt-10 w-48 h-48 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none"></div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center border border-cyan-500/30">
                    <Zap className="w-4 h-4 fill-current" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-cyan-300 tracking-tight">
                      The Electric Duo's Take
                    </h3>
                    <p className="text-xs text-slate-400">
                      Add our perspective, analysis, why this matters, or commentary on this news.
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 uppercase tracking-widest self-start sm:self-auto">
                  Required
                </span>
              </div>

              <textarea
                rows={5}
                required
                value={theTake}
                onChange={(e) => setTheTake(e.target.value)}
                placeholder="Type The Electric Duo's unique take, analysis, or reaction here..."
                className="w-full px-4 py-3.5 rounded-2xl bg-slate-950 border border-slate-700/80 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 text-slate-100 text-sm leading-relaxed placeholder-slate-500 transition-all font-sans"
              />
            </div>

            {/* Bottom Action Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={handleReset}
                className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white font-semibold text-xs border border-slate-700/80 transition-colors"
              >
                Cancel / Reset
              </button>

              <button
                type="button"
                onClick={handlePublish}
                disabled={isPublishing || !title.trim() || !theTake.trim()}
                className={`w-full sm:w-auto flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all shadow-xl ${
                  isPublishing || !title.trim() || !theTake.trim()
                    ? "bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed"
                    : "bg-gradient-to-r from-cyan-500 via-cyan-400 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-cyan-500/25 active:scale-[0.98]"
                }`}
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Publishing Draft to WordPress...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 fill-current" />
                    <span>Create Draft Post in WordPress</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* History & Published Drafts Panel */}
      <div className="rounded-3xl bg-slate-900/70 border border-slate-800/90 shadow-xl backdrop-blur-xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-cyan-400" />
              <span>Ford Fathom News History & Drafts</span>
            </h2>
            <p className="text-xs text-slate-400">
              Showing {totalHistory} curated news items logged in Command Center.
            </p>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <Search className="w-3.5 h-3.5" />
              </div>
              <input
                type="text"
                value={historySearch}
                onChange={(e) => {
                  setHistorySearch(e.target.value);
                  setHistoryOffset(0);
                }}
                placeholder="Search title, URL, take..."
                className="w-48 sm:w-60 pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-500 text-xs text-slate-200 placeholder-slate-500 transition-all"
              />
            </div>

            {/* Type Filter */}
            <select
              value={historyTypeFilter}
              onChange={(e) => {
                setHistoryTypeFilter(e.target.value);
                setHistoryOffset(0);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:border-cyan-500"
            >
              <option value="all">All Types</option>
              <option value="article">Articles</option>
              <option value="video">Videos</option>
            </select>

            {/* Status Filter */}
            <select
              value={historyStatusFilter}
              onChange={(e) => {
                setHistoryStatusFilter(e.target.value);
                setHistoryOffset(0);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:border-cyan-500"
            >
              <option value="all">All Statuses</option>
              <option value="published">Published</option>
              <option value="draft_created">Draft</option>
              <option value="trashed">Trashed</option>
              <option value="failed">Failed</option>
            </select>

            {/* Live Sync Statuses Button */}
            <button
              onClick={handleSyncStatus}
              disabled={isSyncingStatus || isLoadingHistory}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 font-bold text-xs border border-slate-700/80 transition-colors disabled:opacity-50"
              title="Sync post statuses live with WordPress"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingStatus ? "animate-spin" : ""}`} />
              <span>Sync Statuses</span>
            </button>
          </div>
        </div>

        {/* History Table / List */}
        {isLoadingHistory ? (
          <div className="py-12 flex items-center justify-center gap-3 text-slate-400 text-xs">
            <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
            <span>Loading history...</span>
          </div>
        ) : historyItems.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs space-y-2">
            <Newspaper className="w-8 h-8 mx-auto opacity-30" />
            <p>No news items found in history.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Thumbnail</th>
                  <th className="py-3 px-4">Title & Source</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date & Author</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {historyItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors group">
                    {/* Thumbnail */}
                    <td className="py-3 px-4 w-20">
                      <div className="w-16 h-10 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 shrink-0">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600">
                            <FileText className="w-4 h-4 opacity-40" />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Title & Source */}
                    <td className="py-3 px-4 max-w-sm">
                      <div className="font-semibold text-slate-100 line-clamp-1 group-hover:text-cyan-300 transition-colors">
                        {item.title || "Untitled News Item"}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-slate-300 underline flex items-center gap-1"
                        >
                          <span className="truncate max-w-[240px]">{item.source_url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </div>
                    </td>

                    {/* Type Badge */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      {item.source_type === "video" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 uppercase">
                          <YoutubeIcon className="w-3 h-3" />
                          <span>Video</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 uppercase">
                          <Globe className="w-3 h-3" />
                          <span>Article</span>
                        </span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      {item.status === "published" || item.status === "publish" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Published</span>
                        </span>
                      ) : item.status === "draft_created" || item.status === "draft" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          <FileText className="w-3 h-3" />
                          <span>Draft</span>
                        </span>
                      ) : item.status === "trashed" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-500/15 text-slate-400 border border-slate-500/30">
                          <Trash2 className="w-3 h-3" />
                          <span>Trashed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Failed</span>
                        </span>
                      )}
                    </td>

                    {/* Date & Author */}
                    <td className="py-3 px-4 whitespace-nowrap text-[11px] text-slate-400">
                      <div>{new Date(item.created_at).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-500">by {item.created_by || "user"}</div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 whitespace-nowrap text-right space-x-2">
                      {item.wp_live_url && (item.status === "published" || item.status === "publish") && (
                        <a
                          href={item.wp_live_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold text-[11px] border border-emerald-500/30 transition-colors"
                        >
                          <span>View Live</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {item.wp_post_url && (
                        <a
                          href={item.wp_post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 font-bold text-[11px] border border-slate-700/80 transition-colors"
                        >
                          <span>Edit in WP</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        onClick={() => handleDeleteHistory(item.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-colors"
                        title="Delete log entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs text-slate-400">
            <div>
              Showing {historyOffset + 1} - {Math.min(historyOffset + historyLimit, totalHistory)} of {totalHistory} items
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={historyOffset === 0}
                onClick={() => setHistoryOffset(Math.max(0, historyOffset - historyLimit))}
                className={`p-2 rounded-xl border border-slate-800 transition-colors ${
                  historyOffset === 0
                    ? "text-slate-600 cursor-not-allowed"
                    : "bg-slate-950 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-semibold text-slate-300 px-2">
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setHistoryOffset(historyOffset + historyLimit)}
                className={`p-2 rounded-xl border border-slate-800 transition-colors ${
                  currentPage >= totalPages
                    ? "text-slate-600 cursor-not-allowed"
                    : "bg-slate-950 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
