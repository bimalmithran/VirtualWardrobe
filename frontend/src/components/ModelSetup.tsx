import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MODELS, type ModelKey } from '../config/models';
import { errorMessage, modelManager, useModelStatuses, type ModelState } from '../ml/modelManager';
import { colors, ui } from '../theme';
import { Button } from './Button';

interface Props {
  /** Which models the calling screen needs. */
  required: ModelKey[];
}

/** One-time model download with per-file progress. Shown until the required models are on disk. */
export function ModelSetup({ required }: Props) {
  const statuses = useModelStatuses();
  const [error, setError] = useState<string | null>(null);
  const downloading = required.some((k) => statuses[k].state === 'downloading');
  const totalMb = required.reduce((sum, k) => sum + MODELS[k].bytes, 0) / 1e6;

  const start = async () => {
    setError(null);
    try {
      for (const key of required) await modelManager.download(key);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <View style={[ui.card, styles.card]}>
      <Text style={ui.h2}>Download on-device AI models</Text>
      <Text style={ui.muted}>
        One-time download of {totalMb.toFixed(0)} MB. After this, photos are processed entirely on your phone — nothing is uploaded.
        Wi-Fi recommended.
      </Text>
      {required.map((key) => (
        <View key={key} style={styles.row}>
          <Text style={[ui.body, { flex: 1 }]}>{MODELS[key].label}</Text>
          <Text style={ui.muted}>{describe(statuses[key], MODELS[key].bytes)}</Text>
        </View>
      ))}
      {required.map((key) =>
        statuses[key].state === 'downloading' ? (
          <View key={`${key}-bar`} style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((statuses[key] as { progress: number }).progress * 100)}%` }]} />
          </View>
        ) : null,
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={error ? 'Retry download' : 'Download models'} onPress={start} busy={downloading} />
    </View>
  );
}

function describe(s: ModelState, bytes: number) {
  switch (s.state) {
    case 'missing': return `${(bytes / 1e6).toFixed(0)} MB`;
    case 'downloading': return `${Math.round(s.progress * 100)}%`;
    case 'error': return 'Failed';
    default: return 'Ready';
  }
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  error: { color: colors.danger },
});
