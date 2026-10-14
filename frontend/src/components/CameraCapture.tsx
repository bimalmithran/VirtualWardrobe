import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useIsFocused } from 'expo-router';

import { useLiveQuality } from '../features/ingestion/useLiveQuality';
import type { Photo } from '../vision/pipeline';
import { colors, ui } from '../theme';
import { Button } from './Button';

/** Most photos one gallery pick may hand over; each is processed in turn. */
export const MAX_GALLERY_PICK = 20;

interface Props {
  hint: string;
  onCapture: (photo: Photo) => void;
  /** Set to let the gallery pick several photos at once. A single pick still goes to onCapture. */
  onPickMany?: (photos: Photo[]) => void;
  /** 'front' for selfies. Either way the user can flip. */
  initialFacing?: 'front' | 'back';
  /** Live blur/exposure feedback before the shutter is pressed. */
  liveQuality?: boolean;
}

export function CameraCapture({ hint, onCapture, onPickMany, initialFacing = 'back', liveQuality = true }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState(initialFacing);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // Tabs stay mounted after first visit; only the focused tab may hold the camera.
  const focused = useIsFocused();
  const live = useLiveQuality(camera, liveQuality && focused && ready && !!permission?.granted, capturing);

  const capture = async () => {
    if (!camera.current || capturing) return;
    setCapturing(true);
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.9, shutterSound: false });
      if (pic) onCapture({ uri: pic.uri, width: pic.width, height: pic.height });
    } finally {
      setCapturing(false);
    }
  };

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      ...(onPickMany && { allowsMultipleSelection: true, selectionLimit: MAX_GALLERY_PICK, orderedSelection: true }),
    });
    if (res.canceled) return;
    const photos = res.assets.slice(0, MAX_GALLERY_PICK).map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
    if (photos.length > 1 && onPickMany) onPickMany(photos);
    else if (photos[0]) onCapture(photos[0]);
  };

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={[ui.body, styles.permissionText]}>Camera access is needed to photograph your clothes.</Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Button title="Open settings" onPress={() => Linking.openSettings()} />
        )}
        <Button title={onPickMany ? 'Choose photos from gallery' : 'Choose from gallery instead'} variant="secondary" onPress={pick} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {focused && (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          animateShutter={false}
          onCameraReady={() => setReady(true)}
        />
      )}
      <View style={styles.hint}>
        <Text style={styles.hintText}>{hint}</Text>
      </View>
      {liveQuality && ready && live.state !== 'checking' && (
        <View
          style={[styles.live, live.state === 'ok' ? styles.liveOk : styles.liveIssue]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={live.state === 'ok' ? 'Photo quality looks good' : live.headline}
        >
          <Text style={styles.liveText}>{live.state === 'ok' ? '✓ Looks good' : `⚠ ${live.headline}`}</Text>
        </View>
      )}
      <View style={styles.controls}>
        <Pressable
          onPress={pick}
          style={styles.sideButton}
          accessibilityLabel={onPickMany ? `Choose up to ${MAX_GALLERY_PICK} photos from gallery` : 'Choose from gallery'}
        >
          <Text style={styles.sideText}>Gallery</Text>
          {onPickMany && <Text style={styles.sideSub}>up to {MAX_GALLERY_PICK}</Text>}
        </Pressable>
        <Pressable
          onPress={capture}
          disabled={!ready || capturing}
          accessibilityLabel="Take photo"
          style={({ pressed }) => [styles.shutter, { opacity: !ready || capturing ? 0.5 : pressed ? 0.7 : 1 }]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <Pressable
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          style={styles.sideButton}
          accessibilityLabel={facing === 'back' ? 'Switch to front camera' : 'Switch to back camera'}
        >
          <Text style={styles.sideText}>Flip</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  permissionText: { textAlign: 'center', marginBottom: 16 },
  hint: { position: 'absolute', top: 16, left: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, padding: 10 },
  hintText: { color: '#fff', textAlign: 'center', fontSize: 14 },
  live: { position: 'absolute', bottom: 124, alignSelf: 'center', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  liveOk: { backgroundColor: 'rgba(21,128,61,0.85)' },
  liveIssue: { backgroundColor: 'rgba(180,83,9,0.9)' },
  liveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  controls: { position: 'absolute', bottom: 28, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  sideButton: { width: 76, alignItems: 'center' },
  sideText: { color: '#fff', fontWeight: '600' },
  sideSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
});
