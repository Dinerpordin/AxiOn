import { GoogleGenAI, Type, Schema } from '@google/genai';
import { GenerationParams, QuestionTemplate, AppSettings } from '../types';

// Initialize the SDK. The API key MUST be provided via process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

const getQuestionTemplateSchema = (count: number): Schema => ({
  type: Type.ARRAY,
  description: `An array of EXACTLY ${count} 11+ exam question archetypes. You MUST return exactly ${count} items.`,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "A unique alphanumeric or semantic string identifier (e.g., 'sset_math_001')." },
      section: { type: Type.STRING, description: "e.g., 'Maths', 'English Section A', 'English Section B', 'English Section C'." },
      topic: { type: Type.STRING, description: "Must be an exact enum (e.g., 'Arithmetic', 'Geometry', 'English SPaG', 'English Comprehension', 'English Comparison')." },
      difficulty: { type: Type.STRING, description: "e.g., 'D1', 'D2', 'D3'." },
      template_stem: { type: Type.STRING, description: "The question text with variables wrapped in curly braces (e.g., '{TOTAL_CAKES}')." },
      variable_bounds: {
        type: Type.ARRAY,
        description: "MUST be named 'variable_bounds'. Format: [{'name': 'A', 'min': 1, 'max': 10, 'step': 1}].",
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            min: { type: Type.NUMBER },
            max: { type: Type.NUMBER },
            step: { type: Type.NUMBER }
          },
          required: ["name", "min", "max", "step"]
        }
      },
      constraints: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "For Maths: Use modulo for clean division (e.g., 'A % B == 0'). For English: Leave empty []."
      },
      correct_answer_logic: { type: Type.STRING, description: "The mathematical formula or the index-mapped string array." },
      distractor_logic: {
        type: Type.ARRAY,
        description: "EXACTLY 4 distractors. Format: [{'expr': 'logic', 'trap_label': 'label', 'misconception_tag': 'tag'}].",
        items: {
          type: Type.OBJECT,
          properties: {
            expr: { type: Type.STRING },
            trap_label: { type: Type.STRING },
            misconception_tag: { type: Type.STRING }
          },
          required: ["expr", "trap_label", "misconception_tag"]
        }
      },
      svg_template: { type: Type.STRING, description: "Raw, responsive SVG string or null." },
      visual_payload: {
        type: Type.OBJECT,
        description: "Optional visual payload for geometry/diagrams.",
        properties: {
          type: { type: Type.STRING, description: "'rectangle', 'l_shape', 'triangle', 'circle', 'compound'" },
          labels: { type: Type.OBJECT, description: "Key-value pairs of labels" },
          options: {
            type: Type.OBJECT,
            properties: {
              notToScale: { type: Type.BOOLEAN }
            }
          }
        },
        required: ["type", "labels"]
      },
      skill_tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "e.g., ['fractions', 'addition']."
      },
      status: { type: Type.STRING, description: "Always output 'published'" },
      multiSelect: { type: Type.BOOLEAN, description: "STRICTLY true or false" },
      selectTwo: { type: Type.BOOLEAN, description: "STRICTLY true or false" }
    },
    required: [
      "id", "section", "topic", "difficulty", "template_stem",
      "variable_bounds", "correct_answer_logic", "distractor_logic",
      "constraints", "skill_tags", "status", "multiSelect", "selectTwo"
    ]
  }
});

