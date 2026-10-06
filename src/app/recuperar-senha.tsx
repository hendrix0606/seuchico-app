import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
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
import { passwordRecoveryRedirectUrl } from "../lib/auth-redirects";
import { supabase } from "../lib/supabase";
import { BrandMark } from "../components/BrandMark";
import { visualShadows } from "../constants/visual-style";

type Feedback = { tone: "success" | "error"; text: string } | null;

export default function RecoverPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const handleSend = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    setFeedback(null);

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setFeedback({ tone: "error", text: "Digite um endereço de e-mail válido." });
      return;
    }

    setIsSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: passwordRecoveryRedirectUrl(),
    });
    setIsSending(false);

    if (error) {
      const rateLimited = error.message.toLowerCase().includes("rate limit");
      setFeedback({
        tone: "error",
        text: rateLimited
          ? "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente."
          : "Não foi possível enviar o e-mail agora. Confira sua internet e tente novamente.",
      });
      return;
    }

    setSent(true);
    setFeedback({
      tone: "success",
      text: "Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha.",
    });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Pressable accessibilityRole="button" onPress={() => router.replace("/login")} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Text style={styles.backButtonText}>← Voltar ao login</Text>
          </Pressable>

          <BrandMark size={50} style={styles.brandMark} />
          <Text style={styles.eyebrow}>RECUPERAÇÃO DE ACESSO</Text>
          <Text style={styles.title}>Esqueceu sua senha?</Text>
          <Text style={styles.description}>
            Informe o e-mail da conta. Enviaremos um link seguro para você definir uma nova senha.
          </Text>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>E-mail</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                editable={!sent}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="voce@email.com"
                placeholderTextColor="#91A4AD"
                style={[styles.input, sent && styles.disabled]}
                value={email}
              />
            </View>

            {feedback ? (
              <View accessibilityLiveRegion="polite" style={feedback.tone === "success" ? styles.successCard : styles.errorCard}>
                <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>{feedback.text}</Text>
              </View>
            ) : null}

            {!sent ? (
              <Pressable accessibilityRole="button" disabled={isSending} onPress={() => void handleSend()} style={({ pressed }) => [styles.primaryButton, isSending && styles.disabled, pressed && styles.pressed]}>
                {isSending ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                <Text style={styles.primaryButtonText}>{isSending ? "Enviando..." : "Enviar link seguro"}</Text>
                {!isSending ? <Text style={styles.primaryButtonArrow}>→</Text> : null}
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => router.replace("/login")} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonText}>Voltar ao login</Text>
                <Text style={styles.primaryButtonArrow}>→</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.securityCard}>
            <Text style={styles.securityTitle}>SEGURANÇA</Text>
            <Text style={styles.securityText}>A mensagem é igual mesmo quando o e-mail não existe, evitando a exposição de contas cadastradas.</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFF7F3" },
  scrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: { ...visualShadows.raised, width: "100%", maxWidth: 590, borderRadius: 28, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: Platform.OS === "web" ? 40 : 24, marginVertical: 20 },
  backButton: { alignSelf: "flex-start", paddingVertical: 8, marginBottom: 22 },
  backButtonText: { color: "#087E83", fontSize: 13, fontWeight: "800" },
  brandMark: { marginBottom: 24 },
  eyebrow: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: "#102A43", fontSize: 31, lineHeight: 38, fontWeight: "900", letterSpacing: -1, marginTop: 8 },
  description: { color: "#627D8A", fontSize: 13, lineHeight: 21, marginTop: 9 },
  form: { gap: 16, marginTop: 25 },
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
  securityCard: { borderRadius: 14, backgroundColor: "#EFFAFA", padding: 14, marginTop: 20 },
  securityTitle: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  securityText: { color: "#486876", fontSize: 10, lineHeight: 17, marginTop: 5 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
});
