import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { Button, Card, Chip, Field, Muted, Row, Screen, colors, styles } from '../../components/ui';
import { autoFix, timeline, validateSkill } from '../../lib/engine';
import { useRobot } from '../../lib/robot';
import { paths, useStore } from '../../lib/store';
import { prepareSkill } from '../../lib/sync';
import type { Skill, SkillStep, StatName } from '../../lib/types';

const STATS: StatName[] = ['speed', 'agility', 'intelligence'];
const num = (t: string, fallback: number) => {
  const v = parseInt(t, 10);
  return Number.isFinite(v) ? v : fallback;
};

export default function SkillEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, activeMode, saveSkill, deleteSkill } = useStore();
  const robot = useRobot();
  const original = data.skills.find((s) => s.skill_id === id);
  const [draft, setDraft] = useState<Skill | undefined>(original);
  const [idText, setIdText] = useState(original?.skill_id ?? '');
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState('');

  useEffect(() => {
    if (!draft && original) setDraft(original);
  }, [original, draft]);

  const result = useMemo(() => (draft ? validateSkill(draft, data.profile, activeMode) : null), [draft, data.profile, activeMode]);
  const times = useMemo(() => (draft ? timeline(draft.steps).steps : []), [draft]);

  if (!draft || !result) {
    return (
      <Screen>
        <Muted>Skill not found.</Muted>
      </Screen>
    );
  }

  const enabledJoints = data.profile.joints.filter((j) => j.enabled);
  const setStep = (i: number, patch: Partial<SkillStep>) =>
    setDraft({ ...draft, steps: draft.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDraft({ ...draft, steps });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(original) || idText !== original?.skill_id;

  const save = () => {
    const newId = idText.trim();
    if (newId !== id && data.skills.some((s) => s.skill_id === newId)) {
      Alert.alert('Name taken', `A skill "${newId}" exists already.`);
      return;
    }
    const changed = JSON.stringify(draft.steps) !== JSON.stringify(original?.steps);
    const skill = { ...draft, skill_id: newId, version: changed ? (original?.version ?? 0) + 1 : draft.version };
    saveSkill(skill, id);
    setDraft(skill);
    if (newId !== id) router.setParams({ id: newId });
  };

  const tryRun = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e: any) {
      Alert.alert(label, e?.message ?? String(e));
    }
  };

  const current: Skill = { ...draft, skill_id: idText.trim() };

  return (
    <Screen>
      <Stack.Screen options={{ title: draft.name ?? draft.skill_id }} />
      <Card title="Details">
        <Row>
          <Field label="Name" value={draft.name ?? ''} onChangeText={(t) => setDraft({ ...draft, name: t })} />
          <Field label="skill_id" value={idText} onChangeText={setIdText} autoCapitalize="none" />
        </Row>
        <Row>
          <View style={{ width: 90 }}>
            <Field label="Repeat" value={String(draft.repeat ?? 1)} keyboardType="number-pad" onChangeText={(t) => setDraft({ ...draft, repeat: num(t, 1) })} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Trains stat</Text>
            <Row style={{ justifyContent: 'flex-start' }}>
              {STATS.map((s) => (
                <Chip key={s} label={s} active={draft.stat === s} onPress={() => setDraft({ ...draft, stat: s })} />
              ))}
            </Row>
          </View>
        </Row>
      </Card>

      <Card title={result.ok ? `Valid · ${(result.totalMs / 1000).toFixed(1)} s` : 'Problems'}>
        {result.errors.map((e, i) => (
          <Text key={`e${i}`} style={styles.error}>
            {e.step !== undefined ? `Step ${e.step + 1}: ` : ''}
            {e.message}
          </Text>
        ))}
        {result.warnings.map((w, i) => (
          <Text key={`w${i}`} style={styles.warning}>
            {w.message}
          </Text>
        ))}
        {!result.ok ? <Button label="Auto-fix (clamp angles, slow down)" variant="secondary" onPress={() => setDraft(autoFix(draft, data.profile, activeMode))} /> : null}
        {result.ok && result.warnings.length === 0 ? <Muted>Within joint limits and {activeMode?.name ?? 'mode'} speed limit.</Muted> : null}
      </Card>

      {draft.steps.map((s, i) => {
        const bad = result.errors.some((e) => e.step === i);
        return (
          <Card key={i}>
            <Row>
              <Text style={{ fontWeight: '700', color: bad ? colors.danger : colors.text }}>
                Step {i + 1} · {times[i]?.start_ms ?? 0}–{times[i]?.end_ms ?? 0} ms
              </Text>
              <Row>
                <Pressable onPress={() => moveStep(i, -1)} hitSlop={8}>
                  <Text style={{ fontSize: 18 }}>↑</Text>
                </Pressable>
                <Pressable onPress={() => moveStep(i, 1)} hitSlop={8}>
                  <Text style={{ fontSize: 18 }}>↓</Text>
                </Pressable>
                <Pressable onPress={() => setDraft({ ...draft, steps: draft.steps.filter((_, k) => k !== i) })} hitSlop={8}>
                  <Text style={{ fontSize: 16, color: colors.danger, fontWeight: '700' }}>✕</Text>
                </Pressable>
              </Row>
            </Row>
            <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              {enabledJoints.map((j) => (
                <Chip key={j.name} label={j.name} active={s.joint === j.name} onPress={() => setStep(i, { joint: j.name })} />
              ))}
            </Row>
            <Row>
              <Field label="Angle °" value={String(s.target_angle)} keyboardType="number-pad" onChangeText={(t) => setStep(i, { target_angle: num(t, s.target_angle) })} />
              <Field label="Duration ms" value={String(s.duration_ms)} keyboardType="number-pad" onChangeText={(t) => setStep(i, { duration_ms: num(t, s.duration_ms) })} />
            </Row>
            {i > 0 ? (
              <Row>
                <Muted>Move together with previous step</Muted>
                <Switch value={!!s.with_previous} onValueChange={(v) => setStep(i, { with_previous: v || undefined })} />
              </Row>
            ) : null}
          </Card>
        );
      })}

      <Button
        label="+ Add step"
        variant="secondary"
        onPress={() => {
          const last = draft.steps[draft.steps.length - 1];
          const j = enabledJoints[0];
          setDraft({
            ...draft,
            steps: [...draft.steps, { joint: last?.joint ?? j?.name ?? 'head', target_angle: last?.target_angle ?? j?.home_angle ?? 90, duration_ms: 500 }],
          });
        }}
      />

      <Card title="Actions">
        <Button label="Save" variant="good" disabled={!dirty} onPress={save} />
        <Button
          label="Play on robot"
          disabled={!result.ok || robot.conn !== 'connected'}
          onPress={() =>
            tryRun('Play', async () => {
              const p = prepareSkill(current, data);
              if (!p.skill) throw new Error(p.error);
              await robot.play(p.skill);
            })
          }
        />
        <Button
          label="Upload to robot storage"
          variant="secondary"
          disabled={!result.ok || robot.conn !== 'connected'}
          onPress={() =>
            tryRun('Upload', async () => {
              const p = prepareSkill(current, data);
              if (!p.skill) throw new Error(p.error);
              await robot.putFile(paths.skill(p.skill.skill_id), p.skill);
              Alert.alert('Uploaded', paths.skill(p.skill.skill_id));
            })
          }
        />
        <Button
          label={showJson ? 'Hide JSON' : 'Show / import JSON'}
          variant="secondary"
          onPress={() => {
            setJsonText(JSON.stringify(current, null, 2));
            setShowJson(!showJson);
          }}
        />
        {showJson ? (
          <>
            <Field label="Skill JSON" value={jsonText} onChangeText={setJsonText} multiline autoCapitalize="none" style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 160 }} />
            <Row>
              <Button small label="Copy" variant="secondary" onPress={() => Clipboard.setStringAsync(jsonText)} />
              <Button
                small
                label="Apply JSON"
                onPress={() => {
                  try {
                    const parsed = JSON.parse(jsonText) as Skill;
                    if (!Array.isArray(parsed.steps)) throw new Error('missing "steps" array');
                    setDraft({ ...parsed, skill_id: draft.skill_id });
                    if (parsed.skill_id) setIdText(parsed.skill_id);
                  } catch (e: any) {
                    Alert.alert('Invalid JSON', e?.message ?? String(e));
                  }
                }}
              />
            </Row>
          </>
        ) : null}
        <Button
          label="Delete skill"
          variant="danger"
          onPress={() =>
            Alert.alert('Delete skill?', `${draft.skill_id} will be removed from the app (not from the robot).`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  deleteSkill(id);
                  router.back();
                },
              },
            ])
          }
        />
      </Card>
    </Screen>
  );
}
