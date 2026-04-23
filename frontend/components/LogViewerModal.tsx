import React from 'react';
import { X, Download, Trash2, Terminal } from 'lucide-react';
import { LogEntry } from '../types';

interface LogViewerModalProps {
  logs: LogEntry[];
  onClose: () => void;
  onClear: () => void;
}

const LogViewerModal: React.FC<LogViewerModalProps> = ({ logs, onClose, onClear }) => {
  const handleExport = () => {
    if (logs.length === 0) return;

    const mdContent = [
      '# SSET Factory Rejection Audit Log',
      `*Generated on: ${new Date().toLocaleString()}*`,
      '',
      ...logs.map(l => {
        const time = new Date(l.timestamp).toISOString();
        const type = l.type.toUpperCase();
        return `## [${time}] ${type}\n\n\`\`\`text\n${l.message}\n\`\`\`\n---`;
      })
    ].join('\n');

    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sset_rejection_log_${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getTypeColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'error': return 'text-red-500';
      case 'success': return 'text-green-500';
      case 'warning': return 'text-yellow-500';
      default: return 'text-blue-400';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-4xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Rejection Audit Logs</h2>
            <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
              {logs.length} entries
            </span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md text-muted-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-[#0d1117] text-[#c9d1d9] font-mono text-sm">
          {logs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground/50 italic">
              No rejections or errors recorded yet.
            </div>
          ) : (
            <div className="space-y-4">
              {logs.map((log) => (
                <div key={log.id} className="border border-white/10 rounded p-3 bg-white/5">
                  <div className="flex gap-3 mb-2 border-b border-white/10 pb-2">
                    <span className="text-gray-500 shrink-0">
                      [{new Date(log.timestamp).toLocaleTimeString()}]
                    </span>
                    <span className={`shrink-0 font-bold ${getTypeColor(log.type)}`}>
                      [{log.type.toUpperCase()}]
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                    {log.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-between items-center bg-muted/30">
          <button
            onClick={onClear}
            disabled={logs.length === 0}
            className="px-4 py-2 rounded-md text-sm font-medium text-red-600 hover:bg-red-100 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            Clear Logs
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-md text-sm font-medium text-foreground hover:bg-muted transition-colors border border-input"
            >
              Close
            </button>
            <button
              onClick={handleExport}
              disabled={logs.length === 0}
              className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Export as .md
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogViewerModal;