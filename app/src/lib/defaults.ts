import type { MechProfile, Mode, Skill, TrainingRecord } from './types';

// First build from the KB: head + two shoulders + two elbows (5 DOF).
// Trial 1 has 3 micro servos, so the left arm starts disabled.
// All limits are conservative; calibrate them on the real servos.
export const DEFAULT_PROFILE: MechProfile = {
  profile_id: 'trial1',
  version: 1,
  joints: [
    { name: 'head', channel: 0, min_angle: 30, max_angle: 150, home_angle: 90, max_speed_dps: 200, enabled: true },
    { name: 'right_shoulder', channel: 1, min_angle: 20, max_angle: 160, home_angle: 90, max_speed_dps: 200, enabled: true },
    { name: 'right_elbow', channel: 2, min_angle: 20, max_angle: 160, home_angle: 90, max_speed_dps: 200, enabled: true },
    { name: 'left_shoulder', channel: 3, min_angle: 20, max_angle: 160, home_angle: 90, max_speed_dps: 200, enabled: false },
    { name: 'left_elbow', channel: 4, min_angle: 20, max_angle: 160, home_angle: 90, max_speed_dps: 200, enabled: false },
  ],
};

export const DEFAULT_SKILLS: Skill[] = [
  {
    skill_id: 'wave',
    version: 1,
    name: 'Wave',
    stat: 'agility',
    steps: [
      { joint: 'right_shoulder', target_angle: 140, duration_ms: 700 },
      { joint: 'right_elbow', target_angle: 60, duration_ms: 400 },
      { joint: 'right_elbow', target_angle: 120, duration_ms: 600 },
      { joint: 'right_elbow', target_angle: 60, duration_ms: 600 },
      { joint: 'right_elbow', target_angle: 90, duration_ms: 400 },
      { joint: 'right_shoulder', target_angle: 90, duration_ms: 700 },
    ],
  },
  {
    skill_id: 'nod',
    version: 1,
    name: 'Nod',
    stat: 'intelligence',
    repeat: 2,
    steps: [
      { joint: 'head', target_angle: 70, duration_ms: 400 },
      { joint: 'head', target_angle: 110, duration_ms: 500 },
      { joint: 'head', target_angle: 90, duration_ms: 400 },
    ],
  },
  {
    skill_id: 'dance_basic',
    version: 1,
    name: 'Basic Dance',
    stat: 'speed',
    repeat: 2,
    steps: [
      { joint: 'head', target_angle: 60, duration_ms: 500 },
      { joint: 'right_shoulder', target_angle: 130, duration_ms: 500, with_previous: true },
      { joint: 'head', target_angle: 120, duration_ms: 700 },
      { joint: 'right_shoulder', target_angle: 50, duration_ms: 700, with_previous: true },
      { joint: 'right_elbow', target_angle: 130, duration_ms: 600, with_previous: true },
      { joint: 'head', target_angle: 90, duration_ms: 500 },
      { joint: 'right_shoulder', target_angle: 90, duration_ms: 500, with_previous: true },
      { joint: 'right_elbow', target_angle: 90, duration_ms: 500, with_previous: true },
    ],
  },
];

export const DEFAULT_MODES: Mode[] = [
  {
    mode_id: 'friendly',
    version: 1,
    name: 'Friendly Mode',
    limits: { max_speed_pct: 60, max_accel_pct: 50 },
    idle_skill: 'nod',
    allowed_skills: ['wave', 'nod', 'dance_basic'],
    display: { eyes: 'happy' },
    sounds: { greeting: 'hello.wav' },
  },
  {
    mode_id: 'gaming',
    version: 1,
    name: 'Gaming Mode',
    limits: { max_speed_pct: 85, max_accel_pct: 70 },
    idle_skill: 'nod',
    allowed_skills: ['wave', 'nod', 'dance_basic'],
    display: { eyes: 'focused' },
    sounds: { greeting: 'ready.wav' },
  },
];

export const DEFAULT_TRAINING: TrainingRecord = {
  robot_id: 'robot-001',
  skills: {},
  stats: { speed: 1, agility: 1, intelligence: 1 },
};
