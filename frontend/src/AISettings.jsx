import React, { useState } from 'react';
import { Cpu, Brain, Sparkles } from 'lucide-react';

export default function AISettings({ settings, onSaveSettings }) {
  const [selectedModel, setSelectedModel] = useState(settings.default_model || 'gemini-3.6-flash');
  const [customModel, setCustomModel] = useState(
    ['gemini-3.6-flash', 'gemini-3.1-pro'].includes(settings.default_model) ? '' : settings.default_model || ''
  );
  const [isCustomMode, setIsCustomMode] = useState(
    !['gemini-3.6-flash', 'gemini-3.1-pro'].includes(settings.default_model) && !!settings.default_model
  );
  const [thinkingMode, setThinkingMode] = useState(settings.thinking_mode || 'standard');

  const handleModelChange = (val) => {
    if (val === 'custom') {
      setIsCustomMode(true);
      setSelectedModel(customModel || 'gemini-3.6-flash');
      onSaveSettings({ default_model: customModel || 'gemini-3.6-flash', thinking_mode: thinkingMode });
    } else {
      setIsCustomMode(false);
      setSelectedModel(val);
      onSaveSettings({ default_model: val, thinking_mode: thinkingMode });
    }
  };

  const handleCustomModelBlur = () => {
    if (customModel.trim()) {
      onSaveSettings({ default_model: customModel.trim(), thinking_mode: thinkingMode });
    }
  };

  const handleThinkingChange = (mode) => {
    setThinkingMode(mode);
    const activeModel = isCustomMode ? customModel : selectedModel;
    onSaveSettings({ default_model: activeModel, thinking_mode: mode });
  };

  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800 shadow-xl mb-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        {/* Left: Section Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider">AI Generation Controls</h2>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <Sparkles className="w-3 h-3" /> Grounding Active
              </span>
            </div>
            <p className="text-xs text-slate-400">Configure Gemini model selection & reasoning depth for post generation</p>
          </div>
        </div>

        {/* Right: Controls Grid */}
        <div className="flex items-center gap-6 flex-wrap">
          {/* Model Selector */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Gemini Model:</label>
            <div className="flex items-center gap-2">
              <select
                value={isCustomMode ? 'custom' : selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors"
              >
                <option value="gemini-flash-latest">Gemini Flash (Recommended)</option>
                <option value="gemini-pro-latest">Gemini Pro</option>
                <option value="custom">Other / Custom Model...</option>
              </select>

              {isCustomMode && (
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  onBlur={handleCustomModelBlur}
                  placeholder="e.g. gemini-3.0-ultra"
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-cyan-500/50 text-xs font-mono text-cyan-300 w-44 focus:outline-none"
                />
              )}
            </div>
          </div>

          {/* Thinking Mode Toggle */}
          <div className="flex items-center gap-3 pl-6 border-l border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <Brain className="w-4 h-4 text-cyan-400" />
              <span>Thinking Mode:</span>
            </div>
            <div className="p-1 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleThinkingChange('standard')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  thinkingMode === 'standard'
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => handleThinkingChange('extended')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  thinkingMode === 'extended'
                    ? 'bg-purple-500 text-white font-bold shadow-md shadow-purple-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Extended
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
