import React, { useState } from 'react';
import { Search, Filter, Play, ExternalLink, Check, Sparkles, Video, Calendar, RotateCcw } from 'lucide-react';

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
  onProcessSelected,
  onResetSelected,
  isProcessing,
}) {
  const [selectedIds, setSelectedIds] = useState([]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const allChecked = videos.length > 0 && videos.every((v) => selectedIds.includes(v.youtube_id));

  const toggleSelectAll = () => {
    if (allChecked) {
      setSelectedIds([]);
    } else {
      setSelectedIds(videos.map((v) => v.youtube_id));
    }
  };

  const handleProcess = () => {
    if (selectedIds.length === 0) return;
    onProcessSelected(selectedIds);
  };

  const handleResetBatch = () => {
    if (selectedIds.length === 0) return;
    onResetSelected(selectedIds);
    setSelectedIds([]);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search & Filter Header Bar */}
      <div className="glass-panel p-4 rounded-2xl flex items-center justify-between flex-wrap gap-4 border border-slate-800">
        {/* Search Bar */}
        <div className="relative flex-1 min-w-[280px]">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search catalog by title or description keywords..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/90 border border-slate-700/70 text-slate-100 text-xs focus:outline-none focus:border-cyan-500 transition-colors"
          />
        </div>

        {/* Filters & Actions */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
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
              className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Content Modes</option>
              {templates.map((tmpl) => (
                <option key={tmpl.id} value={tmpl.name}>
                  {tmpl.name}
                </option>
              ))}
            </select>
          </div>

          {/* Reset Selected Button */}
          {selectedIds.length > 0 && (
            <button
              onClick={handleResetBatch}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Selected ({selectedIds.length})</span>
            </button>
          )}

          {/* Process Selected Action Button */}
          <button
            onClick={handleProcess}
            disabled={selectedIds.length === 0 || isProcessing}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl font-extrabold text-xs uppercase tracking-wider transition-all shadow-lg ${
              selectedIds.length === 0 || isProcessing
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-gradient-to-r from-emerald-400 to-cyan-500 hover:from-emerald-300 hover:to-cyan-400 text-slate-950 shadow-emerald-500/20'
            }`}
          >
            <Sparkles className={`w-4 h-4 ${isProcessing ? 'animate-pulse' : ''}`} />
            <span>
              {isProcessing
                ? 'Processing Articles...'
                : `Process Selected (${selectedIds.length})`}
            </span>
          </button>
        </div>
      </div>

      {/* Video Catalog Table */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleSelectAll}
                    disabled={videos.length === 0}
                    className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/40"
                  />
                </th>
                <th className="py-3.5 px-4 w-40">Thumbnail</th>
                <th className="py-3.5 px-4">Video Details</th>
                <th className="py-3.5 px-4 w-48">Content Mode</th>
                <th className="py-3.5 px-4 w-64">Custom Context Notes</th>
                <th className="py-3.5 px-4 w-44 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {videos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <Video className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-semibold">No videos found matching your search criteria.</p>
                    <p className="text-[11px] text-slate-600 mt-1">Try syncing your YouTube catalog from the header button.</p>
                  </td>
                </tr>
              ) : (
                videos.map((video) => {
                  const isDraftCreated = video.status === 'draft_created';
                  const isChecked = selectedIds.includes(video.youtube_id);

                  return (
                    <tr
                      key={video.youtube_id}
                      className={`hover:bg-slate-900/40 transition-colors ${
                        isChecked ? 'bg-cyan-500/5' : ''
                      }`}
                    >
                      {/* Select Checkbox */}
                      <td className="py-4 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(video.youtube_id)}
                          disabled={isProcessing}
                          className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/40"
                        />
                      </td>

                      {/* Thumbnail Preview */}
                      <td className="py-4 px-4">
                        <div className="relative group rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-video">
                          <img
                            src={video.thumbnail_url || `https://img.youtube.com/vi/${video.youtube_id}/maxresdefault.jpg`}
                            alt={video.title}
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = `https://img.youtube.com/vi/${video.youtube_id}/hqdefault.jpg`;
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <a
                            href={`https://youtube.com/watch?v=${video.youtube_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="absolute inset-0 flex items-center justify-center bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Play className="w-6 h-6 text-white fill-current" />
                          </a>
                        </div>
                      </td>

                      {/* Title & Publish Date */}
                      <td className="py-4 px-4">
                        <div className="font-bold text-slate-100 text-sm line-clamp-2 mb-1.5 hover:text-cyan-400 transition-colors">
                          <a href={`https://youtube.com/watch?v=${video.youtube_id}`} target="_blank" rel="noreferrer">
                            {video.title}
                          </a>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          <span>Published {formatDate(video.published_at)}</span>
                        </div>
                      </td>

                      {/* Content Mode Dropdown */}
                      <td className="py-4 px-4">
                        <select
                          value={video.content_type || 'Review'}
                          onChange={(e) =>
                            onUpdateVideo(video.youtube_id, { content_type: e.target.value })
                          }
                          disabled={isProcessing}
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs font-semibold text-slate-200 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
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
                          value={video.custom_notes || ''}
                          onChange={(e) =>
                            onUpdateVideo(video.youtube_id, { custom_notes: e.target.value })
                          }
                          placeholder="Add custom notes/instructions for AI..."
                          disabled={isProcessing}
                          rows={2}
                          className="w-full p-2.5 rounded-xl bg-slate-900/90 border border-slate-700/70 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 leading-normal resize-none disabled:opacity-50"
                        />
                      </td>

                      {/* Status Badge & Actions */}
                      <td className="py-4 px-4 text-center">
                        {isDraftCreated ? (
                          <div className="flex flex-col items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
                              <Check className="w-3 h-3" /> Draft Created
                            </span>
                            <div className="flex items-center gap-2">
                              {video.wp_draft_url && (
                                <a
                                  href={video.wp_draft_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
                                >
                                  <span>Edit</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              <button
                                onClick={() => onResetSelected([video.youtube_id])}
                                title="Reset back to Unprocessed so you can re-run AI processing"
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Reset</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 uppercase tracking-wider">
                            Unprocessed
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
