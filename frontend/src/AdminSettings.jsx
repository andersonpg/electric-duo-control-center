import React, { useState, useEffect } from "react";
import {
  Shield,
  Key,
  Users,
  Database,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Save,
  Lock,
  UserPlus,
  Play,
  Globe,
  Video,
  Clock,
  Sliders,
  Check,
  Radio,
  ExternalLink,
  Unlink,
  CheckCircle,
  Tag,
  Plus,
  List,
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowLeft,
  FileText,
  Layers,
} from "lucide-react";

export default function AdminSettings({ currentUser }) {
  const [activeTab, setActiveTab] = useState("integrations"); // 'integrations' | 'users' | 'models' | 'maintenance'

  // Users State
  const [users, setUsers] = useState([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [passwordUserId, setPasswordUserId] = useState(null);
  const [newPassword, setNewPassword] = useState("");

  // Integrations State
  const [integrations, setIntegrations] = useState({
    youtube_api_key: "",
    youtube_channel_id: "UCuhhyTS-Q66qq-gWrCcTOzg",
    google_client_id: "",
    google_client_secret: "",
    gemini_api_key: "",
    wp_site_url: "https://theelectricduo.com",
    wp_username: "patricka",
    wp_application_password: "",
    default_model: "gemini-3.7-flash",
    thinking_mode: "standard",
  });
  const [testResults, setTestResults] = useState({});
  const [testingService, setTestingService] = useState(null);

  // OAuth Status
  const [oauthStatus, setOauthStatus] = useState({
    isConnected: false,
    channelTitle: null,
    redirectUri: "https://cc.theelectricduo.com/api/auth/google/callback",
  });
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Models State
  const [models, setModels] = useState([]);

  // Maintenance State
  const [isSyncingDurations, setIsSyncingDurations] = useState(false);
  const [syncDurationResult, setSyncDurationResult] = useState(null);

  // Category Manager State
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [catalogVideos, setCatalogVideos] = useState([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogTotalPages, setCatalogTotalPages] = useState(1);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState("all");
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [categories, setCategories] = useState([]);
  const [stagedCategoryChanges, setStagedCategoryChanges] = useState({}); // { [youtubeId]: newCategory }
  const [isSavingCategoryChanges, setIsSavingCategoryChanges] = useState(false);

  // Create Category Modal State
  const [isCreateCategoryModalOpen, setIsCreateCategoryModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDescription, setNewCatDescription] = useState("");
  const [newCatColor, setNewCatColor] = useState("#06b6d4");
  const [newCatAddToTemplates, setNewCatAddToTemplates] = useState(false);
  const [newCatPromptTemplate, setNewCatPromptTemplate] = useState("");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  // Feedback Toast
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    fetchUsers();
    fetchIntegrations();
    fetchModels();
    fetchOAuthStatus();

    // Check for OAuth query params
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_success")) {
      showToast("Connected to YouTube Analytics & Google OAuth successfully!");
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchOAuthStatus();
    } else if (params.get("oauth_error")) {
      showToast("OAuth Error: " + params.get("oauth_error"), "error");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : []);
      }
    } catch (e) {}
  };

  const fetchIntegrations = async () => {
    try {
      const res = await fetch("/api/admin/integrations", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setIntegrations((prev) => ({ ...prev, ...data }));
      }
    } catch (e) {}
  };

  const fetchOAuthStatus = async () => {
    try {
      const res = await fetch("/api/admin/oauth-status", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setOauthStatus(data);
      }
    } catch (e) {}
  };

  const fetchModels = async () => {
    try {
      const res = await fetch("/api/models", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setModels(Array.isArray(data) ? data : []);
      }
    } catch (e) {}
  };

  const handleSaveIntegrations = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(integrations),
      });
      if (res.ok) {
        showToast("Integrations & API settings saved successfully.");
        fetchIntegrations();
        fetchOAuthStatus();
      } else {
        showToast("Failed to save settings.", "error");
      }
    } catch (err) {
      showToast("Error saving settings: " + err.message, "error");
    }
  };

  const handleTestConnection = async (service) => {
    setTestingService(service);
    setTestResults((prev) => ({ ...prev, [service]: { loading: true } }));

    try {
      const res = await fetch("/api/admin/test-connection", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        setTestResults((prev) => ({
          ...prev,
          [service]: { ok: true, message: data.message },
        }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [service]: { ok: false, error: data.error || "Connection failed." },
        }));
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [service]: { ok: false, error: err.message },
      }));
    } finally {
      setTestingService(null);
    }
  };

  const handleDisconnectOAuth = async () => {
    if (!confirm("Are you sure you want to disconnect YouTube Analytics OAuth?")) return;
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/auth/google/disconnect", {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.ok) {
        showToast("YouTube Analytics disconnected.");
        fetchOAuthStatus();
      }
    } catch (e) {
      showToast("Error disconnecting: " + e.message, "error");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUserName || !newUserUsername || !newUserPassword) return;

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUserName,
          username: newUserUsername,
          password: newUserPassword,
        }),
      });
      if (res.ok) {
        showToast(`User "${newUserName}" created successfully.`);
        setNewUserName("");
        setNewUserUsername("");
        setNewUserPassword("");
        fetchUsers();
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to create user.", "error");
      }
    } catch (err) {
      showToast("Error creating user: " + err.message, "error");
    }
  };

  const handleUpdatePassword = async (userId) => {
    if (!newPassword) return;
    try {
      const res = await fetch("/api/admin/users/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, newPassword }),
      });
      if (res.ok) {
        showToast("Password updated successfully.");
        setPasswordUserId(null);
        setNewPassword("");
      }
    } catch (err) {
      showToast("Error updating password: " + err.message, "error");
    }
  };

  const handleSyncDurations = async () => {
    setIsSyncingDurations(true);
    setSyncDurationResult(null);

    try {
      const res = await fetch("/api/catalog/sync-durations", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();

      if (data.success) {
        setSyncDurationResult(`Successfully updated exact real durations for ${data.updated} / ${data.total} catalog videos.`);
        showToast(`Backfilled ${data.updated} exact video durations.`);
      } else {
        setSyncDurationResult("Error: " + (data.error || "Failed to backfill durations."));
      }
    } catch (err) {
      setSyncDurationResult("Error: " + err.message);
    } finally {
      setIsSyncingDurations(false);
    }
  };

  // Fetch Categories for dropdowns
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
    } catch (e) {
      console.error("Error fetching categories:", e);
    }
  };

  // Fetch paginated videos for Category Manager
  const fetchCatalogVideos = async (page = 1, search = catalogSearch, category = catalogCategoryFilter) => {
    setIsLoadingCatalog(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "50",
        search: search || "",
        category: category !== "all" ? category : "",
      });

      const res = await fetch(`/api/channel-health/video-catalog?${params.toString()}`, { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        setCatalogVideos(data.videos || []);
        setCatalogTotal(data.total || 0);
        setCatalogTotalPages(data.totalPages || 1);
        setCatalogPage(data.page || 1);
      }
    } catch (e) {
      console.error("Error fetching video catalog:", e);
      showToast("Failed to load videos.", "error");
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  const handleOpenCategoryManager = () => {
    setIsCategoryManagerOpen(true);
    setStagedCategoryChanges({});
    fetchCategories();
    fetchCatalogVideos(1, "", "all");
  };

  const handleCategorySelectChange = (youtubeId, newCategory) => {
    setStagedCategoryChanges((prev) => ({
      ...prev,
      [youtubeId]: newCategory,
    }));
  };

  const handleSaveBatchCategories = async () => {
    const changeKeys = Object.keys(stagedCategoryChanges);
    if (changeKeys.length === 0) {
      showToast("No category changes to save.", "info");
      return;
    }

    setIsSavingCategoryChanges(true);
    try {
      const updates = changeKeys.map((yId) => ({
        youtubeId: yId,
        category: stagedCategoryChanges[yId],
      }));

      const res = await fetch("/api/channel-health/batch-override-categories", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      const data = await res.json();
      if (data.success) {
        showToast(`Saved category updates for ${data.count} video${data.count === 1 ? "" : "s"}!`);
        // Update local catalogVideos state
        setCatalogVideos((prev) =>
          prev.map((v) => {
            if (stagedCategoryChanges[v.youtube_id]) {
              return { ...v, content_type: stagedCategoryChanges[v.youtube_id] };
            }
            return v;
          })
        );
        setStagedCategoryChanges({});
      } else {
        showToast(data.error || "Failed to save category updates.", "error");
      }
    } catch (err) {
      showToast("Error saving category updates: " + err.message, "error");
    } finally {
      setIsSavingCategoryChanges(false);
    }
  };

  const handleCreateNewCategory = async (e) => {
    e.preventDefault();
    if (!newCatName || !newCatName.trim()) return;

    setIsCreatingCategory(true);
    try {
      const res = await fetch("/api/channel-health/categories", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCatName.trim(),
          description: newCatDescription.trim(),
          color: newCatColor,
          addToTemplates: newCatAddToTemplates,
          promptTemplate: newCatPromptTemplate,
        }),
      });

      const data = await res.json();
      if (data.success) {
        showToast(`Category "${newCatName.trim()}" created!${newCatAddToTemplates ? " (Added to Article Generator templates)" : ""}`);
        setNewCatName("");
        setNewCatDescription("");
        setNewCatColor("#06b6d4");
        setNewCatAddToTemplates(false);
        setNewCatPromptTemplate("");
        setIsCreateCategoryModalOpen(false);
        fetchCategories();
      } else {
        showToast(data.error || "Failed to create category.", "error");
      }
    } catch (err) {
      showToast("Error creating category: " + err.message, "error");
    } finally {
      setIsCreatingCategory(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6 font-sans text-slate-100">
      {/* Masthead Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/20 shrink-0">
            <Shield className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">
              The Electric Duo · Command Center
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-white">
              Admin & System Settings
            </h2>
          </div>
        </div>
        <p className="text-slate-400 text-xs sm:text-sm mt-3 leading-relaxed">
          Manage user accounts, connect YouTube Analytics via Google OAuth 2.0 to stream live Studio retention curves, configure Gemini 3.7 Flash, and run catalog maintenance tools.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {[
          { id: "integrations", label: "API Keys & Integrations", icon: Key },
          { id: "models", label: "AI Models & Thinking Mode", icon: Sparkles },
          { id: "users", label: "User Accounts", icon: Users },
          { id: "maintenance", label: "Catalog Maintenance", icon: Database },
        ].map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                isActive
                  ? "bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 shadow-md shadow-cyan-500/10"
                  : "bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800"
              }`}
            >
              <Icon className="w-4 h-4 text-cyan-400" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: API KEYS & INTEGRATIONS */}
      {activeTab === "integrations" && (
        <form onSubmit={handleSaveIntegrations} className="flex flex-col gap-6">
          {/* YouTube Analytics API (Google OAuth 2.0) */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-950 border border-cyan-500/30 rounded-3xl p-6 sm:p-7 shadow-xl shadow-cyan-950/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    YouTube Analytics API (Google OAuth 2.0)
                    {oauthStatus.isConnected && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                        <CheckCircle className="w-3 h-3" /> Live Studio Connected
                      </span>
                    )}
                  </h3>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Pulls ground-truth retention curves, live impressions, true CTR, and traffic sources directly from YouTube Studio.
                  </div>
                </div>
              </div>

              {oauthStatus.isConnected ? (
                <button
                  type="button"
                  onClick={handleDisconnectOAuth}
                  disabled={isDisconnecting}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-950/40 hover:bg-red-950/70 border border-red-500/30 text-red-300 text-xs font-semibold transition-colors shrink-0"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Disconnect Channel</span>
                </button>
              ) : (
                <a
                  href="/api/auth/google"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white text-xs font-bold shadow-md shadow-red-500/20 transition-all shrink-0"
                >
                  <Video className="w-4 h-4" />
                  <span>Sign in with Google & Connect</span>
                </a>
              )}
            </div>

            {/* OAuth Credentials Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Google OAuth Client ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. 123456789-abcdefg.apps.googleusercontent.com"
                  value={integrations.google_client_id || ""}
                  onChange={(e) => setIntegrations({ ...integrations, google_client_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Google OAuth Client Secret
                </label>
                <input
                  type="password"
                  placeholder="e.g. GOCSPX-••••••••••••••••"
                  value={integrations.google_client_secret || ""}
                  onChange={(e) => setIntegrations({ ...integrations, google_client_secret: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* Redirect URI Info Helper */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="text-slate-400">
                <span className="font-semibold text-slate-200">Authorized Redirect URI</span> (Add to Google Cloud Console):
              </div>
              <code className="text-cyan-300 font-mono bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700 text-[11px] select-all">
                {oauthStatus.redirectUri || "https://cc.theelectricduo.com/api/auth/google/callback"}
              </code>
            </div>
          </div>

          {/* YouTube Data API v3 */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-red-500" />
                <h3 className="text-sm font-bold text-white">YouTube Data API v3 (Public Catalog)</h3>
              </div>
              <button
                type="button"
                onClick={() => handleTestConnection("youtube")}
                disabled={testingService === "youtube"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingService === "youtube" ? "animate-spin" : ""}`} />
                <span>Test YouTube API</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">YouTube API Key</label>
                <input
                  type="password"
                  placeholder={integrations.youtube_api_key_configured ? "••••••••••••••••••••••• (Configured)" : "Enter API Key"}
                  value={integrations.youtube_api_key}
                  onChange={(e) => setIntegrations({ ...integrations, youtube_api_key: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">YouTube Channel ID</label>
                <input
                  type="text"
                  value={integrations.youtube_channel_id}
                  onChange={(e) => setIntegrations({ ...integrations, youtube_channel_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {testResults.youtube && (
              <div className={`mt-4 p-3 rounded-xl text-xs font-medium border flex items-center gap-2 ${
                testResults.youtube.ok ? "bg-emerald-950/60 border-emerald-500/30 text-emerald-300" : "bg-red-950/60 border-red-500/30 text-red-300"
              }`}>
                {testResults.youtube.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{testResults.youtube.message || testResults.youtube.error}</span>
              </div>
            )}
          </div>

          {/* Google Gemini AI API */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">Google Gemini AI Studio</h3>
              </div>
              <button
                type="button"
                onClick={() => handleTestConnection("gemini")}
                disabled={testingService === "gemini"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingService === "gemini" ? "animate-spin" : ""}`} />
                <span>Test Gemini 3.7 API</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Gemini API Key</label>
              <input
                type="password"
                placeholder={integrations.gemini_api_key_configured ? "••••••••••••••••••••••• (Configured)" : "Enter Gemini API Key (AIzaSy...)"}
                value={integrations.gemini_api_key}
                onChange={(e) => setIntegrations({ ...integrations, gemini_api_key: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            {testResults.gemini && (
              <div className={`mt-4 p-3 rounded-xl text-xs font-medium border flex items-center gap-2 ${
                testResults.gemini.ok ? "bg-emerald-950/60 border-emerald-500/30 text-emerald-300" : "bg-red-950/60 border-red-500/30 text-red-300"
              }`}>
                {testResults.gemini.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{testResults.gemini.message || testResults.gemini.error}</span>
              </div>
            )}
          </div>

          {/* WordPress REST API */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-white">WordPress REST API & Publishing</h3>
              </div>
              <button
                type="button"
                onClick={() => handleTestConnection("wordpress")}
                disabled={testingService === "wordpress"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingService === "wordpress" ? "animate-spin" : ""}`} />
                <span>Test WordPress Connection</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Site URL</label>
                <input
                  type="text"
                  value={integrations.wp_site_url}
                  onChange={(e) => setIntegrations({ ...integrations, wp_site_url: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Username</label>
                <input
                  type="text"
                  value={integrations.wp_username}
                  onChange={(e) => setIntegrations({ ...integrations, wp_username: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Application Password</label>
                <input
                  type="password"
                  placeholder={integrations.wp_password_configured ? "••••••••••••••••••••••• (Configured)" : "Enter 24-character App Password"}
                  value={integrations.wp_application_password}
                  onChange={(e) => setIntegrations({ ...integrations, wp_application_password: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {testResults.wordpress && (
              <div className={`mt-4 p-3 rounded-xl text-xs font-medium border flex items-center gap-2 ${
                testResults.wordpress.ok ? "bg-emerald-950/60 border-emerald-500/30 text-emerald-300" : "bg-red-950/60 border-red-500/30 text-red-300"
              }`}>
                {testResults.wordpress.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{testResults.wordpress.message || testResults.wordpress.error}</span>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg shadow-cyan-500/20 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>Save All Integration Settings</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: AI MODELS & THINKING MODE */}
      {activeTab === "models" && (
        <form onSubmit={handleSaveIntegrations} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
          <div>
            <h3 className="text-base font-bold text-white mb-1">Gemini AI Model Selector</h3>
            <p className="text-xs text-slate-400">
              Select the primary Google Gemini model used across Article Generator and Video Audit diagnostics.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">Default Gemini Model</label>
              <select
                value={integrations.default_model}
                onChange={(e) => setIntegrations({ ...integrations, default_model: e.target.value })}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-medium focus:outline-none focus:border-cyan-500"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">Thinking / Reasoning Depth</label>
              <select
                value={integrations.thinking_mode}
                onChange={(e) => setIntegrations({ ...integrations, thinking_mode: e.target.value })}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 font-medium focus:outline-none focus:border-cyan-500"
              >
                <option value="standard">Standard (Sub-2s latency · Optimized for publishing speed)</option>
                <option value="extended">Extended Reasoning (Deep diagnostic evaluation)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg shadow-cyan-500/20"
            >
              <Save className="w-4 h-4" />
              <span>Update AI Settings</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: USER ACCOUNTS */}
      {activeTab === "users" && (
        <div className="flex flex-col gap-6">
          {/* User List */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-base font-bold text-white mb-4">Command Center Users</h3>
            <div className="space-y-3">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl flex items-center justify-between gap-4"
                >
                  <div>
                    <div className="text-sm font-bold text-white">{u.name}</div>
                    <div className="text-xs text-slate-400 font-mono">@{u.username}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    {passwordUserId === u.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          placeholder="New password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                        <button
                          onClick={() => handleUpdatePassword(u.id)}
                          className="px-3 py-1.5 rounded-lg bg-cyan-600 text-slate-950 text-xs font-bold"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setPasswordUserId(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPasswordUserId(u.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700/80 transition-colors"
                      >
                        <Lock className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Change Password</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add User Form */}
          <form onSubmit={handleCreateUser} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-base font-bold text-white mb-1">Add New User</h3>
            <p className="text-xs text-slate-400 mb-4">Create a new login for the Command Center.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Liv"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Username</label>
                <input
                  type="text"
                  placeholder="e.g. liv"
                  value={newUserUsername}
                  onChange={(e) => setNewUserUsername(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  placeholder="Secure password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs"
              >
                <UserPlus className="w-4 h-4" />
                <span>Create User</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: CATALOG MAINTENANCE */}
      {activeTab === "maintenance" && !isCategoryManagerOpen && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
          <div>
            <h3 className="text-base font-bold text-white mb-1">Catalog & Video Maintenance</h3>
            <p className="text-xs text-slate-400">
              Manage video classifications, batch update video categories, and backfill accurate video durations from YouTube.
            </p>
          </div>

          {/* Quick Video Category Manager Card */}
          <div className="bg-slate-950/70 border border-slate-800 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <Tag className="w-4 h-4 text-cyan-400" />
                <span>Video Category Manager</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Quickly browse all video titles (50 per page), change categories inline, and create new categories on the fly with Article Generator template support.
              </div>
            </div>

            <button
              onClick={handleOpenCategoryManager}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs uppercase tracking-wider shrink-0 shadow-md shadow-cyan-500/20"
            >
              <List className="w-4 h-4" />
              <span>Open Category Manager</span>
            </button>
          </div>

          {/* Catalog Duration Backfill Card */}
          <div className="bg-slate-950/70 border border-slate-800 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span>Backfill Exact Video Durations</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Query YouTube Data API v3 in batches of 50 to update exact real durations (e.g. 34:18 for Route 66, 8:45 for News) across all catalog videos in your local database.
              </div>
            </div>

            <button
              onClick={handleSyncDurations}
              disabled={isSyncingDurations}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs uppercase tracking-wider shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingDurations ? "animate-spin" : ""}`} />
              <span>{isSyncingDurations ? "Backfilling Durations…" : "Run Duration Backfill"}</span>
            </button>
          </div>

          {syncDurationResult && (
            <div className={`p-4 rounded-xl text-xs font-medium border flex items-center gap-2 ${
              syncDurationResult.startsWith("Error")
                ? "bg-red-950/60 border-red-500/30 text-red-300"
                : "bg-emerald-950/60 border-emerald-500/30 text-emerald-300"
            }`}>
              {syncDurationResult.startsWith("Error") ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{syncDurationResult}</span>
            </div>
          )}
        </div>
      )}

      {/* FULL SCREEN VIDEO CATEGORY MANAGER SCREEN */}
      {activeTab === "maintenance" && isCategoryManagerOpen && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-6">
          {/* Header Bar with Back & Create Category Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsCategoryManagerOpen(false)}
                className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
                title="Back to Catalog Maintenance"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                  <Tag className="w-4 h-4 text-cyan-400" />
                  <span>Video Category Manager</span>
                </h3>
                <p className="text-xs text-slate-400">
                  {catalogTotal} long-form videos · 50 per page · Change categories and save in batch
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsCreateCategoryModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 text-xs font-bold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Category</span>
              </button>

              <button
                onClick={handleSaveBatchCategories}
                disabled={isSavingCategoryChanges || Object.keys(stagedCategoryChanges).length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold text-xs shadow-md shadow-cyan-500/20 disabled:opacity-40 transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {isSavingCategoryChanges
                    ? "Saving Changes…"
                    : `Save Changes ${
                        Object.keys(stagedCategoryChanges).length > 0
                          ? `(${Object.keys(stagedCategoryChanges).length})`
                          : ""
                      }`}
                </span>
              </button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800">
            <div className="sm:col-span-8 relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
              <input
                type="text"
                placeholder="Search videos by title or keywords…"
                value={catalogSearch}
                onChange={(e) => {
                  setCatalogSearch(e.target.value);
                  fetchCatalogVideos(1, e.target.value, catalogCategoryFilter);
                }}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="sm:col-span-4">
              <select
                value={catalogCategoryFilter}
                onChange={(e) => {
                  setCatalogCategoryFilter(e.target.value);
                  fetchCatalogVideos(1, catalogSearch, e.target.value);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs font-semibold text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="all">All Categories ({catalogTotal})</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Video List Table (Titles only, no thumbnails) */}
          <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/60">
            {isLoadingCatalog ? (
              <div className="py-20 text-center text-slate-400 text-xs flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                <span>Loading video catalog…</span>
              </div>
            ) : catalogVideos.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                No videos match your search or category filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 px-5 py-3 bg-slate-900/90 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <div className="col-span-7 sm:col-span-8">Video Title</div>
                  <div className="col-span-5 sm:col-span-4 text-right sm:text-left">Category Selection</div>
                </div>

                {/* Rows */}
                {catalogVideos.map((video, idx) => {
                  const currentCat = stagedCategoryChanges[video.youtube_id] || video.content_type || "Other";
                  const isModified = stagedCategoryChanges[video.youtube_id] !== undefined && stagedCategoryChanges[video.youtube_id] !== video.content_type;

                  return (
                    <div
                      key={video.youtube_id}
                      className={`grid grid-cols-12 gap-4 px-5 py-3.5 items-center transition-colors ${
                        isModified ? "bg-cyan-950/30 border-l-4 border-l-cyan-400" : "hover:bg-slate-900/50"
                      }`}
                    >
                      {/* Title & Metadata */}
                      <div className="col-span-7 sm:col-span-8 pr-2">
                        <div className="text-xs font-semibold text-slate-100 line-clamp-2 leading-snug">
                          {video.title}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1">
                          <span>{new Date(video.published_at).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>{video.duration || "15:00"}</span>
                          {isModified && (
                            <>
                              <span>•</span>
                              <span className="text-cyan-400 font-bold">Modified (Unsaved)</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Category Selector */}
                      <div className="col-span-5 sm:col-span-4 flex items-center justify-end sm:justify-start gap-2">
                        <select
                          value={currentCat}
                          onChange={(e) => handleCategorySelectChange(video.youtube_id, e.target.value)}
                          className={`w-full max-w-[220px] px-3 py-1.5 rounded-xl text-xs font-bold border focus:outline-none transition-colors cursor-pointer ${
                            isModified
                              ? "bg-cyan-950 border-cyan-500 text-cyan-300 shadow-sm shadow-cyan-500/20"
                              : "bg-slate-900 border-slate-700 text-slate-200 focus:border-cyan-500"
                          }`}
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Bar: Pagination & Save Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-slate-800">
            {/* Pagination Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const prevPage = Math.max(1, catalogPage - 1);
                  setCatalogPage(prevPage);
                  fetchCatalogVideos(prevPage, catalogSearch, catalogCategoryFilter);
                }}
                disabled={catalogPage <= 1 || isLoadingCatalog}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>

              <span className="text-xs text-slate-400 px-2 font-medium">
                Page <b className="text-white font-bold">{catalogPage}</b> of <b className="text-white font-bold">{catalogTotalPages}</b>
              </span>

              <button
                onClick={() => {
                  const nextPage = Math.min(catalogTotalPages, catalogPage + 1);
                  setCatalogPage(nextPage);
                  fetchCatalogVideos(nextPage, catalogSearch, catalogCategoryFilter);
                }}
                disabled={catalogPage >= catalogTotalPages || isLoadingCatalog}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-40 transition-colors"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bottom Save Option */}
            <div className="flex items-center gap-3">
              {Object.keys(stagedCategoryChanges).length > 0 && (
                <span className="text-xs text-cyan-300 font-semibold">
                  {Object.keys(stagedCategoryChanges).length} unsaved change{Object.keys(stagedCategoryChanges).length === 1 ? "" : "s"}
                </span>
              )}
              <button
                onClick={handleSaveBatchCategories}
                disabled={isSavingCategoryChanges || Object.keys(stagedCategoryChanges).length === 0}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-cyan-500/20 disabled:opacity-40 transition-all"
              >
                <Save className="w-4 h-4" />
                <span>
                  {isSavingCategoryChanges ? "Saving Updates…" : "Save / Update Category Info"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE NEW CATEGORY MODAL (On The Fly) */}
      {isCreateCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Tag className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-base font-extrabold text-white">Create New Category</h4>
                  <p className="text-[11px] text-slate-400">Add a new category classification on the fly.</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateCategoryModalOpen(false)}
                className="text-slate-500 hover:text-slate-200 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateNewCategory} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Category Name <span className="text-cyan-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Battery Tech & Tear Downs"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Brief description of videos belonging to this category"
                  value={newCatDescription}
                  onChange={(e) => setNewCatDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Accent Badge Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={newCatColor}
                    onChange={(e) => setNewCatColor(e.target.value)}
                    className="w-10 h-10 rounded-xl bg-transparent border-0 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-400">{newCatColor}</span>
                </div>
              </div>

              {/* Option to Add to Article Generator Templates */}
              <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-2xl flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newCatAddToTemplates}
                    onChange={(e) => setNewCatAddToTemplates(e.target.checked)}
                    className="w-4 h-4 rounded text-cyan-500 focus:ring-cyan-500 bg-slate-900 border-slate-700 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-200">
                    Add to Article Generator Templates
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 pl-7">
                  If enabled, this category will immediately appear as a selectable content type in the Article Generator.
                </p>

                {newCatAddToTemplates && (
                  <div className="pt-2 border-t border-slate-800/80 pl-7 flex flex-col gap-2">
                    <label className="block text-xs font-bold text-slate-300">
                      Custom Prompt Template for Article Generator
                    </label>
                    <textarea
                      rows={4}
                      placeholder="Write your custom system prompt instructions for generating articles in this category..."
                      value={newCatPromptTemplate}
                      onChange={(e) => setNewCatPromptTemplate(e.target.value)}
                      className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono leading-relaxed"
                    />
                    <span className="text-[10px] text-slate-500">
                      Leave blank to use The Electric Duo's default EV editorial template.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateCategoryModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 text-xs font-bold border border-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingCategory || !newCatName.trim()}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/20 disabled:opacity-40 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isCreatingCategory ? "Creating Category…" : "Create Category"}</span>
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
