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
  section: string;
  topic: string;
  difficulty: string;
  template_stem: string;
  variables: VariableBound[];
  variable_bounds?: VariableBound[];
  constraints?: string[];
  correct_answer_logic: string;
  distractor_logic: DistractorLogic[];
  svg_template?: string | null;
  visual_payload?: {
    type: 'rectangle' | 'l_shape' | 'triangle' | 'circle' | 'compound';
    labels: Record<string, string>;
    options?: { notToScale?: boolean };
  } | null;
  skill_tags: string[];
  status: 'pending' | 'approved' | 'rejected' | 'published';
  multiSelect: boolean;
  selectTwo: boolean;
  needs_visual_rebuild?: boolean;
  needs_variable_review?: boolean;
  testResult?: TestResult;
}

export interface TopicSelection {
  id: string;
  label: string;
  section: string;
  topic: string;
}

export interface GenerationParams {
  selectedTopics: TopicSelection[];
  difficulty: string;
  count: number;
  instructions: string;
  fewShotJson?: string;
  mainPrompt: string;
}

export interface AppSettings {
  provider: 'gemini' | 'openai' | 'openrouter';
  apiKey: string;
  model: string;
  baseUrl: string;
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