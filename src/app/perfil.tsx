import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import {
  fetchOwnAvatarPath,
  removeOwnAvatar,
  saveOwnAvatar,
} from "../lib/avatar";
import { pickAvatarImage } from "../lib/file-upload";
import { roleLabel, routeForRole } from "../lib/role-routes";
import { supabase } from "../lib/supabase";

type Feedback = { tone: "success" | "error"; text: string } | null;

export default function ProfileScreen() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletionBusy, setIsDeletionBusy] = useState(false);
  const [hasPendingDeletion, setHasPendingDeletion] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [isAvatarAvailable, setIsAvatarAvailable] = useState(true);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const isClient = profile?.role === "client";

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !isClient) return;

    fetchOwnAvatarPath(userId)
      .then((path) => setAvatarPath(path))
      .catch(() => setIsAvatarAvailable(false));
  }, [session?.user.id, isClient]);

  const handlePickAvatar = async () => {
    const userId = session?.user.id;
    if (!userId || isAvatarBusy) return;
    setFeedback(null);

    let asset;
    try {
      asset = await pickAvatarImage();
    } catch {
      setFeedback({ tone: "error", text: "A foto precisa ter até 5 MB." });
      return;
    }
    if (!asset) return;

    setIsAvatarBusy(true);
    try {
      const path = await saveOwnAvatar(userId, asset, avatarPath);
      setAvatarPath(path);
      setFeedback({ tone: "success", text: "Foto atualizada com sucesso." });
    } catch {
      setFeedback({ tone: "error", text: "Não foi possível enviar a foto. Confirme o SQL da Etapa 16 e tente novamente." });
    }
    setIsAvatarBusy(false);
  };

  const handleRemoveAvatar = async () => {
    const userId = session?.user.id;
    if (!userId || !avatarPath || isAvatarBusy) return;
    setFeedback(null);
    setIsAvatarBusy(true);

    try {
      await removeOwnAvatar(userId, avatarPath);
      setAvatarPath(null);
      setFeedback({ tone: "success", text: "Foto removida." });
    } catch {
      setFeedback({ tone: "error", text: "Não foi possível remover a foto. Tente novamente." });
    }
    setIsAvatarBusy(false);
  };

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setPhone(formatPhone(profile?.phone ?? ""));
  }, [profile?.full_name, profile?.phone]);

  useEffect(() => {
    if (!session?.user.id) return;
    supabase
      .from("account_deletion_requests")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("status", "pending")
      .maybeSingle()
      .then(({ data }) => setHasPendingDeletion(Boolean(data)));
  }, [session?.user.id]);

  const handleSave = async () => {
    if (!session?.user.id) return;
    const normalizedPhone = phone.replace(/\D/g, "");
    setFeedback(null);

    if (fullName.trim().length < 2) {
      setFeedback({ tone: "error", text: "Digite seu nome completo." });
      return;
    }
    if (normalizedPhone.length < 10 || normalizedPhone.length > 13) {
      setFeedback({ tone: "error", text: "Digite um telefone válido com DDD." });
      return;
    }

    setIsSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), phone: normalizedPhone })
      .eq("id", session.user.id);

    if (error) {
      setFeedback({ tone: "error", text: "Não foi possível salvar seus dados. Tente novamente." });
      setIsSaving(false);
      return;
    }

    await supabase.auth.updateUser({ data: { full_name: fullName.trim(), phone: normalizedPhone } });
    await refreshProfile();
    setFeedback({ tone: "success", text: "Perfil atualizado com sucesso." });
    setIsSaving(false);
  };

  const handleDeletionAction = () => {
    const message = hasPendingDeletion
      ? "Deseja cancelar sua solicitação de exclusão de conta?"
      : "Deseja solicitar a exclusão da sua conta? A equipe analisará os registros que precisam ser mantidos por obrigação legal ou financeira.";

    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) void updateDeletionRequest();
      return;
    }

    Alert.alert(
      hasPendingDeletion ? "Cancelar solicitação" : "Solicitar exclusão",
      message,
      [
        { text: "Voltar", style: "cancel" },
        { text: hasPendingDeletion ? "Cancelar solicitação" : "Solicitar exclusão", style: hasPendingDeletion ? "default" : "destructive", onPress: () => void updateDeletionRequest() },
      ],
    );
  };

  const updateDeletionRequest = async () => {
    setIsDeletionBusy(true);
    setFeedback(null);
    const functionName = hasPendingDeletion
      ? "cancel_my_account_deletion_request"
      : "request_my_account_deletion";
    const { error } = await supabase.rpc(functionName);

    if (error) {
      setFeedback({ tone: "error", text: "Não foi possível atualizar a solicitação. Confirme o SQL da Etapa 14." });
    } else {
      const nextPending = !hasPendingDeletion;
      setHasPendingDeletion(nextPending);
      setFeedback({
        tone: "success",
        text: nextPending
          ? "Solicitação de exclusão registrada. A equipe responsável fará a análise."
          : "Solicitação de exclusão cancelada.",
      });
    }
    setIsDeletionBusy(false);
  };

  return (
    <ProtectedRoleScreen
      eyebrow="CONTA E SEGURANÇA"
      requiredRole={["client", "courier", "admin"]}
      subtitle="Atualize seus dados pessoais e controle a segurança da sua conta."
      title="Meu perfil"
    >
      <Pressable accessibilityRole="button" onPress={() => router.replace(routeForRole(profile?.role))} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
        <Text style={styles.backButtonText}>← Voltar para minha área</Text>
      </Pressable>

      <View style={styles.grid}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>DADOS PESSOAIS</Text>
          <Text style={styles.cardTitle}>Informações da conta</Text>

          {isClient && isAvatarAvailable ? (
            <View style={styles.avatarRow}>
              <Avatar name={fullName || profile?.full_name || "Cliente"} path={avatarPath} size={84} />
              <View style={styles.avatarActions}>
                <Text style={styles.label}>Sua foto</Text>
                <Text style={styles.helperText}>Aparece para o entregador no chat da entrega. JPG, PNG ou WebP, até 5 MB.</Text>
                <View style={styles.avatarButtons}>
                  <Pressable accessibilityRole="button" disabled={isAvatarBusy} onPress={() => void handlePickAvatar()} style={({ pressed }) => [styles.avatarButton, isAvatarBusy && styles.disabled, pressed && styles.pressed]}>
                    {isAvatarBusy ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                    <Text style={styles.avatarButtonText}>{avatarPath ? "Trocar foto" : "Escolher foto"}</Text>
                  </Pressable>
                  {avatarPath ? (
                    <Pressable accessibilityRole="button" disabled={isAvatarBusy} onPress={() => void handleRemoveAvatar()} style={({ pressed }) => [styles.avatarRemoveButton, isAvatarBusy && styles.disabled, pressed && styles.pressed]}>
                      <Text style={styles.avatarRemoveText}>Remover</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Nome completo</Text>
              <TextInput autoCapitalize="words" onChangeText={setFullName} placeholder="Seu nome" placeholderTextColor="#91A4AD" style={styles.input} value={fullName} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Telefone</Text>
              <TextInput keyboardType="phone-pad" maxLength={16} onChangeText={(value) => setPhone(formatPhone(value))} placeholder="(61) 99999-9999" placeholderTextColor="#91A4AD" style={styles.input} value={phone} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>E-mail de acesso</Text>
              <View style={styles.readOnlyField}><Text style={styles.readOnlyText}>{session?.user.email ?? "E-mail indisponível"}</Text></View>
              <Text style={styles.helperText}>O e-mail não pode ser alterado por esta tela.</Text>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Tipo de acesso</Text>
              <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{roleLabel(profile?.role)}</Text></View>
            </View>

            {feedback ? (
              <View accessibilityLiveRegion="polite" style={feedback.tone === "success" ? styles.successCard : styles.errorCard}>
                <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>{feedback.text}</Text>
              </View>
            ) : null}

            <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => void handleSave()} style={({ pressed }) => [styles.primaryButton, isSaving && styles.disabled, pressed && styles.pressed]}>
              {isSaving ? <ActivityIndicator color="#071D2D" size="small" /> : null}
              <Text style={styles.primaryButtonText}>{isSaving ? "Salvando..." : "Salvar alterações"}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.sideColumn}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>SEGURANÇA</Text>
            <Text style={styles.cardTitle}>Senha da conta</Text>
            <Text style={styles.cardText}>Ao trocar a senha, você será desconectado e deverá entrar novamente.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push("/nova-senha")} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>Alterar minha senha</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.eyebrow}>TRANSPARÊNCIA</Text>
            <Text style={styles.cardTitle}>Documentos e privacidade</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push("/termos")} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}><Text style={styles.linkText}>Termos de Uso →</Text></Pressable>
            <Pressable accessibilityRole="link" onPress={() => router.push("/privacidade")} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}><Text style={styles.linkText}>Política de Privacidade →</Text></Pressable>
          </View>

          <View style={[styles.card, styles.dangerCard]}>
            <Text style={styles.dangerEyebrow}>CONTROLE DOS MEUS DADOS</Text>
            <Text style={styles.cardTitle}>{hasPendingDeletion ? "Exclusão solicitada" : "Exclusão da conta"}</Text>
            <Text style={styles.cardText}>
              {hasPendingDeletion
                ? "Sua solicitação está pendente de análise. Você pode cancelá-la enquanto o atendimento não for concluído."
                : "Inicie uma solicitação para excluir sua conta e os dados que não precisem ser mantidos por obrigação legal ou financeira."}
            </Text>
            <Pressable accessibilityRole="button" disabled={isDeletionBusy} onPress={handleDeletionAction} style={({ pressed }) => [hasPendingDeletion ? styles.cancelDeletionButton : styles.deletionButton, isDeletionBusy && styles.disabled, pressed && styles.pressed]}>
              <Text style={hasPendingDeletion ? styles.cancelDeletionButtonText : styles.deletionButtonText}>
                {isDeletionBusy ? "Atualizando..." : hasPendingDeletion ? "Cancelar solicitação" : "Solicitar exclusão da conta"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ProtectedRoleScreen>
  );
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

