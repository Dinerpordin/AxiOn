import React from 'react';
import { Settings, Play, Upload, Plus, Loader2, FileText, CheckCircle2, ListTodo, Zap, XCircle } from 'lucide-react';
import { GenerationParams, Job, BatchProgress, TopicSelection } from '../types';

export const ENGLISH_TOPICS: TopicSelection[] = [
  { id: 'eng_a', label: 'Section A: Spelling, Punctuation & Grammar', section: 'English', topic: 'English SPaG' },
  { id: 'eng_b', label: 'Section B: Text 1 Comprehension', section: 'English', topic: 'English Comprehension' },
  { id: 'eng_c', label: 'Section C: Text 2 Comprehension', section: 'English', topic: 'English Comprehension' },
  { id: 'eng_d', label: 'Section D: Critical Comparison', section: 'English', topic: 'English Comparison' },
];

export const MATHS_TOPICS: TopicSelection[] = [
  { id: 'math_arith', label: 'Arithmetic', section: 'Maths', topic: 'Arithmetic' },
  { id: 'math_geom', label: 'Geometry', section: 'Maths', topic: 'Geometry' },
  { id: 'math_alg', label: 'Algebra', section: 'Maths', topic: 'Algebra' },
  { id: 'math_data', label: 'Data Handling', section: 'Maths', topic: 'Data Handling' },
  { id: 'math_frac', label: 'Fractions, Decimals & Percentages', section: 'Maths', topic: 'Fractions, Decimals & Percentages' },
  { id: 'math_meas', label: 'Measure', section: 'Maths', topic: 'Measure' },
  { id: 'math_ratio', label: 'Ratio & Proportion', section: 'Maths', topic: 'Ratio & Proportion' },
];

