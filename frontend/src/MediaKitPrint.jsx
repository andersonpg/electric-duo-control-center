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
    <div className="min-h-screen bg-slate-950 print:bg-slate-950">
      <style>{`
        @page {
          size: letter;
          margin: 0.4in;
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
        }
      `}</style>
      <MediaKit currentUser={currentUser} isPrintMode={true} />
    </div>
  );
}
