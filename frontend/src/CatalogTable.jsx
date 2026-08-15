import React, { useState } from "react";
import { Search, Filter, Play, ExternalLink, Sparkles, Calendar, RotateCcw, CheckCircle2 } from "lucide-react";
import GenerateArticleModal from "./GenerateArticleModal";

export default function CatalogTable({
  videos,
  templates,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  categoryFilter,
  setCategoryFilter,
  onUpdateVideo,
  onResetVideo,
}) {
  const [activeModalVideo, setActiveModalVideo] = useState(null);

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  const handleArticleGenerated = (youtubeId, result) => {
    if (onUpdateVideo) {
      onUpdateVideo(youtubeId, {
        status: "draft_created",
        wp_post_id: result.wpPostId,
        wp_draft_url: result.wpDraftUrl,
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search & Filter Header Bar */}
      <div className="bg-slate-900/80 p-4 rounded-2xl flex items-center justify-between flex-wrap gap-4 border border-slate-800">
        {/* Search Bar */}
        <div className="relative flex-1 min-w-[280px]">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search catalog by title or keywords..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-700/70 text-slate-100 text-xs focus:outline-none focus:border-cyan-500 transition-colors font-medium"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Statuses</option>
              <option value="unprocessed">Unprocessed Only</option>
              <option value="draft_created">Draft Created</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Content Modes</option>
              {templates.map((tmpl) => (
                <option key={tmpl.id} value={tmpl.name}>
                  {tmpl.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Catalog Table Container */}
      <div className="bg-slate-900/90 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 font-semibold tracking-wider uppercase text-[10px]">
                <th className="py-3.5 px-4 w-32">Thumbnail</th>
                <th className="py-3.5 px-4 min-w-[280px]">Video Details</th>
                <th className="py-3.5 px-4 w-44">Content Mode</th>
                <th className="py-3.5 px-4 min-w-[200px]">Custom Context / Notes</th>
                <th className="py-3.5 px-4 w-52 text-right">Actions & WordPress Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60 font-sans">
              {videos.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    No videos found matching your filters.
                  </td>
                </tr>
              ) : (
                videos.map((video) => {
                  const isDraftCreated = video.status === "draft_created";

                  return (
                    <tr key={video.youtube_id} className="hover:bg-slate-800/40 transition-colors">
                      {/* Thumbnail Preview */}
                      <td className="py-4 px-4">
                        <div className="relative group rounded-xl overflow-hidden aspect-video bg-slate-950 border border-slate-700/80 shadow-md">
                          <img
                            src={video.thumbnail_url || `https://img.youtube.com/vi/${video.youtube_id}/maxresdefault.jpg`}
                            alt={video.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => {
                              e.target.src = `https://img.youtube.com/vi/${video.youtube_id}/hqdefault.jpg`;
                            }}
                          />
                          <a
                            href={`https://www.youtube.com/watch?v=${video.youtube_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="absolute inset-0 flex items-center justify-center bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Play className="w-6 h-6 text-cyan-400 fill-current" />
                          </a>
                        </div>
                      </td>

                      {/* Video Title & Meta */}
                      <td className="py-4 px-4">
                        <div className="flex flex-col gap-1">
                          <a
                            href={`https://www.youtube.com/watch?v=${video.youtube_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-slate-100 hover:text-cyan-400 transition-colors leading-snug line-clamp-2 text-xs"
                          >
                            {video.title}
                          </a>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              {formatDate(video.published_at)}
                            </span>
                            <span>•</span>
                            <span>{video.duration || "15m"}</span>
                            <span>•</span>
                            <span className="text-slate-500">ID: {video.youtube_id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Content Mode / Template Selector */}
                      <td className="py-4 px-4">
                        <select
                          value={video.content_type || "Review"}
                          onChange={(e) => onUpdateVideo && onUpdateVideo(video.youtube_id, { content_type: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700/80 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                        >
                          {templates.map((tmpl) => (
                            <option key={tmpl.id} value={tmpl.name}>
                              {tmpl.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Custom Context Notes */}
                      <td className="py-4 px-4">
                        <textarea
                          value={video.custom_notes || ""}
                          onChange={(e) => onUpdateVideo && onUpdateVideo(video.youtube_id, { custom_notes: e.target.value })}
                          placeholder="Add custom notes or instructions for AI..."
                          rows={2}
                          className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-700/70 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 leading-normal resize-none"
                        />
                      </td>

                      {/* Individual Action & Status */}
                      <td className="py-4 px-4 text-right">
                        <div className="flex flex-col items-end gap-2">
                          {isDraftCreated ? (
                            <div className="flex flex-col items-end gap-1.5">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-950/80 border border-emerald-500/30 text-emerald-300">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                Draft Created
                              </span>

                              <div className="flex items-center gap-1.5">
                                {video.wp_draft_url && (
                                  <a
                                    href={video.wp_draft_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-[11px] font-bold transition-colors"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>Edit Draft</span>
                                  </a>
                                )}
                                <button
                                  onClick={() => setActiveModalVideo(video)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition-colors"
                                >
                                  Regenerate
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setActiveModalVideo(video)}
                              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-500 hover:from-emerald-300 hover:to-cyan-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 transition-all"
                            >
                              <Sparkles className="w-3.5 h-3.5 fill-current" />
                              <span>Generate Article</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Single Video Generation Modal with Notes & Photo Uploads */}
      {activeModalVideo && (
        <GenerateArticleModal
          video={activeModalVideo}
          templates={templates}
          onClose={() => setActiveModalVideo(null)}
          onGenerated={handleArticleGenerated}
        />
      )}
    </div>
  );
}
