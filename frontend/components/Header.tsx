import React from 'react';
import { Download, CheckCircle2, Clock, AlertCircle, Settings, Terminal } from 'lucide-react';
import { QuestionTemplate } from '../types';

interface HeaderProps {
  templates: QuestionTemplate[];
  onExport: () => void;
  onOpenSettings: () => void;
  onOpenLogs: () => void;
}

const Header: React.FC<HeaderProps> = ({ templates, onExport, onOpenSettings, onOpenLogs }) => {
  const total = templates.length;
  const approved = templates.filter(t => (t.status || 'pending') === 'approved').length;
  const pending = templates.filter(t => (t.status || 'pending') === 'pending').length;
  const rejected = templates.filter(t => (t.status || 'pending') === 'rejected').length;

  const progress = total === 0 ? 0 : (approved / total) * 100;

  return (
    <header className="bg-card border-b border-border h-16 flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="flex items-center gap-8 flex-1">
        <div className="flex flex-col w-64">
          <div className="flex justify-between text-xs mb-1 font-medium">
            <span>Approval Progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-500 ease-in-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1 text-muted-foreground">
            <span className="font-semibold text-foreground">{total}</span> Total
          </div>
          <div className="flex items-center gap-1 text-green-600">
            <CheckCircle2 className="w-4 h-4" />
            <span className="font-semibold">{approved}</span> Approved
          </div>
          <div className="flex items-center gap-1 text-yellow-600">
            <Clock className="w-4 h-4" />
            <span className="font-semibold">{pending}</span> Pending
          </div>
          <div className="flex items-center gap-1 text-red-600">
            <AlertCircle className="w-4 h-4" />
            <span className="font-semibold">{rejected}</span> Rejected
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onOpenLogs}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title="View Audit Logs"
        >
          <Terminal className="w-5 h-5" />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title="Application Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-border mx-1"></div>
        <button
          onClick={onExport}
          disabled={approved === 0}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export Approved JSON
        </button>
      </div>
    </header>
  );
};

export default Header;