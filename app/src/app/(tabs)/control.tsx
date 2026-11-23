import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Field, Muted, Row, Screen, colors } from '../../components/ui';
import { poseToSteps, skillDurationMs } from '../../lib/engine';
import { useRobot } from '../../lib/robot';
import { useStore } from '../../lib/store';
import type { SkillStep } from '../../lib/types';

const SEND_EVERY_MS = 60;

export default function ControlScreen() {
  const { data, activeMode, saveSkill } = useStore();
  const robot = useRobot();
  const joints = useMemo(() => data.profile.joints.filter((j) => j.enabled), [data.profile]);
  const home = useMemo(() => Object.fromEntries(joints.map((j) => [j.name, j.home_angle])), [joints]);

  const [angles, setAngles] = useState<Record<string, number>>(home);
  const [lastPose, setLastPose] = useState<Record<string, number>>(home);
  const [steps, setSteps] = useState<SkillStep[]>([]);
  const [name, setName] = useState('');
  const lastSent = useRef<Record<string, number>>({});

  const sendJoint = (joint: string, angle: number, force = false) => {
    const now = Date.now();
    if (!force && now - (lastSent.current[joint] ?? 0) < SEND_EVERY_MS) return;
    lastSent.current[joint] = now;
    robot.send({ type: 'set_joint', joint, angle: Math.round(angle) });
  };

  const goHome = () => {
    setAngles(home);
    joints.forEach((j) => sendJoint(j.name, j.home_angle, true));
  };

  const readFromRobot = () => {
    const a = robot.status?.angles;
    if (!a) return Alert.alert('Not connected', 'Connect to the robot first.');
    setAngles((cur) => ({ ...cur, ...a }));
  };

  const recordPose = () => {
    const add = poseToSteps(lastPose, angles, data.profile, activeMode);
    if (add.length === 0) return Alert.alert('Nothing changed', 'Move a joint before recording the next pose.');
    setSteps((s) => [...s, ...add]);
    setLastPose(angles);
  };

  const save = () => {
    const skill_id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
    if (!skill_id) return Alert.alert('Name needed', 'Give the new skill a name.');
    if (data.skills.some((s) => s.skill_id === skill_id)) return Alert.alert('Name taken', `A skill "${skill_id}" exists already.`);
    saveSkill({ skill_id, name: name.trim(), version: 1, stat: 'agility', steps });
    setSteps([]);
    setLastPose(home);
    setName('');
    router.push({ pathname: '/skill/[id]', params: { id: skill_id } });
  };

  const connected = robot.conn === 'connected';

  return (
    <Screen>
      <Card title="Move joints" right={<Button small label="Home" variant="secondary" onPress={goHome} />}>
        {!connected ? <Muted>Offline: sliders still work for recording poses, but the robot won't move.</Muted> : null}
        {joints.map((j) => (
          <View key={j.name}>
            <Row>
              <Text style={{ fontWeight: '600', color: colors.text }}>{j.name}</Text>
              <Muted>
                {Math.round(angles[j.name] ?? j.home_angle)}° (robot {robot.status?.angles?.[j.name] ?? '–'}°)
              </Muted>
            </Row>
            <Slider
              minimumValue={j.min_angle}
              maximumValue={j.max_angle}
              step={1}
              value={angles[j.name] ?? j.home_angle}
              minimumTrackTintColor={colors.primary}
              onValueChange={(v) => {
                setAngles((a) => ({ ...a, [j.name]: v }));
                sendJoint(j.name, v);
              }}
              onSlidingComplete={(v) => sendJoint(j.name, v, true)}
            />
          </View>
        ))}
        {connected ? <Button small label="Read angles from robot" variant="secondary" onPress={readFromRobot} /> : null}
        <Muted>Joint limits come from the digital twin (Setup tab). The robot also enforces them itself.</Muted>
      </Card>

      <Card title="Record a new move">
        <Muted>Pose the robot, tap Record pose, repeat. Each pose becomes one movement. Starts from the home pose.</Muted>
        <Row>
          <Button label="Record pose" onPress={recordPose} style={{ flex: 1 }} />
          <Button
            label="Clear"
            variant="secondary"
            onPress={() => {
              setSteps([]);
              setLastPose(home);
            }}
          />
        </Row>
        <Muted>
          {steps.length} steps · {(skillDurationMs({ skill_id: 'x', version: 1, steps }) / 1000).toFixed(1)} s
        </Muted>
        {steps.length > 0 ? (
          <>
            <Field label="Skill name" value={name} onChangeText={setName} placeholder="my_dance" />
            <Button label="Save as skill" variant="good" onPress={save} />
          </>
        ) : null}
      </Card>
    </Screen>
  );
}
