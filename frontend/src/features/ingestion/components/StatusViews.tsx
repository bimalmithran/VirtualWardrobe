import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { colors, ui } from '../../../theme';
import type { QualityReport } from '../../../vision/junkFilter';
import type { IngestionMode, StepKey } from '../modes';
import { screenStyles } from './screenStyles';

export function Centered({ label }: { label: string }) {
  return (
    <View style={[ui.screen, styles.center]}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={[ui.body, screenStyles.gap]}>{label}</Text>
    </View>
  );
}

export function JunkWarning({ quality, onRetake, onProceed }: { quality: QualityReport; onRetake: () => void; onProceed: () => void }) {
  return (
    <>
      <View style={[ui.card, styles.warnCard]}>
        <Text style={[ui.h2, { color: colors.warn }]}>This photo may give poor results</Text>
        {quality.issues.map((issue) => (
          <Text key={issue} style={ui.body}>• {issue}</Text>
        ))}
        <Text style={ui.muted}>
          Brightness {quality.brightness.toFixed(0)} · Contrast {quality.contrast.toFixed(0)} · Sharpness {quality.sharpness.toFixed(0)}
        </Text>
      </View>
      <Button title="Retake photo" onPress={onRetake} style={screenStyles.gap} />
      <Button title="Process anyway" variant="secondary" onPress={onProceed} style={screenStyles.gap} />
    </>
  );
}

export function StepProgress({ steps, current }: { steps: IngestionMode['steps']; current: StepKey }) {
  return (
    <>
      <Text style={ui.h1}>Processing on device</Text>
      <Text style={[ui.muted, screenStyles.gap]}>
        Nothing leaves your phone while it&apos;s processed. First run loads the models into memory, which takes a few seconds.
      </Text>
      <StepList steps={steps} current={current} />
    </>
  );
}

/** The pipeline's steps, ticked off up to `current`. An unknown `current` leaves them all pending. */
export function StepList({ steps, current }: { steps: IngestionMode['steps']; current: string }) {
  const currentIndex = steps.findIndex((s) => s.key === current);
  return (
      <View style={[ui.card, screenStyles.gap]}>
        {steps.map((s, i) => {
          const status = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending';
          return (
            <View key={s.key} style={styles.stageRow}>
              {status === 'active' ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={[styles.stageIcon, status === 'done' && { color: colors.good }]}>{status === 'done' ? '✓' : '○'}</Text>
              )}
              <Text style={[ui.body, status === 'pending' && { color: colors.muted }]}>{s.label}</Text>
            </View>
          );
        })}
      </View>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <View style={ui.card}>
        <Text style={[ui.h2, { color: colors.danger }]}>Processing failed</Text>
        <Text style={[ui.body, screenStyles.gap]}>{message}</Text>
      </View>
      <Button title="Try again" onPress={onRetry} style={screenStyles.gap} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  warnCard: { gap: 8, backgroundColor: colors.warnBg, borderColor: '#FCD34D' },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  stageIcon: { width: 20, textAlign: 'center', fontSize: 16, color: colors.muted },
});
