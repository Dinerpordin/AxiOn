import { evaluate, compile } from 'mathjs';
import { QuestionTemplate, TestResult } from '../types';

export const sanitizeExpression = (formula: string): string => {
  if (!formula) return '';
  let sanitized = String(formula).replace(/[{}]/g, '').replace(/[£$]/g, '');
  
  // Automatically fix implicit multiplication (e.g., '2x' -> '2 * x')
  sanitized = sanitized.replace(/(\d)([a-zA-Z])/g, '$1 * $2');
  
  // Fix common LLM hallucinations
  sanitized = sanitized.replace(/math\./gi, ''); // math.lcm -> lcm, Math.round -> round
  sanitized = sanitized.replace(/×/g, '*');
  sanitized = sanitized.replace(/÷/g, '/');
  sanitized = sanitized.replace(/\*\*/g, '^');
  
  // Remove '=' from expressions to prevent accidental boolean evaluation
  sanitized = sanitized.replace(/=/g, '');
  
  return sanitized;
};

export const sanitizeConstraint = (formula: string): string => {
  if (!formula) return '';
  let sanitized = String(formula).replace(/[{}]/g, '').replace(/[£$]/g, '');
  
  sanitized = sanitized.replace(/(\d)([a-zA-Z])/g, '$1 * $2');
  sanitized = sanitized.replace(/math\./gi, ''); // math.lcm -> lcm, Math.round -> round
  sanitized = sanitized.replace(/×/g, '*');
  sanitized = sanitized.replace(/÷/g, '/');
  sanitized = sanitized.replace(/\*\*/g, '^');
  
  // Replace single '=' with '==' for mathjs constraint evaluation, ignoring '==', '!=', '>=', '<='
  sanitized = sanitized.replace(/(?<![=!<>])=(?!=)/g, '==');
  
  // Fix strict equality/inequality to standard equality for mathjs
  sanitized = sanitized.replace(/===/g, '==');
  sanitized = sanitized.replace(/!==/g, '!=');
  
  return sanitized;
};

const generateRandomValue = (min: number, max: number, step: number): number => {
  // Fallback to step 1 if LLM provides 0, negative, or invalid step
  const safeStep = (typeof step !== 'number' || step <= 0 || isNaN(step)) ? 1 : step;
  
  // Ensure min/max are numbers and correctly ordered
  const numMin = Number(min) || 0;
  const numMax = Number(max) || 0;
  const actualMin = Math.min(numMin, numMax);
  const actualMax = Math.max(numMin, numMax);
  
  const range = actualMax - actualMin;
  const steps = Math.floor(range / safeStep);
  const randomStep = Math.floor(Math.random() * (steps + 1));
  
  // Fix floating point precision issues with step
  return Number((actualMin + randomStep * safeStep).toFixed(10));
};

// Helper to fix floating point inaccuracies (e.g., 0.1 + 0.2 = 0.30000000000000004)
const fixFloat = (num: any): any => {
  if (typeof num === 'number') {
    return Number(Math.round(Number(num + 'e5')) + 'e-5'); // Round to 5 decimal places
  }
  return num;
};

