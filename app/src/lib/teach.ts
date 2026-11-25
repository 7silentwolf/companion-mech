// Teach mode v1: understand simple commands ("raise right hand", "a bit lower",
// "good", "faster", "save as jab", "combo jab jab cross") and build skills from
// them. No AI: fixed words, offline, predictable. Pure logic, unit-tested.
//
// Safety: every pose is clamped to the joint limits here, every saved skill goes
// through autoFix/validateSkill, and the robot enforces its own limits again.
import { autoFix, jointMap, MAX_STEPS, poseToSteps, skillDurationMs, validateSkill } from './engine.ts';
import type { Joint, MechProfile, Mode, Skill, SkillStep } from './types';

export type Pose = Record<string, number>;
type Side = 'right' | 'left';
type Part = 'head' | 'shoulder' | 'elbow';

export interface TeachSnapshot {
  pose: Pose; // what the robot is showing now
  lastPose: Pose; // pose at the last "good" (start: home)
  steps: SkillStep[]; // taught so far
  lastJoint?: string; // joint that "higher/lower/more" refers to
  lastDir?: 1 | -1; // direction of the last nudge (for "more")
  side: Side;
  lastGroup?: { start: number; end: number }; // steps added by the last "good" (for faster/slower)
}

export interface TeachState extends TeachSnapshot {
  undo: TeachSnapshot[];
}

export type TeachCommand =
  | { kind: 'set'; joint?: string; part?: Part; side?: Side; angle: number }
  | { kind: 'nudge'; joint?: string; part?: Part; side?: Side; dir: 1 | -1; amount: number }
  | { kind: 'preset'; name: PresetName; side?: Side }
  | { kind: 'select'; part: Part; side?: Side }
  | { kind: 'more'; amount: number }
  | { kind: 'keep' }
  | { kind: 'undo' }
  | { kind: 'speed'; factor: number }
  | { kind: 'play' }
  | { kind: 'home' }
  | { kind: 'clear' }
  | { kind: 'save'; name?: string }
  | { kind: 'combo'; parts: string[]; unknown: string[]; name?: string }
  | { kind: 'unknown'; text: string };

export type PresetName = 'raise' | 'lower' | 'bend' | 'straighten' | 'punch' | 'guard' | 'look_left' | 'look_right' | 'look_center';

export interface TeachResult {
  state: TeachState;
  message: string;
  /** Joint moves to send to the robot right away. */
  send: { joint: string; angle: number }[];
  /** Skill to play on the robot (for "play"). */
  play?: Skill;
  ok: boolean;
}

export const HELP =
  'Try: raise right hand, a bit lower, bend elbow, straighten, punch, guard, look left, good, undo, faster, play it, save as jab, combo jab jab cross.';

const SMALL = 5;
const MEDIUM = 15;
const LARGE = 30;
const UNDO_LIMIT = 50;

