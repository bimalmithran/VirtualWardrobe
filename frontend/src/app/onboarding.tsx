import { Text, View } from 'react-native';
import { router } from 'expo-router';

import { DigitalTwinForm } from '../components/DigitalTwinForm';
import { useProfile } from '../storage/profile';
import { ui } from '../theme';

export default function Onboarding() {
  const { profile, save } = useProfile();
  return (
    <View style={ui.screen}>
      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <Text style={ui.body}>
          Tell us a little about you. Your Digital Twin is used to judge which colours and cuts suit you.
        </Text>
      </View>
      <DigitalTwinForm
        initial={profile}
        submitLabel="Create my Digital Twin"
        onSubmit={async (p) => {
          await save(p);
          router.replace('/');
        }}
      />
    </View>
  );
}
