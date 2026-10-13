import { useRef } from 'react';
import { Linking, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { grievanceConfigured, LEGAL } from '../../config/legal';
import type { StringKey } from '../../i18n/en';
import { useI18n } from '../../i18n/I18nProvider';
import { colors, ui } from '../../theme';

const SECTIONS: [StringKey, StringKey][] = [
  ['notice.whoTitle', 'notice.whoBody'],
  ['notice.dataTitle', 'notice.dataBody'],
  ['notice.purposeTitle', 'notice.purposeBody'],
  ['notice.retentionTitle', 'notice.retentionBody'],
  ['notice.rightsTitle', 'notice.rightsBody'],
];

/**
 * The DPDP s.5 notice, in the user's language: what is collected, why, how to exercise
 * rights, and how to complain to the Grievance Officer and the Data Protection Board.
 * `onGrievanceLayout` reports where the grievance section sits, so a caller can scroll to it.
 */
export function PrivacyNotice({ onGrievanceLayout }: { onGrievanceLayout?: (y: number) => void }) {
  const { t } = useI18n();
  const g = LEGAL.grievance;
  const reported = useRef(false);
  const onLayout = (e: LayoutChangeEvent) => {
    if (reported.current) return;
    reported.current = true;
    onGrievanceLayout?.(e.nativeEvent.layout.y);
  };

  return (
    <View style={styles.wrap}>
      <Text style={ui.muted}>
        {t('notice.version')} {LEGAL.noticeVersion}
      </Text>
      {SECTIONS.map(([title, body]) => (
        <View key={title} style={styles.section}>
          <Text style={ui.h2}>{t(title)}</Text>
          <Text style={ui.body}>{t(body, { controller: LEGAL.controller })}</Text>
        </View>
      ))}

      <View style={styles.section} onLayout={onLayout}>
        <Text style={ui.h2}>{t('notice.grievanceTitle')}</Text>
        {grievanceConfigured ? (
          <>
            <Text style={ui.body}>{g.name}</Text>
            <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${g.email}`)} accessibilityRole="link">
              {g.email}
            </Text>
            {!!g.phone && (
              <Text style={styles.link} onPress={() => Linking.openURL(`tel:${g.phone}`)} accessibilityRole="link">
                {g.phone}
              </Text>
            )}
            {!!g.address && <Text style={ui.body}>{g.address}</Text>}
          </>
        ) : (
          <Text style={[ui.body, { color: colors.warn }]}>{t('privacy.legalMissing')}</Text>
        )}
        <Text style={ui.muted}>{t('notice.grievanceBody', { days: LEGAL.grievanceResponseDays })}</Text>
      </View>

      <View style={styles.section}>
        <Text style={ui.h2}>{t('notice.boardTitle')}</Text>
        <Text style={ui.body}>{t('notice.boardBody')}</Text>
        <Text style={styles.link} onPress={() => Linking.openURL(LEGAL.dpbUrl)} accessibilityRole="link">
          {LEGAL.dpbUrl}
        </Text>
      </View>

      {!!LEGAL.privacyUrl && (
        <Text style={styles.link} onPress={() => Linking.openURL(LEGAL.privacyUrl)} accessibilityRole="link">
          {t('notice.fullOnline')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  section: { marginTop: 14, gap: 4 },
  link: { color: colors.accent, fontSize: 15, fontWeight: '600', paddingVertical: 2 },
});
