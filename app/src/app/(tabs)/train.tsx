import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button, Card, Chip, Muted, Row, Screen, colors } from '../../components/ui';
import { applyTraining, bumpStat, MAX_LEVEL, MAX_STAT, XP_PER_LEVEL } from '../../lib/engine';
import { useRobot } from '../../lib/robot';
import { paths, useStore } from '../../lib/store';
import { prepareSkill } from '../../lib/sync';
import type { StatName } from '../../lib/types';

const STAT_LABEL: Record<StatName, string> = { speed: 'Speed', agility: 'Agility', intelligence: 'Intelligence' };
const RATINGS = [
  { stars: 1, label: 'Wobbly' },
  { stars: 2, label: 'Okay' },
  { stars: 3, label: 'Good' },
  { stars: 4, label: 'Great' },
  { stars: 5, label: 'Perfect' },
];

function Bar({ value, max, color = colors.primary }: { value: number; max: number; color?: string }) {
  return (
    <View style={{ height: 8, backgroundColor: '#E7EBF5', borderRadius: 4, overflow: 'hidden', flex: 1 }}>
      <View style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: 8, backgroundColor: color }} />
    </View>
  );
}

export default function TrainScreen() {
  const { data, update, activeMode, saveSkill } = useStore();
  const robot = useRobot();
  const skills = data.skills.filter((s) => !activeMode || activeMode.allowed_skills.includes(s.skill_id));
  const [selected, setSelected] = useState(skills[0]?.skill_id);
  const [practiced, setPracticed] = useState(false);
  const skill = data.skills.find((s) => s.skill_id === selected);
  const progress = skill ? data.training.skills[skill.skill_id] : undefined;
  const connected = robot.conn === 'connected';

  const practice = async () => {
    if (!skill) return;
    const p = prepareSkill(skill, data);
    if (!p.skill) return Alert.alert('Fix this skill first', p.error ?? '');
    try {
      await robot.play(p.skill);
      setPracticed(true);
    } catch (e: any) {
      Alert.alert('Practice', e?.message ?? String(e));
    }
  };

  const rate = async (stars: number) => {
    if (!skill) return;
    const score = stars * 20;
    const r = applyTraining(skill, progress, score, data.profile, activeMode);
    const training = {
      ...data.training,
      skills: { ...data.training.skills, [skill.skill_id]: r.progress },
      stats: bumpStat(data.training.stats, r.statChanged),
    };
    saveSkill(r.skill);
    update((d) => ({
      ...d,
      training,
      trainingLog: [{ at: new Date().toISOString(), skill_id: skill.skill_id, score, change: r.change }, ...d.trainingLog].slice(0, 50),
    }));
    setPracticed(false);

    let saved = 'Saved in the app. Connect and sync to update the robot.';
    if (connected) {
      try {
        await robot.putFile(paths.skill(r.skill.skill_id), r.skill);
        await robot.putFile(paths.training, training);
        saved = 'Saved to the robot.';
      } catch (e: any) {
        saved = `Saved in the app, robot upload failed: ${e?.message ?? e}`;
      }
    }
    const levelUp = r.progress.level > (progress?.level ?? 1);
    Alert.alert(
      levelUp ? `Level up! Level ${r.progress.level}` : `Score ${score}`,
      `${skill.name ?? skill.skill_id} ${r.change}.${r.statChanged ? `\n${STAT_LABEL[r.statChanged]} +1` : ''}\n\n${saved}`,
    );
  };

  return (
    <Screen>
      <Card title={`${data.training.robot_id} stats`}>
        {(Object.keys(STAT_LABEL) as StatName[]).map((k) => (
          <Row key={k}>
            <Text style={{ width: 100, color: colors.text, fontWeight: '600' }}>{STAT_LABEL[k]}</Text>
            <Bar value={data.training.stats[k] ?? 0} max={MAX_STAT} color={colors.good} />
            <Text style={{ width: 40, textAlign: 'right', color: colors.text }}>{data.training.stats[k] ?? 0}</Text>
          </Row>
        ))}
        <Muted>Stats grow when a skill levels up. Training never raises power past the mode's limits (no pay-to-win).</Muted>
      </Card>

      <Card title="Pick a skill">
        <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {skills.map((s) => (
            <Chip
              key={s.skill_id}
              label={s.name ?? s.skill_id}
              active={s.skill_id === selected}
              onPress={() => {
                setSelected(s.skill_id);
                setPracticed(false);
              }}
            />
          ))}
        </Row>
        {skill ? (
          <>
            <Row>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                Level {progress?.level ?? 1}/{MAX_LEVEL}
              </Text>
              <Muted>
                best {progress?.best_score ?? 0} · {progress?.sessions ?? 0} sessions · params v{progress?.param_version ?? 1}
              </Muted>
            </Row>
            <Bar value={(progress?.xp ?? 0) % XP_PER_LEVEL} max={XP_PER_LEVEL} />
          </>
        ) : null}
      </Card>

      {skill ? (
        <Card title="1. Practice">
          <Button label={`Play ${skill.name ?? skill.skill_id}`} onPress={practice} disabled={!connected} />
          {!connected ? <Muted>Connect to the robot to practice. You can still rate below to try the training logic.</Muted> : null}
        </Card>
      ) : null}

      {skill ? (
        <Card title="2. How did it go?">
          {practiced ? <Text style={{ color: colors.primary }}>Watch the robot, then rate it.</Text> : null}
          <Row style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            {RATINGS.map((r) => (
              <Pressable key={r.stars} onPress={() => rate(r.stars)} style={{ alignItems: 'center', padding: 6 }}>
                <Text style={{ fontSize: 24, color: '#F59F00' }}>{'★'.repeat(r.stars)}</Text>
                <Muted>{r.label}</Muted>
              </Pressable>
            ))}
          </Row>
          <Muted>3+ stars: the skill gets a bit faster and bigger. 1-2 stars: slower and steadier. Saved as a new skill version.</Muted>
        </Card>
      ) : null}

      <Card title="History">
        {data.trainingLog.length === 0 ? <Muted>No sessions yet.</Muted> : null}
        {data.trainingLog.slice(0, 10).map((e, i) => (
          <Muted key={i}>
            {new Date(e.at).toLocaleString()} · {e.skill_id} · {e.score} · {e.change}
          </Muted>
        ))}
      </Card>
    </Screen>
  );
}
