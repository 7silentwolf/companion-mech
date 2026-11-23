import { autoFix, validateSkill } from './engine';
import type { AppData } from './store';
import { paths } from './store';
import type { Skill } from './types';

type PutFile = (path: string, content: unknown) => Promise<any>;

/** Validated skill ready to store on the robot (duration filled in). */
export function prepareSkill(skill: Skill, data: AppData): { skill?: Skill; error?: string } {
  const mode = data.modes.find((m) => m.mode_id === data.activeModeId);
  const r = validateSkill(skill, data.profile, mode);
  if (!r.ok) return { error: r.errors[0]?.message ?? 'invalid' };
  return { skill: { ...autoFix(skill, data.profile, mode) } };
}

/** Push the profile, all modes, all valid skills and the training record. */
export async function syncAll(data: AppData, putFile: PutFile): Promise<{ sent: number; skipped: string[] }> {
  let sent = 0;
  const skipped: string[] = [];
  await putFile(paths.profile, data.profile);
  sent++;
  for (const m of data.modes) {
    await putFile(paths.mode(m.mode_id), m);
    sent++;
  }
  for (const s of data.skills) {
    const p = prepareSkill(s, data);
    if (!p.skill) {
      skipped.push(`${s.skill_id}: ${p.error}`);
      continue;
    }
    await putFile(paths.skill(s.skill_id), p.skill);
    sent++;
  }
  await putFile(paths.training, data.training);
  sent++;
  return { sent, skipped };
}
