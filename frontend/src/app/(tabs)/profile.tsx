import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { DigitalTwinForm } from '../../components/DigitalTwinForm';
import { ModelSetup } from '../../components/ModelSetup';
import { MODELS, type ModelKey } from '../../config/models';
import { useProfile } from '../../features/profile/ProfileContext';
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

  return (
    <View style={ui.screen}>
      <DigitalTwinForm
        key={profile?.updatedAt}
        initial={profile}
        submitLabel="Save changes"
        onSubmit={save}
        footer={
          <View style={styles.models}>
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
});
