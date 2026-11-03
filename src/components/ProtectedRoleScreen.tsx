import { Redirect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BrandLogo } from "./BrandMark";
import { useAppearance } from "../context/appearance-context";
import { UserRole, useAuth } from "../context/auth-context";
import { visualShadows } from "../constants/visual-style";
import { roleLabel, routeForRole } from "../lib/role-routes";

type ProtectedRoleScreenProps = PropsWithChildren<{
  eyebrow: string;
  requiredRole: UserRole | UserRole[];
  subtitle: string;
  title: string;
}>;

export function ProtectedRoleScreen({
  children,
  eyebrow,
  requiredRole,
  subtitle,
  title,
}: ProtectedRoleScreenProps) {
  const router = useRouter();
  const { appearance } = useAppearance();
  const { session, profile, isLoading, profileError, refreshProfile, signOut } =
    useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: appearance.background_color }]}>
        <ActivityIndicator color={appearance.secondary_color} size="large" />
        <Text style={styles.loadingText}>Carregando sua conta...</Text>
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  const hasRequiredRole = profile
    ? Array.isArray(requiredRole)
      ? requiredRole.includes(profile.role)
      : profile.role === requiredRole
    : false;

  if (profile && !hasRequiredRole) {
    return <Redirect href={routeForRole(profile.role)} />;
  }

  if (profile?.must_change_password) {
    return <Redirect href="/alterar-senha" />;
  }

  const handleSignOut = async () => {
    setIsSigningOut(true);

    try {
      await signOut();
      router.replace("/");
    } catch {
      Alert.alert("Não foi possível sair", "Tente novamente em instantes.");
      setIsSigningOut(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: appearance.background_color }]}>
      <StatusBar style="dark" />

      <View
        pointerEvents="none"
        style={[
          styles.backgroundOrb,
          styles.backgroundOrbTop,
          { backgroundColor: appearance.accent_color },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.backgroundOrb,
          styles.backgroundOrbBottom,
          { backgroundColor: appearance.secondary_color },
        ]}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollLayer}
      >
        <View style={styles.page}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/")}
              style={({ pressed }) => [
                styles.brand,
                pressed && styles.pressed,
              ]}
            >
              {appearance.logo_url ? (
                <>
                  <View style={[styles.brandIcon, { backgroundColor: appearance.primary_color }]}>
                    <Image
                      resizeMode="contain"
                      source={{ uri: appearance.logo_url }}
                      style={styles.brandLogo}
                    />
                  </View>
                  <View>
                    <Text style={[styles.brandName, { color: appearance.primary_color }]}>
                      {appearance.brand_name}
                    </Text>
                    <Text style={[styles.brandTagline, { color: appearance.secondary_color }]}>
                      {appearance.tagline}
                    </Text>
                  </View>
                </>
              ) : (
                <BrandLogo height={72} />
              )}
            </Pressable>

            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/perfil")}
                style={({ pressed }) => [
                  styles.profileButton,
                  { backgroundColor: `${appearance.accent_color}22` },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.profileButtonText, { color: appearance.secondary_color }]}>Perfil</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isSigningOut}
                onPress={handleSignOut}
                style={({ pressed }) => [
                  styles.signOutButton,
                  isSigningOut && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.signOutButtonText, { color: appearance.primary_color }]}>
                  {isSigningOut ? "Saindo..." : "Sair"}
                </Text>
              </Pressable>
            </View>
          </View>

          {profileError || !profile ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Perfil indisponível</Text>
              <Text style={styles.errorText}>
                {profileError ??
                  "Seu usuário existe, mas o perfil ainda não foi encontrado."}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refreshProfile()}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.retryButtonText}>Tentar novamente</Text>
              </Pressable>
            </View>
          ) : !profile.is_active ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Conta desativada</Text>
              <Text style={styles.errorText}>
                Seu acesso foi desativado. Entre em contato com a equipe do
                SeuChico se precisar de ajuda.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={handleSignOut}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.retryButtonText}>Sair da conta</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={[styles.welcomeCard, { backgroundColor: appearance.primary_color }]}>
                {appearance.hero_image_url ? (
                  <>
                    <Image
                      resizeMode="cover"
                      source={{ uri: appearance.hero_image_url }}
                      style={styles.welcomeImage}
                    />
                    <View style={styles.welcomeImageOverlay} />
                  </>
                ) : null}
                <View style={styles.welcomeContent}>
                  <Text style={[styles.eyebrow, { color: appearance.accent_color }]}>{eyebrow}</Text>
                  <Text style={styles.title}>
                    {title}, {firstName(profile.full_name)}!
                  </Text>
                  <Text style={styles.subtitle}>{subtitle}</Text>
                </View>

                <View style={styles.accountCard}>
                  <View style={[styles.avatar, { backgroundColor: appearance.accent_color }]}>
                    <Text style={[styles.avatarText, { color: appearance.primary_color }]}>
                      {initials(profile.full_name)}
                    </Text>
                  </View>
                  <View style={styles.accountText}>
                    <Text numberOfLines={1} style={styles.accountName}>
                      {profile.full_name}
                    </Text>
                    <Text style={styles.accountRole}>
                      {roleLabel(profile.role)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: appearance.accent_color },
                      !profile.is_active && styles.statusDotInactive,
                    ]}
                  />
                </View>
              </View>

              {children}

              <Text style={styles.securityNote}>
                Área protegida: apenas usuários autenticados com o perfil correto
                podem visualizar esta tela.
              </Text>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

