import React, { useState } from "react";
import {
  Layers,
  ChevronDown,
  ChevronUp,
  Save,
  Trash2,
  ExternalLink,
  Download,
  Sliders,
  ArrowUp,
  ArrowDown,
  X,
  Plus,
  FileText,
} from "lucide-react";
import {
  MEDIA_KIT_BLOCKS,
  MEDIA_KIT_SECTIONS,
  isBlockAvailable,
} from "./mediaKitSections";

function estimatePages(activeBlocks, guards) {
  let totalHeight = 160 + 130; // Base header + contact closing
  const activeSet = new Set(activeBlocks);
  const heights = {
    "survey.stats": 180,
    "reach.headline": 150,
    "reach.perVideo": 140,
    "reach.engagement": 140,
    "reach.trailing12m": 150,
    "featuredIn.list": 100,
    "audience.geo": 140,
    "audience.buyingPower": 160,
    "audience.intent": 140,
    "pillars.bars": 180,
    "pillars.whoWeReach": 160,
    "recentWork.grid": 220,
    "duoBios.bios": 240,
    "beyondChannel.clubs": 140,
    "beyondChannel.socials": 140,
    "events.shows": 180,
    "partners.chips": 100,
    "partners.caseStudy": 120,
  };

  const activeSections = new Set();
  for (const block of MEDIA_KIT_BLOCKS) {
    if (activeSet.has(block.id) && isBlockAvailable(block.id, guards)) {
      totalHeight += heights[block.id] || 120;
      activeSections.add(block.section);
    }
  }
  totalHeight += activeSections.size * 40;

  return Math.max(1, Math.ceil(totalHeight / 950));
}

