import { useLocalSearchParams } from 'expo-router';

import { IngestionScreen } from '../../features/ingestion/IngestionScreen';

/** Adds another photo to an existing garment; its colour and style are re-fused from all photos. */
export default function AddGarmentPhoto() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <IngestionScreen mode="add-photo" garmentId={id} underHeader />;
}
