import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAppearance } from "../context/appearance-context";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import { routeForRole } from "../lib/role-routes";

const categories = [
  { emoji: "🎉", title: "Festas", subtitle: "Aniversários e comemorações" },
  {
    emoji: "💍",
    title: "Casamentos",
    subtitle: "Convites para momentos únicos",
  },
  { emoji: "🎵", title: "Shows", subtitle: "Ingressos para grandes eventos" },
  { emoji: "💼", title: "Corporativos", subtitle: "Eventos da sua empresa" },
];

const steps = [
  { number: "01", title: "Escolha", description: "Encontre o modelo ideal." },
  {
    number: "02",
    title: "Personalize",
    description: "Deixe tudo com a sua cara.",
  },
  { number: "03", title: "Receba", description: "Acompanhe até a entrega." },
];

export default function HomeScreen() {
  const router = useRouter();
  const { appearance } = useAppearance();
  const { session, profile, isLoading } = useAuth();

  const openAccount = () => {
    if (!session) {
      router.push("/login");
      return;
    }

    router.push(routeForRole(profile?.role));
  };

  const accountLabel = isLoading
    ? "Carregando..."
    : session
      ? profile?.full_name.trim().split(/\s+/)[0] || "Minha área"
      : "Entrar";

  const showNextStep = () => {
    Alert.alert(
      "SeuChico",
      "O catálogo e o editor de ingressos serão os próximos módulos.",
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: appearance.background_color }]}>
      <StatusBar style="dark" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.page}>
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={[styles.brandIcon, { backgroundColor: appearance.primary_color }]}>
                {appearance.logo_url ? (
                  <Image
                    resizeMode="contain"
                    source={{ uri: appearance.logo_url }}
                    style={styles.brandLogo}
                  />
                ) : (
                  <Text style={[styles.brandIconText, { color: appearance.accent_color }]}>SC</Text>
                )}
              </View>

              <View>
                <Text style={[styles.brandName, { color: appearance.primary_color }]}>
                  {appearance.brand_name}
                </Text>
                <Text style={[styles.brandTagline, { color: appearance.secondary_color }]}>
                  {appearance.tagline}
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={openAccount}
              style={({ pressed }) => [
                styles.profileButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.profileButtonText}>{accountLabel}</Text>
            </Pressable>
          </View>

          <View style={[styles.hero, { backgroundColor: appearance.primary_color }]}>
            {appearance.hero_image_url ? (
              <>
                <Image
                  resizeMode="cover"
                  source={{ uri: appearance.hero_image_url }}
                  style={styles.heroImage}
                />
                <View style={styles.heroImageOverlay} />
              </>
            ) : null}
            <View style={styles.heroGlowOne} />
            <View style={styles.heroGlowTwo} />

            <View style={styles.heroContent}>
              <View style={[styles.heroBadge, { backgroundColor: appearance.accent_color }]}>
                <Text style={[styles.heroBadgeText, { color: appearance.primary_color }]}>NOVO JEITO DE CRIAR</Text>
              </View>

              <Text style={styles.heroTitle}>
                Seu evento começa com um ingresso inesquecível.
              </Text>

              <Text style={styles.heroDescription}>
                Escolha um modelo, personalize cada detalhe e receba seus
                ingressos onde estiver.
              </Text>

              <View style={styles.heroActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={openAccount}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: appearance.accent_color },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.primaryButtonText, { color: appearance.primary_color }]}>
                    Criar meu ingresso
                  </Text>
                  <Text style={[styles.primaryButtonArrow, { color: appearance.primary_color }]}>→</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  onPress={openAccount}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>
                    Acompanhar pedido
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.ticketPreview}>
              <View style={styles.ticketTop}>
                <Text style={styles.ticketLabel}>SEU INGRESSO</Text>
                <Text style={styles.ticketDate}>24 AGO</Text>
              </View>
              <View style={styles.ticketDivider} />
              <Text style={styles.ticketEvent}>UMA NOITE{`\n`}INCRÍVEL</Text>
              <View style={styles.ticketFooter}>
                <Text style={styles.ticketFooterText}>BRASÍLIA · 20H</Text>
                <View style={styles.qrMock}>
                  <Text style={styles.qrMockText}>▦</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>PARA CADA MOMENTO</Text>
              <Text style={styles.sectionTitle}>O que você vai celebrar?</Text>
            </View>

            <Pressable accessibilityRole="button" onPress={showNextStep}>
              <Text style={[styles.seeAllText, { color: appearance.secondary_color }]}>Ver todos</Text>
            </Pressable>
          </View>

          <View style={styles.categoriesGrid}>
            {categories.map((category) => (
              <Pressable
                accessibilityRole="button"
                key={category.title}
                onPress={showNextStep}
                style={({ pressed }) => [
                  styles.categoryCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.categoryIcon, { backgroundColor: `${appearance.accent_color}22` }]}>
                  <Text style={styles.categoryEmoji}>{category.emoji}</Text>
                </View>
                <Text style={styles.categoryTitle}>{category.title}</Text>
                <Text style={styles.categorySubtitle}>{category.subtitle}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.processSection}>
            <Text style={styles.sectionEyebrow}>SIMPLES DO INÍCIO AO FIM</Text>
            <Text style={styles.sectionTitle}>Como funciona</Text>

            <View style={styles.stepsRow}>
              {steps.map((step) => (
                <View key={step.number} style={styles.stepCard}>
                  <Text style={styles.stepNumber}>{step.number}</Text>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDescription}>{step.description}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.bottomBanner, { backgroundColor: appearance.primary_color }]}>
            <View style={styles.bottomBannerText}>
              <Text style={styles.bottomBannerTitle}>
                Uma ideia. Um ingresso. Uma memória.
              </Text>
              <Text style={styles.bottomBannerDescription}>
                Comece agora e transforme seu evento em algo único.
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={showNextStep}
              style={({ pressed }) => [
                styles.bannerButton,
                { backgroundColor: appearance.accent_color },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.bannerButtonText, { color: appearance.primary_color }]}>Começar</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const colors = {
  background: "#F3F7F8",
  surface: "#FFFFFF",
  ink: "#102A43",
  muted: "#627D8A",
  navy: "#071D2D",
  cyan: "#38D6D2",
  cyanDark: "#087E83",
  warm: "#FFB66B",
  line: "#DCE7EA",
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  page: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "web" ? 28 : 58,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.navy,
  },
  brandIconText: {
    color: colors.cyan,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  brandLogo: { width: 36, height: 36, borderRadius: 10 },
  brandName: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  brandTagline: {
    color: colors.cyanDark,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.3,
    marginTop: 1,
  },
  profileButton: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 14,
  },
  profileButtonText: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 14,
  },
  hero: {
    ...visualShadows.hero,
    position: "relative",
    overflow: "hidden",
    minHeight: 420,
    borderRadius: 30,
    backgroundColor: colors.navy,
    padding: 28,
    flexDirection: Platform.OS === "web" ? "row" : "column",
    alignItems: "center",
    gap: 30,
  },
  heroImage: {
    ...StyleSheet.absoluteFill,
    width: undefined,
    height: undefined,
  },
  heroImageOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(3, 18, 30, 0.72)",
  },
  heroGlowOne: {
    position: "absolute",
    width: 310,
    height: 310,
    borderRadius: 155,
    backgroundColor: colors.cyan,
    opacity: 0.12,
    right: -80,
    top: -110,
  },
  heroGlowTwo: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.warm,
    opacity: 0.1,
    left: -80,
    bottom: -100,
  },
  heroContent: {
    flex: 1.25,
    width: "100%",
    zIndex: 2,
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(56, 214, 210, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(56, 214, 210, 0.35)",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginBottom: 20,
  },
  heroBadgeText: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: Platform.OS === "web" ? 43 : 34,
    lineHeight: Platform.OS === "web" ? 48 : 40,
    fontWeight: "900",
    letterSpacing: -1.4,
    maxWidth: 610,
  },
  heroDescription: {
    color: "#B8CCD4",
    fontSize: 16,
    lineHeight: 25,
    marginTop: 17,
    maxWidth: 570,
  },
  heroActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 28,
  },
  primaryButton: {
    ...visualShadows.button,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    borderRadius: 15,
    backgroundColor: colors.cyan,
    paddingHorizontal: 22,
  },
  primaryButtonText: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: "900",
  },
  primaryButtonArrow: {
    color: colors.navy,
    fontSize: 20,
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 20,
  },
  secondaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  ticketPreview: {
    width: Platform.OS === "web" ? 300 : "100%",
    minHeight: 300,
    borderRadius: 22,
    backgroundColor: "#FFF8ED",
    padding: 22,
    transform: Platform.OS === "web" ? [{ rotate: "3deg" }] : [],
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
    zIndex: 2,
  },
  ticketTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  ticketLabel: {
    color: colors.cyanDark,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  ticketDate: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "900",
  },
  ticketDivider: {
    borderBottomWidth: 1,
    borderStyle: "dashed",
    borderColor: "#D4C5AE",
    marginVertical: 20,
  },
  ticketEvent: {
    color: colors.navy,
    fontSize: 31,
    lineHeight: 32,
    fontWeight: "900",
    letterSpacing: -1,
  },
  ticketFooter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 28,
  },
  ticketFooterText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  qrMock: {
    width: 45,
    height: 45,
    borderRadius: 8,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  qrMockText: {
    color: "#FFFFFF",
    fontSize: 29,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    marginTop: 46,
    marginBottom: 20,
  },
  sectionEyebrow: {
    color: colors.cyanDark,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  seeAllText: {
    color: colors.cyanDark,
    fontSize: 13,
    fontWeight: "900",
    paddingVertical: 8,
  },
  categoriesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  categoryCard: {
    ...visualShadows.card,
    flexGrow: 1,
    flexBasis: Platform.OS === "web" ? 230 : 145,
    minHeight: 174,
    backgroundColor: colors.surface,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
  },
  categoryIcon: {
    width: 47,
    height: 47,
    borderRadius: 15,
    backgroundColor: "#E8F9F8",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 17,
  },
  categoryEmoji: {
    fontSize: 23,
  },
  categoryTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900",
  },
  categorySubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  processSection: {
    marginTop: 50,
  },
  stepsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 20,
  },
  stepCard: {
    ...visualShadows.card,
    flexGrow: 1,
    flexBasis: 220,
    borderTopWidth: 3,
    borderTopColor: colors.cyan,
    backgroundColor: colors.surface,
    borderRadius: 19,
    padding: 20,
  },
  stepNumber: {
    color: colors.cyanDark,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  stepTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 13,
  },
  stepDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  bottomBanner: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    backgroundColor: "#DFF7F6",
    borderRadius: 24,
    padding: 25,
    marginTop: 42,
  },
  bottomBannerText: {
    flex: 1,
    minWidth: 220,
  },
  bottomBannerTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  bottomBannerDescription: {
    color: "#BFD0D7",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  bannerButton: {
    backgroundColor: colors.navy,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  bannerButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.76,
    transform: [{ scale: 0.985 }],
  },
});
