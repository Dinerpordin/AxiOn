import React, { useState, useEffect, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import Sidebar, { ENGLISH_TOPICS, MATHS_TOPICS } from './components/Sidebar';
import Header from './components/Header';
import TemplateCard from './components/TemplateCard';
import SettingsModal from './components/SettingsModal';
import LogViewerModal from './components/LogViewerModal';
import { QuestionTemplate, GenerationParams, AppSettings, Job, LogEntry, BatchProgress, TopicSelection } from './types';
import { generateTemplates } from './lib/gemini';
import { runMonteCarloTest } from './lib/math';

const STORAGE_KEY = 'sset_templates';
const SETTINGS_KEY = 'sset_settings';
const JOBS_KEY = 'sset_jobs';

const DEFAULT_SETTINGS: AppSettings = {
  model: 'gemini-2.5-flash',
  systemInstructions: `Role & Persona:
You are an elite Curriculum Engineer designing Stage 1 Maths and English assessments (SSET format) for top-tier UK independent schools (11+ level). Your primary function is to generate rigorous, multi-step "Triple-Jump" questions and output them strictly in a highly structured JSON array format.

CRITICAL RULE 1: Mathematical Safety & Constraints (Zero Failures Allowed)
The questions you generate will be passed through a 50x Monte Carlo simulation. To prevent simulation crashes, infinite decimals, and logic collisions, you MUST include a "constraints" array containing valid JavaScript expression strings.
- Prevent Decimals: Use modulo logic to guarantee clean division. Example: If finding Time from Distance and Speed, you MUST include "(D * 60) % S != 0" or "(D * 60) % (S1 - S2) == 0".
- Prevent Collisions: Distractor logic must never evaluate to the same number. Use rules like "P1 != P2" or "S1 != (2 * R)".
- Prevent Zero/Negatives: Ensure physical limits. Example: "S1 - Reduction > 5".

CRITICAL RULE 2: Pedagogical Rigor (No Red Herrings)
- Every data point provided in the question stem MUST be necessary to solve the problem.
- Never include phrasing like "assuming the price is the same as the start" if it renders previous data points useless.
- Distractor Logic: Traps must represent genuine cognitive errors (e.g., "Unit conversion omission", "Step 1 Stop", "Inverse operation error"). Do not use meaningless combinations of variables.

CRITICAL RULE 3: JSON Schema Strictness
You will output nothing but raw JSON. No markdown formatting, no conversational filler. Your output must be a valid JSON array [] containing objects with the EXACT following keys:
id (string, unique)
section (string, "Maths" or "English")
topic (string)
difficulty (string, usually "D3")
template_stem (string, using {Variable} syntax)
variable_bounds (array of objects with "name", "min", "max", "step")
correct_answer_logic (string, math.js format)
distractor_logic (array of objects with "expr", "trap_label", "misconception_tag")
constraints (array of strings, logical rules to prevent math errors)
skill_tags (array of strings)

CRITICAL RULE 4: Batch Variance
When asked to generate multiple questions, force distinct contextual scenarios (e.g., cars, boats, runners, trains) and vary the trap formulas. Do not repeat the same question structure with just different variable names.

Constraint Syntax: When using built-in math functions in the logic or constraints, use the raw function names natively (e.g., lcm(A,B), gcd(A,B)). DO NOT prefix them with "math." as it will cause a syntax error in the evaluator.`
};

const App: React.FC = () => {
  const [templates, setTemplates] = useState<QuestionTemplate[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [jobQueue, setJobQueue] = useState<Job[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [generationParams, setGenerationParams] = useState<GenerationParams>({
    selectedTopics: [MATHS_TOPICS[4]], // Default to Fractions
    difficulty: 'D2',
    count: 3,
    instructions: '',
    fewShotJson: '',
    mainPrompt: 'Generate 3 questions at D2 difficulty. Focus strictly on the following topics: Fractions, Decimals & Percentages'
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

  const logRejection = useCallback((template: QuestionTemplate, reason: string, params?: any) => {
    const inputStr = params 
      ? `Topic: ${params.topic || template.topic}\nDifficulty: ${params.difficulty || template.difficulty}\nPrompt: ${params.mainPrompt || 'N/A'}\nInstructions: ${params.instructions || 'N/A'}`
      : `Topic: ${template.topic}\nDifficulty: ${template.difficulty}`;
      
    const message = `Reason: ${reason}

[INPUT]
${inputStr}

[OUTPUT]
Stem: ${template.template_stem}

[LOGIC]
Variables: ${JSON.stringify(template.variables || (template as any).variable_bounds)}
Constraints: ${JSON.stringify(template.constraints || [])}
Correct Logic: ${template.correct_answer_logic}
Distractors: ${JSON.stringify(template.distractor_logic)}`;

    addLog(message, 'error');
  }, [addLog]);

  // Load from local storage on mount
  useEffect(() => {
    const storedTemplates = localStorage.getItem(STORAGE_KEY);
    if (storedTemplates) {
      try {
        const parsed = JSON.parse(storedTemplates);
        if (Array.isArray(parsed)) {
          setTemplates(parsed.map(t => ({ 
            ...t, 
            status: t.status || 'pending',
            variables: t.variables || t.variable_bounds || [] 
          })));
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
    if (!generationParams.mainPrompt.trim()) {
      setError("Main Prompt cannot be empty.");
      return;
    }
    if (generationParams.selectedTopics.length === 0) {
      setError("Please select at least one topic.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    abortControllerRef.current = new AbortController();
    const topicNames = generationParams.selectedTopics.map(t => t.topic).join(', ');
    addLog(`Manual generation started for topics: ${topicNames}`, 'info');
    
    try {
      const result = await generateTemplates(generationParams, settings, addLog, abortControllerRef.current.signal);
      
      if (result.warnings.length > 0) {
        result.warnings.forEach(w => {
          addLog(`Template ${w.templateIndex} failed validation: ${w.errors.join(' | ')}`, 'warning');
        });
      }

      // Yielding Monte Carlo tests to prevent UI freeze
      const tested = [];
      for (const t of result.templates) {
        if (abortControllerRef.current?.signal.aborted) break;
        const mcResult = runMonteCarloTest(t);
        if (!mcResult.passed) {
          logRejection(t, mcResult.errors.join(' | '), generationParams);
        }
        tested.push({ ...t, testResult: mcResult });
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
        // Create a temporary TopicSelection for the job
        const jobTopicSelection: TopicSelection = {
          id: `job-topic-${Date.now()}`,
          label: `${job.section}: ${job.topic}`,
          section: job.section,
          topic: job.topic
        };

        const params: GenerationParams = {
          selectedTopics: [jobTopicSelection],
          difficulty: job.difficulty,
          count: job.targetQuantity,
          instructions: job.additionalInstructions,
          fewShotJson: job.fewShotJson,
          mainPrompt: job.promptForContentEngine || `Generate ${job.targetQuantity} questions at ${job.difficulty} difficulty. Focus strictly on the following topics: ${job.topic}.`
        };

        // 1. Generate templates for this job
        const result = await generateTemplates(params, settings, addLog, signal);
        if (signal.aborted) break;

        if (result.warnings.length > 0) {
          result.warnings.forEach(w => {
            addLog(`[Job: ${job.topic}] Template ${w.templateIndex} failed validation: ${w.errors.join(' | ')}`, 'warning');
          });
        }

        // 2. Auto-validate (Monte Carlo test) with yielding
        const tested = [];
        for (const t of result.templates) {
          if (signal.aborted) break;
          const mcResult = runMonteCarloTest(t);
          if (mcResult.passed) {
            addLog(`[Job: ${job.topic}] Template ${t.id} passed simulation.`, 'success');
          } else {
            addLog(`[Job: ${job.topic}] Template ${t.id} failed simulation: ${mcResult.errors.join(' | ')}`, 'error');
            logRejection(t, mcResult.errors.join(' | '), params);
          }
          tested.push({ ...t, testResult: mcResult });
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
    setTemplates(prev => {
      const newTemplates = [...prev];
      const idx = newTemplates.findIndex(t => t.id === id);
      if (idx !== -1) {
        const result = runMonteCarloTest(newTemplates[idx]);
        newTemplates[idx] = { ...newTemplates[idx], testResult: result };
        if (!result.passed) {
          logRejection(newTemplates[idx], result.errors.join(' | '));
        }
      }
      return newTemplates;
    });
  }, [logRejection]);

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
        if (!result.passed) {
          logRejection(t, result.errors.join(' | '));
        }
        updatedTemplates.push({ ...t, testResult: result });
        await new Promise(r => setTimeout(r, 10)); // Yield to main thread
      } else {
        updatedTemplates.push(t);
      }
    }

    setTemplates(updatedTemplates);
    addLog(`Batch simulation complete. Passed: ${passCount}, Failed: ${failCount}`, failCount > 0 ? 'warning' : 'success');
    setIsGeneratingBatch(false);
  }, [templates, addLog, logRejection]);

  const handleUpdateStatus = useCallback((id: string, status: 'approved' | 'rejected' | 'pending') => {
    setTemplates(prev => {
      const newTemplates = [...prev];
      const idx = newTemplates.findIndex(t => t.id === id);
      if (idx !== -1) {
        newTemplates[idx] = { ...newTemplates[idx], status };
        if (status === 'rejected') {
          logRejection(newTemplates[idx], 'Manually rejected by user');
        }
      }
      return newTemplates;
    });
  }, [logRejection]);

  const handleBatchApprove = useCallback(() => {
    setTemplates(prev => {
      let count = 0;
      const next = prev.map(t => {
        if (t.status === 'pending' && t.testResult?.passed) {
          count++;
          return { ...t, status: 'approved' };
        }
        return t;
      });
      if (count > 0) addLog(`Batch approved ${count} passed templates.`, 'success');
      return next;
    });
  }, [addLog]);

  const handleBatchReject = useCallback(() => {
    setTemplates(prev => {
      let count = 0;
      const next = prev.map(t => {
        if (t.status === 'pending' && t.testResult && !t.testResult.passed) {
          count++;
          return { ...t, status: 'rejected' };
        }
        return t;
      });
      if (count > 0) addLog(`Batch rejected ${count} failed templates.`, 'info');
      return next;
    });
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
    
    // Extract unique parameters for filename
    const sections = Array.from(new Set(approved.map(t => t.section))).map(s => s.replace(/[^a-zA-Z0-9]/g, '')).join('-');
    const difficulties = Array.from(new Set(approved.map(t => t.difficulty))).join('-');
    const uniqueTopics = Array.from(new Set(approved.map(t => t.topic)));
    const topicsStr = uniqueTopics.length > 2 
      ? `${uniqueTopics.slice(0, 2).map(t => t.replace(/[^a-zA-Z0-9]/g, '')).join('-')}-mixed`
      : uniqueTopics.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).join('-');
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS
    
    const defaultFileName = `${sections}_${difficulties}_${topicsStr}_${dateStr}_${timeStr}.json`;
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
              .map(t => ({ 
                ...t, 
                status: t.status || 'pending',
                variables: t.variables || (t as any).variable_bounds || []
              }));
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
        // Helper to robustly find column values regardless of exact casing or trailing spaces
        const getVal = (row: any, possibleKeys: string[]) => {
          const key = Object.keys(row).find(k => 
            possibleKeys.some(pk => k.trim().toLowerCase() === pk.toLowerCase())
          );
          return key ? row[key]?.trim() : undefined;
        };

        const newJobs: Job[] = results.data.map((row: any, index) => {
          const promptStr = getVal(row, ['Main_Prompt', 'Main Prompt', 'Prompt for Content Engine', 'Prompt']) || '';
          let diff = getVal(row, ['Difficulty', 'Level', 'Target Difficulty']);
          
          if (!diff && promptStr) {
            const match = String(promptStr).match(/D[1-3]/i);
            if (match) diff = match[0].toUpperCase();
          }

          const targetQuantityRaw = getVal(row, ['Count', 'Target Quantity', 'Quantity']);
          const targetQuantity = parseInt(targetQuantityRaw, 10);

          let fewShot = getVal(row, ['Few_Shot_JSON', 'Few-Shot JSON', 'Few Shot', 'Few-Shot', 'JSON']) || '';
          if (String(fewShot).toLowerCase() === 'none required') fewShot = '';

          return {
            id: `job-${Date.now()}-${index}`,
            section: getVal(row, ['Section', 'Subject']) || 'Maths',
            topic: getVal(row, ['Topic', 'Title']) || '',
            difficulty: diff || 'D2',
            targetQuantity: isNaN(targetQuantity) ? 5 : targetQuantity,
            promptForContentEngine: promptStr,
            additionalInstructions: getVal(row, ['Additional_Instructions', 'Additional Instructions', 'Additional Instructions (Constraints & Traps)', 'Instructions', 'Constraints']) || '',
            fewShotJson: fewShot,
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
    const matchedTopic = [...ENGLISH_TOPICS, ...MATHS_TOPICS].find(
      t => t.topic.toLowerCase() === job.topic.toLowerCase() && t.section.toLowerCase() === job.section.toLowerCase()
    );

    const topicSelection: TopicSelection = matchedTopic || {
      id: `custom-${Date.now()}`,
      label: `${job.section}: ${job.topic}`,
      section: job.section,
      topic: job.topic
    };

    setGenerationParams(prev => ({
      ...prev,
      selectedTopics: [topicSelection],
      difficulty: job.difficulty,
      count: job.targetQuantity,
      instructions: job.additionalInstructions,
      fewShotJson: job.fewShotJson,
      mainPrompt: job.promptForContentEngine || `Generate ${job.targetQuantity} questions at ${job.difficulty} difficulty. Focus strictly on the following topics: ${job.topic}.`
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
          onBatchApprove={handleBatchApprove}
          onBatchReject={handleBatchReject}
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