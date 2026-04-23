import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Play, Check, X, Edit2, Save, AlertTriangle, Trash2 } from 'lucide-react';
import { QuestionTemplate } from '../types';
import { motion, AnimatePresence } from 'framer-motion';

interface TemplateCardProps {
  template: QuestionTemplate;
  onRunTest: (id: string) => void;
  onUpdateStatus: (id: string, status: 'approved' | 'rejected' | 'pending') => void;
  onUpdateTemplate: (template: QuestionTemplate) => void;
  onDeleteTemplate: (id: string) => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({ template, onRunTest, onUpdateStatus, onUpdateTemplate, onDeleteTemplate }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<QuestionTemplate>(template);

  const handleSave = () => {
    onUpdateTemplate(editData);
    setIsEditing(false);
  };

  const currentStatus = template.status || 'pending';

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    approved: 'bg-green-100 text-green-800 border-green-200',
    rejected: 'bg-red-100 text-red-800 border-red-200',
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-card border rounded-lg shadow-sm overflow-hidden transition-colors ${
        template.testResult?.passed === false ? 'border-red-300' : 'border-border'
      }`}
    >
      {/* Header Section */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-4 bg-muted/30">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-bold px-2 py-1 rounded bg-primary/10 text-primary">
              {template.section}
            </span>
            <span className="text-xs font-medium px-2 py-1 rounded bg-secondary text-secondary-foreground">
              {template.topic}
            </span>
            <span className="text-xs font-medium px-2 py-1 rounded border border-border">
              {template.difficulty}
            </span>
            {template.multiSelect && (
              <span className="text-xs font-medium px-2 py-1 rounded bg-purple-100 text-purple-800 border border-purple-200">
                Multi-Select
              </span>
            )}
            {template.selectTwo && (
              <span className="text-xs font-medium px-2 py-1 rounded bg-indigo-100 text-indigo-800 border border-indigo-200">
                Select Two
              </span>
            )}
            <span className={`text-xs font-medium px-2 py-1 rounded border ${statusColors[currentStatus] || statusColors.pending}`}>
              {currentStatus.toUpperCase()}
            </span>
          </div>
          
          {isEditing ? (
            <textarea
              value={editData.template_stem}
              onChange={(e) => setEditData({...editData, template_stem: e.target.value})}
              className="w-full p-2 text-sm border rounded mt-2 font-mono bg-background"
              rows={3}
            />
          ) : (
            <h3 className="text-lg font-medium text-foreground leading-snug">
              {template.template_stem}
            </h3>
          )}
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onRunTest(template.id)}
            className="p-2 rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors flex items-center justify-center"
            title="Run Monte Carlo Test"
          >
            <Play className="w-4 h-4" />
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onUpdateStatus(template.id, 'approved')}
              className="p-2 rounded-md bg-green-100 hover:bg-green-200 text-green-700 transition-colors"
              title="Approve"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onUpdateStatus(template.id, 'rejected')}
              className="p-2 rounded-md bg-orange-100 hover:bg-orange-200 text-orange-700 transition-colors"
              title="Reject"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteTemplate(template.id)}
              className="p-2 rounded-md bg-red-100 hover:bg-red-200 text-red-700 transition-colors"
              title="Delete Template"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Test Results Banner */}
      {template.testResult && (
        <div className={`px-4 py-2 text-sm flex items-start gap-2 ${template.testResult.passed ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {template.testResult.passed ? (
            <Check className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <div>
            <span className="font-semibold">
              {template.testResult.passed ? 'Simulation Passed (50 iterations)' : 'Simulation Failed'}
            </span>
            {!template.testResult.passed && template.testResult.errors.length > 0 && (
              <ul className="mt-1 list-disc list-inside text-xs space-y-1">
                {template.testResult.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Expand Toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-2 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors border-b border-border"
      >
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {isExpanded ? 'Hide Logic Breakdown' : 'Show Logic Breakdown'}
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-6 bg-background">
              
              {/* Actions */}
              <div className="flex justify-end">
                {isEditing ? (
                  <button type="button" onClick={handleSave} className="flex items-center gap-1 text-sm bg-primary text-primary-foreground px-3 py-1 rounded">
                    <Save className="w-4 h-4" /> Save Changes
                  </button>
                ) : (
                  <button type="button" onClick={() => setIsEditing(true)} className="flex items-center gap-1 text-sm bg-secondary text-secondary-foreground px-3 py-1 rounded">
                    <Edit2 className="w-4 h-4" /> Edit Logic
                  </button>
                )}
              </div>

              {/* Variables & Constraints */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Variables</h4>
                  <div className="space-y-2">
                    {(template.variable_bounds || (template as any).variables || []).map((v, i) => (
                      <div key={i} className="text-sm flex items-center gap-2 bg-muted/30 p-2 rounded">
                        <span className="font-mono font-bold text-primary">{v.name}</span>
                        <span className="text-muted-foreground">
                          [{v.min} - {v.max}, step: {v.step}]
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Constraints</h4>
                  {template.constraints && template.constraints.length > 0 ? (
                    <ul className="space-y-1">
                      {template.constraints.map((c, i) => (
                        <li key={i} className="text-sm font-mono bg-muted/30 p-1.5 rounded">{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">None</span>
                  )}
                </div>
              </div>

              {/* Logic */}
              <div>
                <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Evaluation Logic</h4>
                <div className="space-y-3">
                  <div className="bg-green-50 border border-green-200 p-3 rounded-md">
                    <div className="text-xs font-bold text-green-800 mb-1">CORRECT ANSWER</div>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editData.correct_answer_logic}
                        onChange={(e) => setEditData({...editData, correct_answer_logic: e.target.value})}
                        className="w-full p-1 text-sm font-mono border rounded"
                      />
                    ) : (
                      <div className="font-mono text-sm">{template.correct_answer_logic}</div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {(template.distractor_logic || []).map((d, i) => (
                      <div key={i} className="bg-red-50 border border-red-200 p-3 rounded-md">
                        <div className="text-xs font-bold text-red-800 mb-1">DISTRACTOR {i + 1}</div>
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editData.distractor_logic[i]?.expr || ''}
                              onChange={(e) => {
                                const newDistractors = [...(editData.distractor_logic || [])];
                                if (!newDistractors[i]) newDistractors[i] = { expr: '', trap_label: '', misconception_tag: '' };
                                newDistractors[i].expr = e.target.value;
                                setEditData({...editData, distractor_logic: newDistractors});
                              }}
                              className="w-full p-1 text-sm font-mono border rounded"
                            />
                            <input
                              type="text"
                              value={editData.distractor_logic[i]?.trap_label || ''}
                              onChange={(e) => {
                                const newDistractors = [...(editData.distractor_logic || [])];
                                if (!newDistractors[i]) newDistractors[i] = { expr: '', trap_label: '', misconception_tag: '' };
                                newDistractors[i].trap_label = e.target.value;
                                setEditData({...editData, distractor_logic: newDistractors});
                              }}
                              className="w-full p-1 text-xs border rounded"
                              placeholder="Trap Label"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="font-mono text-sm mb-1">{d.expr}</div>
                            <div className="text-xs text-red-600/80">{d.trap_label}</div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* SVG Preview */}
              {template.svg_template && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 text-muted-foreground">SVG Template Preview</h4>
                  <div className="border border-border rounded-md p-4 bg-white flex justify-center overflow-auto">
                    {/* We render the raw SVG string. In a real app, we might want to sanitize this or render it safely. */}
                    <div dangerouslySetInnerHTML={{ __html: template.svg_template }} className="max-w-full" />
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default TemplateCard;