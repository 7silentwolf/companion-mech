// Teach mode v1: teach a move with simple words or buttons, correct it, keep each
// pose, save it as a skill, and join skills into combos. No AI.
import Slider from '@react-native-community/slider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Chip, Field, Muted, Row, Screen, colors, styles } from '../../components/ui';
import { skillDurationMs } from '../../lib/engine';
import { useRobot } from '../../lib/robot';
import { paths, useStore } from '../../lib/store';
import {
  applyTeachCommand,
  buildCombo,
  buildTaughtSkill,
  countPoses,
  HELP,
  initialTeachState,
  parseTeachCommand,
  teachSkill,
  type TeachCommand,
  type TeachResult,
  type TeachState,
} from '../../lib/teach';
import type { Mode, Skill, SkillStep } from '../../lib/types';

const SEND_EVERY_MS = 60;

// Quick buttons: each one runs the same words a child could say.
const QUICK: { label: string; say: string; tone?: 'good' | 'danger' | 'primary' }[] = [
  { label: 'Raise hand', say: 'raise hand' },
  { label: 'Hand down', say: 'lower your hand' },
  { label: 'Higher', say: 'higher' },
  { label: 'Lower', say: 'lower' },
  { label: 'A bit higher', say: 'a bit higher' },
  { label: 'A bit lower', say: 'a bit lower' },
  { label: 'Bend elbow', say: 'bend elbow' },
  { label: 'Straighten', say: 'straighten' },
  { label: 'Punch', say: 'punch' },
  { label: 'Guard', say: 'guard' },
  { label: 'Look left', say: 'look left' },
  { label: 'Look right', say: 'look right' },
  { label: 'Look ahead', say: 'look ahead' },
  { label: 'Home', say: 'home' },
];
const ACTIONS: { label: string; say: string; variant: 'good' | 'secondary' | 'primary' }[] = [
  { label: '✓ Good, keep it', say: 'good', variant: 'good' },
  { label: 'Undo', say: 'undo', variant: 'secondary' },
  { label: 'Faster', say: 'faster', variant: 'secondary' },
  { label: 'Slower', say: 'slower', variant: 'secondary' },
  { label: '▶ Play it', say: 'play it', variant: 'primary' },
];

interface LogLine {
  who: 'you' | 'robot';
  text: string;
  ok?: boolean;
}

function describeSteps(steps: SkillStep[]): string[] {
  // One line per kept pose (steps that move together are one pose).
  const lines: string[] = [];
  let cur: SkillStep[] = [];
  const flush = () => {
    if (!cur.length) return;
    const parts = cur.map((s) => `${s.joint.replace(/_/g, ' ')} ${s.target_angle}°`).join(', ');
    lines.push(`${parts} · ${cur[0].duration_ms} ms`);
    cur = [];
  };
  steps.forEach((s, i) => {
    if (i > 0 && !s.with_previous) flush();
    cur.push(s);
  });
  flush();
  return lines;
}