// ---------------- Parsing ----------------

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/°/g, ' degrees ')
    .replace(/[^a-z0-9_ ,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (t: string, ...words: string[]) => words.some((w) => new RegExp(`(^| )${w}( |$)`).test(t));

function magnitude(t: string): number {
  if (has(t, 'a bit', 'a little', 'slightly', 'little', 'tiny', 'bit', 'touch')) return SMALL;
  if (has(t, 'much', 'a lot', 'lot', 'way', 'very', 'lots', 'far')) return LARGE;
  return MEDIUM;
}

function sideOf(t: string): Side | undefined {
  if (has(t, 'left')) return 'left';
  if (has(t, 'right')) return 'right';
  return undefined;
}

function partOf(t: string): Part | undefined {
  if (has(t, 'head', 'look', 'face', 'eyes', 'turn your head')) return 'head';
  if (has(t, 'elbow', 'elbows', 'forearm', 'bend', 'straighten', 'straight', 'extend')) return 'elbow';
  if (has(t, 'hand', 'hands', 'arm', 'arms', 'shoulder', 'shoulders', 'fist')) return 'shoulder';
  return undefined;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);

/** Find a skill by id or name (case and spaces don't matter). */
export function findSkill(word: string, skills: Skill[]): Skill | undefined {
  const w = slug(word);
  if (!w) return undefined;
  return skills.find((s) => s.skill_id === w || slug(s.name ?? '') === w);
}

export function parseTeachCommand(text: string, skills: Skill[] = []): TeachCommand {
  const t = normalise(text);
  if (!t) return { kind: 'unknown', text };

  // save / name it
  const save = t.match(/^(?:save|save it|save this|save move|call it|name it)(?: as| it as)?(?: (.+))?$/);
  if (save) return { kind: 'save', name: save[1]?.trim() || undefined };

  // combos: "combo jab jab cross", "new combo: jab, jab and cross as one_two"
  const combo = t.match(/(?:^| )combo(?:s)?(?: of)?(.*)$/);
  if (combo) {
    let rest = combo[1];
    let name: string | undefined;
    const as = rest.match(/^(.*) (?:as|called|named) (.+)$/);
    if (as) {
      rest = as[1];
      name = as[2].trim();
    }
    const parts: string[] = [];
    const unknown: string[] = [];
    for (const chunk of rest.split(/,| and | then /)) {
      const c = chunk.trim();
      if (!c) continue;
      const whole = findSkill(c, skills);
      if (whole) {
        parts.push(whole.skill_id);
        continue;
      }
      for (const word of c.split(' ')) {
        const s = findSkill(word, skills);
        if (s) parts.push(s.skill_id);
        else unknown.push(word);
      }
    }
    return { kind: 'combo', parts, unknown, name };
  }

  if (/^(undo|oops|cancel( that)?|go back a step|take that back|undo that)$/.test(t)) return { kind: 'undo' };
  if (/^(start over|clear( all)?|forget it|new move)$/.test(t)) return { kind: 'clear' };
  if (/^(go )?(home|reset|rest|relax|rest position)( position)?$/.test(t)) return { kind: 'home' };
  if (/^(play( it)?|show me|try it|do it|replay|run it|play the move|show it|try that)( again)?$/.test(t)) return { kind: 'play' };
  if (/^(thats |that is |very |so )?(good|keep( it| that)?|yes|ok|okay|perfect|nice|next|correct|great|record( it| that)?|done|thats it|right there|like that|stay)( one)?$/.test(t)) {
    return { kind: 'keep' };
  }

  // speed of the last kept step(s)
  if (has(t, 'faster', 'quicker', 'speed up', 'quick')) return { kind: 'speed', factor: magnitude(t) === SMALL ? 0.9 : magnitude(t) === LARGE ? 0.6 : 0.75 };
  if (has(t, 'slower', 'slow down', 'slowly', 'gentler')) return { kind: 'speed', factor: magnitude(t) === SMALL ? 1.1 : magnitude(t) === LARGE ? 1.6 : 1.33 };

  const side = sideOf(t);
  const part = partOf(t);

  // "more" / "a bit more": repeat the last nudge
  if (/^((a )?(bit|little|lot) )?more( please)?$|^(keep going|again|even more)$/.test(t)) return { kind: 'more', amount: magnitude(t) };

  // presets (named poses)
  if (has(t, 'guard', 'block', 'defend')) return { kind: 'preset', name: 'guard', side };
  if (has(t, 'punch', 'jab', 'hit') && !has(t, 'too')) return { kind: 'preset', name: 'punch', side };
  if (part === 'head' || has(t, 'look')) {
    if (has(t, 'center', 'centre', 'forward', 'ahead', 'front', 'middle', 'at me')) return { kind: 'preset', name: 'look_center' };
    // "too far left" means: go right a bit
    if (has(t, 'too')) {
      if (has(t, 'left')) return { kind: 'nudge', part: 'head', dir: -1, amount: magnitude(t) };
      if (has(t, 'right')) return { kind: 'nudge', part: 'head', dir: 1, amount: magnitude(t) };
    }
    const nudge = has(t, 'more', 'bit', 'little', 'slightly', 'a lot', 'further');
    if (has(t, 'left')) return nudge ? { kind: 'nudge', part: 'head', dir: 1, amount: magnitude(t) } : { kind: 'preset', name: 'look_left' };
    if (has(t, 'right')) return nudge ? { kind: 'nudge', part: 'head', dir: -1, amount: magnitude(t) } : { kind: 'preset', name: 'look_right' };
  }

  // absolute angle: "to 120 degrees", "elbow 60"
  const deg = t.match(/(?:^| )(\d{1,3})(?: degrees?| deg)?(?: |$)/);
  if (deg) {
    return { kind: 'set', part, side, angle: Number(deg[1]) };
  }

  // "too high" / "not too high" / "too low" / "too bent" / "too straight": correct the last joint
  if (has(t, 'too', 'not so', 'less')) {
    if (has(t, 'high', 'up', 'much', 'far', 'bent')) return { kind: 'nudge', part, side, dir: -1, amount: magnitude(t) };
    if (has(t, 'low', 'down', 'straight')) return { kind: 'nudge', part, side, dir: 1, amount: magnitude(t) };
  }

  const up = has(t, 'up', 'raise', 'lift', 'higher', 'high', 'upward', 'upwards');
  const down = has(t, 'down', 'lower', 'drop', 'low', 'downward', 'downwards', 'put down');
  // "lower" is a correction on its own ("a bit lower"), but a verb with a body part ("lower your hand")
  const comparative = has(t, 'higher', 'more', 'bit', 'little', 'slightly', 'a lot', 'further') || (has(t, 'lower') && !part);

  if (part === 'elbow') {
    const bend = has(t, 'bend', 'fold', 'curl') || up;
    const straight = has(t, 'straighten', 'straight', 'extend', 'stretch') || down;
    if (comparative && (bend || straight)) return { kind: 'nudge', part, side, dir: bend ? 1 : -1, amount: magnitude(t) };
    if (bend) return { kind: 'preset', name: 'bend', side };
    if (straight) return { kind: 'preset', name: 'straighten', side };
    return { kind: 'select', part, side };
  }

  if (up || down) {
    // "raise right hand" / "arm up" = named pose; "higher" / "a bit lower" = small correction
    if (!comparative && part === 'shoulder') return { kind: 'preset', name: up ? 'raise' : 'lower', side };
    if (!comparative && !part && has(t, 'raise', 'lift')) return { kind: 'preset', name: 'raise', side };
    return { kind: 'nudge', part, side, dir: up ? 1 : -1, amount: magnitude(t) };
  }

  if (part) return { kind: 'select', part, side };
  return { kind: 'unknown', text };
}

// ---------------- Applying ----------------

export function homePose(profile: MechProfile): Pose {
  return Object.fromEntries(profile.joints.filter((j) => j.enabled).map((j) => [j.name, j.home_angle]));
}

export function initialTeachState(profile: MechProfile): TeachState {
  const home = homePose(profile);
  return { pose: home, lastPose: { ...home }, steps: [], side: 'right', undo: [] };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** +1 if a bigger angle means up/bent/left for this joint, -1 if the servo is mounted reversed. */
const upSign = (j: Joint) => (j.reverse ? -1 : 1);
const upLimit = (j: Joint) => (upSign(j) > 0 ? j.max_angle : j.min_angle);
const downLimit = (j: Joint) => (upSign(j) > 0 ? j.min_angle : j.max_angle);
/** Angle a fraction of the way from home toward the up limit (frac > 0) or the down limit (frac < 0). */
function towards(j: Joint, frac: number): number {
  const limit = frac >= 0 ? upLimit(j) : downLimit(j);
  return Math.round(j.home_angle + Math.abs(frac) * (limit - j.home_angle));
}

const pretty = (name: string) => name.replace(/_/g, ' ');

function resolveJoint(profile: MechProfile, part: Part, side: Side): { joint?: Joint; why?: string } {
  const joints = jointMap(profile);
  const name = part === 'head' ? 'head' : `${side}_${part}`;
  const j = joints.get(name);
  if (!j) return { why: `This robot has no ${pretty(name)}.` };
  if (!j.enabled) return { why: `The ${pretty(name)} isn't wired yet (turn it on in Setup).` };
  return { joint: j };
}

function snapshot(s: TeachState): TeachSnapshot {
  const { undo: _undo, ...rest } = s;
  return { ...rest, pose: { ...rest.pose }, lastPose: { ...rest.lastPose }, steps: [...rest.steps] };
}

function withUndo(s: TeachState): TeachState {
  return { ...s, undo: [...s.undo, snapshot(s)].slice(-UNDO_LIMIT) };
}

function diff(a: Pose, b: Pose) {
  return Object.keys(b)
    .filter((k) => Math.round(a[k] ?? NaN) !== Math.round(b[k]))
    .map((k) => ({ joint: k, angle: Math.round(b[k]) }));
}

/** Move to a new pose (clamped). Returns the result for the robot. */
function moveTo(s: TeachState, next: Pose, profile: MechProfile, message: string, extra: Partial<TeachSnapshot> = {}): TeachResult {
  const joints = jointMap(profile);
  const clamped: Pose = { ...s.pose };
  let hitLimit = false;
  for (const [k, v] of Object.entries(next)) {
    const j = joints.get(k);
    if (!j || !j.enabled) continue;
    const c = clamp(Math.round(v), j.min_angle, j.max_angle);
    if (c !== Math.round(v)) hitLimit = true;
    clamped[k] = c;
  }
  const send = diff(s.pose, clamped);
  if (send.length === 0) {
    return { state: { ...s, ...extra }, message: hitLimit ? "That's as far as it can safely go." : 'Already there.', send, ok: !hitLimit };
  }
  const state = { ...withUndo(s), pose: clamped, ...extra };
  return { state, message: hitLimit ? `${message} (stopped at the safe limit)` : message, send, ok: true };
}

/** Steps of the taught move as a playable, limit-checked skill. */
export function teachSkill(steps: SkillStep[], profile: MechProfile, mode?: Mode, id = 'teach_preview', name = 'Teach preview'): Skill {
  return autoFix({ skill_id: id, name, version: 1, stat: 'agility', steps }, profile, mode);
}

export function applyTeachCommand(state: TeachState, cmd: TeachCommand, profile: MechProfile, mode?: Mode): TeachResult {
  const s = state;
  const joints = jointMap(profile);
  const fail = (message: string): TeachResult => ({ state: s, message, send: [], ok: false });

  switch (cmd.kind) {
    case 'unknown':
      return fail(`I didn't get "${cmd.text}". ${HELP}`);

    case 'select': {
      const side = cmd.side ?? s.side;
      const r = resolveJoint(profile, cmd.part, side);
      if (!r.joint) return fail(r.why!);
      return { state: { ...s, lastJoint: r.joint.name, side }, message: `OK, ${pretty(r.joint.name)}. Say higher or lower.`, send: [], ok: true };
    }

    case 'set': {
      let name = cmd.joint;
      if (!name && cmd.part) {
        const r = resolveJoint(profile, cmd.part, cmd.side ?? s.side);
        if (!r.joint) return fail(r.why!);
        name = r.joint.name;
      }
      name = name || s.lastJoint || '';
      const j = joints.get(name);
      if (!j || !j.enabled) return fail('Which joint? Say for example "elbow 60" or move a joint first.');
      return moveTo(s, { [name]: cmd.angle }, profile, `${pretty(name)} to ${clamp(cmd.angle, j.min_angle, j.max_angle)}°.`, { lastJoint: name });
    }

    case 'nudge':
    case 'more': {
      let name = s.lastJoint;
      let dir: 1 | -1 | undefined = cmd.kind === 'nudge' ? cmd.dir : s.lastDir;
      let side = s.side;
      if (cmd.kind === 'nudge' && cmd.part) {
        side = cmd.side ?? s.side;
        const r = resolveJoint(profile, cmd.part, side);
        if (!r.joint) return fail(r.why!);
        name = r.joint.name;
      }
      if (!name) {
        // nothing chosen yet: arm by default
        const r = resolveJoint(profile, 'shoulder', side);
        if (!r.joint) return fail(r.why!);
        name = r.joint.name;
      }
      if (!dir) return fail('More of what? Say higher or lower first.');
      const j = joints.get(name)!;
      const target = (s.pose[name] ?? j.home_angle) + dir * cmd.amount * upSign(j);
      const words = name === 'head' ? (dir > 0 ? 'left' : 'right') : name.endsWith('elbow') ? (dir > 0 ? 'bent more' : 'straighter') : dir > 0 ? 'higher' : 'lower';
      return moveTo(s, { [name]: target }, profile, `${pretty(name)} ${cmd.amount}° ${words}.`, { lastJoint: name, lastDir: dir, side });
    }

    case 'preset': {
      const side = cmd.side ?? s.side;
      const pick = (part: Part) => resolveJoint(profile, part, side);
      const next: Pose = {};
      let lastJoint = s.lastJoint;
      let lastDir: 1 | -1 | undefined = s.lastDir;
      const put = (part: Part, frac: number, required = true): string | undefined => {
        const r = pick(part);
        if (!r.joint) return required ? r.why : undefined;
        next[r.joint.name] = towards(r.joint, frac);
        lastJoint = r.joint.name;
        lastDir = frac >= 0 ? 1 : -1;
        return undefined;
      };
      let err: string | undefined;
      let label = '';
      switch (cmd.name) {
        case 'raise':
          err = put('shoulder', 0.75);
          label = `${side} hand up`;
          break;
        case 'lower':
          err = put('shoulder', 0);
          label = `${side} hand down`;
          break;
        case 'bend':
          err = put('elbow', 0.75);
          label = `${side} elbow bent`;
          break;
        case 'straighten':
          err = put('elbow', -0.9);
          label = `${side} arm straight`;
          break;
        case 'punch':
          err = put('shoulder', 0.45) ?? put('elbow', -0.9);
          label = `${side} punch`;
          break;
        case 'guard':
          err = put('shoulder', 0.6) ?? put('elbow', 0.85);
          put('head', 0, false);
          label = 'guard';
          break;
        case 'look_left':
          err = put('head', 0.7);
          label = 'looking left';
          break;
        case 'look_right':
          err = put('head', -0.7);
          label = 'looking right';
          break;
        case 'look_center':
          err = put('head', 0);
          label = 'looking ahead';
          break;
      }
      if (err) return fail(err);
      return moveTo(s, next, profile, `${label[0].toUpperCase()}${label.slice(1)}. Correct it, or say "good" to keep it.`, { lastJoint, lastDir, side });
    }

    case 'keep': {
      const add = poseToSteps(s.lastPose, s.pose, profile, mode);
      if (add.length === 0) return fail('Nothing changed since the last step. Move something first.');
      if (s.steps.length + add.length > MAX_STEPS) return fail(`A move can have at most ${MAX_STEPS} steps. Save it and start a combo.`);
      const steps = [...s.steps, ...add];
      const next: TeachState = { ...withUndo(s), steps, lastPose: { ...s.pose }, lastGroup: { start: s.steps.length, end: steps.length } };
      return { state: next, message: `Kept step ${countPoses(steps)}. Show the next pose, or say "play it".`, send: [], ok: true };
    }

    case 'speed': {
      const g = s.lastGroup;
      if (!g) return fail('Keep a step first (say "good"), then make it faster or slower.');
      const steps = s.steps.map((st, i) => (i >= g.start && i < g.end ? { ...st, duration_ms: Math.round(st.duration_ms * cmd.factor) } : st));
      const fixed = teachSkill(steps, profile, mode).steps;
      const before = s.steps.slice(g.start, g.end).reduce((a, st) => a + st.duration_ms, 0);
      const after = fixed.slice(g.start, g.end).reduce((a, st) => a + st.duration_ms, 0);
      if (after === before) return fail(cmd.factor < 1 ? "That's as fast as this mode allows." : "That's already as slow as it goes.");
      return {
        state: { ...withUndo(s), steps: fixed },
        message: `Last step now ${after} ms (was ${before} ms).`,
        send: [],
        ok: true,
      };
    }

    case 'play': {
      if (s.steps.length === 0) return fail('Nothing taught yet. Pose the robot and say "good" to keep a step.');
      const skill = teachSkill(s.steps, profile, mode);
      const v = validateSkill(skill, profile, mode);
      if (!v.ok) return fail(`Can't play it: ${v.errors[0].message}`);
      // After playing, the robot ends at the last kept pose.
      return { state: { ...s, pose: { ...s.lastPose } }, message: `Playing ${countPoses(s.steps)} steps (${(skillDurationMs(skill) / 1000).toFixed(1)} s).`, send: [], play: skill, ok: true };
    }

    case 'home':
      return moveTo(s, homePose(profile), profile, 'Back to the rest position.');

    case 'undo': {
      const prev = s.undo[s.undo.length - 1];
      if (!prev) return fail('Nothing to undo.');
      const state: TeachState = { ...prev, undo: s.undo.slice(0, -1) };
      return { state, message: 'Undone.', send: diff(s.pose, prev.pose), ok: true };
    }

    case 'clear': {
      const fresh = initialTeachState(profile);
      return { state: { ...fresh, undo: [...s.undo, snapshot(s)].slice(-UNDO_LIMIT) }, message: 'Cleared. Starting a new move from rest.', send: diff(s.pose, fresh.pose), ok: true };
    }

    case 'save':
    case 'combo':
      // Handled by the screen (needs the skill store).
      return { state: s, message: '', send: [], ok: true };
  }
}

/** Number of kept poses (a pose with several joints is one step for the child). */
export function countPoses(steps: SkillStep[]): number {
  return steps.filter((st, i) => i === 0 || !st.with_previous).length;
}

// ---------------- Saving ----------------

export function makeSkillId(name: string): string {
  return slug(name);
}

/** Build the taught move as a skill ready to save. */
export function buildTaughtSkill(name: string, steps: SkillStep[], profile: MechProfile, mode: Mode | undefined, existing: Skill[]): { skill?: Skill; error?: string } {
  const id = makeSkillId(name);
  if (!id) return { error: 'Give the move a name, e.g. "save as jab".' };
  if (existing.some((s) => s.skill_id === id)) return { error: `A move called "${id}" already exists. Pick another name.` };
  if (steps.length === 0) return { error: 'Nothing taught yet.' };
  const skill = teachSkill(steps, profile, mode, id, name.trim());
  const v = validateSkill(skill, profile, mode);
  if (!v.ok) return { error: v.errors[0].message };
  return { skill: { ...skill, version: 1 } };
}

/**
 * Join saved moves into one skill: "combo jab jab cross". Each part is copied in
 * (its repeats expanded) and the whole thing is limit-checked; the transitions
 * between parts are slowed down if needed.
 */
export function buildCombo(name: string, partIds: string[], skills: Skill[], profile: MechProfile, mode: Mode | undefined): { skill?: Skill; error?: string } {
  const id = makeSkillId(name);
  if (!id) return { error: 'Give the combo a name.' };
  if (skills.some((s) => s.skill_id === id)) return { error: `A move called "${id}" already exists. Pick another name.` };
  if (partIds.length < 2) return { error: 'A combo needs at least two moves.' };
  const steps: SkillStep[] = [];
  for (const pid of partIds) {
    const part = skills.find((s) => s.skill_id === pid);
    if (!part) return { error: `No move called "${pid}".` };
    for (let r = 0; r < Math.max(1, part.repeat ?? 1); r++) {
      part.steps.forEach((st, i) => steps.push(i === 0 ? { ...st, with_previous: undefined } : { ...st }));
    }
  }
  if (steps.length > MAX_STEPS) return { error: `That combo has ${steps.length} steps; the limit is ${MAX_STEPS}. Use fewer or shorter moves.` };
  const skill: Skill = { ...teachSkill(steps, profile, mode, id, name.trim()), combo: [...partIds] };
  const v = validateSkill(skill, profile, mode);
  if (!v.ok) return { error: v.errors[0].message };
  return { skill };
}
