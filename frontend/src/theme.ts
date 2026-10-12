import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#F7F5F2',
  surface: '#FFFFFF',
  text: '#1C1B1A',
  muted: '#6E6A65',
  border: '#E3DED7',
  accent: '#3A5A40',
  accentText: '#FFFFFF',
  warn: '#B45309',
  warnBg: '#FEF3C7',
  danger: '#B91C1C',
  good: '#15803D',
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  h1: { fontSize: 26, fontWeight: '700', color: colors.text },
  h2: { fontSize: 18, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center' },
  buttonText: { color: colors.accentText, fontSize: 16, fontWeight: '600' },
  buttonSecondary: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttonSecondaryText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  checker: { backgroundColor: '#ECE8E2' },
});