const styles = StyleSheet.create({
  backButton: { alignSelf: "flex-start", paddingVertical: 12, marginTop: 18 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 16, marginTop: 4 },
  card: { ...visualShadows.card, flexGrow: 1, minWidth: 280, borderRadius: 24, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 22 },
  sideColumn: { flex: 1, minWidth: 280, gap: 16 },
  eyebrow: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1.3 },
  cardTitle: { color: "#102A43", fontSize: 21, fontWeight: "900", marginTop: 7 },
  cardText: { color: "#627D8A", fontSize: 12, lineHeight: 19, marginTop: 8 },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 18, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: "#E7EFF1" },
  avatarActions: { flex: 1, gap: 6 },
  avatarButtons: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 4 },
  avatarButton: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, backgroundColor: "#38D6D2", paddingHorizontal: 14 },
  avatarButtonText: { color: "#071D2D", fontSize: 11, fontWeight: "900" },
  avatarRemoveButton: { minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 14 },
  avatarRemoveText: { color: "#486876", fontSize: 11, fontWeight: "900" },
  form: { gap: 15, marginTop: 20 },
  fieldGroup: { gap: 7 },
  label: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  input: { height: 51, borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#F9FBFC", color: "#102A43", fontSize: 13, paddingHorizontal: 15 },
  readOnlyField: { minHeight: 51, justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#E1EAED", backgroundColor: "#F1F5F6", paddingHorizontal: 15 },
  readOnlyText: { color: "#627D8A", fontSize: 13, fontWeight: "700" },
  helperText: { color: "#8298A2", fontSize: 9 },
  roleBadge: { alignSelf: "flex-start", borderRadius: 999, backgroundColor: "#E9F8F8", paddingHorizontal: 12, paddingVertical: 7 },
  roleBadgeText: { color: "#087E83", fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  successCard: { borderRadius: 13, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 12 },
  successText: { color: "#176A50", fontSize: 10, lineHeight: 16, fontWeight: "800", textAlign: "center" },
  errorCard: { borderRadius: 13, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 12 },
  errorText: { color: "#8A3325", fontSize: 10, lineHeight: 16, fontWeight: "800", textAlign: "center" },
  primaryButton: { minHeight: 51, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, backgroundColor: "#38D6D2", paddingHorizontal: 15 },
  primaryButtonText: { color: "#071D2D", fontSize: 12, fontWeight: "900" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 14, marginTop: 17 },
  secondaryButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  linkButton: { borderBottomWidth: 1, borderBottomColor: "#E7EFF1", paddingVertical: 13 },
  linkText: { color: "#087E83", fontSize: 11, fontWeight: "900" },
  dangerCard: { borderColor: "#F1D3CD", backgroundColor: "#FFFDFC" },
  dangerEyebrow: { color: "#A74435", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  deletionButton: { minHeight: 47, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#F1B8AE", backgroundColor: "#FFF3F0", paddingHorizontal: 14, marginTop: 16 },
  deletionButtonText: { color: "#A13B2C", fontSize: 10, fontWeight: "900" },
  cancelDeletionButton: { minHeight: 47, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 14, marginTop: 16 },
  cancelDeletionButtonText: { color: "#486876", fontSize: 10, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
});
