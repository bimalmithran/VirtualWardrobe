import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useExecutionPlan } from '../../ml/useExecutionPlan';
import { setPreferNpu } from '../../services/container';
import { useServices } from '../../services/ServicesProvider';
import { colors, ui } from '../../theme';

const TIER_LABEL = { high: 'High-end device', mid: 'Mid-range device', low: 'Entry-level device' } as const;
const WHERE = { device: 'on this phone', cloud: 'in the cloud' } as const;

/** Shows the detected device tier and where each model runs, with the NPU opt-in. */
export function DeviceAiCard() {
  const { models, settings } = useServices();
  const plan = useExecutionPlan(models.router);
  const caps = models.router.caps;
  const [npu, setNpu] = useState(plan.executionProviders[0] === 'nnapi' || plan.executionProviders[0] === 'coreml' || plan.executionProviders[0] === 'webnn');
  const gb = caps.totalMemoryBytes ? `${(caps.totalMemoryBytes / 1024 ** 3).toFixed(0)} GB RAM · ` : '';

  return (
    <View style={[ui.card, styles.card]}>
      <Text style={ui.h2}>AI on this device</Text>
      <Text style={ui.body}>
        {TIER_LABEL[plan.tier]} · {gb}CPU score {caps.cpuScoreMs} ms
      </Text>
      <Text style={ui.muted}>
        Background removal runs {WHERE[plan.segmentation]}; style vectors run {WHERE[plan.embedding]}. Accelerators:{' '}
        {plan.executionProviders.join(' → ')}.
      </Text>
      {plan.reasons.map((r) => (
        <Text key={r} style={ui.muted}>
          • {r}
        </Text>
      ))}
      {caps.npu && (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={ui.body}>Use the neural processor (NPU) first</Text>
            <Text style={ui.muted}>Faster on some phones; others run these int8 models slower there. CPU is always the fallback.</Text>
          </View>
          <Switch
            value={npu}
            onValueChange={(v) => {
              setNpu(v);
              setPreferNpu(settings, v).catch(() => {});
              models.memory.releaseAll().catch(() => {}); // reload sessions with the new providers
            }}
            trackColor={{ true: colors.accent, false: colors.border }}
            accessibilityLabel="Use the neural processor first"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  flex: { flex: 1 },
});
