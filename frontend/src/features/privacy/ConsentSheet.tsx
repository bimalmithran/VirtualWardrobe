import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { useI18n } from '../../i18n/I18nProvider';
import { NO_CONSENT, PURPOSES, type Purposes } from '../../privacy/consent';
import { colors, ui } from '../../theme';
import { LanguagePicker } from './LanguagePicker';
import { PrivacyNotice } from './PrivacyNotice';
import { useConsent } from './ConsentContext';

/**
 * Itemised consent, shown as a bottom sheet before anything else on first launch and again
 * whenever the notice version changes. It cannot be dismissed without a decision, because
 * the app processes nothing until the required purpose is agreed to.
 */
export function ConsentSheet() {
  const { loaded, record, needsDecision, decide } = useConsent();
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  // Always start unticked, even when re-asking after a notice change.
  const [choices, setChoices] = useState<Purposes>(NO_CONSENT);
  const [view, setView] = useState<'choices' | 'notice'>('choices');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  // The notice mounts when opened, so its grievance section reports its position then.
  const jumpToGrievance = useRef(false);
  const onGrievanceLayout = (y: number) => {
    if (!jumpToGrievance.current) return;
    jumpToGrievance.current = false;
    scroll.current?.scrollTo({ y, animated: true });
  };

  if (!loaded || !needsDecision) return null;

  const submit = async () => {
    if (!choices.core) {
      setError(t('consent.needCore'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await decide(choices, language);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const openNotice = (grievance: boolean) => {
    jumpToGrievance.current = grievance;
    setView('notice');
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={() => view === 'notice' && setView('choices')}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
            <View style={styles.handle} />
            <ScrollView ref={scroll} contentContainerStyle={styles.content}>
              {view === 'choices' ? (
                <>
                  <Text style={ui.h1} accessibilityRole="header">
                    {t('consent.title')}
                  </Text>
                  {record && <Text style={[ui.body, { color: colors.warn }]}>{t('consent.updated')}</Text>}
                  <Text style={ui.muted}>{t('common.language')}</Text>
                  <LanguagePicker />
                  <Text style={ui.body}>{t('consent.intro')}</Text>

                  {PURPOSES.map((p) => (
                    <View key={p} style={[ui.card, styles.purpose]}>
                      <Checkbox
                        checked={choices[p]}
                        onChange={(v) => setChoices((c) => ({ ...c, [p]: v }))}
                        label={t(`purpose.${p}.title`)}
                      >
                        <View style={styles.titleRow}>
                          <Text style={[ui.h2, styles.flex]}>{t(`purpose.${p}.title`)}</Text>
                          <Text style={[styles.badge, p === 'core' ? styles.required : styles.optional]}>
                            {p === 'core' ? t('common.required') : t('common.optional')}
                          </Text>
                        </View>
                        <Text style={ui.muted}>{t(`purpose.${p}.body`)}</Text>
                      </Checkbox>
                    </View>
                  ))}

                  <View style={styles.links}>
                    <Text style={styles.link} accessibilityRole="link" onPress={() => openNotice(false)}>
                      {t('consent.readNotice')}
                    </Text>
                    <Text style={styles.link} accessibilityRole="link" onPress={() => openNotice(true)}>
                      {t('consent.grievance')}
                    </Text>
                  </View>
                  <Text style={ui.muted}>{t('consent.footer')}</Text>
                  {error && <Text style={styles.error}>{error}</Text>}
                </>
              ) : (
                <>
                  <Text style={ui.h1} accessibilityRole="header">
                    {t('notice.title')}
                  </Text>
                  <PrivacyNotice onGrievanceLayout={onGrievanceLayout} />
                </>
              )}
            </ScrollView>
            {view === 'choices' ? (
              <Button title={t('consent.continue')} onPress={submit} busy={saving} disabled={!choices.core} style={styles.cta} />
            ) : (
              <Button title={t('common.back')} variant="secondary" onPress={() => setView('choices')} style={styles.cta} />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheetWrap: { maxHeight: '94%' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  purpose: { paddingVertical: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  required: { backgroundColor: colors.warnBg, color: colors.warn },
  optional: { backgroundColor: colors.border, color: colors.muted },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 4 },
  link: { color: colors.accent, fontSize: 15, fontWeight: '600', paddingVertical: 6 },
  error: { color: colors.danger },
  cta: { marginHorizontal: 16, marginTop: 8 },
});
