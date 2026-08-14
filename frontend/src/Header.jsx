import React, { useState, useRef, useEffect } from "react";
import { RefreshCw, Zap, Sliders, ChevronDown, Layers } from "lucide-react";

export default function Header({ onSync, isSyncing, onOpenTemplates }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSyncClick = (mode) => {
    setDropdownOpen(false);
    onSync(mode);
  };

  return (
    <div className="border-b border-slate-800 bg-slate-950/60 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-slate-950">
            <Zap className="w-6 h-6 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-slate-200 to-slate-400">
                The Electric Duo
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest">
                Article Generator
              </span>
            </div>
            <p className="text-xs text-slate-400">YouTube Catalog to WordPress Automated Draft Publisher</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* Template Manager Modal Trigger */}
          <button
            onClick={onOpenTemplates}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 text-xs font-semibold tracking-wide border border-slate-700/60 transition-all hover:border-slate-600"
          >
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span>Template Manager</span>
          </button>

          {/* Sync Catalog Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg ${
                isSyncing
                  ? "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
                  : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-cyan-500/20"
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
              <span>{isSyncing ? "Syncing Catalog..." : "Sync Catalog"}</span>
              <ChevronDown className="w-4 h-4 ml-1 opacity-70" />
            </button>

            {dropdownOpen && !isSyncing && (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-2 z-50 flex flex-col gap-1">
                <button
                  onClick={() => handleSyncClick("delta")}
                  className="flex items-start gap-3 w-full text-left p-3 rounded-xl hover:bg-slate-800/80 transition-colors group"
                >
                  <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500/20">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-200">Manual Delta Sync</div>
                    <div className="text-[11px] text-slate-400">Fetch latest videos until cached ID is found</div>
                  </div>
                </button>

                <button
                  onClick={() => handleSyncClick("full")}
                  className="flex items-start gap-3 w-full text-left p-3 rounded-xl hover:bg-slate-800/80 transition-colors group"
                >
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-200">Full Catalog Sync</div>
                    <div className="text-[11px] text-slate-400">Paginate entire channel upload history</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
