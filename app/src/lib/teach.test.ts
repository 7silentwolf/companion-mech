import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODES, DEFAULT_PROFILE, DEFAULT_SKILLS } from './defaults.ts';
import { validateSkill } from './engine.ts';
import {
  applyTeachCommand,
  buildCombo,
  buildTaughtSkill,
  countPoses,
  initialTeachState,
  parseTeachCommand,
  type TeachState,
} from './teach.ts';
import type { MechProfile } from './types';

const friendly = DEFAULT_MODES[0];
const P = DEFAULT_PROFILE;

/** Run a list of spoken commands, returning the final state and all results. */
function teach(lines: string[], profile: MechProfile = P, start?: TeachState) {
  let state = start ?? initialTeachState(profile);
  const results = [];
  for (const line of lines) {
    const r = applyTeachCommand(state, parseTeachCommand(line, DEFAULT_SKILLS), profile, friendly);
    results.push(r);
    state = r.state;
  }
  return { state, results };
}

test('parses the boxing-lesson phrases', () => {
  const k = (t: string) => parseTeachCommand(t).kind;
  assert.equal(k('raise right hand'), 'preset');
  assert.equal(k('Not too high!'), 'nudge');
  assert.equal(k('a bit lower'), 'nudge');
  assert.equal(k('higher'), 'nudge');
  assert.equal(k('bend your elbow'), 'preset');
  assert.equal(k('bend it a bit more'), 'nudge');
  assert.equal(k('straighten'), 'preset');
  assert.equal(k('punch'), 'preset');
  assert.equal(k('guard'), 'preset');
  assert.equal(k('look left'), 'preset');
  assert.equal(k("that's good"), 'keep');
  assert.equal(k('perfect'), 'keep');
  assert.equal(k('undo'), 'undo');
  assert.equal(k('faster'), 'speed');
  assert.equal(k('play it'), 'play');
  assert.equal(k('elbow to 60 degrees'), 'set');
  assert.equal(k('more'), 'more');
  assert.equal(k('fly away'), 'unknown');
  assert.deepEqual(parseTeachCommand('save as jab'), { kind: 'save', name: 'jab' });
  assert.deepEqual(parseTeachCommand('lower your hand'), { kind: 'preset', name: 'lower', side: undefined });
  const n = parseTeachCommand('not too high');
  assert.ok(n.kind === 'nudge' && n.dir === -1);
  const b = parseTeachCommand('a bit lower');
  assert.ok(b.kind === 'nudge' && b.amount === 5);
});

test('raise hand, correct it, keep it: the robot moves at every step', () => {
  const { state, results } = teach(['raise right hand', 'not too high', 'a bit lower', 'good']);
  // raise: shoulder 90 -> 90 + 0.75 * (160 - 90) = 143
  assert.deepEqual(results[0].send, [{ joint: 'right_shoulder', angle: 143 }]);
  assert.deepEqual(results[1].send, [{ joint: 'right_shoulder', angle: 128 }]); // -15
  assert.deepEqual(results[2].send, [{ joint: 'right_shoulder', angle: 123 }]); // -5
  assert.equal(results[3].ok, true);
  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].joint, 'right_shoulder');
  assert.equal(state.steps[0].target_angle, 123);
});

test('the boxing jab: guard, punch, back to guard, then save', () => {
  const { state, results } = teach(['guard', 'good', 'punch', 'good', 'guard', 'good', 'faster', 'play it']);
  assert.ok(results.every((r) => r.ok), results.map((r) => r.message).join(' | '));
  assert.equal(countPoses(state.steps), 3);
  const play = results[7].play!;
  assert.deepEqual(validateSkill(play, P, friendly).errors, []);
  const saved = buildTaughtSkill('Jab', state.steps, P, friendly, DEFAULT_SKILLS);
  assert.ok(saved.skill, saved.error);
  assert.equal(saved.skill!.skill_id, 'jab');
  assert.deepEqual(validateSkill(saved.skill!, P, friendly).errors, []);
});

test('never goes past the joint limits', () => {
  const { state, results } = teach(['raise right hand', 'much higher', 'much higher', 'much higher']);
  assert.equal(state.pose.right_shoulder, 160); // max_angle
  assert.match(results[3].message, /safe/);
  const set = teach(['elbow to 5 degrees']);
  assert.equal(set.state.pose.right_elbow, 20); // min_angle
});

test('undo restores the previous pose and tells the robot', () => {
  const { state, results } = teach(['raise right hand', 'good', 'a bit lower', 'undo', 'undo']);
  assert.equal(results[3].ok, true);
  assert.deepEqual(results[3].send, [{ joint: 'right_shoulder', angle: 143 }]);
  assert.equal(state.steps.length, 0); // second undo removed the kept step
});

test('disabled joints are refused with a clear reason', () => {
  const r = teach(['raise left hand']).results[0];
  assert.equal(r.ok, false);
  assert.match(r.message, /isn't wired yet/);
});

test('reversed servo: "up" goes to the smaller angle', () => {
  const reversed: MechProfile = { ...P, joints: P.joints.map((j) => (j.name === 'right_shoulder' ? { ...j, reverse: true } : j)) };
  const r = teach(['raise right hand'], reversed).results[0];
  assert.deepEqual(r.send, [{ joint: 'right_shoulder', angle: 38 }]); // 90 + 0.75 * (20 - 90)
});

test('faster never breaks the mode speed limit', () => {
  const { state } = teach(['raise right hand', 'good', 'faster', 'faster', 'faster', 'faster', 'faster']);
  const skill = buildTaughtSkill('quick', state.steps, P, friendly, DEFAULT_SKILLS);
  assert.ok(skill.skill, skill.error);
  assert.deepEqual(validateSkill(skill.skill!, P, friendly).errors, []);
});

test('combos join saved moves and stay within limits', () => {
  const jabSteps = teach(['guard', 'good', 'punch', 'good', 'guard', 'good']).state.steps;
  const jab = buildTaughtSkill('jab', jabSteps, P, friendly, DEFAULT_SKILLS).skill!;
  const skills = [...DEFAULT_SKILLS, jab];
  const cmd = parseTeachCommand('combo jab, jab and nod as one two', skills);
  assert.ok(cmd.kind === 'combo');
  assert.deepEqual(cmd.parts, ['jab', 'jab', 'nod']);
  assert.equal(cmd.name, 'one two');
  const combo = buildCombo(cmd.name!, cmd.parts, skills, P, friendly);
  assert.ok(combo.skill, combo.error);
  assert.equal(combo.skill!.skill_id, 'one_two');
  assert.deepEqual(combo.skill!.combo, ['jab', 'jab', 'nod']);
  // nod has repeat 2 (3 steps each) -> 3 + 3 + 6
  assert.equal(combo.skill!.steps.length, jab.steps.length * 2 + 6);
  assert.deepEqual(validateSkill(combo.skill!, P, friendly).errors, []);
  assert.match(buildCombo('x', ['jab'], skills, P, friendly).error!, /at least two/);
  assert.match(buildCombo('wave', ['jab', 'nod'], skills, P, friendly).error!, /already exists/);
});

test('names must be new', () => {
  assert.match(buildTaughtSkill('Wave', [{ joint: 'head', target_angle: 80, duration_ms: 500 }], P, friendly, DEFAULT_SKILLS).error!, /already exists/);
});
