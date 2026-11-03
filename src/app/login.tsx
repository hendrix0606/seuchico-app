import { StatusBar } from "expo-status-bar";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import type { UserRole } from "../context/auth-context";
import { BrandMark, useHasCustomLogo } from "../components/BrandMark";
import { visualShadows } from "../constants/visual-style";
import { routeForRole } from "../lib/role-routes";

type Feedback = { tone: "error" | "info"; text: string } | null;

export default function LoginScreen() {
  const router = useRouter();
  const hasCustomLogo = useHasCustomLogo();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const handleLogin = async () => {
    setFeedback(null);

    if (!email.trim() || !password.trim()) {
      setFeedback({ tone: "error", text: "Preencha seu e-mail e sua senha." });
      return;
    }

    setIsLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      setIsLoading(false);
      setFeedback({ tone: "error", text: translateAuthError(error.message) });
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("role, must_change_password")
      .eq("id", data.user.id)
      .single();

    setIsLoading(false);

    if (profileError || !profileData) {
      setFeedback({
        tone: "error",
        text: "A conta entrou, mas o perfil não foi encontrado. Tente novamente em instantes.",
      });
      return;
    }

    if (profileData.must_change_password) {
      router.replace("/alterar-senha");
      return;
    }

    router.replace(routeForRole(profileData.role as UserRole | undefined));
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <StatusBar style="dark" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.backButtonText}>← Voltar</Text>
          </Pressable>

          <View style={styles.brand}>
            <BrandMark size={hasCustomLogo ? 43 : 66} />
            {hasCustomLogo ? (
              <View>
                <Text style={styles.brandName}>SeuChico</Text>
                <Text style={styles.brandTagline}>INGRESSOS PERSONALIZADOS</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>BEM-VINDO DE VOLTA</Text>
            <Text style={styles.title}>Entre na sua conta</Text>
            <Text style={styles.description}>
              Acompanhe pedidos, edite seus ingressos e consulte suas entregas.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>E-mail</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="voce@email.com"
                placeholderTextColor="#91A4AD"
                style={styles.input}
                value={email}
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.passwordLabelRow}>
                <Text style={styles.label}>Senha</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/recuperar-senha")}
                >
                  <Text style={styles.forgotText}>Esqueci minha senha</Text>
                </Pressable>
              </View>

              <View style={styles.passwordField}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="current-password"
                  onChangeText={setPassword}
                  placeholder="Digite sua senha"
                  placeholderTextColor="#91A4AD"
                  secureTextEntry={!showPassword}
                  style={styles.passwordInput}
                  value={password}
                />
                <Pressable
                  accessibilityLabel={
                    showPassword ? "Ocultar senha" : "Mostrar senha"
                  }
                  onPress={() => setShowPassword((current) => !current)}
                  style={styles.showPasswordButton}
                >
                  <Text style={styles.showPasswordText}>
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </Text>
                </Pressable>
              </View>
            </View>

            {feedback ? (
              <View
                accessibilityLiveRegion="polite"
                style={feedback.tone === "error" ? styles.errorCard : styles.infoCard}
              >
                <Text style={feedback.tone === "error" ? styles.errorText : styles.infoText}>
                  {feedback.text}
                </Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={handleLogin}
              style={({ pressed }) => [
                styles.primaryButton,
                isLoading && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {isLoading ? "Entrando..." : "Entrar"}
              </Text>
              <Text style={styles.primaryButtonArrow}>→</Text>
            </Pressable>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>AINDA NÃO TEM CONTA?</Text>
            <View style={styles.divider} />
          </View>

          <Link href="/cadastro" asChild>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Criar minha conta</Text>
            </Pressable>
          </Link>

          <Text style={styles.helperText}>
            Entregadores e administradores utilizam os acessos fornecidos pela
            empresa.
          </Text>
        </View>

        <View style={styles.sidePanel}>
          <View style={styles.sideGlow} />
          <Text style={styles.sideEyebrow}>TUDO EM UM SÓ LUGAR</Text>
          <Text style={styles.sideTitle}>
            Da sua ideia até a porta da sua casa.
          </Text>
          <Text style={styles.sideDescription}>
            Personalize, aprove, compre e acompanhe a entrega dos seus ingressos
            físicos.
          </Text>

          <View style={styles.benefitList}>
            {[
              "Modelos para diferentes eventos",
              "Editor simples e visual",
              "Acompanhamento do pedido",
            ].map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <View style={styles.checkCircle}>
                  <Text style={styles.checkText}>✓</Text>
                </View>
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFF7F3" },
  scrollContent: {
    flexGrow: 1,
    flexDirection: Platform.OS === "web" ? "row" : "column",
    justifyContent: "center",
    alignItems: "stretch",
    padding: 20,
    gap: 18,
  },
  card: {
    ...visualShadows.raised,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    padding: Platform.OS === "web" ? 38 : 24,
  },
  backButton: { alignSelf: "flex-start", paddingVertical: 8, marginBottom: 20 },
  backButtonText: { color: "#087E83", fontSize: 13, fontWeight: "800" },
  brand: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandName: {
    color: "#102A43",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  brandTagline: {
    color: "#087E83",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  heading: { marginTop: 34 },
  eyebrow: {
    color: "#087E83",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  title: {
    color: "#102A43",
    fontSize: 31,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: 8,
  },
  description: { color: "#627D8A", fontSize: 14, lineHeight: 22, marginTop: 9 },
  form: { gap: 18, marginTop: 29 },
  fieldGroup: { gap: 8 },
  label: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  input: {
    height: 53,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D4E1E5",
    backgroundColor: "#F9FBFC",
    color: "#102A43",
    fontSize: 14,
    paddingHorizontal: 16,
  },
  passwordLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  forgotText: { color: "#087E83", fontSize: 11, fontWeight: "800" },
  passwordField: {
    minHeight: 53,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D4E1E5",
    backgroundColor: "#F9FBFC",
  },
  passwordInput: {
    flex: 1,
    height: 51,
    color: "#102A43",
    fontSize: 14,
    paddingHorizontal: 16,
  },
  showPasswordButton: { paddingHorizontal: 15, paddingVertical: 14 },
  showPasswordText: { color: "#087E83", fontSize: 11, fontWeight: "900" },
  errorCard: { borderRadius: 14, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 13 },
  errorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800", textAlign: "center" },
  infoCard: { borderRadius: 14, borderWidth: 1, borderColor: "#B8DFE2", backgroundColor: "#EFFAFA", padding: 13 },
  infoText: { color: "#087E83", fontSize: 11, lineHeight: 17, fontWeight: "800", textAlign: "center" },
  primaryButton: {
    ...visualShadows.button,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    borderRadius: 15,
    backgroundColor: "#38D6D2",
    marginTop: 2,
  },
  primaryButtonText: { color: "#071D2D", fontSize: 14, fontWeight: "900" },
  primaryButtonArrow: { color: "#071D2D", fontSize: 20, fontWeight: "900" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 24,
  },
  divider: { flex: 1, height: 1, backgroundColor: "#DCE7EA" },
  dividerText: {
    color: "#8298A2",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  secondaryButton: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#BCD1D6",
  },
  secondaryButtonText: { color: "#102A43", fontSize: 14, fontWeight: "900" },
  helperText: {
    color: "#8298A2",
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 18,
  },
  sidePanel: {
    ...visualShadows.hero,
    display: Platform.OS === "web" ? "flex" : "none",
    width: "100%",
    maxWidth: 450,
    minHeight: 670,
    alignSelf: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#071D2D",
    borderRadius: 28,
    padding: 42,
  },
  sideGlow: {
    position: "absolute",
    width: 290,
    height: 290,
    borderRadius: 145,
    backgroundColor: "#38D6D2",
    opacity: 0.12,
    right: -100,
    top: -80,
  },
  sideEyebrow: {
    color: "#38D6D2",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  sideTitle: {
    color: "#FFFFFF",
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "900",
    letterSpacing: -1.2,
    marginTop: 14,
  },
  sideDescription: {
    color: "#B8CCD4",
    fontSize: 14,
    lineHeight: 23,
    marginTop: 16,
  },
  benefitList: { gap: 15, marginTop: 35 },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(56,214,210,0.15)",
  },
  checkText: { color: "#38D6D2", fontWeight: "900" },
  benefitText: { color: "#E6F1F4", fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.55 },
});

function translateAuthError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }

  if (normalizedMessage.includes("network")) {
    return "Não foi possível conectar ao servidor. Confira sua internet.";
  }

  return "Tente novamente em alguns instantes.";
}
