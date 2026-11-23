// Pure logic: validation against the digital twin, timelines, training, commands.
// No React / React Native imports here, so it can be unit-tested with plain Node.
import type {
  Joint,
  MechProfile,
  Mode,
  Skill,
  SkillProgress,
  SkillStep,
  StatName,
} from './types';

export const MIN_STEP_MS = 50;
export const MAX_STEP_MS = 10000;
export const MAX_SKILL_MS = 60000;
export const MAX_STEPS = 64;
export const MAX_LEVEL = 10;
export const MAX_STAT = 10;
export const XP_PER_LEVEL = 250;

export interface Issue {
  step?: number; // index into skill.steps
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  totalMs: number;
}

export interface TimedStep extends SkillStep {
  index: number;
  start_ms: number;
  end_ms: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function jointMap(profile: MechProfile): Map<string, Joint> {
  return new Map(profile.joints.map((j) => [j.name, j]));
}

/** Effective speed limit for a joint in a mode, in degrees per second. */
export function allowedSpeed(joint: Joint, mode?: Mode): number {
  const pct = mode ? clamp(mode.limits.max_speed_pct, 1, 100) : 100;
  return (joint.max_speed_dps * pct) / 100;
}

/**
 * Start/end times of one pass through the steps.
 * A step starts when everything before it has finished, unless with_previous
 * is set, in which case it starts together with the previous step.
 */
export function timeline(steps: SkillStep[]): { steps: TimedStep[]; passMs: number } {
  const out: TimedStep[] = [];
  let cursor = 0; // end of everything so far
  let prevStart = 0;
  steps.forEach((s, index) => {
    const start = index > 0 && s.with_previous ? prevStart : cursor;
    const end = start + s.duration_ms;
    out.push({ ...s, index, start_ms: start, end_ms: end });
    prevStart = start;
    cursor = Math.max(cursor, end);
  });
  return { steps: out, passMs: cursor };
}

export function skillDurationMs(skill: Skill): number {
  return timeline(skill.steps).passMs * Math.max(1, skill.repeat ?? 1);
}

/** Validate a skill against the mechanical profile and (optionally) a mode. */
export function validateSkill(skill: Skill, profile: MechProfile, mode?: Mode): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const joints = jointMap(profile);

  if (!/^[a-z0-9_]{1,32}$/.test(skill.skill_id)) {
    errors.push({ message: 'skill_id must be 1-32 chars: lowercase letters, digits, _' });
  }
  if (skill.steps.length === 0) errors.push({ message: 'Skill has no steps' });
  if (skill.steps.length > MAX_STEPS) errors.push({ message: `Too many steps (max ${MAX_STEPS})` });
  const repeat = skill.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) {
    errors.push({ message: 'repeat must be a whole number 1-10' });
  }
  if (mode && !mode.allowed_skills.includes(skill.skill_id)) {
    warnings.push({ message: `"${skill.skill_id}" is not in ${mode.name}'s allowed skills` });
  }

  const { steps: timed, passMs } = timeline(skill.steps);

  // Per-step checks.
  timed.forEach((s) => {
    const j = joints.get(s.joint);
    if (!j) {
      errors.push({ step: s.index, message: `Unknown joint "${s.joint}"` });
      return;
    }
    if (!j.enabled) errors.push({ step: s.index, message: `Joint "${s.joint}" is disabled in the profile` });
    if (!Number.isFinite(s.target_angle) || s.target_angle < j.min_angle || s.target_angle > j.max_angle) {
      errors.push({
        step: s.index,
        message: `${s.joint} angle ${s.target_angle} outside ${j.min_angle}-${j.max_angle}`,
      });
    }
    if (!Number.isFinite(s.duration_ms) || s.duration_ms < MIN_STEP_MS || s.duration_ms > MAX_STEP_MS) {
      errors.push({ step: s.index, message: `Duration must be ${MIN_STEP_MS}-${MAX_STEP_MS} ms` });
    }
  });

  // The same joint must not be driven by two overlapping steps.
  for (let a = 0; a < timed.length; a++) {
    for (let b = a + 1; b < timed.length; b++) {
      const x = timed[a];
      const y = timed[b];
      if (x.joint === y.joint && x.start_ms < y.end_ms && y.start_ms < x.end_ms) {
        errors.push({ step: y.index, message: `${y.joint} is already moving in step ${x.index + 1}` });
      }
    }
  }

  // Speed checks: walk the passes in time order, tracking each joint's angle
  // (starting from home). Two passes cover the wrap-around from end to start.
  const angle = new Map<string, number>();
  profile.joints.forEach((j) => angle.set(j.name, j.home_angle));
  const ordered = [...timed].sort((p, q) => p.start_ms - q.start_ms || p.index - q.index);
  const passes = repeat > 1 ? 2 : 1;
  const reported = new Set<number>();
  for (let pass = 0; pass < passes; pass++) {
    for (const s of ordered) {
      const j = joints.get(s.joint);
      if (!j || s.duration_ms <= 0) continue;
      const from = angle.get(s.joint) ?? j.home_angle;
      const need = Math.abs(s.target_angle - from) / (s.duration_ms / 1000);
      const max = allowedSpeed(j, mode);
      if (need > max + 1e-6 && !reported.has(s.index)) {
        reported.add(s.index);
        errors.push({
          step: s.index,
          message: `${s.joint} too fast: ${Math.round(need)}°/s, limit ${Math.round(max)}°/s`,
        });
      }
      angle.set(s.joint, s.target_angle);
    }
  }

  const totalMs = passMs * Math.max(1, repeat);
  if (totalMs > MAX_SKILL_MS) errors.push({ message: `Skill too long (${totalMs} ms, max ${MAX_SKILL_MS})` });

  return { ok: errors.length === 0, errors, warnings, totalMs };
}