export default function MediaKitPresetBar({
  presets = [],
  activePresetId,
  onSelectPreset,
  activeBlocks = new Set(),
  onToggleBlock,
  onSelectAllSectionBlocks,
  sectionOrder = [],
  onReorderSection,
  recipient = "",
  onChangeRecipient,
  onSaveAs,
  onUpdatePreset,
  onDeletePreset,
  onDownloadPdf,
  isDownloadingPdf = false,
  guards = {},
  isDirty = false,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveRecipient, setSaveRecipient] = useState(recipient || "");
  const [isSaving, setIsSaving] = useState(false);

  const activePreset = presets.find((p) => p.id === activePresetId) || null;
  const isBuiltin = activePreset?.is_builtin === 1 || activePreset?.is_builtin === true;
  const pageEstimate = estimatePages(activeBlocks, guards);

  const handleOpenSaveModal = () => {
    setSaveName(activePreset && !isBuiltin ? activePreset.name : "");
    setSaveRecipient(recipient || "");
    setSaveModalOpen(true);
  };

  const handleConfirmSaveAs = async (e) => {
    e.preventDefault();
    if (!saveName.trim()) return;
    setIsSaving(true);
    try {
      await onSaveAs(saveName.trim(), saveRecipient.trim());
      setSaveModalOpen(false);
    } catch (err) {
      alert(err.message || "Failed to save preset");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenPreview = () => {
    const params = new URLSearchParams();
    params.set("theme", "light");
    if (activePresetId && activePresetId !== "custom") {
      params.set("preset", String(activePresetId));
    }
    if (recipient) {
      params.set("recipient", recipient);
    }
    if (activeBlocks && activeBlocks.size > 0) {
      params.set("blocks", Array.from(activeBlocks).join(","));
    }
    if (sectionOrder && sectionOrder.length > 0) {
      params.set("order", sectionOrder.join(","));
    }
    window.open(`/media-kit/print?${params.toString()}`, "_blank");
  };

  return (
    <div
      className="rounded-2xl border p-4 shadow-xl space-y-4"
      style={{
        backgroundColor: "var(--mk-card)",
        borderColor: "var(--mk-border)",
      }}
    >
      {/* Top Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: Preset Selector & Recipient */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4" style={{ color: "var(--mk-accent)" }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
              Preset:
            </span>
          </div>

          <select
            value={activePresetId || ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              onSelectPreset(id);
            }}
            className="px-3 py-1.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-1 cursor-pointer"
            style={{
              backgroundColor: "var(--mk-bg)",
              borderColor: "var(--mk-border)",
              color: "var(--mk-text)",
            }}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.is_builtin ? "(Built-in)" : ""}
              </option>
            ))}
            {activePresetId === "custom" && <option value="custom">Custom (Unsaved)</option>}
          </select>

          {isDirty && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{
                backgroundColor: "rgba(245, 158, 11, 0.15)",
                borderColor: "rgba(245, 158, 11, 0.4)",
                color: "var(--mk-warn)",
              }}
            >
              Modified
            </span>
          )}

          {/* Recipient Field */}
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-xs" style={{ color: "var(--mk-muted)" }}>
              For:
            </span>
            <input
              type="text"
              placeholder="e.g. Ford Motor Company"
              value={recipient}
              onChange={(e) => onChangeRecipient(e.target.value)}
              className="px-2.5 py-1 rounded-lg border text-xs w-44 focus:outline-none focus:ring-1"
              style={{
                backgroundColor: "var(--mk-bg)",
                borderColor: "var(--mk-border)",
                color: "var(--mk-text)",
              }}
            />
          </div>

          {/* Estimate badge */}
          <div
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold"
            style={{
              backgroundColor: "var(--mk-bg)",
              borderColor: "var(--mk-border)",
              color: "var(--mk-muted)",
            }}
          >
            <FileText className="w-3 h-3" style={{ color: "var(--mk-accent)" }} />
            <span>
              Est. ~{pageEstimate} {pageEstimate === 1 ? "page" : "pages"}
            </span>
          </div>
        </div>

        {/* Right Actions: Customize, Save, Preview, Download */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-sm cursor-pointer"
            style={{
              backgroundColor: drawerOpen ? "var(--mk-accent-soft)" : "var(--mk-bg)",
              borderColor: drawerOpen ? "var(--mk-accent)" : "var(--mk-border)",
              color: drawerOpen ? "var(--mk-accent)" : "var(--mk-text)",
            }}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Customize Sections</span>
            {drawerOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {!isBuiltin && activePreset && (
            <button
              type="button"
              onClick={onUpdatePreset}
              disabled={!isDirty}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all disabled:opacity-40 shadow-sm cursor-pointer"
              style={{
                backgroundColor: "var(--mk-bg)",
                borderColor: "var(--mk-border)",
                color: "var(--mk-text)",
              }}
              title="Save changes to current preset"
            >
              <Save className="w-3.5 h-3.5" style={{ color: "var(--mk-accent)" }} />
              <span>Update</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenSaveModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-sm cursor-pointer"
            style={{
              backgroundColor: "var(--mk-bg)",
              borderColor: "var(--mk-border)",
              color: "var(--mk-text)",
            }}
          >
            <Plus className="w-3.5 h-3.5" style={{ color: "var(--mk-accent)" }} />
            <span>Save as…</span>
          </button>

          {!isBuiltin && activePreset && (
            <button
              type="button"
              onClick={onDeletePreset}
              className="p-1.5 rounded-xl border text-xs font-semibold transition-all hover:bg-red-500/10 hover:border-red-500/30 text-red-400 shadow-sm cursor-pointer"
              style={{
                borderColor: "var(--mk-border)",
              }}
              title="Delete preset"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenPreview}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-sm cursor-pointer"
            style={{
              backgroundColor: "var(--mk-bg)",
              borderColor: "var(--mk-border)",
              color: "var(--mk-text)",
            }}
          >
            <ExternalLink className="w-3.5 h-3.5" style={{ color: "var(--mk-accent)" }} />
            <span>Preview Print</span>
          </button>

          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={isDownloadingPdf}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md shrink-0 cursor-pointer"
            style={{
              backgroundColor: "var(--mk-accent)",
              color: "var(--mk-bg)",
            }}
          >
            <Download className={`w-3.5 h-3.5 stroke-[2.5] ${isDownloadingPdf ? "animate-bounce" : ""}`} />
            <span>{isDownloadingPdf ? "Generating PDF…" : "Download PDF"}</span>
          </button>
        </div>
      </div>

      {/* Collapsible Block & Section Customizer Drawer */}
      {drawerOpen && (
        <div
          className="pt-4 border-t space-y-4 text-xs"
          style={{ borderColor: "var(--mk-border)" }}
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider" style={{ color: "var(--mk-muted)" }}>
              Fine-Grained Block Selection & Section Ordering
            </span>
            <span className="text-[11px]" style={{ color: "var(--mk-muted)" }}>
              Use arrows to adjust document section order
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sectionOrder.map((sectionId, idx) => {
              const secDef = MEDIA_KIT_SECTIONS.find((s) => s.id === sectionId);
              if (!secDef) return null;

              const secBlocks = MEDIA_KIT_BLOCKS.filter(
                (b) => b.section === sectionId && isBlockAvailable(b.id, guards)
              );
              if (secBlocks.length === 0) return null;

              const activeInSec = secBlocks.filter((b) => activeBlocks.has(b.id));
              const allChecked = activeInSec.length === secBlocks.length;
              const someChecked = activeInSec.length > 0 && !allChecked;

              return (
                <div
                  key={sectionId}
                  className="p-3 rounded-xl border space-y-2.5"
                  style={{
                    backgroundColor: "var(--mk-bg)",
                    borderColor: allChecked || someChecked ? "var(--mk-border)" : "rgba(255, 255, 255, 0.05)",
                    opacity: allChecked || someChecked ? 1 : 0.6,
                  }}
                >
                  {/* Section header with reorder & select-all */}
                  <div className="flex items-center justify-between pb-1.5 border-b" style={{ borderColor: "var(--mk-border)" }}>
                    <label className="flex items-center gap-2 cursor-pointer font-bold select-none">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => {
                          if (el) el.indeterminate = someChecked;
                        }}
                        onChange={(e) => onSelectAllSectionBlocks(sectionId, e.target.checked)}
                        className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                      />
                      <span style={{ color: allChecked || someChecked ? "var(--mk-text)" : "var(--mk-muted)" }}>
                        {secDef.label}
                      </span>
                    </label>

                    {/* Order up / down buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onReorderSection(idx, idx - 1)}
                        className="p-1 rounded hover:bg-slate-800 disabled:opacity-20 transition-opacity cursor-pointer"
                        title="Move section up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === sectionOrder.length - 1}
                        onClick={() => onReorderSection(idx, idx + 1)}
                        className="p-1 rounded hover:bg-slate-800 disabled:opacity-20 transition-opacity cursor-pointer"
                        title="Move section down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Individual blocks */}
                  <div className="space-y-1.5 pl-4">
                    {secBlocks.map((block) => {
                      const isChecked = activeBlocks.has(block.id);
                      return (
                        <label
                          key={block.id}
                          className="flex items-center justify-between gap-2 cursor-pointer select-none text-[11px] py-0.5"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => onToggleBlock(block.id)}
                              className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                            />
                            <span style={{ color: isChecked ? "var(--mk-text)" : "var(--mk-muted)" }}>
                              {block.label}
                            </span>
                          </div>
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider"
                            style={{
                              borderColor: "var(--mk-border)",
                              color: "var(--mk-muted)",
                            }}
                          >
                            Tier {block.tier}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Save As Preset Modal */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl border p-6 space-y-4 shadow-2xl"
            style={{
              backgroundColor: "var(--mk-card)",
              borderColor: "var(--mk-border)",
              color: "var(--mk-text)",
            }}
          >
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--mk-border)" }}>
              <h3 className="font-bold text-sm">Save Media Kit Preset</h3>
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmSaveAs} className="space-y-4 text-xs">
              <div>
                <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                  Preset Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ford Motor Company - Round 1"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: "var(--mk-bg)",
                    borderColor: "var(--mk-border)",
                    color: "var(--mk-text)",
                  }}
                />
              </div>

              <div>
                <label className="block mb-1 font-semibold" style={{ color: "var(--mk-muted)" }}>
                  Recipient (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ford Motor Company"
                  value={saveRecipient}
                  onChange={(e) => setSaveRecipient(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: "var(--mk-bg)",
                    borderColor: "var(--mk-border)",
                    color: "var(--mk-text)",
                  }}
                />
                <p className="text-[10px] mt-1" style={{ color: "var(--mk-muted)" }}>
                  Feeds the "Prepared for {saveRecipient || "Recipient"} · Month Year" subline on the document.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSaveModalOpen(false)}
                  className="px-4 py-2 rounded-xl border text-xs font-semibold"
                  style={{ borderColor: "var(--mk-border)", color: "var(--mk-muted)" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !saveName.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold shadow-md disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--mk-accent)",
                    color: "var(--mk-bg)",
                  }}
                >
                  {isSaving ? "Saving…" : "Save Preset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
