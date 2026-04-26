import { evaluate } from 'mathjs';
import { QuestionTemplate } from '../types';

const VALID_COMBOS = new Set([
  "Maths|Arithmetic",
  "Maths|Geometry",
  "Maths|Algebra",
  "Maths|Data Handling",
  "Maths|Fractions, Decimals & Percentages",
  "Maths|Measure",
  "Maths|Ratio & Proportion",
  "English Section A|English SPaG",
  "English Section B|English Comprehension",
  "English Section C|English Comprehension",
  "English Section D|English Comparison",
]);

export function fixExpr(expr: string): string {
  if (!expr) return '';
  
  let fixed = expr;

  // Rule 1: Fix missing +1 on modulo-idx array selectors
  // [((idx+N)%M)] → [((idx+N)%M)+1]
  fixed = fixed.replace(
    /\[\(\(idx\s*\+\s*(\d+)\)\s*%\s*(\d+)\)\]/g,
    (_m, n, mod) => `[((idx+${n})%${mod})+1]`
  );
  
  // [(idx+N)%M] single-paren variant
  fixed = fixed.replace(
    /\[\(idx\s*\+\s*(\d+)\)\s*%\s*(\d+)\]/g,
    (_m, n, mod) => `[((idx+${n})%${mod})+1]`
  );

  // Rule 2: Fix bare [idx] on string arrays → [idx+1]
  fixed = fixed.replace(/("[^"]+"]\s*)\[idx\]/g, "$1[idx+1]");

  // Rule 3: JS Math.* → mathjs
  fixed = fixed
    .replace(/Math\.PI/g,  "pi")
    .replace(/Math\.sqrt/g, "sqrt")
    .replace(/Math\.floor/g, "floor")
    .replace(/Math\.ceil/g, "ceil")
    .replace(/Math\.abs/g,  "abs")
    .replace(/Math\.round/g, "round")
    .replace(/Math\.pow/g,  "pow")
    .replace(/&&/g,     " and ")
    .replace(/\|\|/g,    " or ");

  return fixed.trim();
}

export function repairTemplate(template: any): any {
  const repaired = { ...template };

  // A1. Field alias normalisation
  if (repaired.variable_bounds && !repaired.variables) {
    repaired.variables = repaired.variable_bounds;
    delete repaired.variable_bounds;
  }

  // A2. svg_template string "null" → JSON null
  if (repaired.svg_template === "null") {
    repaired.svg_template = null;
  }

  // A3. status normalisation
  if (repaired.status === "approved" || !repaired.status) {
    repaired.status = "published";
  }

  // A4. visual_payload empty object → null
  if (repaired.visual_payload && (!repaired.visual_payload.type || repaired.visual_payload.type === null)) {
    repaired.visual_payload = null;
  }

  // A5. Math.js expression repair
  if (typeof repaired.correct_answer_logic === 'string') {
    repaired.correct_answer_logic = fixExpr(repaired.correct_answer_logic);
  }
  
  if (Array.isArray(repaired.distractor_logic)) {
    repaired.distractor_logic = repaired.distractor_logic.map((d: any) => ({
      ...d,
      expr: typeof d.expr === 'string' ? fixExpr(d.expr) : d.expr
    }));
  }

  // A6. Section D idx-array → literal string
  if (
    repaired.section === "English Section D" &&
    Array.isArray(repaired.variables) &&
    repaired.variables.some((v: any) => v.name === "idx")
  ) {
    const extractLiteral = (expr: string, idxVal: number): string => {
      try {
        if (!expr.includes("[") || !expr.includes("idx")) return expr;
        const result = evaluate(expr, { idx: idxVal });
        return typeof result === "string" ? result : expr;
      } catch {
        return expr;
      }
    };

    if (
      typeof repaired.correct_answer_logic === "string" &&
      (repaired.correct_answer_logic.includes("idx") || repaired.correct_answer_logic.includes("["))
    ) {
      const extracted = extractLiteral(repaired.correct_answer_logic, 0);
      if (extracted !== repaired.correct_answer_logic) {
        console.warn(`[repair] Section D correct_answer_logic: extracted literal at idx=0 (${repaired.id})`);
        repaired.correct_answer_logic = extracted;
      }
    }

    if (Array.isArray(repaired.distractor_logic)) {
      repaired.distractor_logic = repaired.distractor_logic.map((d: any, i: number) => {
        if (
          typeof d?.expr === "string" &&
          (d.expr.includes("idx") || d.expr.includes("["))
        ) {
          const extracted = extractLiteral(d.expr, i);
          if (extracted !== d.expr) {
            console.warn(`[repair] Section D distractor[${i}]: extracted literal at idx=${i} (${repaired.id})`);
            return { ...d, expr: extracted };
          }
        }
        return d;
      });
    }
  }

  // A7. Strip spurious idx variable from plain-text English templates
  if (
    repaired.section?.startsWith("English") &&
    Array.isArray(repaired.variables) &&
    repaired.variables.some((v: any) => v.name === "idx") &&
    typeof repaired.correct_answer_logic === "string" &&
    !repaired.correct_answer_logic.includes("[") &&
    !repaired.correct_answer_logic.includes("idx") &&
    Array.isArray(repaired.distractor_logic) &&
    repaired.distractor_logic.every((d: any) => typeof d.expr === "string" && !d.expr.includes("[") && !d.expr.includes("idx"))
  ) {
    repaired.variables = [];
    repaired.constraints = [];
    console.warn(`[repair A7] id: ${repaired.id} — stripped spurious idx — all expressions are plain text`);
  }

  return repaired;
}

export function validateTemplate(template: any): string[] {
  const errors: string[] = [];

  // B1. Required fields present and non-empty
  const requiredFields = ['id', 'section', 'topic', 'difficulty', 'template_stem', 'correct_answer_logic', 'distractor_logic', 'variables'];
  for (const field of requiredFields) {
    if (template[field] === undefined || template[field] === null || template[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // B2. Section/topic combo is valid
  const key = `${template.section}|${template.topic}`;
  if (!VALID_COMBOS.has(key)) {
    errors.push(`Invalid section/topic combo: ${template.section}|${template.topic}`);
  }

  // B3. Difficulty is one of: "D1" | "D2" | "D3"
  if (!['D1', 'D2', 'D3'].includes(template.difficulty)) {
    errors.push(`Invalid difficulty: ${template.difficulty}. Must be D1, D2, or D3.`);
  }

  // B4. Exactly 4 distractor_logic entries
  if (!Array.isArray(template.distractor_logic) || template.distractor_logic.length !== 4) {
    errors.push(`distractor_logic must have exactly 4 entries, got ${template.distractor_logic?.length || 0}`);
  }

  // B5. Each distractor has required sub-fields
  if (Array.isArray(template.distractor_logic)) {
    template.distractor_logic.forEach((d, i) => {
      if (!d.expr || typeof d.expr !== 'string') errors.push(`distractor[${i}] missing required field: expr`);
      if (!d.trap_label || typeof d.trap_label !== 'string') errors.push(`distractor[${i}] missing required field: trap_label`);
      if (!d.misconception_tag || typeof d.misconception_tag !== 'string') errors.push(`distractor[${i}] missing required field: misconception_tag`);
    });
  }

  // B6. variables is an array
  if (!Array.isArray(template.variables)) {
    errors.push(`'variables' must be an array.`);
  } else {
    template.variables.forEach((v: any, i: number) => {
      if (!v.name || typeof v.name !== 'string') errors.push(`variables[${i}] missing or invalid 'name'`);
      if (typeof v.min !== 'number') errors.push(`variables[${i}] missing or invalid 'min'`);
      if (typeof v.max !== 'number') errors.push(`variables[${i}] missing or invalid 'max'`);
      if (typeof v.step !== 'number') errors.push(`variables[${i}] missing or invalid 'step'`);
      if (v.min === v.max) errors.push(`variables[${i}] min and max cannot be equal`);
    });
  }

  // CHECK C: English Hallucination Guards
  if (template.section?.startsWith("English")) {
    const stem = template.template_stem || '';
    
    // C1. Unfilled passage placeholder
    if (/\[\s*[Pp]assage\s*(text)?.*?\]/i.test(stem) || stem.toLowerCase().includes("[insert passage")) {
      errors.push("template_stem contains unfilled passage placeholder [Passage text here]. Write the full passage directly.");
    }

    // C2. Hardcoded numbered options in stem
    if (/(?:^|\n)\s*1\.\s+.+?\n\s*2\./.test(stem)) {
      errors.push("template_stem contains hardcoded numbered options (1. 2. 3. 4.). Options must live only in the logic arrays.");
    }

    // C3. Unmapped generation variables
    if (/\{(option\w*|Option\w*|Character_.*?|Paragraph_.*?)\}/i.test(stem)) {
      errors.push("template_stem contains unmapped placeholder variable e.g. {Option1_text}. Write the actual text.");
    }

    // C4. Section D plain-text check
    if (template.section === "English Section D") {
      const cal = template.correct_answer_logic as string;
      if (typeof cal === 'string' && (/idx/.test(cal) || /\[/.test(cal))) {
        errors.push("English Section D correct_answer_logic must be a plain text string after repair. Auto-repair (A6) failed. Write the answer directly as a string. Do not use idx or array expressions.");
      }
      if (Array.isArray(template.distractor_logic)) {
        template.distractor_logic.forEach((d: any, i: number) => {
          if (typeof d?.expr === "string" && (/idx/.test(d.expr) || /\[/.test(d.expr))) {
            errors.push(`Section D distractor[${i}] could not be resolved to plain text. Write the wrong answer directly as a string.`);
          }
        });
      }
    }
  }

  // CHECK B: Math.js Evaluation
  const isEnglish = template.section?.startsWith("English");
  const hasIdx = Array.isArray(template.variables) && template.variables.some((v: any) => v.name === "idx");

  if (isEnglish && !hasIdx) {
    // MODE: STATIC (C4)
    const cal = template.correct_answer_logic;
    if (typeof cal !== "string" || !cal.trim()) {
      errors.push("correct_answer_logic must be a non-empty plain text string for static English templates.");
    }
    if (Array.isArray(template.distractor_logic)) {
      template.distractor_logic.forEach((d: any, i: number) => {
        if (typeof d?.expr !== "string" || !d.expr.trim()) {
          errors.push(`distractor[${i}] expr must be a non-empty string.`);
        }
      });
    }
  } else if (isEnglish && hasIdx) {
    // MODE: IDX (C3)
    let skipCorrect = false;
    if (typeof template.correct_answer_logic !== "string" || !template.correct_answer_logic.includes("[")) {
      errors.push("correct_answer_logic contains idx variable but has no array expression. Either use array syntax [\"opt1\",\"opt2\",\"opt3\",\"opt4\"][idx+1] OR remove idx from variables and write the answer as a plain string.");
      skipCorrect = true;
    }

    const skipDistractors = new Set<number>();
    if (Array.isArray(template.distractor_logic)) {
      template.distractor_logic.forEach((d: any, i: number) => {
        if (typeof d?.expr !== "string" || !d.expr.includes("[")) {
          errors.push(`distractor[${i}] expr contains no array bracket. Either use ["d1","d2","d3","d4"][((idx+${i+1})%4)+1] OR remove idx from variables.`);
          skipDistractors.add(i);
        }
      });
    }

    for (let idxVal = 0; idxVal <= 3; idxVal++) {
      const scope = { idx: idxVal };
      
      if (!skipCorrect) {
        try { evaluate(template.correct_answer_logic, scope); }
        catch (e: any) { errors.push(`correct_answer_logic crashed at idx=${idxVal}: ${e.message}. Check array uses [idx+1] not [idx].`); }
      }

      if (Array.isArray(template.distractor_logic)) {
        template.distractor_logic.forEach((d: any, i: number) => {
          if (!skipDistractors.has(i)) {
            try { evaluate(d.expr, scope); }
            catch (e: any) { errors.push(`distractor[${i}] crashed at idx=${idxVal}: ${e.message}. Check array uses [((idx+N)%4)+1] not [((idx+N)%4)].`); }
          }
        });
      }
    }
  } else {
    // MODE: MATHS (C1/C2)
    const scope: Record<string, number> = {};
    if (Array.isArray(template.variables)) {
      for (const v of template.variables) {
        scope[v.name] = Math.floor((v.min + v.max) / 2);
      }
    }

    try { evaluate(template.correct_answer_logic, scope); }
    catch (e: any) { errors.push(`correct_answer_logic failed: ${e.message}`); }

    if (Array.isArray(template.distractor_logic)) {
      template.distractor_logic.forEach((d: any, i: number) => {
        try { evaluate(d.expr, scope); }
        catch (e: any) { errors.push(`distractor[${i}] failed: ${e.message}`); }
      });
    }
  }

  return errors;
}

export function isValidTemplate(template: any): boolean {
  return validateTemplate(template).length === 0;
}
