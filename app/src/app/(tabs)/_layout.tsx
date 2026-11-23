import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { ConnBadge } from '../../components/RobotChrome';
import { colors } from '../../components/ui';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerRight: () => <ConnBadge />,
        headerStyle: { backgroundColor: colors.card },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Robot', tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="control" options={{ title: 'Control', tabBarIcon: icon('✥') }} />
      <Tabs.Screen name="skills" options={{ title: 'Skills', tabBarIcon: icon('☰') }} />
      <Tabs.Screen name="train" options={{ title: 'Train', tabBarIcon: icon('★') }} />
      <Tabs.Screen name="setup" options={{ title: 'Setup', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
