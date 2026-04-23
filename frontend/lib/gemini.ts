import { GoogleGenAI, Type, Schema } from '@google/genai';
import { GenerationParams, QuestionTemplate, AppSettings } from '../types';

// Initialize the SDK. The API key MUST be provided via process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

const questionTemplateSchema: Schema = {
  type: Type.ARRAY,
  description: "An array of 11+ exam question archetypes.",
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "A unique identifier for the template (e.g., uuid)." },
      section: { type: Type.STRING, description: "Must be one of: 'Maths', 'English SPaG', 'English Comp'" },
      topic: { type: Type.STRING, description: "The specific topic, e.g., 'Fractions', 'Verbal Reasoning'" },
      difficulty: { type: Type.STRING, description: "Must be one of: 'D1', 'D2', 'D3'" },
      template_stem: { type: Type.STRING, description: "The question text with variables in curly braces, e.g., 'If a train travels {d} miles in {t} hours...'" },
      variable_bounds: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Variable name without braces, e.g., 'd'" },
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
        description: "Array of mathjs compatible boolean expressions, e.g., ['d > t', 'd % t == 0']"
      },
      correct_answer_logic: { type: Type.STRING, description: "mathjs compatible formula for the correct answer, e.g., 'd / t'" },
      distractor_logic: {
        type: Type.ARRAY,
        description: "EXACTLY 4 distractors.",
        items: {
          type: Type.OBJECT,
          properties: {
            expr: { type: Type.STRING, description: "mathjs compatible formula for the distractor" },
            trap_label: { type: Type.STRING, description: "Short description of the trap" },
            misconception_tag: { type: Type.STRING, description: "Tag for the misconception" }
          },
          required: ["expr", "trap_label", "misconception_tag"]
        }
      },
      svg_template: { type: Type.STRING, description: "Optional valid XML SVG string with {variable} placeholders. Must include 'Diagram NOT drawn to scale' if present." },
      skill_tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      },
      status: { type: Type.STRING, description: "Always set to 'pending'" }
    },
    required: [
      "id", "section", "topic", "difficulty", "template_stem",
      "variable_bounds", "correct_answer_logic", "distractor_logic",
      "constraints", "skill_tags", "status"
    ]
  }
};

export const generateTemplates = async (
  params: GenerationParams, 
  settings: AppSettings,
  onLog?: (msg: string, type?: 'info' | 'error' | 'success' | 'warning') => void,
  abortSignal?: AbortSignal
): Promise<QuestionTemplate[]> => {
  
  const prompt = `${params.mainPrompt}

STRICT CONSTRAINTS & INSTRUCTIONS:
${params.instructions || 'None'}

REFERENCE JSON STRUCTURE (FEW-SHOT):
${params.fewShotJson || 'None'}

CRITICAL RULE 1: Mathematical Safety & Constraints (Zero Failures Allowed)
The questions you generate will be passed through a 50x Monte Carlo simulation. To prevent simulation crashes, infinite decimals, and logic collisions, you MUST include a "constraints" array containing valid JavaScript expression strings.
- Prevent Decimals: Use modulo logic to guarantee clean division. Example: If finding Time from Distance and Speed, you MUST include "(D * 60) % S != 0" or "(D * 60) % (S1 - S2) == 0".
- Prevent Collisions: Distractor logic must never evaluate to the same number. Use rules like "P1 != P2" or "S1 != (2 * R)".
- Prevent Zero/Negatives: Ensure physical limits. Example: "S1 - Reduction > 5".
- Constraint Syntax: When using built-in math functions in the logic or constraints, use the raw function names natively (e.g., lcm(A,B), gcd(A,B)). DO NOT prefix them with "math." as it will cause a syntax error in the evaluator.

CRITICAL RULE 2: Pedagogical Rigor (No Red Herrings)
- Every data point provided in the question stem MUST be necessary to solve the problem.
- Never include phrasing like "assuming the price is the same as the start" if it renders previous data points useless.
- Distractor Logic: Traps must represent genuine cognitive errors (e.g., "Unit conversion omission", "Step 1 Stop", "Inverse operation error"). Do not use meaningless combinations of variables.

CRITICAL RULE 3: JSON Schema Strictness
- Output nothing but raw JSON. No markdown formatting, no conversational filler.
- Valid JSON array [] containing objects with EXACT keys: id, section, topic, difficulty, template_stem, variable_bounds, correct_answer_logic, distractor_logic, constraints, skill_tags, status.

CRITICAL RULE 4: Batch Variance
- Force distinct contextual scenarios (e.g., cars, boats, runners, trains) and vary the trap formulas. Do not repeat the same question structure with just different variable names.
  `;

  const MAX_RETRIES = 3;
  let attempt = 0;

  if (onLog) onLog(`Initiating generation for topic: "${params.topic}" (Count: ${params.count}, Difficulty: ${params.difficulty})`, 'info');

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
          responseSchema: questionTemplateSchema,
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
      
      if (onLog) onLog(`Successfully generated ${templates.length} templates.`, 'success');

      // Ensure exactly 4 distractors and pending status
      return templates.map(t => ({
        ...t,
        status: t.status || 'pending',
        distractor_logic: (t.distractor_logic || []).slice(0, 4) // Enforce max 4, though schema asks for exactly 4
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