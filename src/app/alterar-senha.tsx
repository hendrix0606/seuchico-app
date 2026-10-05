import { Redirect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../context/auth-context";
import { isStrongPassword, STRONG_PASSWORD_HINT } from "../lib/passwords";
import { routeForRole } from "../lib/role-routes";
import { supabase } from "../lib/supabase";
import { visualShadows } from "../constants/visual-style";

type Feedback = { tone: "success" | "error"; text: string } | null;

export default function ChangeTemporaryPasswordScreen() {
  const router = useRouter();
  const { session, profile, isLoading, refreshProfile, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#087E83" size="large" />
        <Text style={styles.loadingText}>Verificando seu acesso...</Text>
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;
  if (!profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.profileErrorTitle}>Perfil indisponível</Text>
        <Text style={styles.loadingText}>Não foi possível validar o primeiro acesso.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void handleSignOut()}
          style={({ pressed }) => [styles.exitButton, pressed && styles.pressed]}
        >
          <Text style={styles.exitButtonText}>Voltar ao login</Text>
        </Pressable>
      </View>
    );
  }
  if (profile && !profile.must_change_password) {
    return <Redirect href={routeForRole(profile.role)} />;
  }

  const handleChangePassword = async () => {
    setFeedback(null);

    if (!isStrongPassword(password)) {
      setFeedback({
        tone: "error",
        text: `Crie uma senha com ${STRONG_PASSWORD_HINT}`,
      });
      return;
    }
    if (password !== confirmation) {
      setFeedback({ tone: "error", text: "A confirmação está diferente da nova senha." });
      return;
    }

    setIsSaving(true);
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setFeedback({ tone: "error", text: "Não foi possível atualizar a senha. Tente uma senha diferente." });
      setIsSaving(false);
      return;
    }

    const { error: profileError } = await supabase.rpc("complete_temporary_password_change");
    if (profileError) {
      setFeedback({
        tone: "error",
        text: "A senha foi atualizada, mas o primeiro acesso não foi concluído. Pressione o botão novamente.",
      });
      setIsSaving(false);
      return;
    }

    await refreshProfile();
    setFeedback({ tone: "success", text: "Senha criada com segurança. Abrindo sua área..." });
    setIsSaving(false);
    router.replace(routeForRole(profile?.role));
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.brandIcon}><Text style={styles.brandIconText}>SC</Text></View>
          <Text style={styles.eyebrow}>PRIMEIRO ACESSO</Text>
          <Text style={styles.title}>Crie sua senha</Text>
          <Text style={styles.description}>
            A senha recebida do administrador era temporária. Antes de entrar, escolha uma senha pessoal que somente você conheça.
          </Text>

          <View style={styles.securityCard}>
            <Text style={styles.securityTitle}>SUA SENHA PRECISA TER</Text>
            <Text style={styles.securityText}>10 ou mais caracteres · maiúscula · minúscula · número · símbolo</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Nova senha</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="new-password"
                onChangeText={setPassword}
                placeholder="Digite sua nova senha"
                placeholderTextColor="#91A4AD"
                secureTextEntry
                style={styles.input}
                value={password}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Confirmar nova senha</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="new-password"
                onChangeText={setConfirmation}
                placeholder="Digite a senha novamente"
                placeholderTextColor="#91A4AD"
                secureTextEntry
                style={styles.input}
                value={confirmation}
              />
            </View>

            {feedback ? (
              <View accessibilityLiveRegion="polite" style={feedback.tone === "success" ? styles.successCard : styles.errorCard}>
                <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>{feedback.text}</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => void handleChangePassword()}
              style={({ pressed }) => [styles.primaryButton, isSaving && styles.disabled, pressed && styles.pressed]}
            >
              {isSaving ? <ActivityIndicator color="#071D2D" size="small" /> : null}
              <Text style={styles.primaryButtonText}>{isSaving ? "Salvando..." : "Salvar minha nova senha"}</Text>
              {!isSaving ? <Text style={styles.primaryButtonArrow}>→</Text> : null}
            </Pressable>

            <Pressable accessibilityRole="button" onPress={() => void handleSignOut()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>Sair e fazer isso depois</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFF7F3" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 13, backgroundColor: "#FFF7F3" },
  loadingText: { color: "#627D8A", fontSize: 13, fontWeight: "700" },
  profileErrorTitle: { color: "#8A3325", fontSize: 20, fontWeight: "900" },
  exitButton: { borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 18, paddingVertical: 12 },
  exitButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  scrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: { ...visualShadows.raised, width: "100%", maxWidth: 590, borderRadius: 28, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: Platform.OS === "web" ? 40 : 24, marginVertical: 20 },
  brandIcon: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#071D2D", marginBottom: 24 },
  brandIconText: { color: "#38D6D2", fontSize: 15, fontWeight: "900" },
  eyebrow: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: "#102A43", fontSize: 31, lineHeight: 38, fontWeight: "900", letterSpacing: -1, marginTop: 8 },
  description: { color: "#627D8A", fontSize: 13, lineHeight: 21, marginTop: 9 },
  securityCard: { borderRadius: 14, backgroundColor: "#EFFAFA", padding: 14, marginTop: 20 },
  securityTitle: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  securityText: { color: "#486876", fontSize: 10, lineHeight: 17, marginTop: 5 },
  form: { gap: 16, marginTop: 24 },
  fieldGroup: { gap: 8 },
  label: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  input: { height: 53, borderRadius: 14, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#F9FBFC", color: "#102A43", fontSize: 14, paddingHorizontal: 16 },
  successCard: { borderRadius: 14, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 13 },
  successText: { color: "#176A50", fontSize: 11, lineHeight: 17, fontWeight: "800", textAlign: "center" },
  errorCard: { borderRadius: 14, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 13 },
  errorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800", textAlign: "center" },
  primaryButton: { ...visualShadows.button, minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 15, backgroundColor: "#38D6D2", paddingHorizontal: 16 },
  primaryButtonText: { color: "#071D2D", fontSize: 13, fontWeight: "900" },
  primaryButtonArrow: { color: "#071D2D", fontSize: 20, fontWeight: "900" },
  secondaryButton: { minHeight: 49, alignItems: "center", justifyContent: "center", borderRadius: 14, borderWidth: 1, borderColor: "#D4E1E5" },
  secondaryButtonText: { color: "#627D8A", fontSize: 11, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
});
