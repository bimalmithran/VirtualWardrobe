import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../components/Button';
import { DigitalTwinForm } from '../../components/DigitalTwinForm';
import { ModelSetup } from '../../components/ModelSetup';
import { MODELS, type ModelKey } from '../../config/models';
import { useProfile } from '../../features/profile/ProfileContext';
import { useSelf } from '../../features/self/SelfContext';
import { SEASON_LABELS } from '../../vision/personColouring';
import { useModelStatuses } from '../../ml/modelStatus';
import { useServices } from '../../services/ServicesProvider';
import { ui } from '../../theme';

const KEYS = Object.keys(MODELS) as ModelKey[];

export default function ProfileTab() {
  const { profile, save } = useProfile();
  const { models } = useServices();
  const statuses = useModelStatuses(models.status);
  const missing = KEYS.filter((k) => !models.files.isDownloaded(k) || statuses[k].state === 'downloading');
  const resident = KEYS.filter((k) => statuses[k].state === 'ready');
  const { colouring } = useSelf();

  return (
    <View style={ui.screen}>
      <DigitalTwinForm
        key={profile?.updatedAt}
        initial={profile}
        submitLabel="Save changes"
        onSubmit={save}
        footer={
          <View style={styles.models}>
            <Pressable onPress={() => router.push('/me')} style={[ui.card, styles.me]} accessibilityRole="button">
              <Text style={ui.h2}>Your colours</Text>
              <Text style={ui.muted}>
                {colouring
                  ? `${SEASON_LABELS[colouring.season]}. See what suits you and which colours to add.`
                  : 'Add a photo of yourself to find your colours and get wardrobe suggestions.'}
              </Text>
            </Pressable>
            {missing.length > 0 ? (
              <ModelSetup required={missing} />
            ) : (
              <View style={[ui.card, { gap: 8 }]}>
                <Text style={ui.h2}>On-device models</Text>
                {KEYS.map((k) => (
                  <Text key={k} style={ui.muted}>
                    {MODELS[k].label}: {statuses[k].state === 'ready' ? 'in memory' : 'on disk'}
                  </Text>
                ))}
                <Text style={ui.muted}>Keeping up to {models.memory.maxResident} model(s) in memory on this device.</Text>
                <Button
                  title="Free model memory"
                  variant="secondary"
                  disabled={resident.length === 0}
                  onPress={() => models.memory.releaseAll()}
                />
              </View>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  models: { marginTop: 24 },
  me: { gap: 4, marginBottom: 16 },
});
