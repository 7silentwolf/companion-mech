import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Chip, Field, Muted, Row, Screen, colors, styles } from '../../components/ui';
import { EYE_STYLES } from '../../lib/defaults';
import { parseCommand } from '../../lib/engine';
import { useRobot } from '../../lib/robot';
import { paths, useStore } from '../../lib/store';
import { prepareSkill, syncAll } from '../../lib/sync';

export default function RobotScreen() {
  const { data, update, activeMode } = useStore();
  const robot = useRobot();
  const [host, setHost] = useState(data.host);
  const [port, setPort] = useState(String(data.port));
  const [command, setCommand] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const connected = robot.conn === 'connected';

  const doConnect = () => {
    const p = parseInt(port, 10) || 81;
    update((d) => ({ ...d, host: host.trim(), port: p }));
    robot.connect(host, p);
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert(label, e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const playSkill = (id: string) =>
    run('Play', async () => {
      const skill = data.skills.find((s) => s.skill_id === id);
      if (!skill) throw new Error(`No skill "${id}"`);
      const p = prepareSkill(skill, data);
      if (!p.skill) throw new Error(`${id} is not safe to play: ${p.error}`);
      await robot.play(p.skill);
      setReply(`Playing ${skill.name ?? id}`);
    });

  const setMode = (modeId: string) =>
    run('Mode', async () => {
      update((d) => ({ ...d, activeModeId: modeId }));
      if (connected) {
        const m = data.modes.find((x) => x.mode_id === modeId);
        if (m) await robot.putFile(paths.mode(modeId), m);
        await robot.request({ type: 'set_mode', mode_id: modeId });
      }
    });

  const sendCommand = () => {
    const c = parseCommand(command, data.skills, data.modes);
    setCommand('');
    if (c.kind === 'stop') {
      robot.request({ type: 'stop' }).catch(() => robot.estop());
      setReply('Stopping');
    } else if (c.kind === 'skill') playSkill(c.skill_id);
    else if (c.kind === 'mode') {
      setMode(c.mode_id);
      setReply(`Switching to ${c.mode_id}`);
    } else setReply(`I don't know "${c.text}" yet. Try: wave, nod, dance, stop, gaming mode.`);
  };

  const estopped = robot.status?.state === 'estop';

  return (
    <Screen>
      <Card title="Connect">
        <Muted>Robot and phone on the same Wi-Fi. The robot prints its IP on the Arduino serial monitor.</Muted>
        <Row>
          <Field label="Robot IP" value={host} onChangeText={setHost} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={{ minWidth: 150 }} />
          <View style={{ width: 80 }}>
            <Field label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" />
          </View>
        </Row>
        {connected ? (
          <Button label="Disconnect" variant="secondary" onPress={robot.disconnect} />
        ) : (
          <Button label={robot.conn === 'connecting' ? 'Connecting…' : 'Connect'} onPress={doConnect} disabled={robot.conn === 'connecting'} />
        )}
        {connected ? (
          <Muted>
            {robot.info.robot_id ?? 'robot'} · fw {robot.info.fw ?? '?'}
            {robot.info.movement_fw ? ` + ${robot.info.movement_fw}` : ''} · state {robot.status?.state ?? '?'} · mode {robot.status?.mode ?? '?'}
          </Muted>
        ) : null}
      </Card>

      {connected && robot.status?.movement_ok === false ? (
        <Card title="Movement board not answering">
          <Text style={styles.error}>
            The Wi-Fi board is fine, but the servo board isn't answering. Check: movement ESP32 powered (USB), TX2 (GPIO17) → S3 GPIO18, RX2 (GPIO16) ← S3
            GPIO17, and GND between the boards.
          </Text>
        </Card>
      ) : null}

      {estopped ? (
        <Card title="Emergency stop is active">
          <Text style={styles.error}>
            Motors are off. Check the robot is safe{robot.status?.estop_button ? ' and release the physical STOP button' : ''}, then release.
          </Text>
          <Button label="Release E-STOP" variant="danger" onPress={() => run('Release', () => robot.request({ type: 'estop_release' }))} />
        </Card>
      ) : null}

      <Card title="Mode">
        <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {data.modes.map((m) => (
            <Chip key={m.mode_id} label={m.name} active={m.mode_id === data.activeModeId} onPress={() => setMode(m.mode_id)} />
          ))}
        </Row>
        {activeMode ? <Muted>Speed limit {activeMode.limits.max_speed_pct}% · eyes {activeMode.display?.eyes ?? '-'}</Muted> : null}
      </Card>

      <Card title="Talk to your robot">
        <Muted>Type, or tap the mic on your keyboard to speak. The phone is the robot's microphone.</Muted>
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="Command" value={command} onChangeText={setCommand} placeholder="say hello" onSubmitEditing={sendCommand} returnKeyType="send" />
          </View>
          <Button label="Go" onPress={sendCommand} disabled={!command.trim()} />
        </Row>
        {reply ? <Text style={{ color: colors.primary }}>{reply}</Text> : null}
        <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {data.skills
            .filter((s) => !activeMode || activeMode.allowed_skills.includes(s.skill_id))
            .map((s) => (
              <Chip key={s.skill_id} label={s.name ?? s.skill_id} onPress={() => playSkill(s.skill_id)} />
            ))}
        </Row>
      </Card>

      {connected && robot.status?.eyes !== undefined ? (
        <Card title="Display test">
          <Muted>Shows these eyes on the robot's screen until you change mode.</Muted>
          <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            {EYE_STYLES.map((e) => (
              <Chip key={e} label={e} active={robot.status?.eyes === e} onPress={() => run('Eyes', () => robot.request({ type: 'set_eyes', eyes: e }))} />
            ))}
          </Row>
        </Card>
      ) : null}

      <Card title="Robot storage">
        <Muted>Send the digital twin, modes, skills and training record to the robot's flash.</Muted>
        <Button
          label="Sync everything to robot"
          disabled={!connected || busy}
          onPress={() =>
            run('Sync', async () => {
              const r = await syncAll(data, robot.putFile);
              Alert.alert('Sync done', `${r.sent} files sent.${r.skipped.length ? `\nSkipped:\n${r.skipped.join('\n')}` : ''}`);
            })
          }
        />
        <Button
          label="List files on robot"
          variant="secondary"
          disabled={!connected || busy}
          onPress={() =>
            run('Files', async () => {
              const r = await robot.request({ type: 'list_files' });
              const files: { path: string; size: number }[] = r.files ?? [];
              Alert.alert('Robot files', files.map((f) => `${f.path}  (${f.size} B)`).join('\n') || 'No files');
            })
          }
        />
      </Card>

      <Card title="Log">
        {robot.log.length === 0 ? <Muted>Nothing yet.</Muted> : null}
        {robot.log.slice(0, 15).map((l, i) => (
          <Text key={i} style={{ fontSize: 12, color: colors.muted, fontFamily: 'monospace' }}>
            {l}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}
