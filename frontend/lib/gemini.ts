import { GoogleGenAI, Type, Schema } from '@google/genai';
import { GenerationParams, QuestionTemplate, AppSettings } from '../types';
import { repairTemplate, validateTemplate } from './template-validator';

// Initialize the SDK. The API key MUST be provided via process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

const getQuestionTemplateSchema = (count: number): Schema => ({
  type: Type.ARRAY,
  description: `An array of EXACTLY ${count} 11+ exam question archetypes. You MUST return exactly ${count} items.`,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "A unique alphanumeric or semantic string identifier (e.g., 'sset_math_001')." },
      section: { type: Type.STRING, description: "e.g., 'Maths', 'English Section A', 'English Section B', 'English Section C', 'English Section D'." },
      topic: { type: Type.STRING, description: "Must be an exact enum (e.g., 'Arithmetic', 'Geometry', 'English SPaG', 'English Comprehension', 'English Comparison')." },
      difficulty: { type: Type.STRING, description: "e.g., 'D1', 'D2', 'D3'." },
      template_stem: { type: Type.STRING, description: "The question text with variables wrapped in curly braces (e.g., '{TOTAL_CAKES}')." },
      variables: {
        type: Type.ARRAY,
        description: "MUST be named 'variables'. Format: [{'name': 'A', 'min': 1, 'max': 10, 'step': 1}].",
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
      selectTwo: { type: Type.BOOLEAN, description: "STRICTLY true or false" },
      needs_visual_rebuild: { type: Type.BOOLEAN, description: "STRICTLY true or false" },
      needs_variable_review: { type: Type.BOOLEAN, description: "STRICTLY true or false" }
    },
    required: [
      "id", "section", "topic", "difficulty", "template_stem",
      "variables", "correct_answer_logic", "distractor_logic",
      "constraints", "skill_tags", "status", "multiSelect", "selectTwo",
      "needs_visual_rebuild", "needs_variable_review"
    ]
  }
});

function buildBasePrompt(params: GenerationParams): string {
  return `TASK: ${params.mainPrompt}

CRITICAL REQUIREMENT: You MUST generate EXACTLY ${params.count} question objects in the JSON array. Do not stop at 1. Generate all ${params.count} questions.

STRICT CONSTRAINTS & INSTRUCTIONS:
${params.instructions || 'None'}

REFERENCE JSON STRUCTURE (FEW-SHOT):
${params.fewShotJson || 'None'}

# CRITICAL RULE: STRICT JSON SCHEMA COMPLIANCE
Your output must be a raw JSON array of exactly ${params.count} objects. You MUST NOT use Markdown wrappers (e.g., no \`\`\`json). You MUST use the exact keys and data types listed below. Any deviation will cause a fatal pipeline crash.

## 1. REQUIRED KEYS & TYPES
Every template object must use exactly the field names listed below — snake_case throughout.
- "id": "tpl-{unix_ms}-{batch_index}-{6char_hash}"
- "section": "Maths" | "English Section A" | "English Section B" | "English Section C" | "English Section D"
- "topic": "Arithmetic" | "Geometry" | "Algebra" | "Data Handling" | "Fractions, Decimals & Percentages" | "Measure" | "Ratio & Proportion" | "English SPaG" | "English Comprehension" | "English Comparison"
- "difficulty": "D1" | "D2" | "D3"
- "template_stem": "Question text. Placeholder vars in CAPS e.g. {NUM_A}."
- "variables": [ { "name": "VAR", "min": 0, "max": 10, "step": 1 } ]
- "constraints": [ "constraint expression string", "..." ]
- "correct_answer_logic": The mathematical formula or the index-mapped string array.
- "distractor_logic": [ {"expr": "logic", "trap_label": "label", "misconception_tag": "tag"} ]
- "skill_tags": [ "tag1", "tag2" ]
- "status": "published"
- "multiSelect": false
- "selectTwo": false
- "svg_template": null
- "visual_payload": null
- "needs_visual_rebuild": false
- "needs_variable_review": false

## 2. SVG RENDERING RULES (GEOMETRY/VISUALS)
- If the question requires a visual diagram (e.g., Geometry, Area), output a raw, responsive SVG string in the "svg_template" key.
- If the question does NOT require a diagram, output exactly: "svg_template": null.
- PARAMETRIC INJECTION: You MUST use your defined variables inside the SVG string wrapped in curly braces. 
 Example: <text x="10" y="20">{LENGTH} cm</text>
- Do not use markdown inside the svg_template string. Escape quotes if necessary.

## 3. INDEX-MAPPING FOR TEXT (ENGLISH QUESTIONS)
- math.js cannot evaluate English strings in constraints. 
- For text arrays, set "constraints": [] and define a pointer in "variables" (e.g., [{"name": "idx", "min": 0, "max": 3, "step": 1}]).
- Put text arrays directly in the logic fields: "[\\"CorrectA\\", \\"CorrectB\\"][idx + 1]".`;
}

