import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CloudMatch, SimilarityRemote } from '../../api/wardrobeApi';
import { Button } from '../../components/Button';
import { SimilarGrid } from '../../components/SimilarGrid';
import type { Garment } from '../../domain/types';
import { errorMessage } from '../../lib/errors';
import { colors, ui } from '../../theme';

interface Props {
  garment: Garment & { embedding: Float32Array };
  remote: SimilarityRemote;
  onOpen: (clientItemId: string) => void;
}

/** The same query as the on-device list, answered by pgvector's HNSW index on the server. */
export function CloudSearchPanel({ garment, remote, onOpen }: Props) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CloudMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      // Ask for one extra: the garment itself is usually the top hit.
      const matches = await remote.searchSimilar(garment.embedding, 6);
      setResults(matches.filter((m) => m.client_item_id !== garment.id).slice(0, 5));
    } catch (e) {
      setResults(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={[ui.h2, styles.title]}>Cloud search (pgvector)</Text>
      {garment.syncedAt === null && <Text style={ui.muted}>This garment hasn&apos;t been uploaded yet.</Text>}
      {error && <Text style={[ui.muted, { color: colors.danger }]}>{error}</Text>}
      {results?.length === 0 && <Text style={ui.muted}>No other garments on the server yet.</Text>}
      {results && results.length > 0 && (
        <SimilarGrid
          items={results.map((m) => ({
            key: m.id,
            imageUri: m.image_url,
            score: m.similarity,
            onPress: () => onOpen(m.client_item_id),
          }))}
        />
      )}
      <Button title="Search the cloud" variant="secondary" busy={busy} onPress={search} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 20, marginBottom: 8 },
  title: { marginBottom: 8 },
  button: { marginTop: 8 },
});