/**
 * Make a skill safe: clamp angles into limits and lengthen steps that are too
 * fast. Never makes anything faster.
 */
export function autoFix(skill: Skill, profile: MechProfile, mode?: Mode): Skill {
  const joints = jointMap(profile);
  const steps = skill.steps.map((s) => {
    const j = joints.get(s.joint);
    const target = j ? clamp(Math.round(s.target_angle), j.min_angle, j.max_angle) : s.target_angle;
    const duration = clamp(Math.round(s.duration_ms), MIN_STEP_MS, MAX_STEP_MS);
    return { ...s, target_angle: target, duration_ms: duration };
  });

  // Fix speeds using the same time-ordered walk as validation (two passes
  // when repeating). Re-run the timeline after each change.
  const repeat = Math.max(1, skill.repeat ?? 1);
  for (let iter = 0; iter < 3; iter++) {
    const angle = new Map<string, number>();
    profile.joints.forEach((j) => angle.set(j.name, j.home_angle));
    const ordered = [...timeline(steps).steps].sort((p, q) => p.start_ms - q.start_ms || p.index - q.index);
    let changed = false;
    for (let pass = 0; pass < (repeat > 1 ? 2 : 1); pass++) {
      for (const t of ordered) {
        const j = joints.get(t.joint);
        if (!j) continue;
        const from = angle.get(t.joint) ?? j.home_angle;
        const minMs = Math.ceil(((Math.abs(steps[t.index].target_angle - from) / allowedSpeed(j, mode)) * 1000) / 10) * 10;
        if (steps[t.index].duration_ms < minMs) {
          steps[t.index] = { ...steps[t.index], duration_ms: clamp(minMs, MIN_STEP_MS, MAX_STEP_MS) };
          changed = true;
        }
        angle.set(t.joint, steps[t.index].target_angle);
      }
    }
    if (!changed) break;
  }
  const fixed: Skill = { ...skill, steps };
  return { ...fixed, duration_ms: skillDurationMs(fixed) };
}

/** Steps that move from one recorded pose to the next, all joints together. */
export function poseToSteps(
  prev: Record<string, number>,
  next: Record<string, number>,
  profile: MechProfile,
  mode?: Mode,
): SkillStep[] {
  const joints = jointMap(profile);
  const changed = Object.keys(next).filter((k) => joints.get(k)?.enabled && Math.round(next[k]) !== Math.round(prev[k] ?? NaN));
  if (changed.length === 0) return [];
  // One shared duration: slowest joint at half its allowed speed, at least 300 ms.
  let ms = 300;
  for (const k of changed) {
    const j = joints.get(k)!;
    const from = prev[k] ?? j.home_angle;
    const need = (Math.abs(next[k] - from) / (allowedSpeed(j, mode) * 0.5)) * 1000;
    ms = Math.max(ms, Math.ceil(need / 10) * 10);
  }
  return changed.map((k, i) => ({
    joint: k,
    target_angle: Math.round(next[k]),
    duration_ms: Math.min(ms, MAX_STEP_MS),
    ...(i > 0 ? { with_previous: true } : {}),
  }));
}

// ---------------- Training ----------------

export interface TrainingResult {
  skill: Skill;
  progress: SkillProgress;
  statChanged?: StatName;
  change: string;
}

