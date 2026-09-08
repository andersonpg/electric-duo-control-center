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
  Pencil,
} from "lucide-react";

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSrtChunks(srtText) {
  if (!srtText || typeof srtText !== "string") return [];
  const normalized = srtText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const rawBlocks = normalized.split(/\n\n+/);
  const chunks = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const lines = rawBlocks[i].trim().split("\n");
    if (!lines.length) continue;

    let seq = i + 1;
    let timestamp = "";
    let textLines = [];

    if (/^\d+$/.test(lines[0]?.trim()) && lines[1] && lines[1].includes("-->")) {
      seq = parseInt(lines[0].trim(), 10) || (i + 1);
      timestamp = lines[1].trim();
      textLines = lines.slice(2);
    } else if (lines[0] && lines[0].includes("-->")) {
      timestamp = lines[0].trim();
      textLines = lines.slice(1);
    } else {
      textLines = lines;
    }

    chunks.push({
      seq,
      timestamp,
      text: textLines.join(" "),
      raw: rawBlocks[i],
    });
  }

  return chunks;
}

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
  const [activeChunk, setActiveChunk] = useState(null);
  const cleanedChunkRefs = useRef({});

  // Title Editing & YouTube Push state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleText, setEditTitleText] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isPushingTitle, setIsPushingTitle] = useState(false);
  const [isPushConfirmOpen, setIsPushConfirmOpen] = useState(false);

  // Correction Dialogue state (4 options: Cancel, Fix one time, Fix all in this video, Add to Term List)
  const [isCorrectionOpen, setIsCorrectionOpen] = useState(false);
  const [correctionCategory, setCorrectionCategory] = useState("vehicles");
  const [correctionCorrect, setCorrectionCorrect] = useState("");
  const [correctionWrong, setCorrectionWrong] = useState("");
  const [correctionChunkSeq, setCorrectionChunkSeq] = useState(null);
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
  const [thumbnailInstructions, setThumbnailInstructions] = useState("");
  const [promptUpdatedAt, setPromptUpdatedAt] = useState("");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // Gemini Title Strategist state
  const [creatorContext, setCreatorContext] = useState("");
  const [titleCandidates, setTitleCandidates] = useState([]);
  const [isGeneratingTitles, setIsGeneratingTitles] = useState(false);
  const [copiedTitleIndex, setCopiedTitleIndex] = useState(null);
  const [isSettingWorkingTitle, setIsSettingWorkingTitle] = useState(false);

  // YouTube Description & Chapters state
  const [generatedDescription, setGeneratedDescription] = useState("");
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isCopiedDescription, setIsCopiedDescription] = useState(false);
  const [generatedChapters, setGeneratedChapters] = useState("");
  const [chapterList, setChapterList] = useState([]);
  const [isGeneratingChapters, setIsGeneratingChapters] = useState(false);
  const [isCopiedChapters, setIsCopiedChapters] = useState(false);

  // Description Push & Restore state
  const [hasDescriptionBackup, setHasDescriptionBackup] = useState(false);
  const [isPushModalOpen, setIsPushModalOpen] = useState(false);
  const [pushPreviewData, setPushPreviewData] = useState(null);
  const [isLoadingPushPreview, setIsLoadingPushPreview] = useState(false);
  const [isPushingDescription, setIsPushingDescription] = useState(false);
  const [isRestoringDescription, setIsRestoringDescription] = useState(false);

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
    setCreatorContext("");
    setLoadingTranscript(true);
    setActiveChunk(null);
    setIsEditingTitle(false);
    setEditTitleText(video.working_title || video.title || "");
    setGeneratedDescription("");
    setGeneratedChapters("");
    setChapterList([]);

    // Load stored title suggestions
    if (video.title_suggestions) {
      try {
        const parsed = typeof video.title_suggestions === "string"
          ? JSON.parse(video.title_suggestions)
          : video.title_suggestions;
        setTitleCandidates(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        setTitleCandidates([]);
      }
    } else {
      setTitleCandidates([]);
      fetch(`/api/videos/${video.youtube_id}/title-suggestions`, { credentials: "same-origin" })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok && Array.isArray(d.suggestions) && d.suggestions.length > 0) {
            setTitleCandidates(d.suggestions);
          }
        })
        .catch(() => {});
    }

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

    // Check if description backup exists for this video
    setHasDescriptionBackup(false);
    fetch(`/api/videos/${video.youtube_id}/description-backup`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (d && d.hasBackup) setHasDescriptionBackup(true);
      })
      .catch(() => setHasDescriptionBackup(false));
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
      if (!res.ok) {
        if (data.isScopeError) {
          showToast(data.error || "The YouTube connection is missing the youtube.force-ssl permission and must be reconnected in Admin Settings.", "error");
          return;
        }
        if (data.canQuickPaste) {
          setIsUploadingNew(true);
        }
        throw new Error(data.error || "Failed to retrieve captions from YouTube");
      }

      if (data.transcript) {
        setSavedTranscript(data.transcript);
      }
      setRawInput(data.transcript?.raw_srt || "");
      await runPreview(data.transcript?.raw_srt || "");
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
      await handleSelectVideo(selectedVideo);
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

  // Click to scroll to matching cleaned chunk
  const scrollToCleanedChunk = (seq) => {
    setActiveChunk(seq);
    const targetEl = cleanedChunkRefs.current[seq] || document.getElementById(`cleaned-chunk-${seq}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const handleWordClick = (word, seq) => {
    scrollToCleanedChunk(seq);
  };

  // Open 4-option Correction Dialog
  const handleOpenCorrectionModal = (selectedWord = "", chunkSeq = null) => {
    setCorrectionWrong(selectedWord.trim());
    setCorrectionCorrect(selectedWord.trim());
    setCorrectionCategory("vehicles");
    setCorrectionChunkSeq(chunkSeq);
    setIsCorrectionOpen(true);
  };

  // Option 2: Fix one time
  const handleFixOneTime = () => {
    if (!previewData || !correctionWrong.trim() || !correctionCorrect.trim()) return;

    let newCleanedSrt = previewData.cleaned_srt;
    if (correctionChunkSeq) {
      const chunks = parseSrtChunks(previewData.cleaned_srt);
      const chunkIdx = chunks.findIndex((c) => c.seq === correctionChunkSeq);
      if (chunkIdx !== -1) {
        const wrongRegex = new RegExp(escapeRegExp(correctionWrong.trim()), "i");
        chunks[chunkIdx].text = chunks[chunkIdx].text.replace(wrongRegex, correctionCorrect.trim());
        newCleanedSrt = chunks.map((c) => `${c.seq}\n${c.timestamp}\n${c.text}`).join("\n\n") + "\n";
      } else {
        const wrongRegex = new RegExp(escapeRegExp(correctionWrong.trim()), "i");
        newCleanedSrt = newCleanedSrt.replace(wrongRegex, correctionCorrect.trim());
      }
    } else {
      const wrongRegex = new RegExp(escapeRegExp(correctionWrong.trim()), "i");
      newCleanedSrt = newCleanedSrt.replace(wrongRegex, correctionCorrect.trim());
    }

    const wrongRegex = new RegExp(escapeRegExp(correctionWrong.trim()), "i");
    const newPlainText = (previewData.plain_text || "").replace(wrongRegex, correctionCorrect.trim());

    setPreviewData({
      ...previewData,
      cleaned_srt: newCleanedSrt,
      plain_text: newPlainText,
    });
    setIsCorrectionOpen(false);
    showToast(`Fixed 1 occurrence: "${correctionWrong}" → "${correctionCorrect}"`, "success");
  };

  // Option 3: Fix all in this video
  const handleFixAllInVideo = () => {
    if (!previewData || !correctionWrong.trim() || !correctionCorrect.trim()) return;
    const wrongRegex = new RegExp(escapeRegExp(correctionWrong.trim()), "gi");
    const newCleanedSrt = previewData.cleaned_srt.replace(wrongRegex, correctionCorrect.trim());
    const newPlainText = (previewData.plain_text || "").replace(wrongRegex, correctionCorrect.trim());

    setPreviewData({
      ...previewData,
      cleaned_srt: newCleanedSrt,
      plain_text: newPlainText,
      summary: [
        ...(previewData.summary || []),
        {
          before: correctionWrong.trim(),
          after: correctionCorrect.trim(),
          count: 1,
          category: correctionCategory,
        },
      ],
    });
    setIsCorrectionOpen(false);
    showToast(`Fixed all occurrences of "${correctionWrong}" in this video!`, "success");
  };

  // Option 4: Add to Term List (writes to ev_terms.json and re-cleans)
  const handleCorrectionAddToTermList = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!correctionCategory || !correctionCorrect.trim() || !correctionWrong.trim()) {
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
          category: correctionCategory.trim(),
          correct: correctionCorrect.trim(),
          wrong: correctionWrong.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add term");

      if (data.added) {
        showToast(`Added "${correctionWrong}" → "${correctionCorrect}" to EV Terms!`, "success");
        setIsCorrectionOpen(false);
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

  // Manual Title Editing & YouTube Push handlers
  const handleSaveLocalTitle = async () => {
    if (!selectedVideo || !editTitleText.trim()) return;
    setIsSavingTitle(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title: editTitleText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save title");

      const updatedTitle = editTitleText.trim();
      setSelectedVideo((prev) => ({
        ...prev,
        working_title: updatedTitle,
      }));
      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === selectedVideo.youtube_id ? { ...v, working_title: updatedTitle } : v
        )
      );
      setIsEditingTitle(false);
      showToast("Local title saved successfully!", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handlePushTitleToYoutube = async () => {
    if (!selectedVideo) return;
    const titleToPush = (selectedVideo.working_title || selectedVideo.title || "").trim();
    if (!titleToPush) return;

    setIsPushingTitle(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/title/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title: titleToPush }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to push title to YouTube");

      setSelectedVideo((prev) => ({
        ...prev,
        title: titleToPush,
        youtube_title: titleToPush,
        working_title: titleToPush,
      }));
      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === selectedVideo.youtube_id
            ? { ...v, title: titleToPush, youtube_title: titleToPush, working_title: titleToPush }
            : v
        )
      );
      setIsPushConfirmOpen(false);
      showToast("Successfully updated title on YouTube!", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsPushingTitle(false);
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
        setThumbnailInstructions(data.thumbnail_instructions || "");
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
        body: JSON.stringify({
          instructions: promptInstructions,
          thumbnail_instructions: thumbnailInstructions,
        }),
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

      const candidates = data.candidates || [];
      setTitleCandidates(candidates);
      setSelectedVideo((prev) => ({
        ...prev,
        title_suggestions: JSON.stringify(candidates),
      }));
      setVideos((prev) =>
        prev.map((v) =>
          v.youtube_id === selectedVideo.youtube_id
            ? { ...v, title_suggestions: JSON.stringify(candidates) }
            : v
        )
      );
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

  // Generate Gemini YouTube Video Description
  const handleGenerateDescription = async () => {
    if (!selectedVideo) return;
    setIsGeneratingDescription(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/generate-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ context: creatorContext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Description generation failed");

      setGeneratedDescription(data.description || "");
      showToast(`Generated description (${data.charCount || (data.description || "").length} characters)!`, "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  // Generate Gemini YouTube Video Chapters
  const handleGenerateChapters = async () => {
    if (!selectedVideo) return;
    setIsGeneratingChapters(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/generate-chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chapter generation failed");

      setGeneratedChapters(data.chapterBlock || "");
      setChapterList(data.chapters || []);
      showToast(`Generated ${data.chapters?.length || 0} video chapters!`, "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsGeneratingChapters(false);
    }
  };

  const handleCopyDescription = () => {
    if (!generatedDescription.trim()) return;
    navigator.clipboard.writeText(generatedDescription);
    setIsCopiedDescription(true);
    setTimeout(() => setIsCopiedDescription(false), 2000);
    showToast("Copied description to clipboard!", "success");
  };

  const handleCopyChapters = () => {
    if (!generatedChapters.trim()) return;
    navigator.clipboard.writeText(generatedChapters);
    setIsCopiedChapters(true);
    setTimeout(() => setIsCopiedChapters(false), 2000);
    showToast("Copied chapters to clipboard!", "success");
  };

  // Open Push Confirmation Modal with calculated payload preview
  const handleOpenPushModal = async () => {
    // Guarded push restriction: only allow pushing to unlisted videos
    if (!selectedVideo || selectedVideo.privacy_status !== "unlisted") return;
    setIsPushModalOpen(true);
    setIsLoadingPushPreview(true);
    setPushPreviewData(null);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/preview-push-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          description: generatedDescription,
          chapterBlock: generatedChapters,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to calculate description preview");
      setPushPreviewData(data);
    } catch (err) {
      showToast(err.message, "error");
      setIsPushModalOpen(false);
    } finally {
      setIsLoadingPushPreview(false);
    }
  };

  // Confirmed push of final description and chapters to YouTube
  const handleConfirmPushDescription = async () => {
    if (!selectedVideo || selectedVideo.privacy_status !== "unlisted") return;
    setIsPushingDescription(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/push-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          description: generatedDescription,
          chapterBlock: generatedChapters,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to push description to YouTube");

      showToast(data.message || "Successfully pushed description to YouTube!", "success");
      setIsPushModalOpen(false);
      setHasDescriptionBackup(true);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsPushingDescription(false);
    }
  };

  // Restore description to pre-push backup state
  const handleRestoreDescription = async () => {
    if (!selectedVideo || selectedVideo.privacy_status !== "unlisted") return;
    if (!confirm("Are you sure you want to restore this YouTube video's description to its exact state prior to the last push?")) {
      return;
    }
    setIsRestoringDescription(true);
    try {
      const res = await fetch(`/api/videos/${selectedVideo.youtube_id}/restore-description`, {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to restore description");

      showToast(data.message || "Successfully restored previous description!", "success");
      setHasDescriptionBackup(false);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsRestoringDescription(false);
    }
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
              {(() => {
                const activeTitle = (selectedVideo.working_title || selectedVideo.title || "").trim();
                const ytTitle = (selectedVideo.youtube_title || selectedVideo.title || "").trim();
                const titlesMatch = activeTitle === ytTitle;

                return (
                  <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 flex flex-col gap-4 shadow-xl backdrop-blur-xl">
                    <div className="flex items-start justify-between flex-wrap gap-4">
                      <div className="flex items-start gap-4 min-w-0 flex-1">
                        <img
                          src={selectedVideo.thumbnail_url || `https://img.youtube.com/vi/${selectedVideo.youtube_id}/mqdefault.jpg`}
                          alt={selectedVideo.title}
                          className="w-24 h-14 rounded-xl object-cover bg-slate-800 shrink-0 border border-slate-700/60 shadow-md mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-wider">
                              {selectedVideo.privacy_status === "unlisted" ? "Unlisted Video" : "Public Upload"}
                            </span>
                            <span className="text-xs text-slate-400 font-mono">
                              {selectedVideo.youtube_id}
                            </span>
                            {titlesMatch ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                                <CheckCircle2 className="w-3 h-3" /> Matches YouTube
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">
                                <AlertCircle className="w-3 h-3" /> Differs from YouTube
                              </span>
                            )}
                          </div>

                          {/* Editable Title or Display */}
                          {isEditingTitle ? (
                            <div className="flex items-center gap-2 mt-2">
                              <input
                                type="text"
                                value={editTitleText}
                                onChange={(e) => setEditTitleText(e.target.value)}
                                className="flex-1 px-3 py-1.5 rounded-xl bg-slate-950 border border-cyan-500 text-sm font-bold text-white focus:outline-none"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={handleSaveLocalTitle}
                                disabled={isSavingTitle || !editTitleText.trim()}
                                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-bold shadow-md shadow-cyan-500/20 disabled:opacity-50"
                              >
                                {isSavingTitle ? "Saving…" : "Save Title"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsEditingTitle(false)}
                                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:text-white"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mt-1">
                              <h2 className="text-sm sm:text-base font-bold text-white truncate max-w-lg">
                                {activeTitle}
                              </h2>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditTitleText(activeTitle);
                                  setIsEditingTitle(true);
                                }}
                                className="p-1 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
                                title="Edit Title"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          {/* Original / Working Title details */}
                          {selectedVideo.working_title && selectedVideo.working_title !== selectedVideo.title && (
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              Original YouTube Title: <span className="font-mono text-slate-300">"{selectedVideo.title}"</span>
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

                    {/* If title differs from YouTube, show diff bar with Copy and Push actions */}
                    {!titlesMatch && (
                      <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-500/30 flex items-center justify-between flex-wrap gap-3 animate-fade-in">
                        <div className="text-xs text-amber-200 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>
                            Live YouTube Title: <b className="font-mono text-white">"{ytTitle}"</b>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(activeTitle, "header-title")}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
                          >
                            {copiedTitleIndex === "header-title" ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-400">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-slate-400" />
                                <span>Copy Title</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setIsPushConfirmOpen(true)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white text-xs font-bold shadow-md shadow-red-500/20 transition-all"
                          >
                            <UploadCloud className="w-3.5 h-3.5" />
                            <span>Push to YouTube</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

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
                        onClick={() => handleOpenCorrectionModal("")}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold border border-cyan-500/30 transition-all"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Correction</span>
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
                      Tip: Click any word to scroll to Cleaned Output · Double-click to open Correction.
                    </span>
                  </div>

                  {/* Diff Panes */}
                  {activeDiffTab === "side-by-side" ? (
                    (() => {
                      const rawChunks = parseSrtChunks(previewData.raw_srt);
                      const cleanedChunks = parseSrtChunks(previewData.cleaned_srt);

                      if (rawChunks.length > 0 && cleanedChunks.length > 0) {
                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1 flex items-center justify-between">
                                <span>Original Raw Input</span>
                                <span className="text-[10px] text-slate-500 font-normal">{rawChunks.length} chunks</span>
                              </div>
                              <div className="h-96 overflow-y-auto p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono custom-scrollbar space-y-2">
                                {rawChunks.map((chunk) => (
                                  <div
                                    key={chunk.seq}
                                    id={`raw-chunk-${chunk.seq}`}
                                    onClick={() => scrollToCleanedChunk(chunk.seq)}
                                    className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                                      activeChunk === chunk.seq
                                        ? "bg-cyan-950/40 border-cyan-500 ring-1 ring-cyan-500/30 shadow-md"
                                        : "bg-slate-900/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/80"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                                      <span className="font-bold text-slate-400">#{chunk.seq}</span>
                                      <span>{chunk.timestamp}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenCorrectionModal("", chunk.seq);
                                        }}
                                        className="text-[10px] text-cyan-400/80 hover:text-cyan-300 flex items-center gap-0.5"
                                        title="Open correction dialogue for this block"
                                      >
                                        <Pencil className="w-2.5 h-2.5" /> Correct
                                      </button>
                                    </div>
                                    <div className="text-slate-200 leading-relaxed">
                                      {chunk.text.split(/(\s+)/).map((segment, sIdx) => {
                                        if (/^\s+$/.test(segment) || !segment) return segment;
                                        return (
                                          <span
                                            key={sIdx}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleWordClick(segment, chunk.seq);
                                            }}
                                            onDoubleClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenCorrectionModal(segment, chunk.seq);
                                            }}
                                            className="hover:text-cyan-400 hover:bg-cyan-500/10 cursor-pointer rounded px-0.5 py-0.5 transition-colors"
                                            title="Click to scroll to Cleaned Output · Double-click to Correct"
                                          >
                                            {segment}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div>
                              <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider mb-1 px-1 flex items-center justify-between">
                                <span>Cleaned Output</span>
                                <span className="text-[10px] text-cyan-500/60 font-normal">{cleanedChunks.length} chunks</span>
                              </div>
                              <div className="h-96 overflow-y-auto p-3 rounded-2xl bg-slate-950 border border-cyan-500/30 text-xs font-mono custom-scrollbar space-y-2">
                                {cleanedChunks.map((chunk) => (
                                  <div
                                    key={chunk.seq}
                                    id={`cleaned-chunk-${chunk.seq}`}
                                    ref={(el) => (cleanedChunkRefs.current[chunk.seq] = el)}
                                    className={`p-2.5 rounded-xl border transition-all ${
                                      activeChunk === chunk.seq
                                        ? "bg-cyan-950/50 border-cyan-400 ring-2 ring-cyan-400/50 shadow-lg shadow-cyan-500/20"
                                        : "bg-slate-900/50 border-cyan-500/20"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between text-[10px] text-cyan-500/60 mb-1">
                                      <span className="font-bold text-cyan-400">#{chunk.seq}</span>
                                      <span>{chunk.timestamp}</span>
                                    </div>
                                    <div className="text-cyan-100 leading-relaxed">
                                      {chunk.text}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">
                              Original Raw Input
                            </div>
                            <div
                              onMouseUp={() => {
                                const sel = window.getSelection()?.toString();
                                if (sel && sel.trim().length > 1 && sel.trim().length < 40) {
                                  handleOpenCorrectionModal(sel.trim());
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
                      );
                    })()
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
                      <span>
                        {isGeneratingTitles
                          ? "Generating 8 Titles…"
                          : titleCandidates.length > 0
                          ? "Regenerate Title Ideas"
                          : "Generate Title Ideas"}
                      </span>
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
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {selectedVideo.title_suggestions ? "Saved Title Suggestions:" : "Candidate Suggestions:"}
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {titleCandidates.length} generated
                        </span>
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

                                {/* Thumbnail Words Suggestion */}
                                {cand.thumbnailWords && (
                                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-950/40 border border-blue-500/20 text-xs">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase tracking-widest font-mono shrink-0">
                                        Thumbnail Words
                                      </span>
                                      <span className="font-extrabold text-blue-200 tracking-wide truncate">
                                        "{cand.thumbnailWords}"
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(cand.thumbnailWords, `thumb-${idx}`)}
                                      className="text-slate-400 hover:text-blue-300 p-1 shrink-0 transition-colors"
                                      title="Copy thumbnail words"
                                    >
                                      {copiedTitleIndex === `thumb-${idx}` ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  </div>
                                )}

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
                                      <span>Copy Title</span>
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

              {/* FEATURE 3: YouTube Description & Chapters Generator Section */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 backdrop-blur-xl">
                <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 to-emerald-500 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/20 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">YouTube Description & Chapters Generator</h3>
                      <p className="text-xs text-slate-400">
                        Generate structured, high-retention descriptions and timestamped chapters from your cleaned transcript.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Undo / Restore button: visible whenever a backup row exists for the selected video */}
                    {hasDescriptionBackup && (
                      <button
                        type="button"
                        onClick={handleRestoreDescription}
                        disabled={isRestoringDescription}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all disabled:opacity-50"
                        title="Restore previous description from pre-push backup"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRestoringDescription ? "animate-spin" : ""}`} />
                        <span>{isRestoringDescription ? "Restoring…" : "Undo Last Push"}</span>
                      </button>
                    )}

                    {/* Guarded Push to YouTube: ONLY shown and enabled for unlisted draft videos */}
                    {/* Clearly commented condition so it can be lifted later */}
                    {selectedVideo.privacy_status === "unlisted" && (
                      <button
                        type="button"
                        onClick={handleOpenPushModal}
                        disabled={!generatedDescription.trim() && !generatedChapters.trim()}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white text-xs font-black shadow-lg shadow-red-500/20 disabled:opacity-40 transition-all"
                        title="Push description & chapters to unlisted draft on YouTube"
                      >
                        <UploadCloud className="w-4 h-4" />
                        <span>Push to YouTube (Unlisted Draft)</span>
                      </button>
                    )}
                  </div>
                </div>

                {!(savedTranscript && ["fixed", "uploaded"].includes(savedTranscript.status)) ? (
                  <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 flex items-center gap-3 text-slate-400 text-xs">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <span className="font-bold text-slate-300">Cleaned transcript required:</span> Description and chapter generation require an EV-cleaned transcript (status <code className="text-cyan-400">fixed</code> or <code className="text-cyan-400">uploaded</code>). Please retrieve and clean the transcript above to enable these generators.
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 1. Description Generator Card */}
                    <div className="flex flex-col gap-3 p-5 rounded-2xl bg-slate-950/70 border border-slate-800">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest">
                            Description
                          </span>
                          <h4 className="text-xs font-bold text-white">Video Description</h4>
                        </div>

                        <button
                          type="button"
                          onClick={handleGenerateDescription}
                          disabled={isGeneratingDescription}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-bold shadow-md shadow-cyan-500/20 disabled:opacity-50 transition-all"
                        >
                          <Sparkles className={`w-3.5 h-3.5 ${isGeneratingDescription ? "animate-spin" : ""}`} />
                          <span>{isGeneratingDescription ? "Generating Description…" : generatedDescription ? "Regenerate Description" : "Generate Description"}</span>
                        </button>
                      </div>

                      <textarea
                        rows={12}
                        value={generatedDescription}
                        onChange={(e) => setGeneratedDescription(e.target.value)}
                        placeholder="Click 'Generate Description' to generate a 2-3 sentence hook, content breakdown, and engaging discussion closing..."
                        className="w-full p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-sans text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors leading-relaxed selection:bg-cyan-500 selection:text-slate-950"
                      />

                      <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-slate-800/80">
                        <span className={`text-[11px] font-mono ${generatedDescription.length > 4500 ? "text-rose-400 font-bold" : generatedDescription.length > 4000 ? "text-amber-400" : "text-slate-500"}`}>
                          {generatedDescription.length} / 4,500 characters
                        </span>

                        <button
                          type="button"
                          onClick={handleCopyDescription}
                          disabled={!generatedDescription.trim()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all disabled:opacity-40"
                        >
                          {isCopiedDescription ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Copy Description</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* 2. Chapters Generator Card */}
                    <div className="flex flex-col gap-3 p-5 rounded-2xl bg-slate-950/70 border border-slate-800">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-widest">
                            Chapters
                          </span>
                          <h4 className="text-xs font-bold text-white">Timestamped Chapters</h4>
                        </div>

                        <button
                          type="button"
                          onClick={handleGenerateChapters}
                          disabled={isGeneratingChapters}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-50 transition-all"
                        >
                          <Sparkles className={`w-3.5 h-3.5 ${isGeneratingChapters ? "animate-spin" : ""}`} />
                          <span>{isGeneratingChapters ? "Generating Chapters…" : generatedChapters ? "Regenerate Chapters" : "Generate Chapters"}</span>
                        </button>
                      </div>

                      <textarea
                        rows={10}
                        value={generatedChapters}
                        onChange={(e) => setGeneratedChapters(e.target.value)}
                        placeholder={"0:00 Introduction\n1:15 Real-World Range Test\n..."}
                        className="w-full p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono text-emerald-200 focus:outline-none focus:border-emerald-500 transition-colors leading-relaxed selection:bg-emerald-500 selection:text-slate-950"
                      />

                      {/* Reviewable Chapter List with Source Excerpts */}
                      {chapterList && chapterList.length > 0 && (
                        <div className="bg-slate-900/60 border border-slate-800/90 rounded-xl p-3 flex flex-col gap-2 max-h-60 overflow-y-auto">
                          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-800/60">
                            <span>Chapter Verification & Excerpts</span>
                            <span className="text-slate-500 font-mono font-normal">{chapterList.length} chapters derived</span>
                          </div>
                          <div className="flex flex-col divide-y divide-slate-800/60">
                            {chapterList.map((ch, idx) => (
                              <div key={idx} className="py-2 first:pt-1 last:pb-0 flex flex-col gap-0.5">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-xs font-mono font-bold text-emerald-400 shrink-0">{ch.timeFormatted}</span>
                                  <span className="text-xs font-medium text-slate-200">{ch.title}</span>
                                </div>
                                {ch.sourceExcerpt && (
                                  <p className="text-[11px] text-slate-500 italic pl-2 border-l-2 border-slate-700/60 leading-snug">
                                    "{ch.sourceExcerpt}…"
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-slate-800/80">
                        <span className="text-[11px] font-mono text-slate-500">
                          {generatedChapters.trim() ? `${generatedChapters.trim().split("\n").filter(Boolean).length} chapters` : "0 chapters"}
                        </span>

                        <button
                          type="button"
                          onClick={handleCopyChapters}
                          disabled={!generatedChapters.trim()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all disabled:opacity-40"
                        >
                          {isCopiedChapters ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Copy Chapters</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: 4-Option Correction Dialog */}
      {isCorrectionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xl animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-cyan-400" />
                <span>Correction Dialogue</span>
              </h3>
              <button
                onClick={() => setIsCorrectionOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-300">Mis-transcription (Wrong ASR text):</label>
                <input
                  type="text"
                  required
                  value={correctionWrong}
                  onChange={(e) => setCorrectionWrong(e.target.value)}
                  placeholder="e.g. knacks, maki, ionic"
                  className="w-full mt-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-medium focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-300">Correct Spelling:</label>
                <input
                  type="text"
                  required
                  value={correctionCorrect}
                  onChange={(e) => setCorrectionCorrect(e.target.value)}
                  placeholder="e.g. NACS, Mach-E, Ioniq"
                  className="w-full mt-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-medium focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-300">Category (for Term List):</label>
                <select
                  value={correctionCategory}
                  onChange={(e) => setCorrectionCategory(e.target.value)}
                  className="w-full mt-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-medium focus:border-cyan-500 focus:outline-none"
                >
                  <option value="vehicles">Vehicles</option>
                  <option value="charging">Charging</option>
                  <option value="tech">Tech</option>
                  <option value="units">Units</option>
                </select>
              </div>

              <p className="text-[11px] text-slate-400 italic">
                Choose how to apply this correction:
              </p>

              {/* 4 Correction Options Grid */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCorrectionOpen(false)}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors text-center"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleFixOneTime}
                  disabled={!correctionWrong.trim() || !correctionCorrect.trim()}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition-colors text-center disabled:opacity-50"
                  title="Fix only this instance"
                >
                  Fix one time
                </button>

                <button
                  type="button"
                  onClick={handleFixAllInVideo}
                  disabled={!correctionWrong.trim() || !correctionCorrect.trim()}
                  className="px-3 py-2 rounded-xl bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-200 border border-cyan-500/40 text-xs font-bold transition-colors text-center disabled:opacity-50"
                  title="Replace all occurrences across this video"
                >
                  Fix all in this video
                </button>

                <button
                  type="button"
                  onClick={handleCorrectionAddToTermList}
                  disabled={isAddingTerm || !correctionWrong.trim() || !correctionCorrect.trim()}
                  className="px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-black transition-all text-center shadow-md shadow-cyan-500/20 disabled:opacity-50"
                  title="Save permanently to EV Terms list"
                >
                  {isAddingTerm ? "Saving…" : "Add to Term List"}
                </button>
              </div>
            </div>
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
                  onClick={() => handleOpenCorrectionModal("")}
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
                          setCorrectionCategory(t.category);
                          setCorrectionCorrect(t.correct);
                          setCorrectionWrong("");
                          setCorrectionChunkSeq(null);
                          setIsCorrectionOpen(true);
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

      {/* MODAL 3: Push Title to YouTube Confirmation Modal */}
      {isPushConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xl animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Push Title to YouTube</h3>
                <p className="text-xs text-slate-400">Update live title on the public YouTube channel</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5 text-xs">
              <div>
                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Current YouTube Title:</span>
                <div className="text-rose-300 font-mono line-through mt-0.5 break-words">
                  {selectedVideo.youtube_title || selectedVideo.title}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-emerald-400 uppercase tracking-wider text-[10px] font-bold">New Title to Push:</span>
                <div className="text-emerald-300 font-bold font-mono mt-0.5 break-words">
                  {(selectedVideo.working_title || selectedVideo.title || "").trim()}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              This action will update the title on YouTube video <span className="font-mono text-cyan-400">{selectedVideo.youtube_id}</span>. Are you sure you want to push this change now?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPushConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePushTitleToYoutube}
                disabled={isPushingTitle}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-bold text-xs shadow-md shadow-red-500/20 disabled:opacity-50 transition-all"
              >
                {isPushingTitle ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Pushing to YouTube…</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Yes, Push to YouTube</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Title Prompt Settings Modal */}
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
                    System prompt and rules used by Gemini for title and thumbnail brainstorming
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

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300">Title Generation Instructions:</label>
                <textarea
                  rows={10}
                  value={promptInstructions}
                  onChange={(e) => setPromptInstructions(e.target.value)}
                  className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono leading-relaxed focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5 pt-3 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-widest">
                    Thumbnail Words
                  </span>
                  <label className="text-xs font-bold text-white">Thumbnail Words Suggestion Instructions:</label>
                </div>
                <textarea
                  rows={6}
                  value={thumbnailInstructions}
                  onChange={(e) => setThumbnailInstructions(e.target.value)}
                  placeholder="Instructions for generating 2-4 punchy thumbnail words alongside titles..."
                  className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono leading-relaxed focus:outline-none focus:border-cyan-500"
                />
              </div>

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

      {/* MODAL 5: Push Description & Chapters to YouTube Confirmation Modal */}
      {isPushModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xl animate-fade-in">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Push Description to YouTube</h3>
                  <p className="text-xs text-slate-400">
                    Pre-publish draft · Video ID: <span className="font-mono text-cyan-400">{selectedVideo?.youtube_id}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsPushModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isLoadingPushPreview ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400 text-xs">
                <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
                <span>Calculating full YouTube description payload…</span>
              </div>
            ) : pushPreviewData ? (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                {pushPreviewData.isRepeatPush && (
                  <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex items-center gap-2.5 text-cyan-300 text-xs">
                    <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>
                      <strong>Repeat push detected:</strong> The previous leading block will be replaced with your updated description and chapters rather than duplicating.
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
                      Full Composed Description Preview:
                    </span>
                    <span
                      className={`font-mono text-[11px] font-bold ${
                        pushPreviewData.charCount > 5000
                          ? "text-rose-400"
                          : pushPreviewData.charCount > 4500
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {pushPreviewData.charCount} / 5,000 characters
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 max-h-64 overflow-y-auto whitespace-pre-wrap custom-scrollbar leading-relaxed">
                    {pushPreviewData.composed}
                  </div>
                </div>

                {pushPreviewData.charCount > 5000 && (
                  <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      <strong>Exceeds YouTube limit:</strong> Total description exceeds 5,000 characters. Please cut at least {pushPreviewData.charCount - 5000} characters before pushing.
                    </span>
                  </div>
                )}

                <p className="text-[11px] text-slate-400 leading-relaxed italic">
                  This action will update the description for YouTube video <span className="font-mono text-cyan-400">{selectedVideo?.youtube_id}</span> via Google OAuth. A backup of the current description will be automatically preserved for instant rollback.
                </p>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setIsPushModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-bold"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmPushDescription}
                disabled={
                  isLoadingPushPreview ||
                  isPushingDescription ||
                  !pushPreviewData ||
                  pushPreviewData.charCount > 5000
                }
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white font-bold text-xs shadow-md shadow-red-500/20 disabled:opacity-50 transition-all"
              >
                {isPushingDescription ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Pushing to YouTube…</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Yes, Push to YouTube</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}