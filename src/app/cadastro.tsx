import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
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
import { BrandMark } from "../components/BrandMark";
import { visualShadows } from "../constants/visual-style";
import { isStrongPassword, STRONG_PASSWORD_HINT } from "../lib/passwords";

type Feedback = { tone: "success" | "error"; text: string } | null;

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [registrationComplete, setRegistrationComplete] = useState(false);

  const handleRegister = async () => {
    setFeedback(null);

    if (
      ![name, email, phone, password, confirmation].every((value) =>
        value.trim(),
      )
    ) {
      setFeedback({
        tone: "error",
        text: "Preencha todos os campos para continuar.",
      });
      return;
    }

    if (!isStrongPassword(password)) {
      setFeedback({ tone: "error", text: `Use uma senha com ${STRONG_PASSWORD_HINT}` });
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFeedback({ tone: "error", text: "Digite um endereço de e-mail válido." });
      return;
    }

    if (password !== confirmation) {
      setFeedback({
        tone: "error",
        text: "A confirmação precisa ser exatamente igual à senha.",
      });
      return;
    }

    setIsLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          full_name: name.trim(),
          phone: phone.replace(/\D/g, ""),
        },
      },
    });

    setIsLoading(false);

    if (error) {
      setFeedback({ tone: "error", text: translateRegisterError(error.message) });
      return;
    }

    if (!data.session) {
      setPassword("");
      setConfirmation("");
      setRegistrationComplete(true);
      setFeedback({
        tone: "success",
        text: "Cadastro realizado! Enviamos uma confirmação para seu e-mail. Confirme a mensagem antes de entrar.",
      });
      return;
    }

    router.replace("/cliente");
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
            <Text style={styles.backButtonText}>← Voltar ao login</Text>
          </Pressable>

          <View style={styles.heading}>
            <BrandMark size={50} style={styles.brandMark} />
            <Text style={styles.eyebrow}>CONTA DE CLIENTE</Text>
            <Text style={styles.title}>Vamos começar?</Text>
            <Text style={styles.description}>
              Crie sua conta de cliente para personalizar ingressos e
              acompanhar os pedidos. Entregadores recebem o acesso do
              administrador.
            </Text>
          </View>

          <View style={styles.form}>
            <InputField
              autoCapitalize="words"
              label="Nome completo"
              onChangeText={setName}
              placeholder="Seu nome"
              value={name}
            />
            <InputField
              autoCapitalize="none"
              keyboardType="email-address"
              label="E-mail"
              onChangeText={setEmail}
              placeholder="voce@email.com"
              value={email}
            />
            <InputField
              keyboardType="phone-pad"
              label="Telefone"
              onChangeText={setPhone}
              placeholder="(61) 99999-9999"
              value={phone}
            />
            <InputField
              autoCapitalize="none"
              label="Senha"
              onChangeText={setPassword}
              placeholder="Crie uma senha forte"
              secureTextEntry
              value={password}
            />
            <InputField
              autoCapitalize="none"
              label="Confirmar senha"
              onChangeText={setConfirmation}
              placeholder="Digite a senha novamente"
              secureTextEntry
              value={confirmation}
            />

            <View style={styles.termsBlock}>
              <Text style={styles.termsText}>Ao criar a conta, você concorda com:</Text>
              <View style={styles.termsLinks}>
                <Pressable accessibilityRole="link" onPress={() => router.push("/termos")}>
                  <Text style={styles.termsLink}>Termos de Uso</Text>
                </Pressable>
                <Text style={styles.termsText}>e</Text>
                <Pressable accessibilityRole="link" onPress={() => router.push("/privacidade")}>
                  <Text style={styles.termsLink}>Política de Privacidade</Text>
                </Pressable>
              </View>
            </View>

            {feedback ? (
              <View
                accessibilityLiveRegion="polite"
                style={feedback.tone === "success" ? styles.successCard : styles.errorCard}
              >
                <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>
                  {feedback.text}
                </Text>
              </View>
            ) : null}

            {registrationComplete ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace("/login")}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryButtonText}>Ir para o login</Text>
                <Text style={styles.primaryButtonArrow}>→</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                onPress={handleRegister}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isLoading && styles.buttonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isLoading ? "Criando conta..." : "Criar minha conta"}
                </Text>
                <Text style={styles.primaryButtonArrow}>→</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type InputFieldProps = {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address" | "phone-pad";
  label: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  value: string;
};

function InputField({ label, ...props }: InputFieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#91A4AD"
        style={styles.input}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFF7F3" },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    ...visualShadows.raised,
    width: "100%",
    maxWidth: 650,
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    padding: Platform.OS === "web" ? 40 : 24,
    marginVertical: 20,
  },
  backButton: { alignSelf: "flex-start", paddingVertical: 8 },
  backButtonText: { color: "#087E83", fontSize: 13, fontWeight: "800" },
  heading: { alignItems: "center", marginTop: 16 },
  brandMark: { marginBottom: 20 },
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
  description: {
    color: "#627D8A",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 450,
    marginTop: 9,
  },
  form: { gap: 17, marginTop: 30 },
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
  termsText: {
    color: "#8298A2",
    fontSize: 10,
    lineHeight: 16,
    textAlign: "center",
  },
  termsBlock: { alignItems: "center", gap: 4 },
  termsLinks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 5 },
  termsLink: { color: "#087E83", fontSize: 10, lineHeight: 16, fontWeight: "900" },
  successCard: { borderRadius: 14, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 13 },
  successText: { color: "#176A50", fontSize: 11, lineHeight: 17, fontWeight: "800", textAlign: "center" },
  errorCard: { borderRadius: 14, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 13 },
  errorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800", textAlign: "center" },
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
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.55 },
});

function translateRegisterError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("already registered")) {
    return "Já existe uma conta com este e-mail.";
  }

  if (normalizedMessage.includes("password")) {
    return "A senha não atende aos requisitos de segurança.";
  }

  if (normalizedMessage.includes("rate limit")) {
    return "Muitas tentativas seguidas. Aguarde alguns minutos.";
  }

  if (normalizedMessage.includes("network")) {
    return "Não foi possível conectar ao servidor. Confira sua internet.";
  }

  return "Confira os dados e tente novamente.";
}
