// Always-visible E-STOP button and connection badge.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRobot } from '../lib/robot';
import { colors } from './ui';

export function EStopButton({ bottom = 16 }: { bottom?: number }) {
  const robot = useRobot();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Emergency stop"
      onPress={robot.estop}
      hitSlop={10}
      style={({ pressed }) => [s.estop, { bottom }, pressed && { transform: [{ scale: 0.95 }] }]}
    >
      <Text style={s.estopText}>STOP</Text>
    </Pressable>
  );
}

export function ConnBadge() {
  const { conn, status } = useRobot();
  const color = conn === 'connected' ? (status?.state === 'estop' ? colors.stop : colors.good) : conn === 'connecting' ? colors.warn : colors.muted;
  const label =
    conn === 'connected' ? (status?.state === 'estop' ? 'E-STOPPED' : status?.state === 'playing' ? 'Playing' : 'Connected') : conn === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <View style={s.badge}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  estop: {
    position: 'absolute',
    right: 16,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.stop,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFD43B',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  estopText: { color: '#fff', fontWeight: '900', fontSize: 18, letterSpacing: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