function buildRetryPrompt(params: GenerationParams, errors: string[], attempt: number): string {
  const errorBlock = errors.map((e, i) => ` ${i+1}. ${e}`).join("\n");

  return `${buildBasePrompt(params)}

--- RETRY INSTRUCTION (Attempt ${attempt + 1} of 3) ---
Your previous output failed validation. Fix ALL errors below:

${errorBlock}

Common fixes:
 • "[Passage text here]" → write a full 120+ word passage directly
  in template_stem. No placeholders whatsoever.
 • "hardcoded numbered options" → remove all 1./2./3./4. from stem.
  Options live ONLY in correct_answer_logic and distractor_logic.
 • "idx=0" or "index out of range":
   WRONG:  ["a","b","c","d"][idx]
   CORRECT: ["a","b","c","d"][idx+1]
   WRONG:  [...][((idx+1)%4)]
   CORRECT: [...][((idx+1)%4)+1]
 • "distractor count" → distractor_logic must have EXACTLY 4 items.
 • "invalid section/topic" → use only canonical pairs:
   Maths + Arithmetic / Geometry / Algebra / Data Handling /
        Fractions, Decimals & Percentages / Measure /
        Ratio & Proportion
   English Section A + English SPaG
   English Section B + English Comprehension
   English Section C + English Comprehension
   English Section D + English Comparison
--- END RETRY INSTRUCTION ---`;
}

export const generateTemplates = async (
  params: GenerationParams, 
  settings: AppSettings,
  onLog?: (msg: string, type?: 'info' | 'error' | 'success' | 'warning') => void,
  abortSignal?: AbortSignal
): Promise<{ templates: QuestionTemplate[], warnings: { templateIndex: number, errors: string[] }[] }> => {
  
  const MAX_ATTEMPTS = 3;
  let attempts = 0;
  let lastErrors: string[] = [];
  let lastRawResponse = "";

  const topicNames = params.selectedTopics.map(t => t.topic).join(', ');
  if (onLog) onLog(`Initiating generation for topics: "${topicNames}" (Count: ${params.count}, Difficulty: ${params.difficulty})`, 'info');

  while (attempts < MAX_ATTEMPTS) {
    if (abortSignal?.aborted) throw new Error("Aborted by user");
    
    try {
      const modelName = settings.model || 'gemini-2.5-flash';
      if (onLog) onLog(`Calling API using model: ${modelName} (Attempt ${attempts + 1}/${MAX_ATTEMPTS})`, 'info');
      
      const prompt = attempts === 0
        ? buildBasePrompt(params)
        : buildRetryPrompt(params, lastErrors, attempts);

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

      lastRawResponse = response.text;

      // ── 1. Parse ────────────────────────────────────────────────
      const cleaned = lastRawResponse
        .replace(/^[^\[{]*/s, "")
        .replace(/[^\]\}]*$/s, "")
        .trim();
      
      const parsed = JSON.parse(cleaned);
      const templates = Array.isArray(parsed) ? parsed : [parsed];
      
      // ── 2. Repair each template ─────────────────────────────────
      const repaired = templates.map(repairTemplate);

      // ── 3. Validate each template independently ─────────────────
      const validTemplates:  any[]                 = [];
      const failedTemplates: { index: number; errors: string[] }[] = [];

      for (const [i, tpl] of repaired.entries()) {
        const errs = validateTemplate(tpl);
        if (errs.length === 0) {
          validTemplates.push({
            ...tpl,
            id: `tpl-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 9)}`,
            status: 'pending'
          });
        } else {
          failedTemplates.push({ index: i, errors: errs });
          console.warn(`[generator] template[${i}] invalid (attempt ${attempts+1}):`, errs);
        }
      }

      // ── 4. Return or retry ───────────────────────────────────────
      if (validTemplates.length > 0 && failedTemplates.length === 0) {
        // ── FULL SUCCESS ──
        console.log(`[generator] All ${validTemplates.length} accepted on attempt ${attempts+1}`);
        if (onLog) onLog(`[generator] All ${validTemplates.length} accepted on attempt ${attempts+1}`, 'success');
        return { templates: validTemplates, warnings: [] };
      }

      if (validTemplates.length > 0 && failedTemplates.length > 0) {
        // ── PARTIAL SUCCESS — return valid, report failures, NO retry ──
        console.warn(
          `[generator] Partial: ${validTemplates.length} valid, ` +
          `${failedTemplates.length} failed. Returning valid set.`
        );
        if (onLog) onLog(`[generator] Partial: ${validTemplates.length} valid, ${failedTemplates.length} failed. Returning valid set.`, 'warning');
        return {
          templates: validTemplates,
          warnings: failedTemplates.map(f => ({
            templateIndex: f.index,
            errors:    f.errors,
          })),
        };
      }

      // ── ZERO VALID — retry ──
      lastErrors = failedTemplates.flatMap(f =>
        f.errors.map(e => `[template ${f.index}] ${e}`)
      );
      console.warn(
        `[generator] Zero valid on attempt ${attempts+1}/${MAX_ATTEMPTS}: ` +
        `${lastErrors.length} total errors`
      );
      if (onLog) onLog(`[generator] Zero valid on attempt ${attempts+1}/${MAX_ATTEMPTS}: ${lastErrors.length} total errors`, 'warning');

    } catch (error: any) {
      if (error.message === "Aborted by user" || abortSignal?.aborted) {
        throw new Error("Aborted by user");
      }
      
      const msg = error instanceof Error ? error.message : String(error);
      lastErrors = [`JSON parse or API error: ${msg}`];
      console.warn(`[generator] Parse/API failed attempt ${attempts + 1}/${MAX_ATTEMPTS}: ${msg}`);
      if (onLog) onLog(`[generator] Parse/API failed attempt ${attempts + 1}/${MAX_ATTEMPTS}: ${msg}`, 'error');
    }
    
    attempts++;
    
    if (attempts < MAX_ATTEMPTS) {
      // Interruptible wait before retry
      for (let w = 0; w < 20; w++) { // 2 seconds
        if (abortSignal?.aborted) throw new Error("Aborted by user");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
  
  throw new Error(`Generation failed after ${MAX_ATTEMPTS} attempts. Reasons: ${lastErrors.join(' | ')}`);
};
