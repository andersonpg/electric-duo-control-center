import React, { useState } from 'react';
import { X, Plus, Edit2, Trash2, Save, FileCode } from 'lucide-react';

export default function TemplateManagerModal({ isOpen, onClose, templates, onSaveTemplate, onDeleteTemplate }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', prompt_template: '' });

  if (!isOpen) return null;

  const handleSelect = (tmpl) => {
    setSelectedTemplate(tmpl);
    setIsCreating(false);
    setFormData({
      name: tmpl.name,
      description: tmpl.description || '',
      prompt_template: tmpl.prompt_template,
    });
  };

  const handleStartCreate = () => {
    setSelectedTemplate(null);
    setIsCreating(true);
    setFormData({
      name: '',
      description: '',
      prompt_template: `GLOBAL ROLE & VOICE:
You are the lead technical writer for TheElectricDuo.com. Write in the first-person ("we" / "I"), adopting an enthusiastic, knowledgeable, and direct tone of an experienced EV peer.

ABSOLUTE RULES:
1. Banned AI Clichés: NEVER use words like "delve", "game-changer", "testament", "unlock", "dive into", "revolutionize", or "in conclusion."
2. Formatting: Output pure, formatted HTML suitable for the WordPress Gutenberg editor (<h2>, <h3>, <ul>, <ol>, <strong>, and <table>).
3. User Context: Honor any specific custom notes provided by the user.

STRUCTURE REQUIREMENTS:
- Section 1: ...
- Section 2: ...`,
    });
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!formData.name || !formData.prompt_template) return;

    onSaveTemplate({
      id: selectedTemplate ? selectedTemplate.id : undefined,
      ...formData,
    });

    setIsCreating(false);
    setSelectedTemplate(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-5xl max-h-[90vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden border border-slate-700/50">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Content Template Manager</h2>
              <p className="text-xs text-slate-400">Customize prompt instructions and structure rules per category</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar - Template List */}
          <div className="w-64 border-r border-slate-800 p-4 flex flex-col gap-2 bg-slate-900/30 overflow-y-auto">
            <button
              onClick={handleStartCreate}
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold text-xs tracking-wider uppercase transition-all shadow-lg shadow-cyan-500/20"
            >
              <Plus className="w-4 h-4" /> Add New Mode
            </button>

            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-4 px-2">
              Existing Templates
            </div>

            <div className="flex flex-col gap-1 mt-1">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  onClick={() => handleSelect(tmpl)}
                  className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                    selectedTemplate?.id === tmpl.id && !isCreating
                      ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                      : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="truncate">
                    <div className="font-semibold text-sm truncate">{tmpl.name}</div>
                    <div className="text-[11px] text-slate-400 truncate">{tmpl.description || 'Custom template'}</div>
                  </div>
                  {templates.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete template "${tmpl.name}"?`)) onDeleteTemplate(tmpl.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Main Content - Editor */}
          <div className="flex-1 p-6 overflow-y-auto bg-slate-950/50">
            {selectedTemplate || isCreating ? (
              <form onSubmit={handleFormSubmit} className="flex flex-col gap-4 h-full">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Template Category Name
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Long-Term Ownership, Accessory Deep Dive"
                      required
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/70 text-slate-100 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Short Description
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="e.g. Long term updates after 10k miles"
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700/70 text-slate-100 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="flex-1 flex flex-col">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Prompt Instructions & Rules (Markdown/Text)
                  </label>
                  <textarea
                    value={formData.prompt_template}
                    onChange={(e) => setFormData({ ...formData, prompt_template: e.target.value })}
                    rows={12}
                    required
                    className="flex-1 w-full p-4 rounded-xl bg-slate-900/90 border border-slate-700/70 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500 leading-relaxed resize-none transition-colors"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setSelectedTemplate(null);
                    }}
                    className="px-5 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs font-semibold uppercase tracking-wider transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-cyan-500/25"
                  >
                    <Save className="w-4 h-4" /> Save Template
                  </button>
                </div>
              </form>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                <Edit2 className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">Select a template on the left to edit or click "Add New Mode"</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
