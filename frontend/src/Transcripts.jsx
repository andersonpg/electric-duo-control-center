import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  Upload,
  Download,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Search,
  BookOpen,
  Settings,
  X,
  Plus,
  Trash2,
  Copy,
  Check,
  Smartphone,
  Eye,
  RefreshCw,
  Sliders,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Tag,
  ArrowRight,
  Video,
  DownloadCloud,
  UploadCloud,
  AlertCircle,
} from "lucide-react";

export default function Transcripts({ currentUser, initialVideoId, onClearInitialVideoId }) {
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [privacyTab, setPrivacyTab] = useState("public"); // 'public' | 'unlisted'
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVideo, setSelectedVideo] = useState(null);

  // Transcript state for selected video
  const [savedTranscript, setSavedTranscript] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [isUploadingNew, setIsUploadingNew] = useState(false);

  // Upload & Preview state
  const [rawInput, setRawInput] = useState("");
  const [previewData, setPreviewData] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);
  const [activeDiffTab, setActiveDiffTab] = useState("side-by-side"); // 'side-by-side' | 'cleaned' | 'raw'

  // Manual Term Correction Dialog state
  const [isTermModalOpen, setIsTermModalOpen] = useState(false);
  const [termCategory, setTermCategory] = useState("vehicles");
  const [termCorrect, setTermCorrect] = useState("");
  const [termWrong, setTermWrong] = useState("");
  const [isAddingTerm, setIsAddingTerm] = useState(false);

  // Terms Registry Full Manager Dialog state
  const [isRegistryOpen, setIsRegistryOpen] = useState(false);
  const [registryTerms, setRegistryTerms] = useState([]);
  const [loadingTerms, setLoadingTerms] = useState(false);
  const [registrySearch, setRegistrySearch] = useState("");
  const [registryCategoryFilter, setRegistryCategoryFilter] = useState("all");

  // Title Prompt Settings Dialog state
  const [isPromptSettingsOpen, setIsPromptSettingsOpen] = useState(false);
  const [promptInstructions, setPromptInstructions] = useState("");
  const [promptUpdatedAt, setPromptUpdatedAt] = useState("");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // Gemini Title Strategist state
  const [creatorContext, setCreatorContext] = useState("");
  const [titleCandidates, setTitleCandidates] = useState([]);
  const [isGeneratingTitles, setIsGeneratingTitles] = useState(false);
  const [copiedTitleIndex, setCopiedTitleIndex] = useState(null);
  const [isSettingWorkingTitle, setIsSettingWorkingTitle] = useState(false);

  // Toast message
  const [toast, setToast] = useState(null);

  const fileInputRef = useRef(null);

  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Load videos catalog
  useEffect(() => {
    fetchVideos();
  }, [privacyTab]);

  // Handle initialVideoId deep linking
  useEffect(() => {
    if (initialVideoId && videos.length > 0) {
      const match = videos.find((v) => v.youtube_id === initialVideoId);
      if (match) {
        handleSelectVideo(match);
      }
      if (onClearInitialVideoId) onClearInitialVideoId();
    }
  }, [initialVideoId, videos]);

  const fetchVideos = async () => {
    setLoadingVideos(true);
    try {
      const res = await fetch(`/api/videos?privacy=${privacyTab}`, { credentials: "same-origin" });
      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      const data = await res.json();
      setVideos(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load videos:", err);
    } finally {
      setLoadingVideos(false);
    }
  };

  const handleSelectVideo = async (video) => {
    setSelectedVideo(video);
    setPreviewData(null);
    setRawInput("");
    setIsUploadingNew(false);
    setTitleCandidates([]);
    setCreatorContext("");
    setLoadingTranscript(true);

    try {
      const res = await fetch(`/api/transcripts/${video.youtube_id}`, { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setSavedTranscript(data);
      } else {
        setSavedTranscript(null);
      }
    } catch (e) {
      setSavedTranscript(null);
    } finally {
      setLoadingTranscript(false);
    }
  };

  // Handle file drop or selection
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      setRawInput(text);
      runPreview(text);
    };
    reader.readAsText(file);
  };

  // Run preview cleanup via fixSrt
  const runPreview = async (textToClean = rawInput) => {
    if (!textToClean || !textToClean.trim()) {
      showToast("Please provide or upload SRT content to analyze.", "error");
      return;
    }

    setIsPreviewing(true);
    try {
      const res = await fetch("/api/transcripts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ srtText: textToClean }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Preview failed");
      }

      const data = await res.json();
      setPreviewData(data);
      showToast(`Cleaned with ${data.summary?.length || 0} vocabulary adjustments!`, "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsPreviewing(false);
    }
  };

  // Save reviewed transcript
  const handleSaveTranscript = async () => {
    if (!selectedVideo || !previewData) return;

    setIsSavingTranscript(true);
    try {
      const res = await fetch(`/api/transcripts/${selectedVideo.youtube_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          raw_srt: previewData.raw_srt,
          cleaned_srt: previewData.cleaned_srt,
          plain_text: previewData.plain_text,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }

      const data = await res.json();
      setSavedTranscript(data.transcript);
      setPreviewData(null);
      setIsUploadingNew(false);
      showToast("Transcript successfully saved to video record!", "success");

      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === selectedVideo.youtube_id ? { ...v, transcript: previewData.plain_text } : v
        )
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsSavingTranscript(false);
    }
  };

  const [isRetrievingYoutubeCaptions, setIsRetrievingYoutubeCaptions] = useState(false);
  const [isUploadingYoutubeCaptions, setIsUploadingYoutubeCaptions] = useState(false);

  const handleRetrieveFromYoutube = async () => {
    if (!selectedVideo) return;
    setIsRetrievingYoutubeCaptions(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/captions/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite: true }),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to retrieve captions from YouTube");

      if (data.transcript) {
        setSavedTranscript(data.transcript);
      }
      setRawInput(data.transcript?.raw_srt || "");
      await handlePreviewText(data.transcript?.raw_srt || "");
      setIsUploadingNew(false);
      showToast(`Retrieved ${data.chunkCount || ""} caption chunks from YouTube!`, "success");

      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === selectedVideo.youtube_id ? { ...v, caption_status: data.status || "unfixed" } : v
        )
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsRetrievingYoutubeCaptions(false);
    }
  };

  const handleUploadToYoutube = async () => {
    if (!selectedVideo) return;
    setIsUploadingYoutubeCaptions(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/captions/upload`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload clean captions to YouTube");

      showToast(`Clean captions uploaded to YouTube as "English (Edited)"!`, "success");
      await loadTranscriptForVideo(selectedVideo.youtube_id);
      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === selectedVideo.youtube_id ? { ...v, caption_status: "uploaded" } : v
        )
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsUploadingYoutubeCaptions(false);
    }
  };

  // Handle manual term addition
  const handleOpenAddTermModal = (selectedWord = "") => {
    setTermWrong(selectedWord.trim());
    setTermCorrect(selectedWord.trim());
    setTermCategory("vehicles");
    setIsTermModalOpen(true);
  };

  const handleAddTermSubmit = async (e) => {
    e.preventDefault();
    if (!termCategory || !termCorrect.trim() || !termWrong.trim()) {
      showToast("Please fill in category, correct spelling, and mis-transcription.", "error");
      return;
    }

    setIsAddingTerm(true);
    try {
      const res = await fetch("/api/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          category: termCategory.trim(),
          correct: termCorrect.trim(),
          wrong: termWrong.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add term");

      if (data.added) {
        showToast(`Added "${termWrong}" → "${termCorrect}" to EV Terms!`, "success");
        setIsTermModalOpen(false);
        if (rawInput || (previewData && previewData.raw_srt)) {
          runPreview(rawInput || previewData.raw_srt);
        }
      } else {
        showToast(data.reason || "Term already exists in list", "info");
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsAddingTerm(false);
    }
  };

  // Registry Manager: Load terms
  const loadRegistryTerms = async () => {
    setLoadingTerms(true);
    try {
      const res = await fetch("/api/terms", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setRegistryTerms(data);
      }
    } catch (err) {
      console.error("Failed to load terms:", err);
    } finally {
      setLoadingTerms(false);
    }
  };

  const handleOpenRegistry = () => {
    loadRegistryTerms();
    setIsRegistryOpen(true);
  };

  const handleRemoveVariant = async (category, correct, wrong) => {
    if (!window.confirm(`Remove variant "${wrong}" for "${correct}"?`)) return;

    try {
      const res = await fetch("/api/terms", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ category, correct, wrong }),
      });
      const data = await res.json();
      if (data.removed) {
        showToast(`Removed "${wrong}"`, "success");
        loadRegistryTerms();
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // Title Prompt Settings
  const loadPromptSettings = async () => {
    try {
      const res = await fetch("/api/title-prompt-settings", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setPromptInstructions(data.instructions || "");
        setPromptUpdatedAt(data.updated_at || "");
      }
    } catch (e) {}
  };

  const handleOpenPromptSettings = () => {
    loadPromptSettings();
    setIsPromptSettingsOpen(true);
  };

  const handleSavePromptSettings = async () => {
    setIsSavingPrompt(true);
    try {
      const res = await fetch("/api/title-prompt-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ instructions: promptInstructions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");

      setPromptUpdatedAt(data.updated_at);
      showToast("Title prompt instructions saved!", "success");
      setIsPromptSettingsOpen(false);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsSavingPrompt(false);
    }
  };

  // Generate Gemini Title Ideas
  const handleGenerateTitles = async () => {
    if (!selectedVideo) return;

    setIsGeneratingTitles(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/generate-titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ context: creatorContext }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Title generation failed");

      setTitleCandidates(data.candidates || []);
      showToast("Generated 8 high-CTR title candidates!", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsGeneratingTitles(false);
    }
  };

  // Select Working Title
  const handleSelectWorkingTitle = async (title) => {
    if (!selectedVideo) return;

    setIsSettingWorkingTitle(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/working-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ workingTitle: title }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set working title");

      setSelectedVideo((prev) => ({ ...prev, working_title: title }));
      setVideos((prev) =>
        prev.map((v) => (v.youtube_id === selectedVideo.youtube_id ? { ...v, working_title: title } : v))
      );
      showToast(`Selected "${title}" as working title!`, "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsSettingWorkingTitle(false);
    }
  };

  const copyToClipboard = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedTitleIndex(idx);
    setTimeout(() => setCopiedTitleIndex(null), 2000);
  };

  // Filter videos in sidebar
  const filteredVideos = videos.filter((v) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return v.title.toLowerCase().includes(q) || (v.working_title && v.working_title.toLowerCase().includes(q));
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-2 backdrop-blur-xl transition-all ${
            toast.type === "error"
              ? "bg-rose-950/90 text-rose-200 border-rose-800/80"
              : toast.type === "success"
              ? "bg-emerald-950/90 text-emerald-200 border-emerald-800/80"
              : "bg-slate-900/90 text-cyan-200 border-cyan-800/80"
          }`}
        >
          {toast.type === "error" ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Top Action Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 bg-slate-900/80 border border-slate-800 p-5 rounded-3xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-lg shadow-cyan-500/20 shrink-0">
            <FileText className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">
                EV Transcripts & Title Strategist
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest">
                Deterministic Engine
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Deterministic EV-vocabulary cleanup, subtitle downloads, and Gemini-powered title brainstorming.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleOpenRegistry}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all shadow-sm"
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>EV Terms Registry</span>
          </button>

          <button
            onClick={handleOpenPromptSettings}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all shadow-sm"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>Title Prompt Settings</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Video Selector & Tabs */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 flex flex-col gap-3 shadow-xl backdrop-blur-xl">
            {/* Catalog Type Tabs: Public vs Unlisted */}
            <div className="flex p-1 bg-slate-950 rounded-2xl border border-slate-800">
              <button
                onClick={() => setPrivacyTab("public")}
                className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
                  privacyTab === "public"
                    ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Public Videos
              </button>
              <button
                onClick={() => setPrivacyTab("unlisted")}
                className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
                  privacyTab === "unlisted"
                    ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Unlisted Videos
              </button>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search videos by title..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-cyan-500 font-medium"
              />
            </div>

            {/* Video List */}
            <div className="max-h-[640px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {loadingVideos ? (
                <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-cyan-400"></div>
                  <span>Loading catalog…</span>
                </div>
              ) : filteredVideos.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No {privacyTab} videos found matching your query.
                </div>
              ) : (
                filteredVideos.map((v) => {
                  const isSelected = selectedVideo && selectedVideo.youtube_id === v.youtube_id;
                  const hasTranscript = !!v.transcript;

                  return (
                    <div
                      key={v.youtube_id}
                      onClick={() => handleSelectVideo(v)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex gap-3 items-start ${
                        isSelected
                          ? "bg-cyan-950/30 border-cyan-500/60 shadow-lg shadow-cyan-500/10"
                          : "bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700"
                      }`}
                    >
                      <img
                        src={v.thumbnail_url || `https://img.youtube.com/vi/${v.youtube_id}/mqdefault.jpg`}
                        alt={v.title}
                        className="w-16 h-10 rounded-lg object-cover bg-slate-800 shrink-0 border border-slate-700/50"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-slate-200 line-clamp-2 leading-snug">
                          {v.title}
                        </h4>
                        {v.working_title && (
                          <div className="text-[10px] text-cyan-400 font-medium truncate mt-0.5">
                            Working: {v.working_title}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {hasTranscript ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Transcript
                            </span>
                          ) : (
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
                              No Transcript
                            </span>
                          )}
                          {v.privacy_status === "unlisted" && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              Unlisted
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Active Video Workspace */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {!selectedVideo ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-16 text-center text-slate-400 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-3xl bg-slate-800 flex items-center justify-center text-slate-500">
                <FileText className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-200">Select a Video to Begin</h3>
                <p className="text-xs text-slate-500 max-w-sm mt-1">
                  Choose any video from the catalog on the left to upload subtitles, run deterministic EV cleanup, and generate high-CTR title suggestions.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Video Header Card */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 flex items-center justify-between flex-wrap gap-4 shadow-xl backdrop-blur-xl">
                <div className="flex items-center gap-4 min-w-0">
                  <img
                    src={selectedVideo.thumbnail_url || `https://img.youtube.com/vi/${selectedVideo.youtube_id}/mqdefault.jpg`}
                    alt={selectedVideo.title}
                    className="w-24 h-14 rounded-xl object-cover bg-slate-800 shrink-0 border border-slate-700/60 shadow-md"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-wider">
                        {selectedVideo.privacy_status === "unlisted" ? "Unlisted Video" : "Public Upload"}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {selectedVideo.youtube_id}
                      </span>
                    </div>
                    <h2 className="text-sm sm:text-base font-bold text-white truncate max-w-lg mt-0.5">
                      {selectedVideo.title}
                    </h2>
                    {selectedVideo.working_title && (
                      <div className="text-xs text-cyan-300 font-semibold mt-0.5 flex items-center gap-1.5">
                        <Tag className="w-3 h-3 text-cyan-400" />
                        <span>Working Title: <b>{selectedVideo.working_title}</b></span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`https://www.youtube.com/watch?v=${selectedVideo.youtube_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                    title="Open on YouTube"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Saved Transcript Status Bar & Actions */}
              {savedTranscript && !isUploadingNew && (
                <div className="bg-slate-900/90 border border-emerald-500/30 rounded-3xl p-5 shadow-xl flex items-center justify-between flex-wrap gap-4 backdrop-blur-xl">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${
                      savedTranscript.status === "uploaded"
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                    }`}>
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-white">Cleaned Transcript Saved</h4>
                        {savedTranscript.status === "uploaded" ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                            Uploaded to YouTube
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
                            Ready to Upload
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Updated {new Date(savedTranscript.updated_at).toLocaleString()} · Ready for title generation & YouTube subtitles
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleUploadToYoutube}
                      disabled={isUploadingYoutubeCaptions}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50 ${
                        savedTranscript.status === "uploaded"
                          ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                          : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-cyan-500/20"
                      }`}
                      title="Upload cleaned subtitle track to YouTube Data API v3"
                    >
                      <UploadCloud className={`w-3.5 h-3.5 ${isUploadingYoutubeCaptions ? "animate-bounce" : ""}`} />
                      <span>
                        {isUploadingYoutubeCaptions
                          ? "Uploading to YouTube…"
                          : savedTranscript.status === "uploaded"
                          ? "Re-upload to YouTube"
                          : "Upload Clean Captions to YouTube"}
                      </span>
                    </button>

                    <a
                      href={`/api/transcripts/${selectedVideo.youtube_id}/download`}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold transition-all shadow-md shadow-emerald-600/20"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Cleaned SRT</span>
                    </a>

                    <button
                      onClick={() => setIsUploadingNew(true)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all"
                    >
                      <Upload className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Replace Subtitles</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Upload & Fix Form (Visible if no saved transcript OR user clicked Replace) */}
              {(!savedTranscript || isUploadingNew) && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4 backdrop-blur-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Upload className="w-4 h-4 text-cyan-400" />
                        <span>Upload or Retrieve Subtitles</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Download YouTube auto-captions directly, drop an `.srt` file, or paste subtitle text.
                      </p>
                    </div>

                    {isUploadingNew && savedTranscript && (
                      <button
                        onClick={() => setIsUploadingNew(false)}
                        className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg bg-slate-800"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {/* Quick Retrieve from YouTube Box */}
                  <div className="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                        <DownloadCloud className="w-4 h-4 text-cyan-400" />
                        <span>Fetch Captions from YouTube</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Directly download auto-generated or published YouTube captions without having to export files.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRetrieveFromYoutube}
                      disabled={isRetrievingYoutubeCaptions}
                      className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50 shrink-0"
                    >
                      <DownloadCloud className={`w-3.5 h-3.5 ${isRetrievingYoutubeCaptions ? "animate-bounce" : ""}`} />
                      <span>{isRetrievingYoutubeCaptions ? "Fetching Captions…" : "Retrieve Auto-Captions"}</span>
                    </button>
                  </div>

                  {/* Drag-and-drop / File upload box */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-700/80 hover:border-cyan-500/60 rounded-2xl p-6 text-center cursor-pointer transition-colors bg-slate-950/40 group"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".srt,.vtt"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <Upload className="w-8 h-8 text-slate-500 group-hover:text-cyan-400 mx-auto mb-2 transition-colors" />
                    <div className="text-xs font-semibold text-slate-200">
                      Click to browse or drop an <span className="text-cyan-400">.srt</span> file here
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Supports standard YouTube SRT or WebVTT files</div>
                  </div>

                  {/* Or Paste Raw Text */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-400">Or Paste Raw SRT / Subtitle Text:</label>
                    <textarea
                      rows={6}
                      value={rawInput}
                      onChange={(e) => setRawInput(e.target.value)}
                      placeholder="1
00:00:01,000 --> 00:00:04,000
I drove the maki to a super charger with fifty kilowatt hours..."
                      className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => runPreview()}
                      disabled={isPreviewing || !rawInput.trim()}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-black transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                    >
                      <Sparkles className={`w-4 h-4 ${isPreviewing ? "animate-spin" : ""}`} />
                      <span>{isPreviewing ? "Analyzing Transcript…" : "Clean & Review Transcript"}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Review Screen: Side-by-Side Diff, Summary, and Manual Term Corrections */}
              {previewData && (
                <div className="bg-slate-900/90 border border-cyan-500/40 rounded-3xl p-6 shadow-2xl space-y-6 backdrop-blur-xl animate-fade-in">
                  {/* Review Header & Summary */}
                  <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest">
                          Review Changes Before Saving
                        </span>
                        <span className="text-xs text-slate-400">
                          {previewData.summary?.length || 0} unique term adjustments made
                        </span>
                      </div>
                      <h3 className="text-sm sm:text-base font-bold text-white mt-1">
                        Deterministic EV Cleanup Summary
                      </h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenAddTermModal("")}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold border border-cyan-500/30 transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add New Term</span>
                      </button>

                      <button
                        onClick={handleSaveTranscript}
                        disabled={isSavingTranscript}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 text-xs font-black transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                        <span>{isSavingTranscript ? "Saving…" : "Save Transcript"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Summary Badges */}
                  {previewData.summary && previewData.summary.length > 0 ? (
                    <div className="flex flex-wrap gap-2 p-3 bg-slate-950/60 rounded-2xl border border-slate-800">
                      {previewData.summary.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-700/80 text-xs"
                        >
                          <span className="text-rose-400 line-through">{item.before}</span>
                          <ArrowRight className="w-3 h-3 text-slate-500" />
                          <span className="text-cyan-300 font-bold">{item.after}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-800 text-slate-400 font-semibold">
                            ×{item.count}
                          </span>
                          <span className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">
                            {item.category}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800 text-xs text-slate-400">
                      No dictionary changes required. All terms matched correct EV vocabulary.
                    </div>
                  )}

                  {/* View Mode Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                      <button
                        onClick={() => setActiveDiffTab("side-by-side")}
                        className={`px-3 py-1 rounded-lg font-bold transition-all ${
                          activeDiffTab === "side-by-side" ? "bg-slate-800 text-cyan-400" : "text-slate-400"
                        }`}
                      >
                        Side-by-Side
                      </button>
                      <button
                        onClick={() => setActiveDiffTab("cleaned")}
                        className={`px-3 py-1 rounded-lg font-bold transition-all ${
                          activeDiffTab === "cleaned" ? "bg-slate-800 text-cyan-400" : "text-slate-400"
                        }`}
                      >
                        Cleaned SRT
                      </button>
                      <button
                        onClick={() => setActiveDiffTab("raw")}
                        className={`px-3 py-1 rounded-lg font-bold transition-all ${
                          activeDiffTab === "raw" ? "bg-slate-800 text-cyan-400" : "text-slate-400"
                        }`}
                      >
                        Raw SRT
                      </button>
                    </div>

                    <span className="text-[11px] text-slate-400 italic">
                      Tip: Highlight any mis-transcribed word below to add it to the EV Vocabulary list.
                    </span>
                  </div>

                  {/* Diff Panes */}
                  {activeDiffTab === "side-by-side" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">
                          Original Raw Input
                        </div>
                        <div
                          onMouseUp={() => {
                            const sel = window.getSelection()?.toString();
                            if (sel && sel.trim().length > 1 && sel.trim().length < 40) {
                              handleOpenAddTermModal(sel.trim());
                            }
                          }}
                          className="h-80 overflow-y-auto p-3 rounded-2xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono whitespace-pre-wrap selection:bg-rose-500/30 custom-scrollbar"
                        >
                          {previewData.raw_srt}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider mb-1 px-1">
                          Cleaned Output
                        </div>
                        <div className="h-80 overflow-y-auto p-3 rounded-2xl bg-slate-950 border border-cyan-500/30 text-cyan-100 text-xs font-mono whitespace-pre-wrap selection:bg-cyan-500/30 custom-scrollbar">
                          {previewData.cleaned_srt}
                        </div>
                      </div>
                    </div>
                  ) : activeDiffTab === "cleaned" ? (
                    <div className="h-96 overflow-y-auto p-4 rounded-2xl bg-slate-950 border border-cyan-500/30 text-cyan-100 text-xs font-mono whitespace-pre-wrap custom-scrollbar">
                      {previewData.cleaned_srt}
                    </div>
                  ) : (
                    <div className="h-96 overflow-y-auto p-4 rounded-2xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono whitespace-pre-wrap custom-scrollbar">
                      {previewData.raw_srt}
                    </div>
                  )}
                </div>
              )}

              {/* Saved Cleaned Spoken Text Accordion */}
              {savedTranscript && (
                <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl backdrop-blur-xl">
                  <details className="group">
                    <summary className="flex items-center justify-between cursor-pointer list-none text-xs font-bold text-slate-300 group-open:text-cyan-400">
                      <span className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-cyan-400" />
                        <span>View Spoken Transcript Plain Text</span>
                      </span>
                      <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-300 leading-relaxed font-sans max-h-60 overflow-y-auto custom-scrollbar whitespace-pre-wrap bg-slate-950/60 p-4 rounded-2xl">
                      {savedTranscript.plain_text}
                    </div>
                  </details>
                </div>
              )}

              {/* FEATURE 2: Gemini YouTube Title Strategist Section */}
              {savedTranscript && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 backdrop-blur-xl">
                  <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/20 shrink-0">
                        <Sparkles className="w-5 h-5 fill-current" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">Gemini YouTube Title Strategist</h3>
                        <p className="text-xs text-slate-400">
                          Generates 8 high-CTR candidate titles based on channel rules and human psychology.
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleGenerateTitles}
                      disabled={isGeneratingTitles}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-black transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                    >
                      <Sparkles className={`w-4 h-4 ${isGeneratingTitles ? "animate-spin" : ""}`} />
                      <span>{isGeneratingTitles ? "Generating 8 Titles…" : "Generate Title Ideas"}</span>
                    </button>
                  </div>

                  {/* Optional Context Input */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                      <span>Creator Context & Highlights (Optional):</span>
                      <span className="text-[10px] text-slate-500 font-normal">
                        What was surprising, frustrating, or numerically notable?
                      </span>
                    </label>
                    <textarea
                      rows={2}
                      value={creatorContext}
                      onChange={(e) => setCreatorContext(e.target.value)}
                      placeholder="e.g. The 150kW charge curve held flat for 30 minutes, or we almost ran out of battery crossing Death Valley..."
                      className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  {/* Working Title Banner if Set */}
                  {selectedVideo.working_title && (
                    <div className="p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/40 flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">
                          Active Working Title
                        </div>
                        <div className="text-sm sm:text-base font-bold text-white mt-0.5">
                          {selectedVideo.working_title}
                        </div>
                      </div>
                      <button
                        onClick={() => handleSelectWorkingTitle("")}
                        className="text-xs text-slate-400 hover:text-rose-400 font-semibold"
                      >
                        Clear Working Title
                      </button>
                    </div>
                  )}

                  {/* 8 Title Candidates Grid */}
                  {titleCandidates.length > 0 && (
                    <div className="space-y-3 pt-2">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        8 Candidate Suggestions:
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {titleCandidates.map((cand, idx) => {
                          const isCurrentWorking = selectedVideo.working_title === cand.title;
                          const emotionColor =
                            cand.emotion === "curiosity"
                              ? "bg-purple-500/10 text-purple-300 border-purple-500/20"
                              : cand.emotion === "desire"
                              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-300 border-rose-500/20";

                          return (
                            <div
                              key={idx}
                              className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                                isCurrentWorking
                                  ? "bg-cyan-950/30 border-cyan-400 shadow-lg shadow-cyan-500/10"
                                  : "bg-slate-950/70 border-slate-800 hover:border-slate-700"
                              }`}
                            >
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${emotionColor}`}>
                                    {cand.emotion.replace("_", " ")}
                                  </span>

                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
                                        cand.charCount <= 55
                                          ? "text-emerald-400 bg-emerald-500/10"
                                          : cand.charCount <= 65
                                          ? "text-cyan-400 bg-cyan-500/10"
                                          : "text-amber-400 bg-amber-500/10"
                                      }`}
                                    >
                                      {cand.charCount} chars
                                    </span>
                                    {cand.deliversOnPromise && (
                                      <span
                                        className="text-[10px] font-bold text-emerald-400 flex items-center gap-0.5"
                                        title="Model verified: delivers on promise"
                                      >
                                        <CheckCircle2 className="w-3 h-3" /> Honest
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <h4 className="text-sm font-bold text-white leading-snug">
                                  {cand.title}
                                </h4>

                                <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-800/80 text-[11px] text-slate-300 flex items-center gap-1.5 font-mono">
                                  <Smartphone className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                  <span className="truncate">{cand.first40Preview}…</span>
                                </div>

                                <p className="text-xs text-slate-400 italic">
                                  "{cand.rationale}"
                                </p>
                              </div>

                              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                                <button
                                  onClick={() => copyToClipboard(cand.title, idx)}
                                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                                >
                                  {copiedTitleIndex === idx ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      <span className="text-emerald-400">Copied!</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Copy</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  onClick={() => handleSelectWorkingTitle(cand.title)}
                                  disabled={isSettingWorkingTitle || isCurrentWorking}
                                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                    isCurrentWorking
                                      ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 cursor-default"
                                      : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                                  }`}
                                >
                                  {isCurrentWorking ? "Active Working Title" : "Use as Working Title"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: Add New Term Modal */}
      {isTermModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xl animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-cyan-400" />
                <span>Add Explicit EV Term</span>
              </h3>
              <button
                onClick={() => setIsTermModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddTermSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-300">Mis-transcription (Wrong ASR text):</label>
                <input
                  type="text"
                  required
                  value={termWrong}
                  onChange={(e) => setTermWrong(e.target.value)}
                  placeholder="e.g. knacks, maki, ionic"
                  className="w-full mt-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-medium focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-300">Correct Spelling:</label>
                <input
                  type="text"
                  required
                  value={termCorrect}
                  onChange={(e) => setTermCorrect(e.target.value)}
                  placeholder="e.g. NACS, Mach-E, Ioniq"
                  className="w-full mt-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-medium focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-300">Category:</label>
                <select
                  value={termCategory}
                  onChange={(e) => setTermCategory(e.target.value)}
                  className="w-full mt-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-medium focus:border-cyan-500 focus:outline-none"
                >
                  <option value="vehicles">Vehicles</option>
                  <option value="charging">Charging</option>
                  <option value="tech">Tech</option>
                  <option value="units">Units</option>
                </select>
              </div>

              <p className="text-[11px] text-slate-400 italic">
                Note: This writes explicitly to `ev_terms.json` via termList.js. It never runs automatically.
              </p>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsTermModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingTerm}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold disabled:opacity-50"
                >
                  {isAddingTerm ? "Adding…" : "Add to Term List"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Full EV Terms Registry Manager */}
      {isRegistryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-xl animate-fade-in">
          <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">EV Terms Registry</h3>
                  <p className="text-xs text-slate-400">Manage all correct vocabulary and known mis-transcriptions</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenAddTermModal("")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Term</span>
                </button>

                <button
                  onClick={() => setIsRegistryOpen(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 py-3 border-b border-slate-800 shrink-0 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={registrySearch}
                  onChange={(e) => setRegistrySearch(e.target.value)}
                  placeholder="Filter terms by spelling or variant..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <select
                value={registryCategoryFilter}
                onChange={(e) => setRegistryCategoryFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none"
              >
                <option value="all">All Categories</option>
                <option value="vehicles">Vehicles</option>
                <option value="charging">Charging</option>
                <option value="tech">Tech</option>
                <option value="units">Units</option>
              </select>
            </div>

            {/* Terms List */}
            <div className="flex-1 overflow-y-auto space-y-3 py-4 pr-1 custom-scrollbar">
              {loadingTerms ? (
                <div className="py-12 text-center text-slate-400 text-xs">Loading dictionary…</div>
              ) : (
                registryTerms
                  .filter((t) => {
                    if (registryCategoryFilter !== "all" && t.category !== registryCategoryFilter) return false;
                    if (!registrySearch) return true;
                    const q = registrySearch.toLowerCase();
                    return (
                      t.correct.toLowerCase().includes(q) ||
                      t.wrong.some((w) => w.toLowerCase().includes(q))
                    );
                  })
                  .map((t, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-start justify-between gap-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{t.correct}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 uppercase tracking-wider">
                            {t.category}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-[11px] text-slate-500">Variants:</span>
                          {t.wrong.map((w, wIdx) => (
                            <span
                              key={wIdx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 text-xs"
                            >
                              <span>{w}</span>
                              <button
                                onClick={() => handleRemoveVariant(t.category, t.correct, w)}
                                className="text-slate-500 hover:text-rose-400 ml-1"
                                title="Remove variant"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setTermCategory(t.category);
                          setTermCorrect(t.correct);
                          setTermWrong("");
                          setIsTermModalOpen(true);
                        }}
                        className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 shrink-0"
                      >
                        + Variant
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Title Prompt Settings Modal */}
      {isPromptSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-xl animate-fade-in">
          <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 flex flex-col max-h-[90vh] overflow-hidden space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Title Strategist Instructions</h3>
                  <p className="text-xs text-slate-400">
                    System prompt and 10 Channel Rules used by Gemini for title brainstorming
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsPromptSettingsOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              <textarea
                rows={16}
                value={promptInstructions}
                onChange={(e) => setPromptInstructions(e.target.value)}
                className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono leading-relaxed focus:outline-none focus:border-cyan-500"
              />
              {promptUpdatedAt && (
                <div className="text-[10px] text-slate-500 italic">
                  Last updated: {new Date(promptUpdatedAt).toLocaleString()}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800 shrink-0">
              <button
                onClick={() => setIsPromptSettingsOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold"
              >
                Cancel
              </button>

              <button
                onClick={handleSavePromptSettings}
                disabled={isSavingPrompt}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-black transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50"
              >
                {isSavingPrompt ? "Saving…" : "Save Instructions"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}