import React, { useState, useEffect, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import TemplateCard from './components/TemplateCard';
import SettingsModal from './components/SettingsModal';
import LogViewerModal from './components/LogViewerModal';
import { QuestionTemplate, GenerationParams, AppSettings, Job, LogEntry, BatchProgress } from './types';
import { generateTemplates } from './lib/gemini';
import { runMonteCarloTest } from './lib/math';

const STORAGE_KEY = 'sset_templates';
const SETTINGS_KEY = 'sset_settings';
const JOBS_KEY = 'sset_jobs';

const DEFAULT_SETTINGS: AppSettings = {
  model: 'gemini-2.5-flash',
  systemInstructions: 'You are an elite Curriculum Engineer designing Stage 1 Maths and English assessments (SSET format) for top-tier UK independent schools (11+ level). Your primary function is to generate rigorous, multi-step "Triple-Jump" questions and output them strictly in a highly structured JSON array format.'
};

const App: React.FC = () => {
  const [templates, setTemplates] = useState<QuestionTemplate[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [jobQueue, setJobQueue] = useState<Job[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [generationParams, setGenerationParams] = useState<GenerationParams>({
    section: 'Maths',
    topic: 'Fractions',
    difficulty: 'D2',
    count: 3,
    instructions: '',
    fewShotJson: ''
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ current: 0, total: 0, label: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  
  // Custom modal states to bypass sandbox window.confirm restrictions
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      message,
      type
    }]);
  }, []);

  // Load from local storage on mount
  useEffect(() => {
    const storedTemplates = localStorage.getItem(STORAGE_KEY);
    if (storedTemplates) {
      try {
        const parsed = JSON.parse(storedTemplates);
        if (Array.isArray(parsed)) {
          setTemplates(parsed.map(t => ({ ...t, status: t.status || 'pending' })));
        }
      } catch (e) {
        console.error("Failed to parse stored templates", e);
      }
    }

    const storedSettings = localStorage.getItem(SETTINGS_KEY);
    if (storedSettings) {
      try {
        const parsedSettings = JSON.parse(storedSettings);
        if (parsedSettings.model === 'gemini-3.1-pro') {
          parsedSettings.model = 'gemini-2.5-flash';
        }
        setSettings({ ...DEFAULT_SETTINGS, ...parsedSettings });
      } catch (e) {
        console.error("Failed to parse stored settings", e);
      }
    }

    const storedJobs = localStorage.getItem(JOBS_KEY);
    if (storedJobs) {
      try {
        const parsedJobs = JSON.parse(storedJobs);
        if (Array.isArray(parsedJobs)) {
          setJobQueue(parsedJobs);
        }
      } catch (e) {
        console.error("Failed to parse stored jobs", e);
      }
    }
  }, []);

  // Save to local storage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  }, [templates]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobQueue));
  }, [jobQueue]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    abortControllerRef.current = new AbortController();
    addLog(`Manual generation started for topic: ${generationParams.topic}`, 'info');
    try {
      const newTemplates = await generateTemplates(generationParams, settings, addLog, abortControllerRef.current.signal);
      
      // Yielding Monte Carlo tests to prevent UI freeze
      const tested = [];
      for (const t of newTemplates) {
        if (abortControllerRef.current?.signal.aborted) break;
        tested.push({ ...t, testResult: runMonteCarloTest(t) });
        await new Promise(r => setTimeout(r, 10)); // Yield to main thread
      }

      if (!abortControllerRef.current?.signal.aborted) {
        setTemplates(prev => [...tested, ...prev]);
        addLog(`Manual generation completed. Added ${tested.length} templates.`, 'success');
      }
    } catch (err: any) {
      if (err.message === 'Aborted by user') {
        addLog('Manual generation stopped by user.', 'warning');
      } else {
        setError(err.message || "Failed to generate templates.");
        addLog(`Manual generation failed: ${err.message}`, 'error');
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleRunAllJobs = async () => {
    setIsGeneratingBatch(true);
    setError(null);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    const pendingJobs = jobQueue.filter(j => j.status === 'pending');
    addLog(`Starting batch generation for ${pendingJobs.length} jobs.`, 'info');
    setBatchProgress({ current: 0, total: pendingJobs.length, label: 'Initializing...' });
    
    for (let i = 0; i < pendingJobs.length; i++) {
      if (signal.aborted) {
        addLog('Batch generation stopped by user.', 'warning');
        break;
      }

      const job = pendingJobs[i];
      setBatchProgress({ current: i, total: pendingJobs.length, label: job.topic });
      addLog(`Processing Job: ${job.topic} (${job.targetQuantity} items)`, 'info');
      
      try {
        const params: GenerationParams = {
          section: job.section,
          topic: job.topic,
          difficulty: job.difficulty,
          count: job.targetQuantity,
          instructions: job.additionalInstructions,
          fewShotJson: job.fewShotJson
        };

        // 1. Generate templates for this job
        const generated = await generateTemplates(params, settings, addLog, signal);
        if (signal.aborted) break;

        // 2. Auto-validate (Monte Carlo test) with yielding
        const tested = [];
        for (const t of generated) {
          if (signal.aborted) break;
          const result = runMonteCarloTest(t);
          if (result.passed) {
            addLog(`[Job: ${job.topic}] Template ${t.id} passed simulation.`, 'success');
          } else {
            addLog(`[Job: ${job.topic}] Template ${t.id} failed simulation: ${result.errors.join(' | ')}`, 'error');
          }
          tested.push({ ...t, testResult: result });
          await new Promise(r => setTimeout(r, 10)); // Yield to main thread
        }

        if (signal.aborted) break;

        // 3. Add to state progressively
        setTemplates(prev => [...tested, ...prev]);

        // 4. Mark job as complete
        setJobQueue(prev => prev.map(j => j.id === job.id ? { ...j, status: 'completed' } : j));
        addLog(`Job completed: ${job.topic}`, 'success');
        setBatchProgress({ current: i + 1, total: pendingJobs.length, label: job.topic });

        // 5. Cooldown between jobs to prevent rate limits (HTTP 429)
        if (i < pendingJobs.length - 1) {
          addLog(`Cooling down for 4 seconds to prevent API rate limits...`, 'info');
          for (let w = 0; w < 40; w++) {
            if (signal.aborted) throw new Error("Aborted by user");
            await new Promise(r => setTimeout(r, 100));
          }
        }

      } catch (err: any) {
        if (err.message === 'Aborted by user') {
          addLog(`Batch generation stopped by user during job "${job.topic}".`, 'warning');
          break;
        }
        const errMsg = `Batch generation stopped. Failed on job "${job.topic}": ${err.message}`;
        setError(errMsg);
        addLog(errMsg, 'error');
        break; // Stop processing further jobs on error
      }
    }
    
    addLog(`Batch generation process finished.`, 'info');
    setIsGeneratingBatch(false);
    setBatchProgress({ current: 0, total: 0, label: '' });
    abortControllerRef.current = null;
  };

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // Instantly update UI state to feel responsive
    setIsGenerating(false);
    setIsGeneratingBatch(false);
    setBatchProgress({ current: 0, total: 0, label: '' });
  }, []);

  const handleRunTest = useCallback((id: string) => {
    const template = templates.find(t => t.id === id);
    if (!template) return;

    addLog(`Running manual simulation for template: ${template.topic} (${template.id})`, 'info');
    const result = runMonteCarloTest(template);
    
    if (result.passed) {
      addLog(`Simulation passed for template: ${template.id}`, 'success');
    } else {
      addLog(`Simulation failed for template: ${template.id}. Errors: ${result.errors.join(' | ')}`, 'error');
    }

    setTemplates(prev => prev.map(t => t.id === id ? { ...t, testResult: result } : t));
  }, [templates, addLog]);

  const handleRunBatchSimulation = useCallback(async () => {
    setIsGeneratingBatch(true); // Reuse this state to show loading spinner
    addLog(`Running batch simulation for all pending templates...`, 'info');
    let passCount = 0;
    let failCount = 0;

    const updatedTemplates = [];
    for (const t of templates) {
      if ((t.status || 'pending') === 'pending') {
        const result = runMonteCarloTest(t);
        if (result.passed) passCount++; else failCount++;
        updatedTemplates.push({ ...t, testResult: result });
        await new Promise(r => setTimeout(r, 10)); // Yield to main thread
      } else {
        updatedTemplates.push(t);
      }
    }

    setTemplates(updatedTemplates);
    addLog(`Batch simulation complete. Passed: ${passCount}, Failed: ${failCount}`, failCount > 0 ? 'warning' : 'success');
    setIsGeneratingBatch(false);
  }, [templates, addLog]);

  const handleUpdateStatus = useCallback((id: string, status: 'approved' | 'rejected' | 'pending') => {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    addLog(`Template ${id} status updated to ${status}`, 'info');
  }, [addLog]);

  const handleUpdateTemplate = useCallback((updatedTemplate: QuestionTemplate) => {
    setTemplates(prev => prev.map(t => t.id === updatedTemplate.id ? updatedTemplate : t));
    addLog(`Template ${updatedTemplate.id} logic manually updated.`, 'info');
  }, [addLog]);

  const handleDeleteTemplate = useCallback((id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
    addLog(`Template ${id} deleted.`, 'info');
  }, [addLog]);

  const handleClearAll = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  const executeClearAll = useCallback(() => {
    setTemplates([]);
    setJobQueue([]);
    setLogs([]);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(JOBS_KEY);
    addLog("All data and caches cleared by user.", "warning");
    setShowClearConfirm(false);
    setShowExportSuccess(false);
  }, [addLog]);

  const handleExport = useCallback(async () => {
    const approved = templates.filter(t => (t.status || 'pending') === 'approved');
    if (approved.length === 0) return;

    const jsonString = JSON.stringify(approved, null, 2);
    const defaultFileName = `sset_export_${new Date().toISOString().split('T')[0]}.json`;
    let exportSuccess = false;

    try {
      // Use File System Access API if available (allows folder selection)
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: defaultFileName,
            types: [{
              description: 'JSON File',
              accept: { 'application/json': ['.json'] },
            }],
          });
          const writable = await handle.createWritable();
          await writable.write(jsonString);
          await writable.close();
          addLog(`Exported ${approved.length} approved templates to JSON via File Picker.`, 'success');
          exportSuccess = true;
        } catch (pickerErr: any) {
          if (pickerErr.name === 'AbortError') {
            return; // User cancelled the picker, do nothing
          }
          console.warn('showSaveFilePicker failed, falling back to Blob download:', pickerErr);
        }
      }

      // Fallback for browsers/sandboxes that don't support showSaveFilePicker
      if (!exportSuccess) {
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.href = url;
        downloadAnchorNode.download = defaultFileName;
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        URL.revokeObjectURL(url);
        addLog(`Exported ${approved.length} approved templates to JSON (Fallback).`, 'success');
        exportSuccess = true;
      }

      // Prompt to clear data after successful export using custom modal
      if (exportSuccess) {
        setShowExportSuccess(true);
      }

    } catch (err: any) {
      console.error('Export failed:', err);
      addLog(`Export failed: ${err.message}`, 'error');
    }
  }, [templates, addLog]);

  const handleImportManifest = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = JSON.parse(content) as QuestionTemplate[];
        if (Array.isArray(imported)) {
          setTemplates(prev => {
            const existingIds = new Set(prev.map(t => t.id));
            const newUnique = imported
              .filter(t => !existingIds.has(t.id))
              .map(t => ({ ...t, status: t.status || 'pending' }));
            addLog(`Imported ${newUnique.length} new templates from JSON manifest.`, 'success');
            return [...newUnique, ...prev];
          });
        }
      } catch (err) {
        setError("Failed to parse imported JSON file.");
        addLog(`Failed to parse imported JSON manifest.`, 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, [addLog]);

  const handleImportCsv = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const newJobs: Job[] = results.data.map((row: any, index) => {
          let diff = row['Difficulty'];
          if (!diff && row['Prompt for Content Engine']) {
            const match = String(row['Prompt for Content Engine']).match(/D[1-3]/i);
            if (match) diff = match[0].toUpperCase();
          }

          return {
            id: `job-${Date.now()}-${index}`,
            section: row['Section'] || 'Maths',
            topic: row['Topic'] || '',
            difficulty: diff || 'D2',
            targetQuantity: parseInt(row['Target Quantity']) || 5,
            promptForContentEngine: row['Prompt for Content Engine'] || '',
            additionalInstructions: row['Additional Instructions (Constraints & Traps)'] || '',
            fewShotJson: row['Few-Shot JSON'] === 'None required' ? '' : (row['Few-Shot JSON'] || ''),
            status: 'pending'
          };
        });
        setJobQueue(prev => [...prev, ...newJobs]);
        addLog(`Imported ${newJobs.length} jobs from CSV matrix.`, 'success');
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
        addLog(`Failed to parse CSV: ${err.message}`, 'error');
      }
    });
    event.target.value = '';
  }, [addLog]);

  const handleLoadJob = useCallback((job: Job) => {
    setGenerationParams(prev => ({
      ...prev,
      section: job.section,
      topic: job.topic,
      difficulty: job.difficulty,
      count: job.targetQuantity,
      instructions: job.additionalInstructions,
      fewShotJson: job.fewShotJson
    }));
    addLog(`Loaded job "${job.topic}" into generation form.`, 'info');
  }, [addLog]);

  const handleMarkJobComplete = useCallback((jobId: string) => {
    setJobQueue(prev => prev.map(job => 
      job.id === jobId ? { ...job, status: 'completed' } : job
    ));
    addLog(`Manually marked job ${jobId} as complete.`, 'info');
  }, [addLog]);

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar 
        params={generationParams}
        onParamsChange={setGenerationParams}
        onGenerate={handleGenerate} 
        isGenerating={isGenerating} 
        onRunBatchSimulation={handleRunBatchSimulation}
        onImportManifest={handleImportManifest}
        jobQueue={jobQueue}
        onImportCsv={handleImportCsv}
        onLoadJob={handleLoadJob}
        onMarkJobComplete={handleMarkJobComplete}
        onRunAllJobs={handleRunAllJobs}
        isGeneratingBatch={isGeneratingBatch}
        batchProgress={batchProgress}
        onStopGeneration={handleStopGeneration}
      />
      
      <main className="flex-1 ml-96 flex flex-col min-h-screen">
        <Header 
          templates={templates} 
          onExport={handleExport} 
          onOpenSettings={() => setIsSettingsOpen(true)} 
          onOpenLogs={() => setIsLogsOpen(true)}
          onClearAll={handleClearAll}
        />
        
        <div className="p-6 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-6 p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-md">
              {error}
            </div>
          )}

          {templates.length === 0 && !isGenerating && !isGeneratingBatch ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <div className="w-16 h-16 mb-4 rounded-full bg-muted flex items-center justify-center">
                <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <p className="text-lg font-medium">No templates generated yet.</p>
              <p className="text-sm">Use the sidebar to generate new archetypes via AI.</p>
            </div>
          ) : (
            <div className="space-y-4 max-w-5xl mx-auto pb-12">
              {templates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onRunTest={handleRunTest}
                  onUpdateStatus={handleUpdateStatus}
                  onUpdateTemplate={handleUpdateTemplate}
                  onDeleteTemplate={handleDeleteTemplate}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          onSave={(newSettings) => {
            setSettings(newSettings);
            setIsSettingsOpen(false);
            addLog(`Application settings updated.`, 'info');
          }}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {isLogsOpen && (
        <LogViewerModal
          logs={logs}
          onClose={() => setIsLogsOpen(false)}
          onClear={() => setLogs([])}
        />
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold mb-2 text-foreground">Clear All Data?</h3>
            <p className="text-muted-foreground mb-6 text-sm">Are you sure you want to clear all templates, jobs, and logs? This will wipe your local cache and cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowClearConfirm(false)} className="px-4 py-2 rounded-md text-sm font-medium hover:bg-muted transition-colors border border-input">Cancel</button>
              <button onClick={executeClearAll} className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90 transition-colors">Clear Data</button>
            </div>
          </div>
        </div>
      )}

      {showExportSuccess && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold mb-2 text-foreground">Export Successful!</h3>
            <p className="text-muted-foreground mb-6 text-sm">Your approved templates have been exported. Would you like to clear all data to start fresh?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowExportSuccess(false)} className="px-4 py-2 rounded-md text-sm font-medium hover:bg-muted transition-colors border border-input">Keep Data</button>
              <button onClick={executeClearAll} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">Clear Data & Start Fresh</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;