import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth, type UserRole } from "../context/auth-context";
import { isStrongPassword } from "../lib/passwords";
import { roleLabel } from "../lib/role-routes";
import { supabase } from "../lib/supabase";

type Account = {
  id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
};

type Feedback = { tone: "success" | "error"; text: string } | null;

type DeletionRequest = {
  id: number;
  user_id: string;
  requested_at: string;
};

export default function UserManagementScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);

  const loadAccounts = async () => {
    setIsLoading(true);
    const result = await invokeManagement({ action: "list_accounts" });

    if (!result.ok) {
      setFeedback({ tone: "error", text: translateManagementError(result.error) });
    } else {
      setAccounts((result.data?.accounts ?? []) as Account[]);
      const { data: requests } = await supabase
        .from("account_deletion_requests")
        .select("id, user_id, requested_at")
        .eq("status", "pending")
        .order("requested_at", { ascending: false });
      setDeletionRequests((requests ?? []) as DeletionRequest[]);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (session && profile?.role === "admin" && profile.is_active) {
      void loadAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, profile?.role, profile?.is_active]);

  const summary = useMemo(
    () => ({
      clients: accounts.filter((item) => item.role === "client").length,
      couriers: accounts.filter((item) => item.role === "courier").length,
      inactive: accounts.filter((item) => !item.is_active).length,
      deletionRequests: deletionRequests.length,
    }),
    [accounts, deletionRequests.length],
  );

  const handleCreateCourier = async () => {
    setFeedback(null);

    if (![name, email, phone, temporaryPassword, passwordConfirmation].every((value) => value.trim())) {
      setFeedback({ tone: "error", text: "Preencha todos os campos do entregador." });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFeedback({ tone: "error", text: "Digite um e-mail válido para o entregador." });
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setFeedback({ tone: "error", text: "Digite um telefone com DDD." });
      return;
    }
    if (!isStrongPassword(temporaryPassword)) {
      setFeedback({
        tone: "error",
        text: "A senha temporária precisa ter 10 caracteres, maiúscula, minúscula, número e símbolo.",
      });
      return;
    }
    if (temporaryPassword !== passwordConfirmation) {
      setFeedback({ tone: "error", text: "A confirmação da senha temporária está diferente." });
      return;
    }

    setIsCreating(true);
    const result = await invokeManagement({
      action: "create_courier",
      full_name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.replace(/\D/g, ""),
      password: temporaryPassword,
    });

    if (!result.ok) {
      setFeedback({ tone: "error", text: translateManagementError(result.error) });
    } else {
      setName("");
      setEmail("");
      setPhone("");
      setTemporaryPassword("");
      setPasswordConfirmation("");
      setFeedback({
        tone: "success",
        text: "Entregador criado. Entregue o e-mail e a senha temporária diretamente a ele.",
      });
      await loadAccounts();
    }

    setIsCreating(false);
  };

  const handleToggleActive = (account: Account) => {
    const nextActive = !account.is_active;
    const verb = nextActive ? "reativar" : "desativar";
    const message = `Deseja ${verb} o acesso de ${account.full_name}?`;

    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) {
        void updateActive(account, nextActive);
      }
      return;
    }

    Alert.alert(
      `${nextActive ? "Reativar" : "Desativar"} conta`,
      message,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: nextActive ? "Reativar" : "Desativar",
          style: nextActive ? "default" : "destructive",
          onPress: () => void updateActive(account, nextActive),
        },
      ],
    );
  };

  const updateActive = async (account: Account, nextActive: boolean) => {
    setBusyUserId(account.id);
    setFeedback(null);

    const result = await invokeManagement({
      action: "set_active",
      user_id: account.id,
      is_active: nextActive,
    });

    if (!result.ok) {
      setFeedback({ tone: "error", text: translateManagementError(result.error) });
    } else {
      setFeedback({
        tone: "success",
        text: nextActive ? "Acesso reativado." : "Acesso desativado e notificações interrompidas.",
      });
      await loadAccounts();
    }

    setBusyUserId(null);
  };

  return (
    <ProtectedRoleScreen
      eyebrow="CONTAS E PERMISSÕES"
      requiredRole="admin"
      subtitle="Crie acessos de entregador e controle contas sem expor privilégios no cadastro público."
      title="Acessos"
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/admin")}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>← Voltar à operação</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={() => void loadAccounts()}
          style={({ pressed }) => [
            styles.refreshButton,
            isLoading && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.refreshButtonText}>{isLoading ? "Atualizando..." : "↻ Atualizar"}</Text>
        </Pressable>
      </View>

      <View style={styles.summaryGrid}>
        <Summary label="CLIENTES" value={summary.clients} />
        <Summary label="ENTREGADORES" value={summary.couriers} />
        <Summary label="DESATIVADOS" value={summary.inactive} warm />
        <Summary label="EXCLUSÕES SOLICITADAS" value={summary.deletionRequests} warm />
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

      <View style={styles.contentGrid}>
        <View style={styles.formCard}>
          <Text style={styles.eyebrow}>NOVO ACESSO OPERACIONAL</Text>
          <Text style={styles.cardTitle}>Criar conta de entregador</Text>
          <Text style={styles.cardDescription}>
            A conta já nasce confirmada e ativa. No primeiro login, o entregador será obrigado a criar a própria senha.
          </Text>

          <View style={styles.form}>
            <InputField autoComplete="off" label="Nome completo" onChangeText={setName} placeholder="Nome do entregador" value={name} />
            <InputField autoCapitalize="none" autoComplete="off" keyboardType="email-address" label="E-mail de acesso" onChangeText={setEmail} placeholder="entregador@email.com" value={email} />
            <InputField autoComplete="off" keyboardType="phone-pad" label="Telefone" onChangeText={setPhone} placeholder="(61) 99999-9999" value={phone} />
            <InputField autoCapitalize="none" autoComplete="new-password" label="Senha temporária" onChangeText={setTemporaryPassword} placeholder="Crie uma senha temporária forte" secureTextEntry value={temporaryPassword} />
            <InputField autoCapitalize="none" autoComplete="new-password" label="Confirmar senha temporária" onChangeText={setPasswordConfirmation} placeholder="Digite a senha novamente" secureTextEntry value={passwordConfirmation} />

            <View style={styles.passwordRule}>
              <Text style={styles.passwordRuleTitle}>REQUISITOS DA SENHA</Text>
              <Text style={styles.passwordRuleText}>10 ou mais caracteres, com letra maiúscula, minúscula, número e símbolo.</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={isCreating}
              onPress={() => void handleCreateCourier()}
              style={({ pressed }) => [
                styles.createButton,
                isCreating && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {isCreating ? <ActivityIndicator color="#071D2D" size="small" /> : null}
              <Text style={styles.createButtonText}>{isCreating ? "Criando acesso..." : "Criar entregador"}</Text>
              {!isCreating ? <Text style={styles.createButtonArrow}>→</Text> : null}
            </Pressable>
          </View>
        </View>

        <View style={styles.listCard}>
          <Text style={styles.eyebrow}>CONTAS CADASTRADAS</Text>
          <Text style={styles.cardTitle}>Acessos do SeuChico</Text>
          <Text style={styles.cardDescription}>
            Clientes criam a própria conta. Entregadores são cadastrados apenas por esta área administrativa.
          </Text>

          {isLoading && accounts.length === 0 ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#087E83" size="large" />
              <Text style={styles.loadingText}>Carregando contas...</Text>
            </View>
          ) : accounts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nenhuma conta encontrada</Text>
              <Text style={styles.loadingText}>Confirme a função administrativa e tente novamente.</Text>
            </View>
          ) : (
            <View style={styles.accountList}>
              {accounts.map((account) => {
                const busy = busyUserId === account.id;
                const protectedAdmin = account.role === "admin";
                const deletionRequest = deletionRequests.find((item) => item.user_id === account.id);
                return (
                  <View key={account.id} style={[styles.accountCard, !account.is_active && styles.accountCardInactive]}>
                    <View style={styles.accountHeading}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initials(account.full_name)}</Text>
                      </View>
                      <View style={styles.accountIdentity}>
                        <Text numberOfLines={1} style={styles.accountName}>{account.full_name}</Text>
                        <Text numberOfLines={1} style={styles.accountEmail}>{account.email ?? "E-mail indisponível"}</Text>
                      </View>
                      <View style={[styles.statusDot, !account.is_active && styles.statusDotInactive]} />
                    </View>

                    <View style={styles.badgeRow}>
                      <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{roleLabel(account.role)}</Text></View>
                      <View style={account.is_active ? styles.activeBadge : styles.inactiveBadge}>
                        <Text style={account.is_active ? styles.activeBadgeText : styles.inactiveBadgeText}>{account.is_active ? "ATIVO" : "DESATIVADO"}</Text>
                      </View>
                      {account.must_change_password ? (
                        <View style={styles.pendingBadge}><Text style={styles.pendingBadgeText}>TROCA DE SENHA PENDENTE</Text></View>
                      ) : null}
                      {deletionRequest ? (
                        <View style={styles.deletionBadge}><Text style={styles.deletionBadgeText}>EXCLUSÃO SOLICITADA</Text></View>
                      ) : null}
                    </View>

                    <Text style={styles.accountMeta}>{formatPhone(account.phone)} · criado em {formatDate(account.created_at)}</Text>
                    {deletionRequest ? (
                      <Text style={styles.deletionNotice}>Solicitada em {formatDate(deletionRequest.requested_at)}. Revise pedidos e obrigações de retenção antes de concluir o atendimento.</Text>
                    ) : null}

                    {protectedAdmin ? (
                      <View style={styles.protectedNotice}><Text style={styles.protectedNoticeText}>Conta administrativa protegida</Text></View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => handleToggleActive(account)}
                        style={({ pressed }) => [
                          account.is_active ? styles.deactivateButton : styles.reactivateButton,
                          busy && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={account.is_active ? styles.deactivateButtonText : styles.reactivateButtonText}>
                          {busy ? "Atualizando..." : account.is_active ? "Desativar acesso" : "Reativar acesso"}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </ProtectedRoleScreen>
  );
}

function Summary({ label, value, warm = false }: { label: string; value: number; warm?: boolean }) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryAccent, warm && styles.summaryAccentWarm]} />
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

type InputFieldProps = {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "off" | "new-password";
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
      <TextInput placeholderTextColor="#91A4AD" style={styles.input} {...props} />
    </View>
  );
}

async function invokeManagement(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-manage-user", { body });
  if (!error) return { ok: true as const, data, error: null };

  let code = "FUNCTION_REQUEST_FAILED";
  const context = (error as { context?: Response }).context;
  if (context) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string") code = payload.error;
    } catch {
      // Mantém o código genérico quando o provedor não devolve JSON.
    }
  }
  return { ok: false as const, data: null, error: code };
}

function translateManagementError(code: string | null) {
  const messages: Record<string, string> = {
    ACTIVE_ADMIN_REQUIRED: "Somente um administrador ativo pode gerenciar contas.",
    EMAIL_ALREADY_REGISTERED: "Já existe uma conta com este e-mail.",
    WEAK_TEMPORARY_PASSWORD: "A senha temporária não atende aos requisitos de segurança.",
    CANNOT_CHANGE_OWN_ACCESS: "Você não pode desativar a própria conta por esta tela.",
    ADMIN_ACCOUNT_PROTECTED: "Outra conta administrativa não pode ser alterada por esta tela.",
    ACCOUNT_LIST_FAILED: "Não foi possível carregar as contas.",
    COURIER_CREATION_FAILED: "Não foi possível criar o entregador.",
    COURIER_PROFILE_FAILED: "A conta não foi concluída; tente novamente.",
    ACCOUNT_UPDATE_FAILED: "Não foi possível alterar esse acesso.",
    FUNCTION_REQUEST_FAILED: "A função administrativa não respondeu. Confirme a publicação no Supabase.",
  };
  return messages[code ?? ""] ?? "Não foi possível concluir a ação. Tente novamente.";
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? "S"}${words[1]?.[0] ?? "C"}`.toUpperCase();
}

function formatPhone(phone: string | null) {
  if (!phone) return "Telefone não informado";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 22 },
  backButton: { paddingVertical: 10 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  refreshButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 15 },
  refreshButtonText: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  summaryCard: { ...visualShadows.subtle, overflow: "hidden", minWidth: Platform.OS === "web" ? 180 : "46%", flexGrow: 1, borderRadius: 18, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 16 },
  summaryAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5, backgroundColor: "#38D6D2" },
  summaryAccentWarm: { backgroundColor: "#FF9B81" },
  summaryLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 0.9 },
  summaryValue: { color: "#102A43", fontSize: 25, fontWeight: "900", marginTop: 9 },
  successCard: { borderRadius: 15, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 13, marginTop: 15 },
  successText: { color: "#176A50", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  errorCard: { borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 13, marginTop: 15 },
  errorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  contentGrid: { flexDirection: Platform.OS === "web" ? "row" : "column", alignItems: "flex-start", gap: 16, marginTop: 16 },
  formCard: { ...visualShadows.card, width: Platform.OS === "web" ? "40%" : "100%", borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 20 },
  listCard: { ...visualShadows.card, flex: 1, width: Platform.OS === "web" ? undefined : "100%", minWidth: 0, borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 20 },
  eyebrow: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  cardTitle: { color: "#102A43", fontSize: 20, lineHeight: 26, fontWeight: "900", marginTop: 7 },
  cardDescription: { color: "#627D8A", fontSize: 11, lineHeight: 18, marginTop: 7 },
  form: { gap: 14, marginTop: 20 },
  fieldGroup: { gap: 7 },
  label: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  input: { height: 50, borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#F9FBFC", color: "#102A43", fontSize: 13, paddingHorizontal: 14 },
  passwordRule: { borderRadius: 13, backgroundColor: "#EFFAFA", padding: 12 },
  passwordRuleTitle: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 0.9 },
  passwordRuleText: { color: "#486876", fontSize: 9, lineHeight: 15, marginTop: 4 },
  createButton: { minHeight: 51, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, backgroundColor: "#38D6D2", paddingHorizontal: 15 },
  createButtonText: { color: "#071D2D", fontSize: 12, fontWeight: "900" },
  createButtonArrow: { color: "#071D2D", fontSize: 19, fontWeight: "900" },
  loadingState: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#627D8A", fontSize: 11, lineHeight: 17, textAlign: "center" },
  emptyState: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 7 },
  emptyTitle: { color: "#102A43", fontSize: 16, fontWeight: "900" },
  accountList: { gap: 11, marginTop: 18 },
  accountCard: { borderRadius: 17, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#F9FBFC", padding: 14 },
  accountCardInactive: { backgroundColor: "#FFF8F6", borderColor: "#F1D3CD" },
  accountHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 41, height: 41, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#DDF8F7" },
  avatarText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  accountIdentity: { flex: 1, minWidth: 0 },
  accountName: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  accountEmail: { color: "#627D8A", fontSize: 9, marginTop: 3 },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#38D6D2" },
  statusDotInactive: { backgroundColor: "#FF8B7A" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 11 },
  roleBadge: { borderRadius: 12, backgroundColor: "#E8F1F4", paddingHorizontal: 8, paddingVertical: 5 },
  roleBadgeText: { color: "#486876", fontSize: 7, fontWeight: "900" },
  activeBadge: { borderRadius: 12, backgroundColor: "#DFF6EC", paddingHorizontal: 8, paddingVertical: 5 },
  activeBadgeText: { color: "#176A50", fontSize: 7, fontWeight: "900" },
  inactiveBadge: { borderRadius: 12, backgroundColor: "#FFE7E2", paddingHorizontal: 8, paddingVertical: 5 },
  inactiveBadgeText: { color: "#8A3325", fontSize: 7, fontWeight: "900" },
  pendingBadge: { borderRadius: 12, backgroundColor: "#FFF0C9", paddingHorizontal: 8, paddingVertical: 5 },
  pendingBadgeText: { color: "#77530D", fontSize: 7, fontWeight: "900" },
  deletionBadge: { borderRadius: 12, backgroundColor: "#FFF0EC", paddingHorizontal: 8, paddingVertical: 5 },
  deletionBadgeText: { color: "#A13B2C", fontSize: 7, fontWeight: "900" },
  accountMeta: { color: "#8298A2", fontSize: 8, lineHeight: 14, marginTop: 9 },
  deletionNotice: { color: "#A13B2C", fontSize: 9, lineHeight: 15, fontWeight: "800", marginTop: 9 },
  protectedNotice: { alignItems: "center", borderRadius: 11, backgroundColor: "#E8F1F4", padding: 9, marginTop: 11 },
  protectedNoticeText: { color: "#486876", fontSize: 8, fontWeight: "900" },
  deactivateButton: { alignItems: "center", borderRadius: 11, borderWidth: 1, borderColor: "#F1BDB4", backgroundColor: "#FFF4F1", padding: 10, marginTop: 11 },
  deactivateButtonText: { color: "#8A3325", fontSize: 9, fontWeight: "900" },
  reactivateButton: { alignItems: "center", borderRadius: 11, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 10, marginTop: 11 },
  reactivateButtonText: { color: "#176A50", fontSize: 9, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
});
