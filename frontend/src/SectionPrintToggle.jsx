import React from "react";
import { Printer } from "lucide-react";

export default function SectionPrintToggle({ isIncluded, onToggle, label = "PDF" }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="no-print inline-flex items-center gap-2 px-2.5 py-1 rounded-xl cursor-pointer select-none transition-all border group"
      style={{
        backgroundColor: isIncluded ? "rgba(0, 177, 226, 0.08)" : "rgba(255, 255, 255, 0.03)",
        borderColor: isIncluded ? "rgba(0, 177, 226, 0.3)" : "rgba(255, 255, 255, 0.1)",
      }}
      title={isIncluded ? "Included in PDF export (click to exclude)" : "Excluded from PDF export (click to include)"}
      aria-label={`Toggle ${label} section in PDF export`}
      aria-pressed={isIncluded}
    >
      <Printer
        className="w-3.5 h-3.5 transition-colors shrink-0"
        style={{ color: isIncluded ? "var(--mk-accent, #00b1e2)" : "rgba(255, 255, 255, 0.4)" }}
      />
      <span
        className="text-[11px] font-semibold tracking-wide hidden sm:inline"
        style={{ color: isIncluded ? "var(--mk-text, #ffffff)" : "rgba(255, 255, 255, 0.5)" }}
      >
        {label}
      </span>
      {/* Slider switch track and knob */}
      <div
        className="w-7 h-4 rounded-full p-0.5 transition-colors flex items-center relative shrink-0"
        style={{
          backgroundColor: isIncluded ? "var(--mk-accent, #00b1e2)" : "rgba(255, 255, 255, 0.2)",
        }}
      >
        <div
          className="w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out"
          style={{
            transform: isIncluded ? "translateX(12px)" : "translateX(0px)",
          }}
        />
      </div>
      <span
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: isIncluded ? "var(--mk-accent, #00b1e2)" : "rgba(255, 255, 255, 0.4)" }}
      >
        {isIncluded ? "In PDF" : "Excluded"}
      </span>
    </button>
  );
}
