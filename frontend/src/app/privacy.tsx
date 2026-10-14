import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { offerFile, writeCacheFile } from '../platform/files';

import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { useConsent } from '../features/privacy/ConsentContext';
import { LanguagePicker } from '../features/privacy/LanguagePicker';
import { PrivacyNotice } from '../features/privacy/PrivacyNotice';
import { useProfile } from '../features/profile/ProfileContext';
import { useSelf } from '../features/self/SelfContext';
import { useI18n } from '../i18n/I18nProvider';
import { errorMessage } from '../lib/errors';
import { PURPOSES, type Purposes } from '../privacy/consent';
import { useServices } from '../services/ServicesProvider';
import { colors, ui } from '../theme';

/** Privacy & data: change or withdraw consent, export, erase, and read the notice. */
export default function PrivacySettings() {
  const { t, language } = useI18n();
  const { record, decide } = useConsent();
  const { api, consent, eraser } = useServices();
  const profile = useProfile();
  const self = useSelf();
  const [choices, setChoices] = useState<Purposes | null>(record?.purposes ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = !!record && !!choices && PURPOSES.some((p) => record.purposes[p] !== choices[p]);

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (e) {
      Alert.alert(t('privacy.title'), errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const confirm = (message: string, then: () => void) =>
    Alert.alert(t('privacy.title'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: 'OK', style: 'destructive', onPress: then },
    ]);

  const save = () =>
    run('save', async () => {
      if (!choices) return;
      await decide(choices, language);
      Alert.alert(t('privacy.title'), t('privacy.saved'));
    });

  const exportData = () =>
    run('export', async () => {
      if (!api) return;
      const data = await api.exportCloudData();
      const name = `virtualwardrobe-export-${Date.now()}.json`;
      const uri = writeCacheFile(name, JSON.stringify(data, null, 2));
      if (!(await offerFile(uri, 'application/json', name))) Alert.alert(t('privacy.export'), uri);
    });

  const eraseCloud = () =>
    confirm(t('privacy.eraseCloudConfirm'), () =>
      run('cloud', async () => {
        await consent.eraseCloud();
        setChoices(consent.current()?.purposes ?? null);
        Alert.alert(t('privacy.title'), t('privacy.done'));
      }),
    );

  const eraseDevice = () =>
    confirm(t('privacy.eraseDeviceConfirm'), () =>
      run('device', async () => {
        await eraser.eraseAll();
        await Promise.all([profile.reload(), self.reload()]);
        router.replace('/onboarding');
      }),
    );

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('privacy.title') }} />
      <Text style={ui.h2}>{t('common.language')}</Text>
      <LanguagePicker />

      <Text style={[ui.h2, styles.section]}>{t('privacy.choices')}</Text>
      {!api && <Text style={ui.muted}>{t('privacy.noServer')}</Text>}
      {choices &&
        PURPOSES.map((p) => (
          <View key={p} style={[ui.card, styles.card]}>
            <Checkbox
              checked={choices[p]}
              disabled={p === 'core'} // withdrawn by erasing the phone's data, below
              onChange={(v) => setChoices((c) => c && { ...c, [p]: v })}
              label={t(`purpose.${p}.title`)}
            >
              <Text style={ui.h2}>
                {t(`purpose.${p}.title`)} · <Text style={ui.muted}>{p === 'core' ? t('common.required') : t('common.optional')}</Text>
              </Text>
              <Text style={ui.muted}>{t(`purpose.${p}.body`)}</Text>
            </Checkbox>
          </View>
        ))}
      <Button title={t('twin.save')} onPress={save} disabled={!dirty} busy={busy === 'save'} style={styles.gap} />

      <Text style={[ui.h2, styles.section]}>{t('privacy.rights')}</Text>
      {api && (
        <>
          <View style={[ui.card, styles.card]}>
            <Text style={ui.h2}>{t('privacy.export')}</Text>
            <Text style={ui.muted}>{t('privacy.exportBody')}</Text>
            <Button title={t('privacy.export')} variant="secondary" onPress={exportData} busy={busy === 'export'} style={styles.gap} />
          </View>
          <View style={[ui.card, styles.card]}>
            <Text style={ui.h2}>{t('privacy.eraseCloud')}</Text>
            <Text style={ui.muted}>{t('privacy.eraseCloudBody')}</Text>
            <Button title={t('privacy.eraseCloud')} variant="secondary" onPress={eraseCloud} busy={busy === 'cloud'} style={styles.gap} />
          </View>
        </>
      )}
      <View style={[ui.card, styles.card]}>
        <Text style={[ui.h2, { color: colors.danger }]}>{t('privacy.eraseDevice')}</Text>
        <Text style={ui.muted}>{t('privacy.eraseDeviceBody')}</Text>
        <Button title={t('privacy.eraseDevice')} variant="secondary" onPress={eraseDevice} busy={busy === 'device'} style={styles.gap} />
      </View>

      <Text style={[ui.h1, styles.section]}>{t('notice.title')}</Text>
      <PrivacyNotice />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 6 },
  section: { marginTop: 24 },
  card: { marginTop: 8 },
  gap: { marginTop: 10 },
});
