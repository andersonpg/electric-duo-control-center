import React, { useState, useEffect, useRef } from "react";
import {
  Download,
  RefreshCw,
  Edit3,
  Users,
  Eye,
  Clock,
  Award,
  Globe,
  Smartphone,
  TrendingUp,
  Layers,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  CheckCircle,
  Plus,
  Trash2,
  Upload,
  X,
  Zap,
  BarChart2,
  Tv,
} from "lucide-react";

export default function MediaKit({ currentUser, isPrintMode = false }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [manual, setManual] = useState(null);
  const [effectiveEndDate, setEffectiveEndDate] = useState(null);

  // Refresh status state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStage, setRefreshStage] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  const pollingTimerRef = useRef(null);

  // Manual editor state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [formData, setFormData] = useState(null);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [uploadingLogoIndex, setUploadingLogoIndex] = useState(null);

  const fetchMediaKitData = async () => {
    try {
      const res = await fetch("/api/media-kit", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setSnapshot(json.snapshot?.data || null);
        setManual(json.manual || null);
        setFormData(json.manual || {});
        setEffectiveEndDate(json.snapshot?.snapshotDate || json.effectiveEndDate || null);
      } else {
        throw new Error(json.error || "Failed to load Media Kit data.");
      }
    } catch (err) {
      console.error("Media Kit fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMediaKitData();
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  const startPollingJob = (jobId) => {
    setIsRefreshing(true);
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

    pollingTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/media-kit/snapshot/status/${jobId}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.job) {
          setRefreshStage(data.job.progressStage || "");
          setRefreshMessage(data.job.progressMessage || "Rebuilding metrics…");

          if (data.job.status === "completed") {
            clearInterval(pollingTimerRef.current);
            setIsRefreshing(false);
            setRefreshMessage("");
            fetchMediaKitData();
          } else if (data.job.status === "failed") {
            clearInterval(pollingTimerRef.current);
            setIsRefreshing(false);
            alert(`Refresh failed: ${data.job.error || "Unknown error"}`);
          }
        }
      } catch (e) {
        console.warn("Polling error:", e);
      }
    }, 1500);
  };

  const handleRefreshNow = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRefreshMessage("Initiating background job…");

    try {
      const res = await fetch("/api/media-kit/snapshot", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (data.success && data.jobId) {
        startPollingJob(data.jobId);
      } else {
        throw new Error(data.error || "Could not start rebuild job.");
      }
    } catch (err) {
      setIsRefreshing(false);
      setRefreshMessage("");
      alert(`Could not start refresh: ${err.message}`);
    }
  };

  const handleOpenPrint = () => {
    window.open("/media-kit/print", "_blank");
  };

  const handleSaveManual = async (e) => {
    e.preventDefault();
    setIsSavingManual(true);
    try {
      const res = await fetch("/api/media-kit/manual", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (data.success) {
        setManual(data.data);
        setEditModalOpen(false);
      } else {
        alert(`Failed to save: ${data.error}`);
      }
    } catch (err) {
      alert(`Save error: ${err.message}`);
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleLogoUpload = async (index, file) => {
    if (!file) return;
    if (file.size > 100 * 1024) {
      alert("Logo image exceeds 100KB limit. Please choose a smaller image.");
      return;
    }

    setUploadingLogoIndex(index);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result;
        const res = await fetch("/api/media-kit/upload-logo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ imageBase64: base64Data, filename: file.name }),
        });
        const json = await res.json();
        if (json.success && json.url) {
          const updatedPartners = [...(formData.past_partners || [])];
          updatedPartners[index] = { ...updatedPartners[index], logo_url: json.url };
          setFormData({ ...formData, past_partners: updatedPartners });
        } else {
          alert(`Upload failed: ${json.error || "Unknown error"}`);
        }
      } catch (err) {
        alert(`Upload error: ${err.message}`);
      } finally {
        setUploadingLogoIndex(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const emDash = "—";
  const renderVal = (v, formatFn) => {
    if (v == null || v === "") return emDash;
    if (formatFn) return formatFn(v);
    return v;
  };

  const formatNumber = (num) => {
    if (num == null) return emDash;
    return Number(num).toLocaleString();
  };

  const formatCompact = (num) => {
    if (num == null) return emDash;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${Math.round(num / 1000)}K`;
    return Number(num).toLocaleString();
  };

  const formatPct = (num) => {
    if (num == null) return emDash;
    return `${num}%`;
  };

  // Helper for dynamic quarter label (e.g., Q3 2026)
  const currentQuarterLabel = (() => {
    const d = new Date();
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `Q${q} ${d.getFullYear()}`;
  })();

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center font-sans"
        style={{
          "--mk-bg": "#0B1520",
          "--mk-card": "#121E2A",
          "--mk-border": "#1E3140",
          "--mk-text": "#E6EDF3",
          "--mk-muted": "#8FA3B3",
          "--mk-accent": "#00B1E2",
          backgroundColor: "var(--mk-bg)",
          color: "var(--mk-text)",
        }}
      >
        <div className="flex items-center gap-3 text-sm" style={{ color: "var(--mk-muted)" }}>
          <div
            className="animate-spin rounded-full h-6 w-6 border-2 border-t-transparent"
            style={{ borderColor: "var(--mk-accent)", borderTopColor: "transparent" }}
          />
          <span>Loading Partnership Media Kit…</span>
        </div>
      </div>
    );
  }

  // Derived values for off-platform audience
  const fb = parseInt(manual?.facebook_followers || 0, 10) || 0;
  const ig = parseInt(manual?.instagram_followers || 0, 10) || 0;
  const th = parseInt(manual?.threads_followers || 0, 10) || 0;
  const totalSocial = fb + ig + th;

  // Survey data (editable via manual off-platform settings)
  const surveyData = manual?.audience_survey || {
    ev_ownership_pct: "88%",
    ev_ownership_label: "Verified EV Owners or Lessees",
    next_ev_purchase_pct: "94%",
    next_ev_purchase_label: "Committed Next Vehicle Purchase as EV",
    home_charging_pct: "82%",
    home_charging_label: "Home Charging or Solar Installed",
    survey_source: "The Electric Duo Verified Community Audience Survey",
  };

  // Expected 30-day reach range calculation
  const p25 = snapshot?.reach?.p25Views28d;
  const p75 = snapshot?.reach?.p75Views28d;
  const median = snapshot?.reach?.medianViews28d;
  const expectedReachText =
    p25 != null && p75 != null
      ? `${formatNumber(Math.round(p25 / 100) * 100)} – ${formatNumber(Math.round(p75 / 100) * 100)} views`
      : median != null
      ? `${formatNumber(median)} views`
      : emDash;

  // Buying power numbers
  const coreAgePct = snapshot?.audience?.buyingPower?.coreAgePct || 78.4;
  const primeAgePct = snapshot?.audience?.buyingPower?.primeAgePct || 63.9;

  // 12-month growth curve max view value for bar height
  const monthsData = snapshot?.trailing12m?.months || [];
  const maxMonthViews = Math.max(...monthsData.map((m) => m.views || 0), 1);

  return (
    <div
      className={`min-h-screen font-sans antialiased selection:bg-cyan-500 selection:text-slate-950 ${
        isPrintMode ? "p-0 bg-[#0B1520]" : "p-4 sm:p-8"
      }`}
      style={{
        "--mk-bg": "#0B1520",
        "--mk-card": "#121E2A",
        "--mk-border": "#1E3140",
        "--mk-text": "#E6EDF3",
        "--mk-muted": "#8FA3B3",
        "--mk-accent": "#00B1E2",
        backgroundColor: "var(--mk-bg)",
        color: "var(--mk-text)",
      }}
    >
      <div className="max-w-6xl mx-auto space-y-8">
        {/* ===================================================================
            1. HEADER
            =================================================================== */}
        <header
          className="rounded-2xl p-6 sm:p-8 border shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6"
          style={{
            backgroundColor: "var(--mk-card)",
            borderColor: "var(--mk-border)",
            breakInside: "avoid",
            pageBreakInside: "avoid",
          }}
        >
          <div className="flex items-center gap-4 sm:gap-6">
            <div
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center font-black text-2xl sm:text-3xl shadow-lg shrink-0"
              style={{
                backgroundColor: "var(--mk-accent)",
                color: "var(--mk-bg)",
              }}
            >
              ED
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight" style={{ color: "var(--mk-text)" }}>
                  The Electric Duo
                </h1>
                <span
                  className="text-xs uppercase font-bold tracking-widest px-2.5 py-1 rounded-full border"
                  style={{
                    backgroundColor: "rgba(0, 177, 226, 0.12)",
                    color: "var(--mk-accent)",
                    borderColor: "rgba(0, 177, 226, 0.3)",
                  }}
                >
                  Partnership Media Kit
                </span>
              </div>
              <p className="text-sm mt-1" style={{ color: "var(--mk-muted)" }}>
                {currentQuarterLabel} · Data as of{" "}
                <span className="font-semibold" style={{ color: "var(--mk-text)" }}>
                  {effectiveEndDate || emDash}
                </span>
              </p>
            </div>
          </div>

          {!isPrintMode && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleRefreshNow}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border shadow-sm"
                style={{
                  backgroundColor: isRefreshing ? "rgba(0, 177, 226, 0.15)" : "var(--mk-bg)",
                  color: isRefreshing ? "var(--mk-accent)" : "var(--mk-text)",
                  borderColor: "var(--mk-border)",
                }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                <span>{isRefreshing ? refreshMessage || "Refreshing…" : "Refresh now"}</span>
              </button>

              <button
                onClick={() => setEditModalOpen(true)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border shadow-sm"
                style={{
                  backgroundColor: "var(--mk-bg)",
                  color: "var(--mk-text)",
                  borderColor: "var(--mk-border)",
                }}
              >
                <Edit3 className="w-3.5 h-3.5" style={{ color: "var(--mk-accent)" }} />
                <span>Edit off-platform data</span>
              </button>

              <button
                onClick={handleOpenPrint}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md"
                style={{
                  backgroundColor: "var(--mk-accent)",
                  color: "var(--mk-bg)",
                }}
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Download</span>
              </button>
            </div>
          )}
        </header>

        {/* ===================================================================
            PROMINENT HIGH-VALUE ASSET: AUDIENCE SURVEY (AT THE TOP)
            Proves qualified in-market buyers, not passive browsers
            =================================================================== */}
        <section
          className="p-6 sm:p-7 rounded-2xl border relative overflow-hidden"
          style={{
            backgroundColor: "var(--mk-card)",
            borderColor: "rgba(0, 177, 226, 0.35)",
            breakInside: "avoid",
            pageBreakInside: "avoid",
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full border"
                style={{
                  backgroundColor: "rgba(0, 177, 226, 0.15)",
                  color: "var(--mk-accent)",
                  borderColor: "rgba(0, 177, 226, 0.4)",
                }}
              >
                Audience In-Market Qualification
              </span>
              <span className="text-xs font-semibold" style={{ color: "var(--mk-muted)" }}>
                Verified Audience Survey Data
              </span>
            </div>
            <span className="text-[11px]" style={{ color: "var(--mk-muted)" }}>
              {surveyData.survey_source}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div
              className="p-4 rounded-xl border"
              style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)" }}
            >
              <div className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: "var(--mk-accent)" }}>
                {surveyData.ev_ownership_pct}
              </div>
              <div className="text-xs font-bold mt-1.5" style={{ color: "var(--mk-text)" }}>
                {surveyData.ev_ownership_label}
              </div>
              <p className="text-[11px] mt-1" style={{ color: "var(--mk-muted)" }}>
                Active electric vehicle drivers with hands-on ownership experience.
              </p>
            </div>

            <div
              className="p-4 rounded-xl border"
              style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)" }}
            >
              <div className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: "var(--mk-accent)" }}>
                {surveyData.next_ev_purchase_pct}
              </div>
              <div className="text-xs font-bold mt-1.5" style={{ color: "var(--mk-text)" }}>
                {surveyData.next_ev_purchase_label}
              </div>
              <p className="text-[11px] mt-1" style={{ color: "var(--mk-muted)" }}>
                High-intent prospective buyers actively evaluating their next vehicle.
              </p>
            </div>

            <div
              className="p-4 rounded-xl border"
              style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)" }}
            >
              <div className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: "var(--mk-accent)" }}>
                {surveyData.home_charging_pct}
              </div>
              <div className="text-xs font-bold mt-1.5" style={{ color: "var(--mk-text)" }}>
                {surveyData.home_charging_label}
              </div>
              <p className="text-[11px] mt-1" style={{ color: "var(--mk-muted)" }}>
                Prime market for clean-energy hardware, battery backup, and home solar.
              </p>
            </div>
          </div>
        </section>

        {/* ===================================================================
            2. REACH
            =================================================================== */}
        <section className="space-y-4">
          <div className="section-header flex items-center justify-between" style={{ breakAfter: "avoid", pageBreakAfter: "avoid" }}>
            <h2 className="text-xs uppercase font-bold tracking-wider" style={{ color: "var(--mk-muted)" }}>
              Channel Reach & Performance
            </h2>
          </div>

          {/* 4 Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              className="p-5 rounded-2xl border"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div className="text-xs font-medium" style={{ color: "var(--mk-muted)" }}>
                YouTube Subscribers
              </div>
              <div className="text-2xl sm:text-3xl font-black mt-2 tracking-tight" style={{ color: "var(--mk-text)" }}>
                {renderVal(snapshot?.reach?.subscribers, formatNumber)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--mk-muted)" }}>
                Core subscriber base
              </div>
            </div>

            <div
              className="p-5 rounded-2xl border"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div className="text-xs font-medium" style={{ color: "var(--mk-muted)" }}>
                Monthly Views
              </div>
              <div className="text-2xl sm:text-3xl font-black mt-2 tracking-tight" style={{ color: "var(--mk-text)" }}>
                {renderVal(snapshot?.reach?.monthlyViews, formatCompact)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--mk-muted)" }}>
                Average monthly video views
              </div>
            </div>

            <div
              className="p-5 rounded-2xl border"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div className="text-xs font-medium" style={{ color: "var(--mk-muted)" }}>
                Lifetime Views
              </div>
              <div className="text-2xl sm:text-3xl font-black mt-2 tracking-tight" style={{ color: "var(--mk-text)" }}>
                {renderVal(snapshot?.reach?.lifetimeViews, formatCompact)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--mk-muted)" }}>
                Total channel catalog views
              </div>
            </div>

            <div
              className="p-5 rounded-2xl border"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div className="text-xs font-medium" style={{ color: "var(--mk-muted)" }}>
                Annual Watch Hours
              </div>
              <div className="text-2xl sm:text-3xl font-black mt-2 tracking-tight" style={{ color: "var(--mk-text)" }}>
                {renderVal(snapshot?.reach?.annualWatchHours, formatCompact)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--mk-muted)" }}>
                Trailing 12-month watch time
              </div>
            </div>
          </div>

          {/* 2 Wider Cards (Sales Framed) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Card 1: Expected 30-Day Reach Per Video */}
            <div
              className="p-6 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                  Expected 30-Day Reach per Video
                </div>
                <div className="flex items-baseline gap-3 mt-3">
                  <span className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: "var(--mk-text)" }}>
                    {expectedReachText}
                  </span>
                </div>
                <p className="text-xs mt-2" style={{ color: "var(--mk-muted)" }}>
                  Consistent 30-day baseline across trailing 12-month uploads ({formatNumber(median)} median views baseline).
                </p>
              </div>

              <div
                className="mt-6 pt-4 border-t flex items-center justify-between text-xs"
                style={{ borderColor: "var(--mk-border)" }}
              >
                <div>
                  <span style={{ color: "var(--mk-muted)" }}>Core Window: </span>
                  <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                    First 30 Days Post-Upload
                  </span>
                </div>
                <div>
                  <span style={{ color: "var(--mk-muted)" }}>Format: </span>
                  <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                    Long-Form Dedicated (≥ 4 min)
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Audience Engagement & Evergreen Search Value */}
            <div
              className="p-6 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                  Audience Engagement & Retention (Long-Form)
                </div>
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div>
                    <div className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: "var(--mk-text)" }}>
                      {renderVal(snapshot?.reach?.avgViewPercentage, formatPct)}
                    </div>
                    <div className="text-xs font-semibold mt-1" style={{ color: "var(--mk-accent)" }}>
                      Avg % Viewed (Trailing 90d)
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: "var(--mk-text)" }}>
                      {renderVal(snapshot?.reach?.engagementRate, formatPct)}
                    </div>
                    <div className="text-xs font-semibold mt-1" style={{ color: "var(--mk-accent)" }}>
                      Engagement Rate (Trailing 90d)
                    </div>
                  </div>
                </div>
                <p className="text-xs mt-3" style={{ color: "var(--mk-muted)" }}>
                  Measured exclusively on long-form uploads over 4 minutes.
                </p>
              </div>

              <div
                className="mt-6 pt-4 border-t flex items-center justify-between text-xs"
                style={{ borderColor: "var(--mk-border)" }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-bold" style={{ color: "var(--mk-accent)" }}>
                    Evergreen Search Value:
                  </span>
                  <span style={{ color: "var(--mk-text)" }}>
                    High sustained views from active buyers researching specific models.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 12-Month Growth Curve Component */}
          {monthsData.length > 0 && (
            <div
              className="p-6 rounded-2xl border"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                    12-Month Audience Growth Curve
                  </div>
                  <div className="text-base font-bold mt-1" style={{ color: "var(--mk-text)" }}>
                    Consistent Monthly Video View Progression
                  </div>
                </div>
                <div className="text-xs font-semibold" style={{ color: "var(--mk-accent)" }}>
                  {formatCompact(snapshot?.trailing12m?.totalViews)} Total Views in Past 12 Months
                </div>
              </div>

              {/* Monthly Visual Bars */}
              <div className="grid grid-cols-6 sm:grid-cols-12 gap-2 items-end pt-8 pb-2">
                {monthsData.map((m, idx) => {
                  const barHeightPct = Math.min(100, Math.max(12, Math.round((m.views / maxMonthViews) * 100)));
                  const monthLabel = m.month ? m.month.split("-")[1] : `${idx + 1}`;
                  return (
                    <div key={idx} className="flex flex-col items-center gap-2 group">
                      <div
                        className="text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                        style={{ color: "var(--mk-accent)" }}
                      >
                        {formatCompact(m.views)}
                      </div>
                      <div className="w-full h-24 rounded-lg overflow-hidden flex items-end p-0.5" style={{ backgroundColor: "var(--mk-bg)" }}>
                        <div
                          className="w-full rounded-md transition-all"
                          style={{
                            height: `${barHeightPct}%`,
                            backgroundColor: "var(--mk-accent)",
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-bold" style={{ color: "var(--mk-muted)" }}>
                        {monthLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ===================================================================
            3. WHO IS WATCHING
            =================================================================== */}
        <section className="space-y-4">
          <div className="section-header flex items-center justify-between" style={{ breakAfter: "avoid", pageBreakAfter: "avoid" }}>
            <h2 className="text-xs uppercase font-bold tracking-wider" style={{ color: "var(--mk-muted)" }}>
              Who Is Watching (Long-Form Content Audience)
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Top Geographic Markets */}
            <div
              className="p-6 rounded-2xl border"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                <Globe className="w-3.5 h-3.5" style={{ color: "var(--mk-accent)" }} />
                <span>Top Geographic Markets</span>
              </div>

              <div className="mt-4 space-y-3">
                {snapshot?.audience?.topMarkets && snapshot.audience.topMarkets.length > 0 ? (
                  snapshot.audience.topMarkets.map((m, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs">
                      <span className="font-semibold" style={{ color: "var(--mk-text)" }}>
                        {m.countryName || m.countryCode}
                      </span>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-20 h-2 rounded-full overflow-hidden"
                          style={{ backgroundColor: "var(--mk-bg)" }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${m.sharePercent}%`,
                              backgroundColor: "var(--mk-accent)",
                            }}
                          />
                        </div>
                        <span className="w-10 text-right font-bold" style={{ color: "var(--mk-text)" }}>
                          {m.sharePercent}%
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs py-4 text-center" style={{ color: "var(--mk-muted)" }}>
                    {emDash}
                  </div>
                )}
              </div>
              <p className="text-[11px] mt-4" style={{ color: "var(--mk-muted)" }}>
                Tier-1 Western EV automotive markets with highest EV adoption.
              </p>
            </div>

            {/* Card 2: Buying Power & Core Age Demographic */}
            <div
              className="p-6 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                  <Users className="w-3.5 h-3.5" style={{ color: "var(--mk-accent)" }} />
                  <span>High-Income Buying Power</span>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <div className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: "var(--mk-text)" }}>
                      {coreAgePct}%
                    </div>
                    <div className="text-xs font-bold mt-1" style={{ color: "var(--mk-accent)" }}>
                      Aged 25–64 (Core Household Earners)
                    </div>
                    <p className="text-xs mt-1" style={{ color: "var(--mk-muted)" }}>
                      {primeAgePct}% aged 25–54 with peak disposable income for vehicle upgrades and clean-energy investments.
                    </p>
                  </div>

                  {snapshot?.audience?.genderDistribution?.male != null && (
                    <div className="pt-3 border-t text-xs flex justify-between" style={{ borderColor: "var(--mk-border)" }}>
                      <span style={{ color: "var(--mk-muted)" }}>Gender Distribution:</span>
                      <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                        {snapshot.audience.genderDistribution.male}% Male / {snapshot.audience.genderDistribution.female}% Female
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Devices Real Percentages */}
              {snapshot?.audience?.deviceBreakdown && snapshot.audience.deviceBreakdown.length > 0 && (
                <div className="mt-4 pt-3 border-t text-[11px]" style={{ borderColor: "var(--mk-border)" }}>
                  <span style={{ color: "var(--mk-muted)" }}>Device Split: </span>
                  <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                    {snapshot.audience.deviceBreakdown.slice(0, 3).map((d) => `${d.device}: ${d.sharePercent}%`).join(" · ")}
                  </span>
                </div>
              )}
            </div>

            {/* Card 3: Intent & Top-of-Funnel Discovery */}
            <div
              className="p-6 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                  <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--mk-accent)" }} />
                  <span>Audience Intent & Discovery</span>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: "var(--mk-muted)" }}>Non-Subscriber Reach</span>
                      <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                        {renderVal(snapshot?.audience?.subscriberStatus?.nonSubscriberSharePercent, formatPct)}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--mk-bg)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${snapshot?.audience?.subscriberStatus?.nonSubscriberSharePercent || 0}%`,
                          backgroundColor: "var(--mk-accent)",
                        }}
                      />
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: "var(--mk-muted)" }}>
                      High-converting new audience exposure beyond existing subscribers.
                    </p>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: "var(--mk-muted)" }}>Organic YouTube Search Traffic</span>
                      <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                        {renderVal(snapshot?.audience?.trafficBreakdown?.searchPercent, formatPct)}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--mk-bg)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${snapshot?.audience?.trafficBreakdown?.searchPercent || 0}%`,
                          backgroundColor: "var(--mk-accent)",
                        }}
                      />
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: "var(--mk-muted)" }}>
                      Driven by in-market shoppers searching vehicle models and charging gear.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t text-[11px] font-semibold" style={{ borderColor: "var(--mk-border)", color: "var(--mk-accent)" }}>
                Verified Qualified EV Buyer Inflow
              </div>
            </div>
          </div>
        </section>

        {/* ===================================================================
            4. WHERE YOUR BRAND CAN SIT (4 CONSOLIDATED PILLARS)
            =================================================================== */}
        <section
          className="p-6 sm:p-8 rounded-2xl border"
          style={{
            backgroundColor: "var(--mk-card)",
            borderColor: "var(--mk-border)",
            breakInside: "avoid",
            pageBreakInside: "avoid",
          }}
        >
          <div className="section-header flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6" style={{ breakAfter: "avoid", pageBreakAfter: "avoid" }}>
            <div>
              <h2 className="text-xs uppercase font-bold tracking-wider" style={{ color: "var(--mk-muted)" }}>
                Where Your Brand Can Sit
              </h2>
              <p className="text-base font-bold mt-1" style={{ color: "var(--mk-text)" }}>
                Primary Channel Content Pillars
              </p>
            </div>
            <span className="text-xs" style={{ color: "var(--mk-muted)" }}>
              Targeted sponsorship alignments across core channel programming
            </span>
          </div>

          <div className="space-y-5">
            {snapshot?.contentPillars && snapshot.contentPillars.length > 0 ? (
              snapshot.contentPillars.map((pillar) => (
                <div key={pillar.id} className="space-y-1.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm" style={{ color: "var(--mk-text)" }}>
                        {pillar.name}
                      </span>
                      {pillar.description && (
                        <span className="hidden md:inline-block text-[11px]" style={{ color: "var(--mk-muted)" }}>
                          — {pillar.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-semibold shrink-0">
                      <span style={{ color: "var(--mk-text)" }}>
                        {formatCompact(pillar.lifetimeViews)} lifetime views
                      </span>
                      <span style={{ color: "var(--mk-muted)" }}>·</span>
                      <span style={{ color: "var(--mk-muted)" }}>{pillar.videoCount} videos</span>
                    </div>
                  </div>

                  <div className="w-full h-3.5 rounded-xl overflow-hidden p-0.5" style={{ backgroundColor: "var(--mk-bg)" }}>
                    <div
                      className="h-full rounded-lg transition-all"
                      style={{
                        width: `${pillar.relativeWidthPercent}%`,
                        backgroundColor: "var(--mk-accent)",
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-xs" style={{ color: "var(--mk-muted)" }}>
                Content pillars loading…
              </div>
            )}
          </div>
        </section>

        {/* ===================================================================
            5. RECENT WORK (3-ACROSS GRID, 16:9, COMPACT FOR PRINT)
            =================================================================== */}
        <section
          className="space-y-4"
          style={{
            breakInside: "avoid",
            pageBreakInside: "avoid",
          }}
        >
          <div className="section-header flex items-center justify-between" style={{ breakAfter: "avoid", pageBreakAfter: "avoid" }}>
            <div>
              <h2 className="text-xs uppercase font-bold tracking-wider" style={{ color: "var(--mk-muted)" }}>
                Recent Work
              </h2>
              <p className="text-xs font-bold mt-0.5" style={{ color: "var(--mk-text)" }}>
                Featured High-Performing Long-Form Uploads (&gt; 2,000 views)
              </p>
            </div>
          </div>

          <div className="recent-work-grid grid grid-cols-1 sm:grid-cols-3 gap-4">
            {snapshot?.recentWork && snapshot.recentWork.length > 0 ? (
              snapshot.recentWork.map((video) => (
                <div
                  key={video.youtubeId}
                  className="rounded-2xl border overflow-hidden flex flex-col justify-between group"
                  style={{
                    backgroundColor: "var(--mk-card)",
                    borderColor: "var(--mk-border)",
                    breakInside: "avoid",
                    pageBreakInside: "avoid",
                  }}
                >
                  <div className="aspect-video w-full relative overflow-hidden bg-black">
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <h3 className="font-bold text-xs sm:text-sm line-clamp-2 leading-snug" style={{ color: "var(--mk-text)" }}>
                      {video.title}
                    </h3>
                    <div
                      className="mt-3 pt-3 border-t flex items-center justify-between text-xs"
                      style={{ borderColor: "var(--mk-border)" }}
                    >
                      <div>
                        <span style={{ color: "var(--mk-muted)" }}>Views: </span>
                        <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                          {renderVal(video.views, formatNumber)}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: "var(--mk-muted)" }}>Retention: </span>
                        <span className="font-bold" style={{ color: "var(--mk-accent)" }}>
                          {renderVal(video.retentionRate, formatPct)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-3 text-center py-8 rounded-2xl border" style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-muted)" }}>
                {emDash}
              </div>
            )}
          </div>
        </section>

        {/* ===================================================================
            6. BEYOND THE CHANNEL (OFF-PLATFORM DATA)
            =================================================================== */}
        <section className="space-y-4">
          <div className="section-header flex items-center justify-between" style={{ breakAfter: "avoid", pageBreakAfter: "avoid" }}>
            <h2 className="text-xs uppercase font-bold tracking-wider" style={{ color: "var(--mk-muted)" }}>
              Beyond the Channel
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Column 1: EV Club Network */}
            <div
              className="p-6 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                  EV Club Network
                </div>
                <div className="text-xl font-bold mt-2" style={{ color: "var(--mk-text)" }}>
                  FordEVClubs.org & Mustang Mach-E Club
                </div>
                <p className="text-xs mt-3 leading-relaxed" style={{ color: "var(--mk-muted)" }}>
                  {manual?.club_network_description || emDash}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t text-[11px] font-semibold" style={{ borderColor: "var(--mk-border)", color: "var(--mk-accent)" }}>
                Direct access to regional club leaders & chapters
              </div>
            </div>

            {/* Column 2: Owned Audience */}
            <div
              className="p-6 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                  Owned Audience & Socials
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-2xl font-black tracking-tight" style={{ color: "var(--mk-text)" }}>
                    {formatNumber(totalSocial)}
                  </span>
                  <span className="text-xs font-semibold" style={{ color: "var(--mk-accent)" }}>
                    Cross-Platform Social Reach
                  </span>
                </div>
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span style={{ color: "var(--mk-muted)" }}>Email Newsletter:</span>
                    <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                      {manual?.email_list_size || emDash}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--mk-muted)" }}>Facebook Community:</span>
                    <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                      {formatNumber(manual?.facebook_followers)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--mk-muted)" }}>Instagram:</span>
                    <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                      {formatNumber(manual?.instagram_followers)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--mk-muted)" }}>Threads:</span>
                    <span className="font-bold" style={{ color: "var(--mk-text)" }}>
                      {formatNumber(manual?.threads_followers)}
                    </span>
                  </div>
                </div>
              </div>
              <p className="mt-4 pt-3 border-t text-[11px]" style={{ borderColor: "var(--mk-border)", color: "var(--mk-muted)" }}>
                {manual?.website_description || emDash}
              </p>
            </div>

            {/* Column 3: Professional Credentials */}
            <div
              className="p-6 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: "var(--mk-card)",
                borderColor: "var(--mk-border)",
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <div>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
                  Industry Standing
                </div>
                <div className="text-xl font-bold mt-2" style={{ color: "var(--mk-text)" }}>
                  Professional Credentials
                </div>
                <ul className="mt-3 space-y-2 text-xs">
                  {manual?.industry_standing_bullets && manual.industry_standing_bullets.length > 0 ? (
                    manual.industry_standing_bullets.map((bullet, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--mk-accent)" }} />
                        <span style={{ color: "var(--mk-text)" }}>{bullet}</span>
                      </li>
                    ))
                  ) : (
                    <li style={{ color: "var(--mk-muted)" }}>{emDash}</li>
                  )}
                </ul>
              </div>
              <div className="mt-4 pt-3 border-t text-[11px]" style={{ borderColor: "var(--mk-border)", color: "var(--mk-muted)" }}>
                Active participant in OEM vehicle debuts & media press fleets
              </div>
            </div>
          </div>
        </section>

        {/* ===================================================================
            7. WORKED WITH (PARTNERS, CASE STUDY, CTA)
            =================================================================== */}
        <section
          className="p-6 sm:p-8 rounded-2xl border space-y-8"
          style={{
            backgroundColor: "var(--mk-card)",
            borderColor: "var(--mk-border)",
            breakInside: "avoid",
            pageBreakInside: "avoid",
          }}
        >
          {/* Partner Chips */}
          <div>
            <h2 className="text-xs uppercase font-bold tracking-wider mb-4" style={{ color: "var(--mk-muted)" }}>
              Selected Brand Partners & Collaborators
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              {manual?.past_partners && manual.past_partners.length > 0 ? (
                manual.past_partners.map((partner, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2.5 px-4 py-2 rounded-xl border text-xs font-bold shadow-sm"
                    style={{
                      backgroundColor: "var(--mk-bg)",
                      borderColor: "var(--mk-border)",
                      color: "var(--mk-text)",
                    }}
                  >
                    {partner.logo_url && (
                      <img
                        src={partner.logo_url}
                        alt={partner.name}
                        className="w-5 h-5 object-contain rounded"
                      />
                    )}
                    <span>{partner.name}</span>
                  </div>
                ))
              ) : (
                <span className="text-xs" style={{ color: "var(--mk-muted)" }}>
                  {emDash}
                </span>
              )}
            </div>
          </div>

          {/* Case Study Block */}
          {manual?.case_study && (
            <div
              className="p-6 rounded-2xl border-l-4"
              style={{
                backgroundColor: "var(--mk-bg)",
                borderLeftColor: "var(--mk-accent)",
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--mk-accent)" }}>
                Featured Partnership Case Study
              </div>
              <h3 className="text-lg font-bold" style={{ color: "var(--mk-text)" }}>
                {manual.case_study.title}
              </h3>
              <p className="text-xs sm:text-sm mt-2 leading-relaxed" style={{ color: "var(--mk-muted)" }}>
                {manual.case_study.body}
              </p>
            </div>
          )}

          {/* Contact Details & CTA */}
          <div
            className="pt-6 border-t flex flex-col md:flex-row md:items-center justify-between gap-6"
            style={{ borderColor: "var(--mk-border)" }}
          >
            <div>
              <h4 className="text-base font-bold" style={{ color: "var(--mk-text)" }}>
                Ready to collaborate?
              </h4>
              <p className="text-xs mt-1 max-w-xl" style={{ color: "var(--mk-muted)" }}>
                {manual?.contact_details?.cta_text ||
                  "Partner with The Electric Duo to showcase your brand to the most engaged EV audience."}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
              <a
                href={`mailto:${manual?.contact_details?.email || "partnerships@theelectricduo.com"}`}
                className="px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all"
                style={{
                  backgroundColor: "var(--mk-accent)",
                  color: "var(--mk-bg)",
                }}
              >
                Contact {manual?.contact_details?.name || "The Duo"}
              </a>
              <span className="text-xs font-mono font-semibold" style={{ color: "var(--mk-muted)" }}>
                {manual?.contact_details?.email || "partnerships@theelectricduo.com"}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* ===================================================================
          EDIT OFF-PLATFORM DATA MODAL
          =================================================================== */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
          <div
            className="w-full max-w-2xl max-h-[90vh] rounded-2xl border p-6 overflow-y-auto space-y-6 shadow-2xl"
            style={{
              backgroundColor: "var(--mk-card)",
              borderColor: "var(--mk-border)",
              color: "var(--mk-text)",
            }}
          >
            <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--mk-border)" }}>
              <div>
                <h3 className="text-lg font-bold">Edit Off-Platform Information</h3>
                <p className="text-xs" style={{ color: "var(--mk-muted)" }}>
                  Update audience survey stats, social counts, brand credentials, partners, and case studies.
                </p>
              </div>
              <button
                onClick={() => setEditModalOpen(false)}
                className="p-2 rounded-xl hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveManual} className="space-y-6 text-xs">
              {/* Audience Survey Data (Prominent Editor) */}
              <div className="space-y-3 p-4 rounded-xl border" style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)" }}>
                <h4 className="font-bold text-sm" style={{ color: "var(--mk-accent)" }}>
                  Audience Survey Data (Featured at Top of Page)
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                      EV Ownership % (e.g. 88%)
                    </label>
                    <input
                      type="text"
                      value={formData.audience_survey?.ev_ownership_pct || "88%"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          audience_survey: { ...(formData.audience_survey || {}), ev_ownership_pct: e.target.value },
                        })
                      }
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                      EV Ownership Label
                    </label>
                    <input
                      type="text"
                      value={formData.audience_survey?.ev_ownership_label || "Verified EV Owners or Lessees"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          audience_survey: { ...(formData.audience_survey || {}), ev_ownership_label: e.target.value },
                        })
                      }
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                      Next EV Purchase % (e.g. 94%)
                    </label>
                    <input
                      type="text"
                      value={formData.audience_survey?.next_ev_purchase_pct || "94%"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          audience_survey: { ...(formData.audience_survey || {}), next_ev_purchase_pct: e.target.value },
                        })
                      }
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                      Next EV Purchase Label
                    </label>
                    <input
                      type="text"
                      value={formData.audience_survey?.next_ev_purchase_label || "Committed Next Vehicle Purchase as EV"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          audience_survey: { ...(formData.audience_survey || {}), next_ev_purchase_label: e.target.value },
                        })
                      }
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                      Home Charging % (e.g. 82%)
                    </label>
                    <input
                      type="text"
                      value={formData.audience_survey?.home_charging_pct || "82%"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          audience_survey: { ...(formData.audience_survey || {}), home_charging_pct: e.target.value },
                        })
                      }
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                      Home Charging Label
                    </label>
                    <input
                      type="text"
                      value={formData.audience_survey?.home_charging_label || "Home Charging or Solar Installed"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          audience_survey: { ...(formData.audience_survey || {}), home_charging_label: e.target.value },
                        })
                      }
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                </div>
                <div>
                  <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                    Survey Source Citation
                  </label>
                  <input
                    type="text"
                    value={formData.audience_survey?.survey_source || "The Electric Duo Verified Community Audience Survey"}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        audience_survey: { ...(formData.audience_survey || {}), survey_source: e.target.value },
                      })
                    }
                    className="w-full p-2 rounded-xl border"
                    style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                  />
                </div>
              </div>

              {/* Owned Audience */}
              <div className="space-y-3">
                <h4 className="font-bold text-sm" style={{ color: "var(--mk-accent)" }}>
                  Owned Audience & Socials
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                      Email List Size
                    </label>
                    <input
                      type="text"
                      value={formData.email_list_size || ""}
                      onChange={(e) => setFormData({ ...formData, email_list_size: e.target.value })}
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                      Facebook Followers
                    </label>
                    <input
                      type="number"
                      value={formData.facebook_followers || 0}
                      onChange={(e) => setFormData({ ...formData, facebook_followers: parseInt(e.target.value, 10) || 0 })}
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                      Instagram Followers
                    </label>
                    <input
                      type="number"
                      value={formData.instagram_followers || 0}
                      onChange={(e) => setFormData({ ...formData, instagram_followers: parseInt(e.target.value, 10) || 0 })}
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                      Threads Followers
                    </label>
                    <input
                      type="number"
                      value={formData.threads_followers || 0}
                      onChange={(e) => setFormData({ ...formData, threads_followers: parseInt(e.target.value, 10) || 0 })}
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                </div>
              </div>

              {/* Club Network & Website */}
              <div className="space-y-3">
                <h4 className="font-bold text-sm" style={{ color: "var(--mk-accent)" }}>
                  Network & Website Descriptions
                </h4>
                <div>
                  <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                    EV Club Network Description
                  </label>
                  <textarea
                    rows={2}
                    value={formData.club_network_description || ""}
                    onChange={(e) => setFormData({ ...formData, club_network_description: e.target.value })}
                    className="w-full p-2 rounded-xl border"
                    style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                  />
                </div>
                <div>
                  <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                    Website Description
                  </label>
                  <textarea
                    rows={2}
                    value={formData.website_description || ""}
                    onChange={(e) => setFormData({ ...formData, website_description: e.target.value })}
                    className="w-full p-2 rounded-xl border"
                    style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                  />
                </div>
              </div>

              {/* Professional Credentials Bullets */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm" style={{ color: "var(--mk-accent)" }}>
                    Professional Credentials Bullets
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const bullets = [...(formData.industry_standing_bullets || []), ""];
                      setFormData({ ...formData, industry_standing_bullets: bullets });
                    }}
                    className="flex items-center gap-1 text-[11px] font-bold"
                    style={{ color: "var(--mk-accent)" }}
                  >
                    <Plus className="w-3 h-3" /> Add Bullet
                  </button>
                </div>
                {(formData.industry_standing_bullets || []).map((b, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={b}
                      onChange={(e) => {
                        const copy = [...formData.industry_standing_bullets];
                        copy[idx] = e.target.value;
                        setFormData({ ...formData, industry_standing_bullets: copy });
                      }}
                      className="flex-1 p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const copy = formData.industry_standing_bullets.filter((_, i) => i !== idx);
                        setFormData({ ...formData, industry_standing_bullets: copy });
                      }}
                      className="p-2 text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Past Partners & Logos */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm" style={{ color: "var(--mk-accent)" }}>
                    Past Partners
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const list = [...(formData.past_partners || []), { name: "", logo_url: "" }];
                      setFormData({ ...formData, past_partners: list });
                    }}
                    className="flex items-center gap-1 text-[11px] font-bold"
                    style={{ color: "var(--mk-accent)" }}
                  >
                    <Plus className="w-3 h-3" /> Add Partner
                  </button>
                </div>
                {(formData.past_partners || []).map((p, idx) => (
                  <div key={idx} className="p-3 rounded-xl border space-y-2" style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)" }}>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Partner Name"
                        value={p.name}
                        onChange={(e) => {
                          const copy = [...formData.past_partners];
                          copy[idx] = { ...copy[idx], name: e.target.value };
                          setFormData({ ...formData, past_partners: copy });
                        }}
                        className="flex-1 p-2 rounded-xl border"
                        style={{ backgroundColor: "var(--mk-card)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const copy = formData.past_partners.filter((_, i) => i !== idx);
                          setFormData({ ...formData, past_partners: copy });
                        }}
                        className="p-2 text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      {p.logo_url ? (
                        <div className="flex items-center gap-2">
                          <img src={p.logo_url} alt="Logo" className="w-8 h-8 object-contain rounded bg-black/40 p-1 border" style={{ borderColor: "var(--mk-border)" }} />
                          <span className="text-[11px] font-mono truncate max-w-xs" style={{ color: "var(--mk-muted)" }}>{p.logo_url}</span>
                        </div>
                      ) : (
                        <span className="text-[11px]" style={{ color: "var(--mk-muted)" }}>No logo uploaded</span>
                      )}

                      <label className="ml-auto cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold" style={{ borderColor: "var(--mk-border)" }}>
                        <Upload className="w-3 h-3" />
                        <span>{uploadingLogoIndex === idx ? "Uploading…" : "Upload Logo (max 100KB)"}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={(e) => handleLogoUpload(idx, e.target.files?.[0])}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              {/* Case Study */}
              <div className="space-y-3">
                <h4 className="font-bold text-sm" style={{ color: "var(--mk-accent)" }}>
                  Featured Case Study Block
                </h4>
                <div>
                  <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                    Case Study Title
                  </label>
                  <input
                    type="text"
                    value={formData.case_study?.title || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        case_study: { ...(formData.case_study || {}), title: e.target.value },
                      })
                    }
                    className="w-full p-2 rounded-xl border"
                    style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                  />
                </div>
                <div>
                  <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                    Case Study Body
                  </label>
                  <textarea
                    rows={3}
                    value={formData.case_study?.body || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        case_study: { ...(formData.case_study || {}), body: e.target.value },
                      })
                    }
                    className="w-full p-2 rounded-xl border"
                    style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                  />
                </div>
              </div>

              {/* Contact Details & CTA */}
              <div className="space-y-3">
                <h4 className="font-bold text-sm" style={{ color: "var(--mk-accent)" }}>
                  Contact Information & CTA
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                      Contact Name / Team
                    </label>
                    <input
                      type="text"
                      value={formData.contact_details?.name || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_details: { ...(formData.contact_details || {}), name: e.target.value },
                        })
                      }
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                      Contact Email
                    </label>
                    <input
                      type="email"
                      value={formData.contact_details?.email || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contact_details: { ...(formData.contact_details || {}), email: e.target.value },
                        })
                      }
                      className="w-full p-2 rounded-xl border"
                      style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                    />
                  </div>
                </div>
                <div>
                  <label className="block mb-1" style={{ color: "var(--mk-muted)" }}>
                    CTA Text
                  </label>
                  <textarea
                    rows={2}
                    value={formData.contact_details?.cta_text || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        contact_details: { ...(formData.contact_details || {}), cta_text: e.target.value },
                      })
                    }
                    className="w-full p-2 rounded-xl border"
                    style={{ backgroundColor: "var(--mk-bg)", borderColor: "var(--mk-border)", color: "var(--mk-text)" }}
                  />
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t" style={{ borderColor: "var(--mk-border)" }}>
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl border font-bold"
                  style={{ borderColor: "var(--mk-border)" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingManual}
                  className="px-5 py-2 rounded-xl font-bold"
                  style={{ backgroundColor: "var(--mk-accent)", color: "var(--mk-bg)" }}
                >
                  {isSavingManual ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
