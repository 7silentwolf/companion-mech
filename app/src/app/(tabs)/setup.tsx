import { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { Button, Card, Field, Muted, Row, Screen, colors, styles } from '../../components/ui';
import { useRobot } from '../../lib/robot';
import { paths, useStore } from '../../lib/store';
import type { Joint, Mode } from '../../lib/types';

const num = (t: string, fallback: number) => {
  const v = parseInt(t, 10);
  return Number.isFinite(v) ? v : fallback;
};

function jointProblems(j: Joint, all: Joint[]): string[] {
  const p: string[] = [];
  if (j.min_angle < 0 || j.max_angle > 180) p.push('angles must be 0-180');
  if (j.min_angle >= j.max_angle) p.push('min must be below max');
  if (j.home_angle < j.min_angle || j.home_angle > j.max_angle) p.push('home must be between min and max');
  if (j.channel < 0 || j.channel > 15) p.push('channel must be 0-15');
  if (j.max_speed_dps < 10 || j.max_speed_dps > 400) p.push('speed must be 10-400 °/s');
  if (all.some((o) => o !== j && o.enabled && j.enabled && o.channel === j.channel)) p.push(`channel ${j.channel} used twice`);
  return p;
}

export default function SetupScreen() {
  const { data, update, resetAll } = useStore();
  const robot = useRobot();
  const [robotId, setRobotId] = useState(data.training.robot_id);
  const connected = robot.conn === 'connected';
  const joints = data.profile.joints;
  const problems = joints.flatMap((j) => jointProblems(j, joints).map((p) => `${j.name}: ${p}`));

  const setJoint = (i: number, patch: Partial<Joint>) =>
    update((d) => ({
      ...d,
      profile: { ...d.profile, joints: d.profile.joints.map((j, k) => (k === i ? { ...j, ...patch } : j)) },
    }));
  const setMode = (id: string, patch: (m: Mode) => Mode) =>
    update((d) => ({ ...d, modes: d.modes.map((m) => (m.mode_id === id ? patch(m) : m)) }));

  const uploadProfile = async () => {
    if (problems.length) return Alert.alert('Fix the profile first', problems.join('\n'));
    const profile = { ...data.profile, version: data.profile.version + 1 };
    update((d) => ({ ...d, profile }));
    try {
      await robot.putFile(paths.profile, profile);
      Alert.alert('Uploaded', 'The robot now uses these joint limits.');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? String(e));
    }
  };

  const test = (j: Joint, angle: number) => robot.send({ type: 'set_joint', joint: j.name, angle });

  return (
    <Screen>
      <Card title="Digital twin (mechanical profile)">
        <Muted>
          Calibrate on the real servo: start with the horn off, use Test buttons, and narrow min/max until there is no buzzing or binding. Then upload so the robot
          enforces the new limits itself.
        </Muted>
        {problems.map((p) => (
          <Text key={p} style={styles.error}>
            {p}
          </Text>
        ))}
        <Button label={`Upload profile to robot (v${data.profile.version})`} onPress={uploadProfile} disabled={!connected} />
      </Card>

      {joints.map((j, i) => (
        <Card
          key={j.name}
          title={j.name}
          right={
            <Row>
              <Muted>{j.enabled ? 'wired' : 'not wired'}</Muted>
              <Switch value={j.enabled} onValueChange={(v) => setJoint(i, { enabled: v })} />
            </Row>
          }
        >
          <Row>
            <Field label="Channel" value={String(j.channel)} keyboardType="number-pad" onChangeText={(t) => setJoint(i, { channel: num(t, j.channel) })} />
            <Field label="Max °/s" value={String(j.max_speed_dps)} keyboardType="number-pad" onChangeText={(t) => setJoint(i, { max_speed_dps: num(t, j.max_speed_dps) })} />
          </Row>
          <Row>
            <Field label="Min °" value={String(j.min_angle)} keyboardType="number-pad" onChangeText={(t) => setJoint(i, { min_angle: num(t, j.min_angle) })} />
            <Field label="Home °" value={String(j.home_angle)} keyboardType="number-pad" onChangeText={(t) => setJoint(i, { home_angle: num(t, j.home_angle) })} />
            <Field label="Max °" value={String(j.max_angle)} keyboardType="number-pad" onChangeText={(t) => setJoint(i, { max_angle: num(t, j.max_angle) })} />
          </Row>
          {connected && j.enabled ? (
            <Row>
              <Button small label="Test min" variant="secondary" onPress={() => test(j, j.min_angle)} style={{ flex: 1 }} />
              <Button small label="Test home" variant="secondary" onPress={() => test(j, j.home_angle)} style={{ flex: 1 }} />
              <Button small label="Test max" variant="secondary" onPress={() => test(j, j.max_angle)} style={{ flex: 1 }} />
            </Row>
          ) : null}
        </Card>
      ))}

      <Card title="Modes">
        <Muted>Mode files live on the robot (/modes). Speed limit caps every skill in that mode.</Muted>
        {data.modes.map((m) => (
          <View key={m.mode_id} style={{ gap: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>{m.name}</Text>
            <Row>
              <Field
                label="Max speed %"
                value={String(m.limits.max_speed_pct)}
                keyboardType="number-pad"
                onChangeText={(t) => setMode(m.mode_id, (x) => ({ ...x, limits: { ...x.limits, max_speed_pct: Math.max(1, Math.min(100, num(t, 50))) } }))}
              />
              <Field
                label="Eyes"
                value={m.display?.eyes ?? ''}
                autoCapitalize="none"
                onChangeText={(t) => setMode(m.mode_id, (x) => ({ ...x, display: { ...x.display, eyes: t } }))}
              />
            </Row>
            <Field
              label="Allowed skills (comma separated)"
              value={m.allowed_skills.join(', ')}
              autoCapitalize="none"
              onChangeText={(t) =>
                setMode(m.mode_id, (x) => ({
                  ...x,
                  allowed_skills: t
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
              }
            />
          </View>
        ))}
      </Card>

      <Card title="Robot identity">
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="robot_id" value={robotId} onChangeText={setRobotId} autoCapitalize="none" />
          </View>
          <Button small label="Save" onPress={() => update((d) => ({ ...d, training: { ...d.training, robot_id: robotId.trim() || 'robot-001' } }))} />
        </Row>
      </Card>

      <Card title="Reset">
        <Button
          label="Reset app data to defaults"
          variant="danger"
          onPress={() =>
            Alert.alert('Reset everything?', 'Skills, modes, profile and training in the app go back to the defaults.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: resetAll },
            ])
          }
        />
      </Card>
    </Screen>
  );
}
