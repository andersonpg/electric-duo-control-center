import React, { useState, useEffect } from "react";
import Header from "./Header";
import AISettings from "./AISettings";
import CatalogTable from "./CatalogTable";
import TemplateManagerModal from "./TemplateManagerModal";

export default function ArticleGenerator({ currentUser }) {
  const [videos, setVideos] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [settings, setSettings] = useState({
    default_model: "gemini-flash-latest",
    thinking_mode: "standard",
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [isSyncing, setIsSyncing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg, type = "info") => {
    setToastMessage({ msg, type });
    setTimeout(() => setToastMessage(null), 5000);
  };

  useEffect(() => {
    fetchVideos();
    fetchTemplates();
    fetchSettings();
  }, [searchQuery, statusFilter, categoryFilter]);

  const fetchVideos = async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (categoryFilter !== "all") params.append("contentType", categoryFilter);

      const res = await fetch(`/api/videos?${params.toString()}`, { credentials: "same-origin" });
      if (res.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      const data = await res.json();
      setVideos(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch videos:", err);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/templates", { credentials: "same-origin" });
      if (res.status === 401) return;
      const data = await res.json();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings", { credentials: "same-origin" });
      if (res.status === 401) return;
      const data = await res.json();
      if (data.default_model) setSettings(data);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  };

  const handleSync = async (mode) => {
    setIsSyncing(true);
    showToast(`Starting ${mode === "delta" ? "Manual Delta" : "Full Catalog"} Sync...`, "info");

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();

      if (data.success) {
        showToast(
          `Sync complete! ${data.newCount} new video(s) added (${data.totalProcessed} checked).`,
          "success"
        );
        fetchVideos();
      } else {
        showToast(`Sync failed: ${data.error}`, "error");
      }
    } catch (err) {
      showToast(`Sync error: ${err.message}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveSettings = async (newSettings) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
    try {
      await fetch("/api/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      showToast("AI settings updated.", "success");
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  const handleUpdateVideo = async (id, updates) => {
    setVideos((prev) =>
      prev.map((v) => (v.youtube_id === id ? { ...v, ...updates } : v))
    );

    try {
      await fetch(`/api/videos/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      console.error("Failed to update video:", err);
    }
  };

  const handleSaveTemplate = async (templateData) => {
    const isEdit = !!templateData.id;
    const url = isEdit ? `/api/templates/${templateData.id}` : "/api/templates";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateData),
      });
      const data = await res.json();

      if (res.ok) {
        showToast(`Template "${data.name}" saved successfully!`, "success");
        fetchTemplates();
      } else {
        showToast(`Error saving template: ${data.error}`, "error");
      }
    } catch (err) {
      showToast(`Error saving template: ${err.message}`, "error");
    }
  };

  const handleDeleteTemplate = async (id) => {
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        showToast("Template deleted successfully.", "success");
        fetchTemplates();
      }
    } catch (err) {
      showToast(`Error deleting template: ${err.message}`, "error");
    }
  };

  const handleProcessSelected = async (youtubeIds) => {
    setIsProcessing(true);
    showToast(`Processing ${youtubeIds.length} video(s) via Gemini API...`, "info");

    try {
      const res = await fetch("/api/process", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeIds,
          modelOverride: settings.default_model,
          thinkingModeOverride: settings.thinking_mode,
        }),
      });

      const data = await res.json();

      if (data.results) {
        const successes = data.results.filter((r) => r.success).length;
        const failures = data.results.filter((r) => !r.success).length;

        if (failures === 0) {
          showToast(`Successfully created ${successes} draft post(s) in WordPress!`, "success");
        } else {
          showToast(`Processed: ${successes} succeeded, ${failures} failed.`, "error");
        }

        fetchVideos();
      }
    } catch (err) {
      showToast(`Processing error: ${err.message}`, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetSelected = async (youtubeIds) => {
    try {
      const res = await fetch("/api/videos/reset", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeIds }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Reset ${data.count} video(s) back to Unprocessed state.`, "info");
        fetchVideos();
      }
    } catch (err) {
      showToast(`Error resetting videos: ${err.message}`, "error");
    }
  };

  return (
    <div className="w-full flex flex-col font-sans">
      {/* Sub Header */}
      <Header
        onSync={handleSync}
        isSyncing={isSyncing}
        onOpenTemplates={() => setIsTemplateModalOpen(true)}
      />

      {/* Main Container */}
      <div className="max-w-7xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
        {/* AI Controls Panel */}
        <AISettings settings={settings} onSaveSettings={handleSaveSettings} />

        {/* Video Catalog Table & Filters */}
        <CatalogTable
          videos={videos}
          templates={templates}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          onUpdateVideo={handleUpdateVideo}
          onProcessSelected={handleProcessSelected}
          onResetSelected={handleResetSelected}
          isProcessing={isProcessing}
        />
      </div>

      {/* Template Manager Modal */}
      <TemplateManagerModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        templates={templates}
        onSaveTemplate={handleSaveTemplate}
        onDeleteTemplate={handleDeleteTemplate}
      />

      {/* Toast Notification Floating Banner */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce-short">
          <div
            className={`px-5 py-3 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-3 backdrop-blur-xl ${
              toastMessage.type === "error"
                ? "border-red-500/40 text-red-300 bg-red-950/90"
                : toastMessage.type === "success"
                ? "border-emerald-500/40 text-emerald-300 bg-emerald-950/90"
                : "border-cyan-500/40 text-cyan-300 bg-slate-900/95"
            }`}
          >
            <span>{toastMessage.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
