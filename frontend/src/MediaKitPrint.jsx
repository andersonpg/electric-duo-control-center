import React from "react";
import MediaKit from "./MediaKit";

export default function MediaKitPrint({ currentUser }) {
  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const theme = searchParams.get("theme") || "light";
  const presetId = searchParams.get("preset");
  const recipient = searchParams.get("recipient");

  return (
    <div className={`min-h-screen ${theme === "light" ? "bg-white" : "bg-[#0B1520]"}`}>
      <style>{`
        @page {
          size: letter;
          margin: 0.5in;
        }
      `}</style>
      <MediaKit
        currentUser={currentUser}
        isPrintMode={true}
        printTheme={theme}
        presetIdFromUrl={presetId}
        recipientFromUrl={recipient}
      />
    </div>
  );
}
