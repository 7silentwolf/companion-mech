// Data formats shared by the app and the robot.
// See kb/docs/mode-and-skill-format.md and kb/docs/app-robot-protocol.md.

/** One servo joint in the robot's mechanical profile ("digital twin"). */
export interface Joint {
  name: string; // e.g. "right_shoulder"
  channel: number; // PCA9685 channel 0-15
  min_angle: number; // degrees, safe lower limit (calibrated on real hardware)
  max_angle: number; // degrees, safe upper limit
  home_angle: number; // resting pose
  max_speed_dps: number; // degrees per second at 100% speed
  enabled: boolean; // false = not wired yet; skills may not use it
  /**
   * Teach mode direction: normally a bigger angle = up (shoulder), bent (elbow),
   * left (head). Set true if this servo is mounted the other way round.
   */
  reverse?: boolean;
}

export interface MechProfile {
  profile_id: string;
  version: number;
  joints: Joint[];
}

export interface SkillStep {
  joint: string;
  target_angle: number;
  duration_ms: number;
  /** true = start at the same time as the previous step (simultaneous motors). */
  with_previous?: boolean;
}

export interface Skill {
  skill_id: string;
  version: number;
  name?: string;
  /** Which training stat this skill builds. */
  stat?: StatName;
  repeat?: number; // play the step list this many times (default 1)
  duration_ms?: number; // informational; computed by the app
  /** Set when this skill was built as a combo of other skills (their ids, in order). */
  combo?: string[];
  steps: SkillStep[];
}

export interface Mode {
  mode_id: string;
  version: number;
  name: string;
  limits: { max_speed_pct: number; max_accel_pct: number };
  idle_skill?: string;
  allowed_skills: string[];
  display?: { eyes?: string; color?: string }; // color: "#RRGGBB" for irises and mouth
  sounds?: Record<string, string>;
}

export type StatName = 'speed' | 'agility' | 'intelligence';

export interface SkillProgress {
  level: number;
  xp: number;
  best_score: number;
  param_version: number;
  sessions: number;
}

export interface TrainingRecord {
  robot_id: string;
  skills: Record<string, SkillProgress>;
  stats: Record<StatName, number>;
}

export interface TrainingLogEntry {
  at: string; // ISO time
  skill_id: string;
  score: number;
  change: string;
}