export function DashboardGrid({ children }: PropsWithChildren) {
  return <View style={styles.dashboardGrid}>{children}</View>;
}

type DashboardCardProps = {
  accent?: "cyan" | "warm";
  description: string;
  icon: string;
  onPress?: () => void;
  title: string;
};

export function DashboardCard({
  accent = "cyan",
  description,
  icon,
  onPress,
  title,
}: DashboardCardProps) {
  const { appearance } = useAppearance();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.dashboardCard,
        pressed && onPress && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.dashboardIcon,
          { backgroundColor: `${appearance.accent_color}22` },
          accent === "warm" && styles.dashboardIconWarm,
        ]}
      >
        <Text style={styles.dashboardIconText}>{icon}</Text>
      </View>
      <Text style={styles.dashboardTitle}>{title}</Text>
      <Text style={styles.dashboardDescription}>{description}</Text>
      <Text style={[styles.dashboardArrow, { color: appearance.secondary_color }]}>→</Text>
    </Pressable>
  );
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "bem-vindo";
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? "S"}${words[1]?.[0] ?? "C"}`.toUpperCase();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#F3F7F8",
  },
  scrollLayer: { zIndex: 1 },
  backgroundOrb: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
    opacity: 0.09,
  },
  backgroundOrbTop: { right: -150, top: 80 },
  backgroundOrbBottom: { left: -180, bottom: 30 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#F3F7F8",
  },
  loadingText: { color: "#627D8A", fontSize: 14, fontWeight: "700" },
  scrollContent: { paddingBottom: 48 },
  page: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "web" ? 28 : 58,
  },
  header: {
    ...visualShadows.subtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "rgba(220, 231, 234, 0.92)",
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    padding: 12,
    marginBottom: 18,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandIcon: {
    width: 45,
    height: 45,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#071D2D",
  },
  brandIconText: { color: "#38D6D2", fontSize: 14, fontWeight: "900" },
  brandLogo: { width: 35, height: 35, borderRadius: 10 },
  brandName: { color: "#102A43", fontSize: 20, fontWeight: "900" },
  brandTagline: {
    color: "#087E83",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  profileButton: {
    minWidth: 76,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#E9F8F8",
  },
  profileButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  signOutButton: {
    minWidth: 82,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D4E1E5",
    backgroundColor: "#FFFFFF",
  },
  signOutButtonText: { color: "#102A43", fontSize: 13, fontWeight: "900" },
  welcomeCard: {
    ...visualShadows.hero,
    overflow: "hidden",
    flexDirection: Platform.OS === "web" ? "row" : "column",
    alignItems: Platform.OS === "web" ? "center" : "stretch",
    justifyContent: "space-between",
    gap: 28,
    minHeight: 235,
    borderRadius: 30,
    padding: Platform.OS === "web" ? 38 : 25,
    backgroundColor: "#071D2D",
  },
  welcomeImage: {
    ...StyleSheet.absoluteFill,
    width: undefined,
    height: undefined,
  },
  welcomeImageOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(3, 18, 30, 0.68)",
  },
  welcomeContent: { flex: 1, maxWidth: 650, zIndex: 1 },
  eyebrow: {
    color: "#38D6D2",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  title: {
    color: "#FFFFFF",
    fontSize: Platform.OS === "web" ? 36 : 30,
    lineHeight: Platform.OS === "web" ? 42 : 36,
    fontWeight: "900",
    letterSpacing: -1.1,
    marginTop: 10,
  },
  subtitle: {
    color: "#BFD0D7",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
  },
  accountCard: {
    ...visualShadows.subtle,
    minWidth: Platform.OS === "web" ? 265 : undefined,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#264455",
    backgroundColor: "#102D3D",
    padding: 15,
    zIndex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#38D6D2",
  },
  avatarText: { color: "#071D2D", fontSize: 14, fontWeight: "900" },
  accountText: { flex: 1 },
  accountName: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  accountRole: { color: "#A9C0C9", fontSize: 11, marginTop: 3 },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#38D6D2",
  },
  statusDotInactive: { backgroundColor: "#FF8B7A" },
  dashboardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 22,
  },
  dashboardCard: {
    ...visualShadows.card,
    minWidth: Platform.OS === "web" ? 240 : "100%",
    flexBasis: Platform.OS === "web" ? "31%" : "100%",
    flexGrow: 1,
    minHeight: 185,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#D7E5E8",
    backgroundColor: "#FFFFFF",
    padding: 21,
  },
  dashboardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5FAF9",
  },
  dashboardIconWarm: { backgroundColor: "#FFF0DE" },
  dashboardIconText: { fontSize: 20 },
  dashboardTitle: {
    color: "#102A43",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 16,
  },
  dashboardDescription: {
    color: "#627D8A",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    paddingRight: 24,
  },
  dashboardArrow: {
    position: "absolute",
    right: 20,
    bottom: 18,
    color: "#087E83",
    fontSize: 21,
    fontWeight: "900",
  },
  securityNote: {
    color: "#8298A2",
    fontSize: 10,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 24,
  },
  errorCard: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#FFD1C9",
    backgroundColor: "#FFF8F6",
    padding: 32,
  },
  errorTitle: { color: "#8A3325", fontSize: 20, fontWeight: "900" },
  errorText: {
    color: "#8A5A52",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
  },
  retryButton: {
    borderRadius: 13,
    backgroundColor: "#071D2D",
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 18,
  },
  retryButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
});
