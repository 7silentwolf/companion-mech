// App data (digital twin, skills, modes, training) persisted on the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_MODES, DEFAULT_PROFILE, DEFAULT_SKILLS, DEFAULT_TRAINING } from './defaults';
import type { MechProfile, Mode, Skill, TrainingLogEntry, TrainingRecord } from './types';

const KEY = 'mechakin/data/v1';

export interface AppData {
  host: string; // robot IP shown on the ESP32 serial monitor
  port: number;
  activeModeId: string;
  profile: MechProfile;
  skills: Skill[];
  modes: Mode[];
  training: TrainingRecord;
  trainingLog: TrainingLogEntry[];
}

const INITIAL: AppData = {
  host: '192.168.4.1',
  port: 81,
  activeModeId: 'friendly',
  profile: DEFAULT_PROFILE,
  skills: DEFAULT_SKILLS,
  modes: DEFAULT_MODES,
  training: DEFAULT_TRAINING,
  trainingLog: [],
};

interface StoreValue {
  data: AppData;
  loaded: boolean;
  update: (fn: (d: AppData) => AppData) => void;
  activeMode: Mode | undefined;
  saveSkill: (skill: Skill, previousId?: string) => void;
  deleteSkill: (id: string) => void;
  resetAll: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(INITIAL);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setData({ ...INITIAL, ...(JSON.parse(raw) as Partial<AppData>) });
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});
    }, 300);
  }, [data, loaded]);

  const update = useCallback((fn: (d: AppData) => AppData) => setData(fn), []);

  const saveSkill = useCallback((skill: Skill, previousId?: string) => {
    setData((d) => {
      const oldId = previousId ?? skill.skill_id;
      const exists = d.skills.some((s) => s.skill_id === oldId);
      const skills = exists ? d.skills.map((s) => (s.skill_id === oldId ? skill : s)) : [...d.skills, skill];
      // Keep mode allow-lists in step: renames follow, new skills join every mode.
      const modes = !exists
        ? d.modes.map((m) => (m.allowed_skills.includes(skill.skill_id) ? m : { ...m, allowed_skills: [...m.allowed_skills, skill.skill_id] }))
        : previousId && previousId !== skill.skill_id
          ? d.modes.map((m) => ({
              ...m,
              allowed_skills: m.allowed_skills.map((a) => (a === previousId ? skill.skill_id : a)),
            }))
          : d.modes;
      return { ...d, skills, modes };
    });
  }, []);

  const deleteSkill = useCallback((id: string) => {
    setData((d) => ({ ...d, skills: d.skills.filter((s) => s.skill_id !== id) }));
  }, []);

  const resetAll = useCallback(() => setData((d) => ({ ...INITIAL, host: d.host, port: d.port })), []);

  const activeMode = data.modes.find((m) => m.mode_id === data.activeModeId);

  const value = useMemo(
    () => ({ data, loaded, update, activeMode, saveSkill, deleteSkill, resetAll }),
    [data, loaded, update, activeMode, saveSkill, deleteSkill, resetAll],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

/** Robot storage paths, matching kb/docs/mode-and-skill-format.md. */
export const paths = {
  profile: '/config/mech_profile.json',
  training: '/training/robot_profile.json',
  skill: (id: string) => `/skills/${id}.json`,
  mode: (id: string) => `/modes/${id}.json`,
};
