import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useIsFocused } from 'expo-router';

import type { Photo } from '../vision/pipeline';
import { colors, ui } from '../theme';
import { Button } from './Button';

interface Props {
  hint: string;
  onCapture: (photo: Photo) => void;
}

export function CameraCapture({ hint, onCapture }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // Tabs stay mounted after first visit; only the focused tab may hold the camera.
  const focused = useIsFocused();

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
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) onCapture({ uri: asset.uri, width: asset.width, height: asset.height });
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
        <Button title="Choose from gallery instead" variant="secondary" onPress={pick} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {focused && (
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
      )}
      <View style={styles.hint}>
        <Text style={styles.hintText}>{hint}</Text>
      </View>
      <View style={styles.controls}>
        <Pressable onPress={pick} style={styles.sideButton} accessibilityLabel="Choose from gallery">
          <Text style={styles.sideText}>Gallery</Text>
        </Pressable>
        <Pressable
          onPress={capture}
          disabled={!ready || capturing}
          accessibilityLabel="Take photo"
          style={({ pressed }) => [styles.shutter, { opacity: !ready || capturing ? 0.5 : pressed ? 0.7 : 1 }]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <View style={styles.sideButton} />
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
  controls: { position: 'absolute', bottom: 28, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  sideButton: { width: 76, alignItems: 'center' },
  sideText: { color: '#fff', fontWeight: '600' },
});
