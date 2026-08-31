import React, { useState, useEffect, useRef } from "react";
import {
  CheckSquare,
  Zap,
  LogOut,
  User,
  Sparkles,
  BarChart3,
  Activity,
  Settings,
  Users,
  Newspaper,
  ChevronDown,
  Menu,
  X,
  Layers,
} from "lucide-react";
import PlanChecklist from "./PlanChecklist";
import ArticleGenerator from "./ArticleGenerator";
import FathomNews from "./FathomNews";
import VideoAudit from "./VideoAudit";
import ChannelHealth from "./ChannelHealth";
import CompetitorComparison from "./CompetitorComparison";
import AdminSettings from "./AdminSettings";

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeModule, setActiveModule] = useState(() => {
    return localStorage.getItem("ed_active_module") || "checklist";
  });
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [selectedAuditId, setSelectedAuditId] = useState(null);

  // Navigation dropdown states for responsive/grouped layout
  const [openDropdown, setOpenDropdown] = useState(null); // 'content' | 'analytics' | null
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef(null);

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleModuleSwitch = (mod) => {
    setActiveModule(mod);
    localStorage.setItem("ed_active_module", mod);
    setOpenDropdown(null);
    setMobileMenuOpen(false);
  };

  const handleSelectVideoForAudit = (youtubeId) => {
    setSelectedAuditId(youtubeId);
    handleModuleSwitch("audit");
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

  const isContentActive = activeModule === "article" || activeModule === "fathom";
  const isAnalyticsActive = activeModule === "channel" || activeModule === "audit" || activeModule === "comparison";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Master Top Navigation Bar */}
      <nav ref={navRef} className="sticky top-0 z-50 bg-slate-950/90 border-b border-slate-800/80 backdrop-blur-2xl px-4 sm:px-6 py-3 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/20 shrink-0">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-tight text-slate-100 text-base">
              The Electric Duo
            </span>
            <span className="hidden lg:inline-block text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
              Command Center
            </span>
          </div>
        </div>

        {/* Master Navigation Switcher (Desktop Grouped & Direct Mode) */}
        <div className="hidden md:flex items-center bg-slate-900/90 p-1 rounded-2xl border border-slate-800 shadow-inner gap-1">
          {/* 1. Plan Checklist */}
          <button
            onClick={() => handleModuleSwitch("checklist")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeModule === "checklist"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>Checklist</span>
          </button>

          {/* Divider */}
          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          {/* 2. Content Studio Dropdown / Group */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === "content" ? null : "content")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                isContentActive
                  ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              {activeModule === "fathom" ? (
                <Newspaper className="w-3.5 h-3.5" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>
                {activeModule === "fathom"
                  ? "Fathom News"
                  : activeModule === "article"
                  ? "Article Gen"
                  : "Content Studio"}
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform ${openDropdown === "content" ? "rotate-180" : ""}`} />
            </button>

            {openDropdown === "content" && (
              <div className="absolute left-0 mt-2 w-56 rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-2 z-50 flex flex-col gap-1 backdrop-blur-xl">
                <button
                  onClick={() => handleModuleSwitch("article")}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === "article"
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <div>Article Generator</div>
                    <div className="text-[10px] font-normal text-slate-400">YouTube video to WP draft</div>
                  </div>
                </button>

                <button
                  onClick={() => handleModuleSwitch("fathom")}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === "fathom"
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  <Newspaper className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <div>Ford Fathom News</div>
                    <div className="text-[10px] font-normal text-slate-400">News curation & Duo's Take</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          {/* 3. Analytics & Intelligence Group */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === "analytics" ? null : "analytics")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                isAnalyticsActive
                  ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              {activeModule === "audit" ? (
                <BarChart3 className="w-3.5 h-3.5" />
              ) : activeModule === "comparison" ? (
                <Users className="w-3.5 h-3.5" />
              ) : (
                <Activity className="w-3.5 h-3.5" />
              )}
              <span>
                {activeModule === "channel"
                  ? "Channel Health"
                  : activeModule === "audit"
                  ? "Video Audit"
                  : activeModule === "comparison"
                  ? "Competitors"
                  : "Analytics"}
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform ${openDropdown === "analytics" ? "rotate-180" : ""}`} />
            </button>

            {openDropdown === "analytics" && (
              <div className="absolute left-0 mt-2 w-60 rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-2 z-50 flex flex-col gap-1 backdrop-blur-xl">
                <button
                  onClick={() => handleModuleSwitch("channel")}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === "channel"
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <div>Channel Health</div>
                    <div className="text-[10px] font-normal text-slate-400">Audience, CTR & growth KPIs</div>
                  </div>
                </button>

                <button
                  onClick={() => handleModuleSwitch("audit")}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === "audit"
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  <BarChart3 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <div>Video Audit</div>
                    <div className="text-[10px] font-normal text-slate-400">Deep-dive video scores</div>
                  </div>
                </button>

                <button
                  onClick={() => handleModuleSwitch("comparison")}
                  className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeModule === "comparison"
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                  }`}
                >
                  <Users className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <div>Competitor Comparison</div>
                    <div className="text-[10px] font-normal text-slate-400">Benchmark vs rivals</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          {/* 4. Admin */}
          <button
            onClick={() => handleModuleSwitch("admin")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeModule === "admin"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Admin</span>
          </button>
        </div>

        {/* User Info & Actions */}
        <div className="flex items-center gap-3">
          {currentUser && (
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400">
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                Signed in as <b className="text-slate-200 font-semibold">{currentUser.name}</b>
              </span>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-400" />
            <span>Log out</span>
          </button>

          {/* Mobile Menu Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-900/95 border-b border-slate-800 px-4 py-4 space-y-2 backdrop-blur-2xl z-40">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 pt-1">
            Workflow & Content
          </div>
          <button
            onClick={() => handleModuleSwitch("checklist")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left ${
              activeModule === "checklist"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <CheckSquare className="w-4 h-4" />
            <span>Plan Checklist</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("article")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left ${
              activeModule === "article"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Article Generator</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("fathom")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left ${
              activeModule === "fathom"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Newspaper className="w-4 h-4" />
            <span>Ford Fathom News</span>
          </button>

          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 pt-2">
            Analytics & Management
          </div>

          <button
            onClick={() => handleModuleSwitch("channel")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left ${
              activeModule === "channel"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Channel Health</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("audit")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left ${
              activeModule === "audit"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Video Audit</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("comparison")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left ${
              activeModule === "comparison"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Competitor Comparison</span>
          </button>

          <button
            onClick={() => handleModuleSwitch("admin")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left ${
              activeModule === "admin"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Admin Settings</span>
          </button>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            {currentUser && (
              <span className="text-xs text-slate-400">User: {currentUser.name}</span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs text-rose-400 font-bold"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}

      {/* Main View Area */}
      <main className="flex-1 w-full">
        {activeModule === "checklist" && <PlanChecklist currentUser={currentUser} />}
        {activeModule === "article" && <ArticleGenerator currentUser={currentUser} />}
        {activeModule === "fathom" && <FathomNews currentUser={currentUser} />}
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
        {activeModule === "comparison" && <CompetitorComparison currentUser={currentUser} />}
        {activeModule === "admin" && <AdminSettings currentUser={currentUser} />}
      </main>
    </div>
  );
}
