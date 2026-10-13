import { Text, View } from 'react-native';
import { router } from 'expo-router';

import { DigitalTwinForm } from '../components/DigitalTwinForm';
import { useConsent } from '../features/privacy/ConsentContext';
import { useProfile } from '../features/profile/ProfileContext';
import { useI18n } from '../i18n/I18nProvider';
import { ui } from '../theme';

export default function Onboarding() {
  const { profile, save } = useProfile();
  const { t } = useI18n();
  const { allows } = useConsent();
  return (
    <View style={ui.screen}>
      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <Text style={ui.body}>{t('twin.intro')}</Text>
      </View>
      <DigitalTwinForm
        initial={profile}
        submitLabel={t('twin.create')}
        cloudBackup={allows('cloud_sync')}
        onSubmit={async (p) => {
          await save(p);
          router.replace('/');
        }}
      />
    </View>
  );
}
