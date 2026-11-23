import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTraining,
  autoFix,
  parseCommand,
  poseToSteps,
  skillDurationMs,
  timeline,
  validateSkill,
} from './engine.ts';
import { DEFAULT_MODES, DEFAULT_PROFILE, DEFAULT_SKILLS } from './defaults.ts';
import type { Skill } from './types';

const friendly = DEFAULT_MODES[0];

test('all default skills are valid in every default mode', () => {
  for (const mode of DEFAULT_MODES) {
    for (const s of DEFAULT_SKILLS) {
      const r = validateSkill(s, DEFAULT_PROFILE, mode);
      assert.deepEqual(r.errors, [], `${s.skill_id} in ${mode.mode_id}`);
    }
  }
});

test('timeline runs with_previous steps together', () => {
  const t = timeline([
    { joint: 'head', target_angle: 80, duration_ms: 500 },
    { joint: 'right_shoulder', target_angle: 100, duration_ms: 300, with_previous: true },
    { joint: 'head', target_angle: 90, duration_ms: 200 },
  ]);
  assert.deepEqual(t.steps.map((s) => [s.start_ms, s.end_ms]), [[0, 500], [0, 300], [500, 700]]);
  assert.equal(t.passMs, 700);
});

test('rejects out-of-range angles, unknown/disabled joints, overlaps and over-speed', () => {
  const bad: Skill = {
    skill_id: 'bad',
    version: 1,
    steps: [
      { joint: 'head', target_angle: 10, duration_ms: 1000 },
      { joint: 'tail', target_angle: 90, duration_ms: 500 },
      { joint: 'left_elbow', target_angle: 90, duration_ms: 500 },
      { joint: 'right_shoulder', target_angle: 160, duration_ms: 100 },
      { joint: 'right_shoulder', target_angle: 100, duration_ms: 500, with_previous: true },
    ],
  };
  const msgs = validateSkill(bad, DEFAULT_PROFILE, friendly).errors.map((e) => e.message).join('\n');
  assert.match(msgs, /outside 30-150/);
  assert.match(msgs, /Unknown joint "tail"/);
  assert.match(msgs, /disabled/);
  assert.match(msgs, /too fast/);
  assert.match(msgs, /already moving/);
});

test('autoFix makes a too-fast skill valid and never faster', () => {
  const fast: Skill = {
    skill_id: 'fast',
    version: 1,
    repeat: 2,
    steps: [
      { joint: 'head', target_angle: 200, duration_ms: 50 },
      { joint: 'head', target_angle: 30, duration_ms: 50 },
    ],
  };
  const fixed = autoFix(fast, DEFAULT_PROFILE, friendly);
  assert.equal(fixed.steps[0].target_angle, 150);
  assert.deepEqual(validateSkill(fixed, DEFAULT_PROFILE, friendly).errors, []);
  fixed.steps.forEach((s, i) => assert.ok(s.duration_ms >= fast.steps[i].duration_ms));
});

test('training improves within limits and levels up', () => {
  let skill = DEFAULT_SKILLS[0];
  let progress;
  let statUps = 0;
  for (let i = 0; i < 40; i++) {
    const r = applyTraining(skill, progress, 100, DEFAULT_PROFILE, friendly);
    assert.deepEqual(validateSkill(r.skill, DEFAULT_PROFILE, friendly).errors, [], `session ${i}`);
    skill = r.skill;
    progress = r.progress;
    if (r.statChanged) statUps++;
  }
  assert.equal(progress!.level, 10);
  assert.equal(statUps, 9);
  assert.ok(skillDurationMs(skill) < skillDurationMs(DEFAULT_SKILLS[0]));
  assert.ok(skill.version > 1);
});

test('poor score softens the skill', () => {
  const r = applyTraining(DEFAULT_SKILLS[1], undefined, 20, DEFAULT_PROFILE, friendly);
  assert.ok(skillDurationMs(r.skill) > skillDurationMs(DEFAULT_SKILLS[1]));
  assert.equal(r.progress.best_score, 20);
});

test('poseToSteps moves changed joints together', () => {
  const steps = poseToSteps({ head: 90, right_shoulder: 90 }, { head: 120, right_shoulder: 90 }, DEFAULT_PROFILE, friendly);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].joint, 'head');
  assert.ok(steps[0].duration_ms >= 300);
});

test('parseCommand', () => {
  const p = (t: string) => parseCommand(t, DEFAULT_SKILLS, DEFAULT_MODES);
  assert.deepEqual(p('Please STOP!'), { kind: 'stop' });
  assert.deepEqual(p('say hello'), { kind: 'skill', skill_id: 'wave' });
  assert.deepEqual(p("let's dance"), { kind: 'skill', skill_id: 'dance_basic' });
  assert.deepEqual(p('basic dance'), { kind: 'skill', skill_id: 'dance_basic' });
  assert.deepEqual(p('switch to gaming mode'), { kind: 'mode', mode_id: 'gaming' });
  assert.equal(p('fly to the moon').kind, 'unknown');
});