export default function TeachScreen() {
  const { data, activeMode, saveSkill } = useStore();
  const robot = useRobot();
  const connected = robot.conn === 'connected';
  const [state, setState] = useState<TeachState>(() => initialTeachState(data.profile));
  const [input, setInput] = useState('');
  const [log, setLog] = useState<LogLine[]>([{ who: 'robot', text: `Let's teach a new move! ${HELP}` }]);
  const [moveName, setMoveName] = useState('');
  const [comboParts, setComboParts] = useState<string[]>([]);
  const [comboName, setComboName] = useState('');
  const [drag, setDrag] = useState<Record<string, number>>({});
  const lastSent = useRef<Record<string, number>>({});

  // Start over when the set of wired joints changes (e.g. a joint enabled in Setup).
  const jointKey = data.profile.joints.map((j) => `${j.name}:${j.enabled}:${j.reverse ? 1 : 0}`).join('|');
  useEffect(() => {
    setState(initialTeachState(data.profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jointKey]);

  const joints = useMemo(() => data.profile.joints.filter((j) => j.enabled), [data.profile]);
  const say = (line: LogLine) => setLog((l) => [line, ...l].slice(0, 30));

  const sendJoint = (joint: string, angle: number, force = false) => {
    const now = Date.now();
    if (!force && now - (lastSent.current[joint] ?? 0) < SEND_EVERY_MS) return;
    lastSent.current[joint] = now;
    robot.send({ type: 'set_joint', joint, angle: Math.round(angle) });
  };

  /** Carry out a result: move the robot, play, show the reply. */
  const perform = (r: TeachResult) => {
    setState(r.state);
    r.send.forEach((m) => sendJoint(m.joint, m.angle, true));
    if (r.play) {
      robot.play(r.play).catch((e: any) => say({ who: 'robot', text: `Couldn't play: ${e?.message ?? e}`, ok: false }));
    }
    const offline = !connected && (r.send.length > 0 || r.play) ? ' (robot not connected, practising in the app only)' : '';
    if (r.message) say({ who: 'robot', text: r.message + offline, ok: r.ok });
  };

  const uploadNew = async (skill: Skill) => {
    if (!connected) return ' Connect and sync to put it on the robot.';
    try {
      await robot.putFile(paths.skill(skill.skill_id), skill);
      // New skills join every mode; send the active mode's updated allow-list too.
      if (activeMode && !activeMode.allowed_skills.includes(skill.skill_id)) {
        const mode: Mode = { ...activeMode, allowed_skills: [...activeMode.allowed_skills, skill.skill_id] };
        await robot.putFile(paths.mode(mode.mode_id), mode);
      }
      return ' Saved on the robot too.';
    } catch (e: any) {
      return ` Robot upload failed: ${e?.message ?? e}`;
    }
  };

  const saveMove = async (name: string) => {
    const r = buildTaughtSkill(name, state.steps, data.profile, activeMode, data.skills);
    if (!r.skill) return say({ who: 'robot', text: r.error!, ok: false });
    saveSkill(r.skill);
    robot.send({ type: 'react', event: 'taught' });
    const where = await uploadNew(r.skill);
    say({ who: 'robot', text: `Saved "${r.skill.name}"! Train it in the Train tab or use it in a combo.${where}`, ok: true });
    setMoveName('');
    setState(initialTeachState(data.profile));
  };

  const saveCombo = async (name: string, parts: string[]) => {
    const r = buildCombo(name, parts, data.skills, data.profile, activeMode);
    if (!r.skill) return say({ who: 'robot', text: r.error!, ok: false });
    saveSkill(r.skill);
    robot.send({ type: 'react', event: 'taught' });
    const where = await uploadNew(r.skill);
    say({ who: 'robot', text: `Saved combo "${r.skill.name}" (${parts.join(' → ')}).${where}`, ok: true });
    setComboParts([]);
    setComboName('');
  };

  const run = (text: string) => {
    const t = text.trim();
    if (!t) return;
    say({ who: 'you', text: t });
    const cmd: TeachCommand = parseTeachCommand(t, data.skills);
    if (cmd.kind === 'save') {
      const name = cmd.name ?? moveName.trim();
      if (!name) return say({ who: 'robot', text: 'What should it be called? Say "save as jab", or type a name below.', ok: false });
      saveMove(name);
      return;
    }
    if (cmd.kind === 'combo') {
      if (cmd.unknown.length) say({ who: 'robot', text: `I don't know: ${cmd.unknown.join(', ')}.`, ok: false });
      if (cmd.parts.length < 2) return say({ who: 'robot', text: 'Name at least two saved moves, e.g. "combo jab jab cross".', ok: false });
      setComboParts(cmd.parts);
      if (cmd.name) saveCombo(cmd.name, cmd.parts);
      else say({ who: 'robot', text: `Combo ready: ${cmd.parts.join(' → ')}. Give it a name below and save.`, ok: true });
      return;
    }
    if (cmd.kind === 'unknown') robot.send({ type: 'react', event: 'confused' });
    perform(applyTeachCommand(state, cmd, data.profile, activeMode));
  };

  const submit = () => {
    run(input);
    setInput('');
  };

  const poses = describeSteps(state.steps);
  const previewMs = state.steps.length ? skillDurationMs(teachSkill(state.steps, data.profile, activeMode)) : 0;
  const lastReply = log.find((l) => l.who === 'robot');

  return (
    <Screen>
      <Card title="Teach a move">
        {lastReply ? (
          <View style={{ backgroundColor: lastReply.ok === false ? '#FFF0F3' : '#EEF2FB', borderRadius: 10, padding: 10 }}>
            <Text style={{ color: lastReply.ok === false ? colors.danger : colors.text }}>🤖 {lastReply.text}</Text>
          </View>
        ) : null}
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="Tell the robot (or tap the keyboard mic)" value={input} onChangeText={setInput} placeholder="raise right hand" onSubmitEditing={submit} returnKeyType="send" autoCapitalize="none" />
          </View>
          <Button label="Go" onPress={submit} disabled={!input.trim()} />
        </Row>
        <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {QUICK.map((q) => (
            <Chip key={q.label} label={q.label} onPress={() => run(q.say)} />
          ))}
        </Row>
        <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {ACTIONS.map((a) => (
            <Button key={a.label} small label={a.label} variant={a.variant} onPress={() => run(a.say)} />
          ))}
        </Row>
        {!connected ? <Muted>Robot not connected: you can still practise here, and connect later to see it move.</Muted> : null}
      </Card>

      <Card title={`Your move · ${poses.length} step${poses.length === 1 ? '' : 's'}${previewMs ? ` · ${(previewMs / 1000).toFixed(1)} s` : ''}`}>
        {poses.length === 0 ? <Muted>Pose the robot, then tap "Good, keep it" for each step.</Muted> : null}
        {poses.map((p, i) => (
          <Text key={i} style={{ color: colors.text, fontSize: 13 }}>
            {i + 1}. {p}
          </Text>
        ))}
        {poses.length > 0 ? (
          <>
            <Row>
              <View style={{ flex: 1 }}>
                <Field label="Move name" value={moveName} onChangeText={setMoveName} placeholder="jab" />
              </View>
              <Button label="Save" variant="good" onPress={() => run(`save as ${moveName}`)} disabled={!moveName.trim()} />
            </Row>
            <Button small label="Start over" variant="secondary" onPress={() => run('start over')} />
          </>
        ) : null}
      </Card>

      <Card title="Fine-tune">
        <Muted>Drag to set an exact angle. The robot follows, within the safe limits.</Muted>
        {joints.map((j) => {
          const v = drag[j.name] ?? state.pose[j.name] ?? j.home_angle;
          return (
            <View key={j.name}>
              <Row>
                <Text style={{ fontWeight: '600', color: state.lastJoint === j.name ? colors.primary : colors.text }}>{j.name.replace(/_/g, ' ')}</Text>
                <Muted>
                  {Math.round(v)}° {connected ? `(robot ${robot.status?.angles?.[j.name] ?? '–'}°)` : ''}
                </Muted>
              </Row>
              <Slider
                minimumValue={j.min_angle}
                maximumValue={j.max_angle}
                step={1}
                value={state.pose[j.name] ?? j.home_angle}
                minimumTrackTintColor={colors.primary}
                onValueChange={(x) => {
                  setDrag((d) => ({ ...d, [j.name]: x }));
                  sendJoint(j.name, x);
                }}
                onSlidingComplete={(x) => {
                  setDrag((d) => {
                    const { [j.name]: _done, ...rest } = d;
                    return rest;
                  });
                  perform(applyTeachCommand(state, { kind: 'set', joint: j.name, angle: Math.round(x) }, data.profile, activeMode));
                }}
              />
            </View>
          );
        })}
      </Card>

      <Card title="Combo">
        <Muted>Tap saved moves in order, or say "combo jab jab cross".</Muted>
        <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {data.skills.map((s) => (
            <Chip key={s.skill_id} label={`+ ${s.name ?? s.skill_id}`} onPress={() => setComboParts((p) => [...p, s.skill_id])} />
          ))}
        </Row>
        {comboParts.length ? (
          <>
            <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              {comboParts.map((id, i) => (
                <Pressable key={`${id}-${i}`} onPress={() => setComboParts((p) => p.filter((_, k) => k !== i))}>
                  <Text style={[styles.chip, { color: colors.text }]}>
                    {i + 1}. {id} ✕
                  </Text>
                </Pressable>
              ))}
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Field label="Combo name" value={comboName} onChangeText={setComboName} placeholder="one two" />
              </View>
              <Button label="Save combo" variant="good" onPress={() => saveCombo(comboName, comboParts)} disabled={!comboName.trim() || comboParts.length < 2} />
            </Row>
            <Button small label="Clear combo" variant="secondary" onPress={() => setComboParts([])} />
          </>
        ) : null}
      </Card>

      <Card title="Conversation">
        {log.slice(0, 12).map((l, i) => (
          <Text key={i} style={{ fontSize: 13, color: l.who === 'you' ? colors.primary : l.ok === false ? colors.danger : colors.muted }}>
            {l.who === 'you' ? 'You: ' : 'Robot: '}
            {l.text}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}
