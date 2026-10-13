import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Canvas, Circle, Group, Image as SkiaImage, Path, Skia, useImage } from '@shopify/react-native-skia';

import type { Category } from '../../domain/types';
import { placeGarment, type Avatar } from '../../style/tryOn';
import { colors, ui } from '../../theme';
import type { Pose } from '../../vision/pose';

interface Props {
  garmentUri: string;
  category: Category | null;
  subcategory: string | null;
  /** The person: a photo with its pose in the photo's pixels, or the Digital Twin avatar. */
  person: { kind: 'photo'; uri: string; pose: Pose } | { kind: 'avatar'; avatar: Avatar };
  width: number;
  maxHeight: number;
}

/**
 * Draws the garment's cutout over the person, anchored and rotated to the body by pose
 * keypoints (see style/tryOn.ts). Silhouette and drape come from the garment's own outline:
 * a long kurta falls past the hips, a cropped top stops at the waist.
 */
export function TryOnCanvas({ garmentUri, category, subcategory, person, width, maxHeight }: Props) {
  const garment = useImage(garmentUri);
  const photo = useImage(person.kind === 'photo' ? person.uri : null);
  const base =
    person.kind === 'photo' ? (photo ? { w: photo.width(), h: photo.height() } : null) : { w: person.avatar.width, h: person.avatar.height };
  const pose = person.kind === 'photo' ? person.pose : person.avatar.pose;

  const outline = useMemo(() => {
    if (person.kind !== 'avatar') return null;
    const p = Skia.Path.Make();
    person.avatar.outline.forEach((pt, i) => (i === 0 ? p.moveTo(pt.x, pt.y) : p.lineTo(pt.x, pt.y)));
    p.close();
    return p;
  }, [person]);

  if (!base || !garment) {
    return <View style={{ width, height: Math.min(maxHeight, width * 1.4), backgroundColor: colors.border, borderRadius: 16 }} />;
  }

  const scale = Math.min(width / base.w, maxHeight / base.h);
  const placed = placeGarment(category, subcategory, { width: garment.width(), height: garment.height() }, pose);

  return (
    <View>
      <Canvas style={{ width: base.w * scale, height: base.h * scale, alignSelf: 'center' }} accessibilityLabel="Virtual try-on preview">
        <Group transform={[{ scale }]}>
          {person.kind === 'photo' && photo && <SkiaImage image={photo} x={0} y={0} width={base.w} height={base.h} fit="fill" />}
          {person.kind === 'avatar' && outline && (
            <>
              <Path path={outline} color="#E4D7C9" />
              <Circle cx={person.avatar.head.x} cy={person.avatar.head.y} r={person.avatar.headRadius} color="#E4D7C9" />
            </>
          )}
          {placed.ok && (
            <Group
              transform={[
                { translateX: placed.placement.pivotX },
                { translateY: placed.placement.pivotY },
                { rotate: placed.placement.rotation },
                { translateX: -placed.placement.pivotX },
                { translateY: -placed.placement.pivotY },
              ]}
            >
              <SkiaImage
                image={garment}
                x={placed.placement.x}
                y={placed.placement.y}
                width={placed.placement.width}
                height={placed.placement.height}
                fit="fill"
                opacity={0.97}
              />
            </Group>
          )}
        </Group>
      </Canvas>
      {!placed.ok && <Text style={[ui.body, { color: colors.warn, marginTop: 8 }]}>{placed.reason}</Text>}
    </View>
  );
}
