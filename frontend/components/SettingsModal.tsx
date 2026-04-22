import React, { useState } from 'react';
import { X, Save, Info } from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsModalProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onSave, onClose }) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setLocalSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localSettings);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Application Settings</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md text-muted-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-6">
          <div className="bg-blue-50 text-blue-800 p-3 rounded-md text-sm flex items-start gap-2 border border-blue-200">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <strong>Note:</strong> The API Key is securely managed via environment variables (<code>process.env.API_KEY</code>) and cannot be changed here.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground block">AI Model</label>
            <select
              name="model"
              value={localSettings.model}
              onChange={handleChange}
              className="w-full p-2 rounded-md border border-input bg-background text-sm focus:ring-2 focus:ring-ring outline-none"
            >
              <option value="gemini-2.5-flash">gemini-2.5-flash (Stable & Fast)</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro (Advanced Reasoning)</option>
            </select>
            <p className="text-xs text-muted-foreground">Select the Gemini model to use for generation. Invalid models will cause 'Failed to fetch' errors.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground block">Master System Instructions</label>
            <textarea
              name="systemInstructions"
              value={localSettings.systemInstructions}
              onChange={handleChange}
              rows={6}
              className="w-full p-3 rounded-md border border-input bg-background text-sm font-mono focus:ring-2 focus:ring-ring outline-none resize-y"
              placeholder="Enter system instructions..."
            />
            <p className="text-xs text-muted-foreground">
              These instructions define the AI's persona and overarching rules for every generation request.
            </p>
          </div>
        </form>

        <div className="p-4 border-t border-border flex justify-end gap-3 bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium text-foreground hover:bg-muted transition-colors border border-input"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;