export const runMonteCarloTest = (template: QuestionTemplate): TestResult => {
  const ITERATIONS = 50;
  const MAX_ATTEMPTS_PER_ITERATION = 400; // Reduced to prevent long hangs on impossible constraints
  const errors: string[] = [];

  const variableBounds = template.variable_bounds || (template as any).variables || [];
  const distractorLogic = template.distractor_logic || [];
  const distractorCollisions = new Array(distractorLogic.length).fill(0);
  
  const isEnglishSection = template.section.startsWith('English');
  const hasIdx = variableBounds.some((v: any) => v.name === 'idx');
  const isStaticEnglish = isEnglishSection && !hasIdx;

  if (!template.correct_answer_logic || template.correct_answer_logic.trim() === '') {
    return { passed: false, errors: ["Correct answer logic is empty."], lastRunTimestamp: Date.now() };
  }

  if (isStaticEnglish) {
    // ── STATIC ENGLISH MODE ──
    // No mathjs evaluation at all. Just check exprs are non-empty strings.
    if (typeof template.correct_answer_logic !== "string" || !template.correct_answer_logic.trim()) {
      errors.push("correct_answer_logic must be a non-empty string.");
    }
    distractorLogic.forEach((d: any, i: number) => {
      const expr = typeof d === 'string' ? d : d?.expr;
      if (typeof expr !== "string" || !expr.trim()) {
        errors.push(`distractor[${i}] expr must be a non-empty string.`);
      }
    });
    return {
      passed: errors.length === 0,
      errors,
      lastRunTimestamp: Date.now()
    };
  }

  const MAX_CONSTRAINTS_PER_VARIABLE = 5;
  const variableCount = variableBounds.length;
  const constraintCount = (template.constraints || []).length;

  if (constraintCount > variableCount * MAX_CONSTRAINTS_PER_VARIABLE) {
    errors.push(
      `Over-constrained: ${constraintCount} constraints for ${variableCount} variables. Maximum allowed is ${variableCount * MAX_CONSTRAINTS_PER_VARIABLE}. Simplify the constraint chain.`
    );
  }

  // 2. Pre-compile expressions for massive performance boost
  const compiledConstraints: { original: string, compiled: any }[] = [];
  if (template.constraints) {
    for (const constraint of template.constraints) {
      try {
        compiledConstraints.push({
          original: constraint,
          compiled: compile(sanitizeConstraint(constraint))
        });
      } catch (e: any) {
        return { passed: false, errors: [`Syntax Error in Constraint '${constraint}': ${e.message}`], lastRunTimestamp: Date.now() };
      }
    }
  }

  let compiledCorrectLogic: any;
  try {
    compiledCorrectLogic = compile(sanitizeExpression(template.correct_answer_logic));
  } catch (e: any) {
    return { passed: false, errors: [`Syntax Error in Correct Logic: ${e.message}`], lastRunTimestamp: Date.now() };
  }

  const compiledDistractors: { distractor: any, compiled: any, index: number }[] = [];
  for (let i = 0; i < distractorLogic.length; i++) {
    const distractor = distractorLogic[i];
    const expr = typeof distractor === 'string' ? distractor : distractor?.expr;
    if (!expr) continue;
    try {
      compiledDistractors.push({
        distractor,
        compiled: compile(sanitizeExpression(expr)),
        index: i
      });
    } catch (e: any) {
      return { passed: false, errors: [`Syntax Error in Distractor '${expr}': ${e.message}`], lastRunTimestamp: Date.now() };
    }
  }

  // 3. Run Monte Carlo Simulation
  for (let i = 0; i < ITERATIONS; i++) {
    let scope: Record<string, number> = {};
    let validScopeFound = false;
    let attempts = 0;
    const constraintErrors = new Set<string>();

    // Generate valid scope respecting constraints
    while (attempts < MAX_ATTEMPTS_PER_ITERATION) {
      scope = {};
      variableBounds.forEach(bound => {
        scope[bound.name] = generateRandomValue(bound.min, bound.max, bound.step);
      });

      let constraintsPassed = true;
      for (const c of compiledConstraints) {
        try {
          if (!c.compiled.evaluate(scope)) {
            constraintsPassed = false;
            break;
          }
        } catch (e: any) {
          constraintsPassed = false;
          constraintErrors.add(`Evaluation Error in Constraint '${c.original}': ${e.message}`);
          break;
        }
      }

      if (constraintsPassed) {
        validScopeFound = true;
        break;
      }
      attempts++;
    }

    if (!validScopeFound) {
      const boundsStr = variableBounds.map(v => `${v.name}[${v.min}-${v.max}]`).join(', ');
      const constraintsStr = template.constraints && template.constraints.length > 0 ? template.constraints.join(' AND ') : 'None';
      errors.push(`Constraint Exhaustion: Could not find valid variables after ${MAX_ATTEMPTS_PER_ITERATION} attempts. Bounds: ${boundsStr}. Constraints: ${constraintsStr}. Ensure bounds allow constraints to be mathematically possible.`);
      if (constraintErrors.size > 0) {
        errors.push(...Array.from(constraintErrors));
      }
      return { passed: false, errors: Array.from(new Set(errors)), lastRunTimestamp: Date.now() };
    }

    // Evaluate formulas
    try {
      let correctAnswer = compiledCorrectLogic.evaluate(scope);
      
      if (typeof correctAnswer === 'number') {
        correctAnswer = fixFloat(correctAnswer);
        if (!isEnglishSection && (!isFinite(correctAnswer) || isNaN(correctAnswer))) {
          throw new Error(`Formula evaluated to Infinity or NaN (possible division by zero)`);
        }
        // Precision Error Check
        if (!Number.isInteger(correctAnswer)) {
          const decimals = correctAnswer.toString().split('.')[1];
          if (decimals && decimals.length > 3) {
             errors.push(`Precision Error: Correct answer has >3 decimal places (${correctAnswer}) for scope ${JSON.stringify(scope)}`);
          }
        }
      } else if (typeof correctAnswer === 'boolean') {
        throw new Error(`Formula evaluated to a boolean instead of a number or string. Do not use '=' in logic formulas.`);
      }

      for (const d of compiledDistractors) {
        let distractorAnswer = d.compiled.evaluate(scope);
        
        if (typeof distractorAnswer === 'number') {
          distractorAnswer = fixFloat(distractorAnswer);
          if (!isEnglishSection && (!isFinite(distractorAnswer) || isNaN(distractorAnswer))) {
            throw new Error(`Distractor '${d.distractor.trap_label || d.distractor.expr}' evaluated to Infinity or NaN`);
          }
        } else if (typeof distractorAnswer === 'boolean') {
          throw new Error(`Distractor '${d.distractor.trap_label || d.distractor.expr}' evaluated to a boolean.`);
        }

        if (distractorAnswer === correctAnswer) {
          distractorCollisions[d.index]++;
        }
      }

    } catch (e: any) {
      errors.push(`Evaluation Error: ${e.message} for scope ${JSON.stringify(scope)}`);
      return { passed: false, errors: Array.from(new Set(errors)), lastRunTimestamp: Date.now() };
    }
  }

  // Logic Collision Check (>15% of runs per distractor)
  for (let i = 0; i < distractorCollisions.length; i++) {
    const rate = distractorCollisions[i] / ITERATIONS;
    if (rate > 0.15) {
      errors.push(`Logic Collision: Distractor ${i + 1} matched the correct answer in ${(rate * 100).toFixed(1)}% of runs (>15% threshold).`);
    }
  }

  const passed = errors.length === 0;
  return {
    passed,
    errors: Array.from(new Set(errors)), // Deduplicate errors
    lastRunTimestamp: Date.now()
  };
};