export const generateTemplates = async (
  params: GenerationParams, 
  settings: AppSettings,
  onLog?: (msg: string, type?: 'info' | 'error' | 'success' | 'warning') => void,
  abortSignal?: AbortSignal
): Promise<QuestionTemplate[]> => {
  
  const prompt = `TASK: ${params.mainPrompt}

CRITICAL REQUIREMENT: You MUST generate EXACTLY ${params.count} question objects in the JSON array. Do not stop at 1. Generate all ${params.count} questions.

STRICT CONSTRAINTS & INSTRUCTIONS:
${params.instructions || 'None'}

REFERENCE JSON STRUCTURE (FEW-SHOT):
${params.fewShotJson || 'None'}

# CRITICAL RULE: STRICT JSON SCHEMA COMPLIANCE
Your output must be a raw JSON array of exactly ${params.count} objects. You MUST NOT use Markdown wrappers (e.g., no \`\`\`json). You MUST use the exact keys and data types listed below. Any deviation will cause a fatal pipeline crash.

## 1. REQUIRED KEYS & TYPES
Every question object MUST contain exactly these keys:
- "id": (String) A unique alphanumeric or semantic string identifier (e.g., "sset_math_001").
- "section": (String) e.g., "Maths", "English Section A".
- "topic": (String) Must be an exact enum (e.g., "Arithmetic", "Geometry", "English SPaG", "English Comprehension", "English Comparison").
- "difficulty": (String) e.g., "D1", "D2", "D3".
- "template_stem": (String) The question text with variables wrapped in curly braces (e.g., "{TOTAL_CAKES}").
- "variable_bounds": (Array of Objects) Format: [{"name": "A", "min": 1, "max": 10, "step": 1}].
- "constraints": (Array of Strings) For Maths: Use modulo for clean division (e.g., "A % B == 0"). For English: Leave empty [].
- "correct_answer_logic": (String) The mathematical formula or the index-mapped string array.
- "distractor_logic": (Array of Objects) Format: [{"expr": "logic", "trap_label": "label", "misconception_tag": "tag"}].
- "skill_tags": (Array of Strings) e.g., ["fractions", "addition"].
- "status": (String) Always output "published".
- "multiSelect": (Boolean) STRICTLY true or false. Do not use quotes.
- "selectTwo": (Boolean) STRICTLY true or false. Do not use quotes.
- "svg_template": (String or null) See SVG Rules below.

## 2. SVG RENDERING RULES (GEOMETRY/VISUALS)
- If the question requires a visual diagram (e.g., Geometry, Area), output a raw, responsive SVG string in the "svg_template" key.
- If the question does NOT require a diagram, output exactly: "svg_template": null.
- PARAMETRIC INJECTION: You MUST use your defined variables inside the SVG string wrapped in curly braces. 
 Example: <text x="10" y="20">{LENGTH} cm</text>
- Do not use markdown inside the svg_template string. Escape quotes if necessary.

## 3. INDEX-MAPPING FOR TEXT (ENGLISH QUESTIONS)
- math.js cannot evaluate English strings in constraints. 
- For text arrays, set "constraints": [] and define a pointer in "variable_bounds" (e.g., [{"name": "idx", "min": 0, "max": 3, "step": 1}]).
- Put text arrays directly in the logic fields: "[\\"CorrectA\\", \\"CorrectB\\"][idx + 1]".
  `;

  const MAX_RETRIES = 3;
  let attempt = 0;

  const topicNames = params.selectedTopics.map(t => t.topic).join(', ');
  if (onLog) onLog(`Initiating generation for topics: "${topicNames}" (Count: ${params.count}, Difficulty: ${params.difficulty})`, 'info');

  while (attempt < MAX_RETRIES) {
    if (abortSignal?.aborted) throw new Error("Aborted by user");
    
    try {
      const modelName = settings.model || 'gemini-2.5-flash';
      if (onLog) onLog(`Calling API using model: ${modelName} (Attempt ${attempt + 1}/${MAX_RETRIES})`, 'info');
      
      const generatePromise = ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: settings.systemInstructions || undefined,
          responseMimeType: 'application/json',
          responseSchema: getQuestionTemplateSchema(params.count),
          temperature: 0.2, // Lowered temperature for logic/math consistency
        }
      });

      let response: any;

      // Use Promise.race to instantly reject if the user clicks Stop
      if (abortSignal) {
        const abortPromise = new Promise<never>((_, reject) => {
          if (abortSignal.aborted) reject(new Error("Aborted by user"));
          abortSignal.addEventListener('abort', () => reject(new Error("Aborted by user")));
        });
        
        // Catch the background promise to prevent unhandled rejections if it fails after abort
        generatePromise.catch(() => {});
        
        response = await Promise.race([generatePromise, abortPromise]);
      } else {
        response = await generatePromise;
      }

      if (!response.text) {
        throw new Error("Empty response from AI");
      }

      const templates: QuestionTemplate[] = JSON.parse(response.text);
      
      if (templates.length < params.count) {
        if (onLog) onLog(`Warning: Requested ${params.count} templates, but AI only generated ${templates.length}.`, 'warning');
      } else {
        if (onLog) onLog(`Successfully generated ${templates.length} templates.`, 'success');
      }

      // Ensure exactly 4 distractors, pending status, and UNIQUE IDs to prevent React key collisions
      return templates.map((t, index) => ({
        ...t,
        id: `tpl-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 9)}`, // Force unique ID
        status: 'pending', // Force to pending so the UI review flow works
        variable_bounds: t.variable_bounds || (t as any).variables || [], // Fallback just in case
        distractor_logic: (t.distractor_logic || []).slice(0, 4)
      }));

    } catch (error: any) {
      if (error.message === "Aborted by user" || abortSignal?.aborted) {
        throw new Error("Aborted by user");
      }
      
      attempt++;
      console.error(`Error generating templates (attempt ${attempt}):`, error);
      
      if (attempt >= MAX_RETRIES) {
        if (onLog) onLog(`Generation failed after ${MAX_RETRIES} attempts: ${error.message}`, 'error');
        throw new Error(`Failed to generate templates after ${MAX_RETRIES} attempts: ${error.message}`);
      }
      
      if (onLog) onLog(`Attempt ${attempt} failed: ${error.message}. Waiting 10 seconds before retrying to prevent rate limits...`, 'warning');
      
      // Interruptible 10-second wait
      for (let w = 0; w < 100; w++) {
        if (abortSignal?.aborted) throw new Error("Aborted by user");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
  
  throw new Error("Unexpected error in generation loop");
};