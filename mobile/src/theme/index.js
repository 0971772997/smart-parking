// Design tokens dung chung cho toan app
export const colors = {
  navy: '#0B1F3A',          // nen splash, chu tieu de
  primary: '#1D4ED8',       // nut chinh, lien ket
  primaryDark: '#1E3A8A',
  primarySoft: '#E8EEFF',
  accent: '#22C55E',        // o trong
  warning: '#F59E0B',       // dat cho
  danger: '#DC2626',        // loi / o co xe
  dangerSoft: '#FEF2F2',
  success: '#16A34A',
  successSoft: '#ECFDF5',

  bg: '#F5F7FB',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  borderFocus: '#1D4ED8',
  text: '#0F172A',
  textMuted: '#64748B',
  textOnDark: '#FFFFFF',
  placeholder: '#94A3B8',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const font = {
  h1: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.textMuted },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
};

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
};
