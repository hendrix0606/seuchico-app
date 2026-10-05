import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import { isStrongPassword, STRONG_PASSWORD_HINT } from "../lib/passwords";
import { supabase } from "../lib/supabase";
import { visualShadows } from "../constants/visual-style";

type Feedback = { tone: "success" | "error"; text: string } | null;

function clearRecoveryTokenFromAddressBar() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.history.replaceState(null, "", window.location.pathname);
  }
}

export default function NewPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isChecking, setIsChecking] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [canChange, setCanChange] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let active = true;

    const prepareRecovery = async () => {
      // No navegador, o cliente do Supabase pode trocar o código PKCE por uma
      // sessão automaticamente antes deste efeito executar. Verificamos a
      // sessão primeiro para não tentar consumir o mesmo código duas vezes.
      const { data: currentSession } = await supabase.auth.getSession();
      if (currentSession.session) {
        clearRecoveryTokenFromAddressBar();
        if (active) {
          setCanChange(true);
          setIsChecking(false);
        }
        return;
      }

      let code = Array.isArray(params.code) ? params.code[0] : params.code;
      if (!code) {
        const initialUrl = await Linking.getInitialURL();
        const parsedCode = initialUrl ? Linking.parse(initialUrl).queryParams?.code : undefined;
        code = typeof parsedCode === "string" ? parsedCode : undefined;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          clearRecoveryTokenFromAddressBar();
          if (active) {
            setCanChange(true);
            setIsChecking(false);
          }
          return;
        }

        // A inicialização automática e este efeito podem terminar quase ao
        // mesmo tempo. Se a sessão já existir, o link foi validado com sucesso.
        const { data: recoveredSession } = await supabase.auth.getSession();
        if (recoveredSession.session) {
          clearRecoveryTokenFromAddressBar();
          if (active) {
            setCanChange(true);
            setIsChecking(false);
          }
          return;
        }

        if (active) {
          setFeedback({ tone: "error", text: "Este link é inválido ou expirou. Solicite um novo e-mail de recuperação." });
          setIsChecking(false);
        }
        return;
      }

      if (active) {
        setFeedback({ tone: "error", text: "Este link é inválido ou expirou. Solicite um novo e-mail de recuperação." });
        setIsChecking(false);
      }
    };

    void prepareRecovery();
    return () => { active = false; };
  }, [params.code]);

  const handleSave = async () => {
    setFeedback(null);
    if (!isStrongPassword(password)) {
      setFeedback({ tone: "error", text: `Use uma senha com ${STRONG_PASSWORD_HINT}` });
      return;
    }
    if (password !== confirmation) {
      setFeedback({ tone: "error", text: "A confirmação está diferente da nova senha." });
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setFeedback({ tone: "error", text: "Não foi possível atualizar a senha. Solicite um novo link e tente novamente." });
      setIsSaving(false);
      return;
    }

    await supabase.auth.signOut();
    setPassword("");
    setConfirmation("");
    setCompleted(true);
    setCanChange(false);
    setFeedback({ tone: "success", text: "Senha atualizada com segurança. Entre novamente usando a nova senha." });
    setIsSaving(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.brandIcon}><Text style={styles.brandIconText}>SC</Text></View>
          <Text style={styles.eyebrow}>ACESSO SEGURO</Text>
          <Text style={styles.title}>Crie uma nova senha</Text>
          <Text style={styles.description}>A nova senha substituirá a anterior em todos os dispositivos.</Text>

          <View style={styles.securityCard}>
            <Text style={styles.securityTitle}>SUA SENHA PRECISA TER</Text>
            <Text style={styles.securityText}>10 ou mais caracteres · maiúscula · minúscula · número · símbolo</Text>
          </View>

          {isChecking ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#087E83" /><Text style={styles.loadingText}>Validando o link...</Text></View>
          ) : null}

          {canChange ? (
            <View style={styles.form}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Nova senha</Text>
                <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setPassword} placeholder="Digite sua nova senha" placeholderTextColor="#91A4AD" secureTextEntry style={styles.input} value={password} />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Confirmar nova senha</Text>
                <TextInput autoCapitalize="none" autoComplete="new-password" onChangeText={setConfirmation} placeholder="Digite a senha novamente" placeholderTextColor="#91A4AD" secureTextEntry style={styles.input} value={confirmation} />
              </View>
              {feedback ? <FeedbackCard feedback={feedback} /> : null}
              <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => void handleSave()} style={({ pressed }) => [styles.primaryButton, isSaving && styles.disabled, pressed && styles.pressed]}>
                {isSaving ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                <Text style={styles.primaryButtonText}>{isSaving ? "Salvando..." : "Salvar nova senha"}</Text>
                {!isSaving ? <Text style={styles.primaryButtonArrow}>→</Text> : null}
              </Pressable>
            </View>
          ) : null}

          {!isChecking && !canChange ? (
            <View style={styles.form}>
              {feedback ? <FeedbackCard feedback={feedback} /> : null}
              <Pressable accessibilityRole="button" onPress={() => router.replace(completed ? "/login" : "/recuperar-senha")} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonText}>{completed ? "Ir para o login" : "Solicitar novo link"}</Text>
                <Text style={styles.primaryButtonArrow}>→</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FeedbackCard({ feedback }: { feedback: Exclude<Feedback, null> }) {
  return (
    <View accessibilityLiveRegion="polite" style={feedback.tone === "success" ? styles.successCard : styles.errorCard}>
      <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>{feedback.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFF7F3" },
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
  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 26 },
  loadingText: { color: "#627D8A", fontSize: 12, fontWeight: "800" },
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
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
});
