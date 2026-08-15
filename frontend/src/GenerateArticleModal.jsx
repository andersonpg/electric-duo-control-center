import React, { useState } from "react";
import {
  X,
  Sparkles,
  UploadCloud,
  Trash2,
  CheckCircle2,
  ExternalLink,
  Layers,
  FileText,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";

export default function GenerateArticleModal({ video, templates, onClose, onGenerated }) {
  const [selectedTemplate, setSelectedTemplate] = useState(video.content_type || "Review");
  const [customNotes, setCustomNotes] = useState(video.custom_notes || "");
  const [photos, setPhotos] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [successResult, setSuccessResult] = useState(null);

  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (photos.length + files.length > 3) {
      alert("You can upload a maximum of 3 photos for inclusion in the article.");
      return;
    }

    files.forEach((file) => {
      if (!file.type.startsWith("image/")) {
        alert("Please upload image files only (JPEG, PNG, WebP).");
        return;
      }

      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        setPhotos((prev) => [
          ...prev,
          {
            name: file.name,
            size: (file.size / 1024).toFixed(0) + " KB",
            mimeType: file.type,
            data: uploadEvent.target.result,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  };

  const handleRemovePhoto = (index) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/articles/generate-single", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeId: video.youtube_id,
          templateName: selectedTemplate,
          customNotes: customNotes.trim(),
          photos: photos,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate article.");
      }

      setSuccessResult(data);
      if (onGenerated) onGenerated(video.youtube_id, data);
    } catch (err) {
      console.error("Article generation error:", err);
      setError(err.message || "An unexpected error occurred while generating the article.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 sm:p-7 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/20 shrink-0">
              <Sparkles className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Generate WordPress Article</h3>
              <div className="text-[11px] text-slate-400">Powered by Gemini 3.7 Flash & Real Transcripts</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video Card Preview */}
        <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex items-center gap-3.5">
          <img
            src={video.thumbnail_url || `https://img.youtube.com/vi/${video.youtube_id}/mqdefault.jpg`}
            alt=""
            className="w-24 h-14 rounded-xl object-cover shrink-0 border border-slate-800"
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-white line-clamp-2 leading-snug">{video.title}</h4>
            <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2 font-mono">
              <span>{video.duration || "15m"}</span>
              <span>•</span>
              <span>ID: {video.youtube_id}</span>
            </div>
          </div>
        </div>

        {/* Success Result View */}
        {successResult ? (
          <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-2xl p-5 flex flex-col items-center text-center gap-3 animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-200">WordPress Draft Created Successfully!</h4>
              <p className="text-xs text-emerald-300/80 mt-1">
                Post #{successResult.wpPostId} has been saved as a draft with embedded YouTube video and photos.
              </p>
            </div>

            <div className="flex items-center gap-3 mt-2">
              <a
                href={successResult.wpDraftUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Edit in WordPress (Post #{successResult.wpPostId})</span>
              </a>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleGenerate} className="flex flex-col gap-4">
            {/* Template Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Content Template / Article Mode</span>
              </label>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                disabled={isGenerating}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                {templates.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.name}>
                    {tmpl.name} — {tmpl.description || "Default structure"}
                  </option>
                ))}
              </select>
            </div>

            {/* Custom Notes & Additional Instructions */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>Additional Information & Custom Instructions</span>
              </label>
              <textarea
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                disabled={isGenerating}
                placeholder="Add specific context, key talking points, pricing updates, or instructions for Gemini to prioritize in this article..."
                rows={3}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none leading-relaxed"
              />
            </div>

            {/* Upload Up to 3 Photos */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Include Photos in Article (Optional · Up to 3)</span>
                </label>
                <span className="text-[10px] text-slate-400 font-mono">{photos.length} / 3 photos</span>
              </div>

              {/* Photo Previews */}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2.5 mb-2.5">
                  {photos.map((p, index) => (
                    <div
                      key={index}
                      className="relative group rounded-xl overflow-hidden bg-slate-950 border border-slate-700 aspect-video flex items-center justify-center shadow-md"
                    >
                      <img src={p.data} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(index)}
                        className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-slate-950/80 text-red-400 hover:text-red-300 hover:bg-slate-900 border border-red-500/40 shadow-md transition-all"
                        title="Remove photo"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-1 left-1.5 right-1.5 text-[9px] text-slate-300 bg-slate-950/80 px-1.5 py-0.5 rounded truncate">
                        {p.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload Dropzone */}
              {photos.length < 3 && (
                <label className="flex flex-col items-center justify-center p-4 rounded-2xl bg-slate-950/60 border-2 border-dashed border-slate-800 hover:border-cyan-500/50 cursor-pointer transition-colors group">
                  <UploadCloud className="w-6 h-6 text-slate-500 group-hover:text-cyan-400 transition-colors mb-1" />
                  <span className="text-xs font-semibold text-slate-300 group-hover:text-cyan-300">
                    Click or drag photos here to upload
                  </span>
                  <span className="text-[10px] text-slate-500 mt-0.5">JPEG, PNG, or WebP (max 3 images)</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    className="hidden"
                    disabled={isGenerating}
                  />
                </label>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-950/40 border border-red-500/30 rounded-xl p-3 flex items-center gap-2 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isGenerating}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isGenerating}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-500 hover:from-emerald-300 hover:to-cyan-400 text-slate-950 text-xs font-extrabold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 fill-current ${isGenerating ? "animate-spin" : ""}`} />
                <span>{isGenerating ? "Generating Article with AI..." : "Generate & Save WordPress Draft"}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
