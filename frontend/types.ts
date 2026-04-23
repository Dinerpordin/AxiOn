export interface VariableBound {
  name: string;
  min: number;
  max: number;
  step: number;
}

export interface DistractorLogic {
  expr: string;
  trap_label: string;
  misconception_tag: string;
}

export interface TestResult {
  passed: boolean;
  errors: string[];
  lastRunTimestamp?: number;
}

export interface QuestionTemplate {
  id: string;
  section: 'Maths' | 'English SPaG' | 'English Comp';
  topic: string;
  difficulty: 'D1' | 'D2' | 'D3';
  template_stem: string;
  variable_bounds: VariableBound[];
  constraints?: string[];
  correct_answer_logic: string;
  distractor_logic: DistractorLogic[];
  svg_template?: string;
  skill_tags: string[];
  status: 'pending' | 'approved' | 'rejected';
  testResult?: TestResult;
}

export interface GenerationParams {
  section: string;
  topic: string;
  difficulty: string;
  count: number;
  instructions: string;
  fewShotJson?: string;
}

export interface AppSettings {
  model: string;
  systemInstructions: string;
}

export interface Job {
  id: string;
  section: string;
  topic: string;
  difficulty: string;
  targetQuantity: number;
  promptForContentEngine: string;
  additionalInstructions: string;
  fewShotJson: string;
  status: 'pending' | 'completed';
}

export interface LogEntry {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'error' | 'success' | 'warning';
}

export interface BatchProgress {
  current: number;
  total: number;
  label: string;
}