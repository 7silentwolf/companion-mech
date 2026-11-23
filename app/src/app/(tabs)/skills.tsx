import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Muted, Row, Screen, colors, styles } from '../../components/ui';
import { skillDurationMs, validateSkill } from '../../lib/engine';
import { useStore } from '../../lib/store';

export default function SkillsScreen() {
  const { data, activeMode, saveSkill } = useStore();

  const newSkill = () => {
    let n = 1;
    while (data.skills.some((s) => s.skill_id === `skill_${n}`)) n++;
    const first = data.profile.joints.find((j) => j.enabled);
    saveSkill({
      skill_id: `skill_${n}`,
      name: `Skill ${n}`,
      version: 1,
      stat: 'agility',
      steps: first ? [{ joint: first.name, target_angle: first.home_angle, duration_ms: 500 }] : [],
    });
    router.push({ pathname: '/skill/[id]', params: { id: `skill_${n}` } });
  };

  return (
    <Screen>
      <Card title="Skills" right={<Button small label="+ New" onPress={newSkill} />}>
        <Muted>Checked against the digital twin and {activeMode?.name ?? 'no mode'} limits.</Muted>
      </Card>
      {data.skills.map((s) => {
        const r = validateSkill(s, data.profile, activeMode);
        return (
          <Pressable key={s.skill_id} onPress={() => router.push({ pathname: '/skill/[id]', params: { id: s.skill_id } })}>
            <Card>
              <Row>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{s.name ?? s.skill_id}</Text>
                  <Muted>
                    {s.skill_id} · v{s.version} · {s.steps.length} steps · {(skillDurationMs(s) / 1000).toFixed(1)} s
                    {s.repeat && s.repeat > 1 ? ` · ×${s.repeat}` : ''}
                  </Muted>
                </View>
                <Text style={{ color: r.ok ? colors.good : colors.danger, fontWeight: '700' }}>{r.ok ? 'OK' : `${r.errors.length} issue${r.errors.length > 1 ? 's' : ''}`}</Text>
              </Row>
              {!r.ok ? <Text style={styles.error}>{r.errors[0].message}</Text> : null}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
