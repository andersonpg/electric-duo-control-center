import React, { useEffect } from "react";
import MediaKit from "./MediaKit";

export default function MediaKitPrint({ currentUser }) {
  useEffect(() => {
    // Auto-trigger print dialog after layout has rendered
    const timer = setTimeout(() => {
      window.print();
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B1520] print:bg-[#0B1520]">
      <style>{`
        @page {
          size: letter;
          margin: 0.35in;
        }
        @media print {
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            background-color: #0B1520 !important;
          }
          .no-print {
            display: none !important;
          }
          .section-header {
            break-after: avoid !important;
            page-break-after: avoid !important;
          }
          .recent-work-grid {
            display: grid !important;
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 1rem !important;
          }
          header, section, .recent-work-grid {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>
      <MediaKit currentUser={currentUser} isPrintMode={true} />
    </div>
  );
}