interface SidebarProps {
  params: GenerationParams;
  onParamsChange: (params: GenerationParams) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  onRunBatchSimulation: () => void;
  onImportManifest: (event: React.ChangeEvent<HTMLInputElement>) => void;
  jobQueue: Job[];
  onImportCsv: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadJob: (job: Job) => void;
  onMarkJobComplete: (jobId: string) => void;
  onRunAllJobs: () => void;
  isGeneratingBatch: boolean;
  batchProgress: BatchProgress;
  onStopGeneration: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  params, 
  onParamsChange, 
  onGenerate, 
  isGenerating, 
  onRunBatchSimulation, 
  onImportManifest,
  jobQueue,
  onImportCsv,
  onLoadJob,
  onMarkJobComplete,
  onRunAllJobs,
  isGeneratingBatch,
  batchProgress,
  onStopGeneration
}) => {

  const updateMainPrompt = (topics: TopicSelection[], count: number, difficulty: string) => {
    if (topics.length === 0) return '';
    const topicNames = Array.from(new Set(topics.map(t => t.topic))).join(', ');
    return `Generate ${count} questions at ${difficulty} difficulty. Focus strictly on the following topics: ${topicNames}`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    const newParams = {
      ...params,
      [name]: name === 'count' ? parseInt(value, 10) || 1 : value
    };

    // Auto-compile the main prompt if core fields change
    if (['difficulty', 'count'].includes(name)) {
      newParams.mainPrompt = updateMainPrompt(newParams.selectedTopics, newParams.count, newParams.difficulty);
    }

    onParamsChange(newParams);
  };

  const handleTopicToggle = (topicObj: TopicSelection) => {
    const isSelected = params.selectedTopics.some(t => t.id === topicObj.id);
    let newTopics;
    if (isSelected) {
      newTopics = params.selectedTopics.filter(t => t.id !== topicObj.id);
    } else {
      newTopics = [...params.selectedTopics, topicObj];
    }
    
    onParamsChange({
      ...params,
      selectedTopics: newTopics,
      mainPrompt: updateMainPrompt(newTopics, params.count, params.difficulty)
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate();
  };

  const pendingJobs = jobQueue.filter(j => j.status === 'pending');

  return (
    <aside className="w-96 bg-card border-r border-border h-screen flex flex-col fixed left-0 top-0 overflow-y-auto">
      <div className="p-6 border-b border-border sticky top-0 bg-card z-10">
        <div className="flex items-center gap-2 text-primary font-bold text-xl mb-1">
          <Settings className="w-6 h-6" />
          <span>SSET Factory</span>
        </div>
        <p className="text-sm text-muted-foreground">Systematic Smart Exam Templates</p>
      </div>

      <div className="p-6 flex-1 space-y-8">
        
        {/* Generation Form */}
        <section>
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Generate Archetypes
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div className="space-y-3">
              <label className="text-sm font-medium">Topics</label>
              
              <div className="space-y-2 bg-muted/30 p-3 rounded-md border border-border">
                <div className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">English</div>
                {ENGLISH_TOPICS.map(t => (
                  <label key={t.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded">
                    <input 
                      type="checkbox" 
                      checked={params.selectedTopics.some(st => st.id === t.id)} 
                      onChange={() => handleTopicToggle(t)} 
                      className="mt-1 rounded border-input text-primary focus:ring-primary" 
                    />
                    <span className="leading-tight">{t.label}</span>
                  </label>
                ))}
              </div>

              <div className="space-y-2 bg-muted/30 p-3 rounded-md border border-border">
                <div className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Mathematics</div>
                {MATHS_TOPICS.map(t => (
                  <label key={t.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded">
                    <input 
                      type="checkbox" 
                      checked={params.selectedTopics.some(st => st.id === t.id)} 
                      onChange={() => handleTopicToggle(t)} 
                      className="mt-1 rounded border-input text-primary focus:ring-primary" 
                    />
                    <span className="leading-tight">{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-4">
              <div className="space-y-1 flex-1">
                <label className="text-sm font-medium">Difficulty</label>
                <select
                  name="difficulty"
                  value={params.difficulty}
                  onChange={handleChange}
                  className="w-full p-2 rounded-md border border-input bg-background text-sm focus:ring-2 focus:ring-ring outline-none"
                >
                  <option value="D1">D1 (Easy)</option>
                  <option value="D2">D2 (Medium)</option>
                  <option value="D3">D3 (Hard)</option>
                </select>
              </div>
              <div className="space-y-1 w-24">
                <label className="text-sm font-medium">Count</label>
                <input
                  type="number"
                  name="count"
                  min="1"
                  max="20"
                  value={params.count}
                  onChange={handleChange}
                  className="w-full p-2 rounded-md border border-input bg-background text-sm focus:ring-2 focus:ring-ring outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Prompt for Content Engine (Main Prompt)</label>
              <textarea
                name="mainPrompt"
                value={params.mainPrompt}
                onChange={handleChange}
                placeholder="Auto-compiles based on selections..."
                className="w-full p-2 rounded-md border border-input bg-background text-sm h-20 resize-none focus:ring-2 focus:ring-ring outline-none"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Additional Instructions</label>
              <textarea
                name="instructions"
                value={params.instructions}
                onChange={handleChange}
                placeholder="Specific rules, constraints, or traps..."
                className="w-full p-2 rounded-md border border-input bg-background text-sm h-20 resize-none focus:ring-2 focus:ring-ring outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Few-Shot JSON (Optional)</label>
              <textarea
                name="fewShotJson"
                value={params.fewShotJson || ''}
                onChange={handleChange}
                placeholder="Paste reference JSON structure here..."
                className="w-full p-2 rounded-md border border-input bg-background text-sm font-mono h-20 resize-none focus:ring-2 focus:ring-ring outline-none"
              />
            </div>

            {isGenerating && !isGeneratingBatch ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="w-full bg-destructive/10 text-destructive border border-destructive/20 p-2 rounded-md font-medium flex items-center justify-center gap-2 hover:bg-destructive/20 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Stop Generation
              </button>
            ) : (
              <button
                type="submit"
                disabled={isGeneratingBatch || params.selectedTopics.length === 0}
                className="w-full bg-primary text-primary-foreground p-2 rounded-md font-medium flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Settings className="w-4 h-4" />
                Generate via AI
              </button>
            )}
          </form>
        </section>

        {/* Job Queue Section */}
        <section className="pt-6 border-t border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <ListTodo className="w-4 h-4" /> Job Queue
            </h3>
            <span className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-full font-medium">
              {pendingJobs.length} Pending
            </span>
          </div>
          
          <label className="w-full bg-background border border-input text-foreground p-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 hover:bg-accent transition-colors cursor-pointer mb-4">
            <FileText className="w-4 h-4" />
            Import CSV Matrix
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={onImportCsv}
            />
          </label>

          {isGeneratingBatch && (
            <div className="mb-4 p-4 bg-muted/50 border border-border rounded-md">
              <div className="flex justify-between text-xs mb-1 font-medium text-foreground">
                <span className="truncate pr-2">Processing: {batchProgress.label}</span>
                <span className="shrink-0">{batchProgress.current} / {batchProgress.total}</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
                />
              </div>
              <button
                onClick={onStopGeneration}
                className="w-full bg-destructive/10 text-destructive border border-destructive/20 p-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 hover:bg-destructive/20 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Stop Batch
              </button>
            </div>
          )}

          {!isGeneratingBatch && pendingJobs.length > 0 && (
            <button
              onClick={onRunAllJobs}
              disabled={isGenerating}
              className="w-full bg-accent text-accent-foreground border border-border p-2 rounded-md font-medium flex items-center justify-center gap-2 hover:bg-accent/80 transition-colors disabled:opacity-50 mb-4"
            >
              <Zap className="w-4 h-4 text-yellow-500" />
              Auto-Generate All Jobs
            </button>
          )}

          {pendingJobs.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {pendingJobs.map(job => (
                <div key={job.id} className="bg-muted/50 border border-border rounded-md p-3 text-sm">
                  <div className="font-medium text-foreground mb-1 truncate" title={job.topic}>
                    {job.topic || 'Untitled Topic'}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                    <span>{job.section} • {job.difficulty}</span>
                    <span>{job.targetQuantity} items</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onLoadJob(job)}
                      disabled={isGeneratingBatch}
                      className="flex-1 bg-background border border-input hover:bg-accent text-foreground py-1.5 rounded transition-colors disabled:opacity-50"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => onMarkJobComplete(job.id)}
                      disabled={isGeneratingBatch}
                      className="flex-1 bg-green-100 text-green-700 hover:bg-green-200 py-1.5 rounded transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Done
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4 bg-muted/30 rounded-md border border-dashed border-border">
              No pending jobs. Upload a CSV to queue batch generations.
            </div>
          )}
        </section>

      </div>
    </aside>
  );
};

export default Sidebar;