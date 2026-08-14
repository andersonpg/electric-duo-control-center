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
    gemini_api_key: "",
    wp_site_url: "https://theelectricduo.com",
    wp_username: "patricka",
    wp_application_password: "",
    default_model: "gemini-3.7-flash",
    thinking_mode: "standard",
  });
  const [testResults, setTestResults] = useState({});
  const [testingService, setTestingService] = useState(null);

  // Models State
  const [models, setModels] = useState([]);

  // Maintenance State
  const [isSyncingDurations, setIsSyncingDurations] = useState(false);
  const [syncDurationResult, setSyncDurationResult] = useState(null);

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
        showToast(`Exact durations updated for ${data.updated} videos!`);
      } else {
        setSyncDurationResult("Error: " + (data.error || "Duration sync failed."));
      }
    } catch (err) {
      setSyncDurationResult("Error: " + err.message);
    } finally {
      setIsSyncingDurations(false);
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
          Manage user accounts, update API credentials with real-time connectivity testing, select default Gemini models (including Gemini 3.7 Flash), and run catalog maintenance tools.
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
          {/* YouTube API */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-red-500" />
                <h3 className="text-sm font-bold text-white">YouTube Data API v3</h3>
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
              <span>Save Integrations</span>
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
      {activeTab === "maintenance" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
          <div>
            <h3 className="text-base font-bold text-white mb-1">Catalog Duration Backfill</h3>
            <p className="text-xs text-slate-400">
              Query YouTube Data API v3 in batches of 50 to update exact real durations (e.g. 34:18 for Route 66, 8:45 for News) across all 562 videos in your local database.
            </p>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-white">Backfill Exact Video Durations</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Replaces placeholder durations with exact durations from YouTube Data API v3.
              </div>
            </div>

            <button
              onClick={handleSyncDurations}
              disabled={isSyncingDurations}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold text-xs uppercase tracking-wider shrink-0 disabled:opacity-50"
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
