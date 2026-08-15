import React, { useState, useEffect } from "react";
import { CheckSquare, Zap, LogOut, User, Sparkles, BarChart3, Activity, Settings } from "lucide-react";
import PlanChecklist from "./PlanChecklist";
import ArticleGenerator from "./ArticleGenerator";
import VideoAudit from "./VideoAudit";
import ChannelHealth from "./ChannelHealth";
import AdminSettings from "./AdminSettings";

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeModule, setActiveModule] = useState(() => {
    return localStorage.getItem("ed_active_module") || "checklist";
  });
  const [isLoadingUser, setIsLoadingUser] = useState(true);

  useEffect(() => {
    fetch("/api/me", { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) {
          window.location.href = "/login.html";
          return;
        }
        return res.json();
      })
      .then((data) => {
        if (data && data.user) {
          setCurrentUser(data.user);
        }
        setIsLoadingUser(false);
      })
      .catch((err) => {
        console.error("Auth error:", err);
        setIsLoadingUser(false);
      });
  }, []);

  const handleModuleSwitch = (mod) => {
    setActiveModule(mod);
    localStorage.setItem("ed_active_module", mod);
  };

  const handleLogout = async () => {
    try {
      await fetch("/logout", { method: "POST", credentials: "same-origin" });
    } catch (e) {}
    window.location.href = "/login.html";
  };

  if (isLoadingUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400 text-sm">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-cyan-400"></div>
          <span>Loading Electric Duo Command Center…</span>
        </div>
      </div>
    );
  }

  const [selectedAuditId, setSelectedAuditId] = useState(null);

  const handleSelectVideoForAudit = (youtubeId) => {
    setSelectedAuditId(youtubeId);
    handleModuleSwitch("audit");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Master Top Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-slate-950/90 border-b border-slate-800/80 backdrop-blur-2xl px-6 py-3.5 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/20">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-tight text-slate-100 text-base">
              The Electric Duo
            </span>
            <span className="hidden sm:inline-block text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
              Command Center
            </span>
          </div>
        </div>

        {/* Master Navigation Switcher */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-2xl border border-slate-800 shadow-inner gap-1">
          <button
            onClick={() => handleModuleSwitch("checklist")}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModule === "checklist"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>Plan Checklist</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("article")}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModule === "article"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Article Generator</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("audit")}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModule === "audit"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Video Audit</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("channel")}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModule === "channel"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Channel Health</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("admin")}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              activeModule === "admin"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Admin</span>
          </button>
        </div>

        {/* User Info & Logout */}
        <div className="flex items-center gap-3">
          {currentUser && (
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400">
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                Signed in as <b className="text-slate-200 font-semibold">{currentUser.name}</b>
              </span>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-400" />
            <span>Log out</span>
          </button>
        </div>
      </nav>

      {/* Main View Area */}
      <main className="flex-1 w-full">
        {activeModule === "checklist" && <PlanChecklist currentUser={currentUser} />}
        {activeModule === "article" && <ArticleGenerator currentUser={currentUser} />}
        {activeModule === "audit" && (
          <VideoAudit
            currentUser={currentUser}
            initialVideoId={selectedAuditId}
            onClearInitialVideoId={() => setSelectedAuditId(null)}
          />
        )}
        {activeModule === "channel" && (
          <ChannelHealth
            currentUser={currentUser}
            onSelectVideoForAudit={handleSelectVideoForAudit}
          />
        )}
        {activeModule === "admin" && <AdminSettings currentUser={currentUser} />}
      </main>
    </div>
  );
}