export function newProgress(): SkillProgress {
  return { level: 1, xp: 0, best_score: 0, param_version: 1, sessions: 0 };
}

/**
 * Apply one practice session. A good score sharpens the skill (a little
 * faster and bigger), a poor one softens it (a little slower). Everything is
 * passed through autoFix, so training can never exceed joint or mode limits.
 */
export function applyTraining(
  skill: Skill,
  progress: SkillProgress | undefined,
  score: number,
  profile: MechProfile,
  mode?: Mode,
): TrainingResult {
  const p = { ...(progress ?? newProgress()) };
  const s = clamp(Math.round(score), 0, 100);
  const joints = jointMap(profile);

  let candidate: Skill;
  let change: string;
  const faster = (grow: number): Skill =>
    autoFix(
      {
        ...skill,
        steps: skill.steps.map((st) => {
          const home = joints.get(st.joint)?.home_angle ?? 90;
          return {
            ...st,
            duration_ms: Math.round(st.duration_ms * 0.95),
            target_angle: Math.round(home + (st.target_angle - home) * grow),
          };
        }),
      },
      profile,
      mode,
    );

  if (s >= 60) {
    // Prefer faster + bigger; if the speed limit makes that slower overall,
    // fall back to just faster. A sharpened skill never takes longer.
    const before = skillDurationMs(skill);
    candidate = faster(1.03);
    change = 'sharpened (faster, bigger moves)';
    if (skillDurationMs(candidate) > before) {
      candidate = faster(1);
      change = 'sharpened (faster)';
    }
    if (skillDurationMs(candidate) > before) candidate = skill;
  } else {
    candidate = autoFix(
      { ...skill, steps: skill.steps.map((st) => ({ ...st, duration_ms: Math.round(st.duration_ms * 1.05) })) },
      profile,
      mode,
    );
    change = 'softened (slower, steadier)';
  }

  const paramsChanged = JSON.stringify(candidate.steps) !== JSON.stringify(skill.steps);
  if (paramsChanged) {
    candidate = { ...candidate, version: skill.version + 1, duration_ms: skillDurationMs(candidate) };
    p.param_version += 1;
  } else {
    candidate = skill;
    change = 'already at the safe limit, no change';
  }

  const oldLevel = p.level;
  p.sessions += 1;
  p.xp += s;
  p.best_score = Math.max(p.best_score, s);
  p.level = Math.min(MAX_LEVEL, 1 + Math.floor(p.xp / XP_PER_LEVEL));
  const statChanged = p.level > oldLevel ? skill.stat : undefined;

  return { skill: candidate, progress: p, statChanged, change };
}

export function bumpStat(stats: Record<StatName, number>, stat?: StatName): Record<StatName, number> {
  if (!stat) return stats;
  return { ...stats, [stat]: Math.min(MAX_STAT, (stats[stat] ?? 0) + 1) };
}

// ---------------- Commands (voice/text) ----------------

export type Command =
  | { kind: 'stop' }
  | { kind: 'skill'; skill_id: string }
  | { kind: 'mode'; mode_id: string }
  | { kind: 'unknown'; text: string };

const SKILL_WORDS: Record<string, string[]> = {
  wave: ['wave', 'hello', 'hi', 'bye', 'namaste'],
  nod: ['nod', 'yes', 'agree'],
  dance_basic: ['dance', 'party', 'groove'],
};

/** Simple local command matching. Cloud AI comes later (see architecture.md). */
export function parseCommand(text: string, skills: Skill[], modes: Mode[]): Command {
  const t = text.toLowerCase().replace(/[^a-z0-9_ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { kind: 'unknown', text };
  const words = new Set(t.split(' '));
  if (words.has('stop') || words.has('freeze') || words.has('halt')) return { kind: 'stop' };

  for (const m of modes) {
    const first = m.mode_id.split('_')[0];
    if (words.has('mode') && (words.has(first) || t.includes(m.name.toLowerCase().replace(' mode', '')))) {
      return { kind: 'mode', mode_id: m.mode_id };
    }
  }
  for (const s of skills) {
    const names = [s.skill_id.replace(/_/g, ' '), (s.name ?? '').toLowerCase()].filter(Boolean);
    if (names.some((n) => t.includes(n))) return { kind: 'skill', skill_id: s.skill_id };
  }
  for (const [id, keys] of Object.entries(SKILL_WORDS)) {
    if (skills.some((s) => s.skill_id === id) && keys.some((k) => words.has(k))) {
      return { kind: 'skill', skill_id: id };
    }
  }
  return { kind: 'unknown', text };
}
