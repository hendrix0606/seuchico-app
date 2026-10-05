import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { notifyOrderEvent } from "../lib/push-notifications";
import { supabase } from "../lib/supabase";
import { formatCurrency } from "../lib/tickets";
import type { PixPaymentSubmission, PixSubmissionStatus } from "../types/pix";

type PixReviewOrder = {
  id: string;
  order_number: number;
  user_id: string;
  status: string;
  payment_status: string;
  total_cents: number;
  created_at: string;
  ticket_drafts: { event_name: string } | null;
};

type ClientProfile = { id: string; full_name: string; phone: string | null };
type ReviewFilter = "pending" | "approved" | "rejected";
type Feedback = { tone: "success" | "error"; text: string } | null;

const filters: { label: string; value: ReviewFilter }[] = [
  { label: "Aguardando análise", value: "pending" },
  { label: "Aprovados", value: "approved" },
  { label: "Recusados", value: "rejected" },
];

export default function PixReviewScreen() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<PixPaymentSubmission[]>([]);
  const [orders, setOrders] = useState<PixReviewOrder[]>([]);
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadReviews = async () => {
    setIsLoading(true);
    setFeedback(null);

    const { data, error } = await supabase
      .from("pix_payment_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setFeedback({
        tone: "error",
        text: "Não foi possível carregar os comprovantes. Confirme se o SQL 015 foi executado.",
      });
      setIsLoading(false);
      return;
    }

    const nextSubmissions = (data ?? []) as PixPaymentSubmission[];
    const orderIds = [...new Set(nextSubmissions.map((item) => item.order_id))];
    const clientIds = [...new Set(nextSubmissions.map((item) => item.client_id))];

    const [ordersResult, profilesResult, signedUrls] = await Promise.all([
      orderIds.length
        ? supabase
            .from("orders")
            .select("id, order_number, user_id, status, payment_status, total_cents, created_at, ticket_drafts(event_name)")
            .in("id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      clientIds.length
        ? supabase.from("profiles").select("id, full_name, phone").in("id", clientIds)
        : Promise.resolve({ data: [], error: null }),
      Promise.all(
        nextSubmissions.map(async (item) => {
          const { data: signed } = await supabase.storage
            .from("pix-proofs")
            .createSignedUrl(item.proof_path, 600);
          return [item.id, signed?.signedUrl ?? ""] as const;
        }),
      ),
    ]);

    if (ordersResult.error || profilesResult.error) {
      setFeedback({ tone: "error", text: "Não foi possível relacionar os comprovantes aos pedidos." });
    }

    setSubmissions(nextSubmissions);
    setOrders((ordersResult.data ?? []) as unknown as PixReviewOrder[]);
    setProfiles((profilesResult.data ?? []) as ClientProfile[]);
    setProofUrls(Object.fromEntries(signedUrls.filter(([, url]) => Boolean(url))));
    setIsLoading(false);
  };

  useEffect(() => {
    void loadReviews();
  }, []);

  const ordersById = useMemo(() => new Map(orders.map((item) => [item.id, item])), [orders]);
  const profilesById = useMemo(() => new Map(profiles.map((item) => [item.id, item])), [profiles]);
  const visibleSubmissions = useMemo(
    () => submissions.filter((item) => item.status === filter),
    [filter, submissions],
  );

  const handleReview = async (submission: PixPaymentSubmission, decision: "approved" | "rejected") => {
    const order = ordersById.get(submission.order_id);
    setBusyId(submission.id);
    setFeedback(null);

    const { error } = await supabase.rpc("admin_review_pix_payment", {
      p_submission_id: submission.id,
      p_decision: decision,
      p_admin_note: notes[submission.id]?.trim() || null,
    });

    if (error) {
      setFeedback({ tone: "error", text: translateReviewError(error.message) });
    } else {
      if (decision === "approved" && order) {
        await notifyOrderEvent(order.id, "order_status");
      }
      const successMessage =
        decision === "approved"
          ? `Pagamento do pedido #${formatOrder(order?.order_number)} aprovado.`
          : `Comprovante do pedido #${formatOrder(order?.order_number)} recusado. O cliente poderá reenviar.`;
      setNotes((current) => ({ ...current, [submission.id]: "" }));
      await loadReviews();
      setFeedback({ tone: "success", text: successMessage });
    }

    setBusyId(null);
  };

  const requestReview = (
    submission: PixPaymentSubmission,
    decision: "approved" | "rejected",
  ) => {
    const order = ordersById.get(submission.order_id);
    const action = decision === "approved" ? "aprovar" : "recusar";
    const message = `Deseja ${action} o comprovante do pedido #${formatOrder(order?.order_number)}?`;

    if (Platform.OS === "web") {
      const confirmAction = (
        globalThis as unknown as { confirm?: (text: string) => boolean }
      ).confirm;
      if (!confirmAction || confirmAction(message)) {
        void handleReview(submission, decision);
      }
      return;
    }

    Alert.alert(
      decision === "approved" ? "Aprovar pagamento" : "Recusar comprovante",
      message,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: decision === "approved" ? "Aprovar" : "Recusar",
          style: decision === "approved" ? "default" : "destructive",
          onPress: () => void handleReview(submission, decision),
        },
      ],
    );
  };

  return (
    <ProtectedRoleScreen
      eyebrow="CONFERÊNCIA FINANCEIRA"
      requiredRole="admin"
      subtitle="Confira cada comprovante antes de liberar o pedido para produção."
      title="Pagamentos PIX"
    >
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.replace("/admin")} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Voltar à operação</Text>
        </Pressable>
        <Pressable onPress={() => void loadReviews()} style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>↻ Atualizar</Text>
        </Pressable>
      </View>

      {feedback ? (
        <View style={feedback.tone === "success" ? styles.successCard : styles.errorCard}>
          <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>{feedback.text}</Text>
        </View>
      ) : null}

      <View style={styles.summaryGrid}>
        <Summary label="AGUARDANDO" value={countStatus(submissions, "pending")} accent="#F3AA3D" />
        <Summary label="APROVADOS" value={countStatus(submissions, "approved")} accent="#3CC68A" />
        <Summary label="RECUSADOS" value={countStatus(submissions, "rejected")} accent="#F47E6B" />
      </View>

      <View style={styles.filters}>
        {filters.map((item) => (
          <Pressable
            key={item.value}
            onPress={() => setFilter(item.value)}
            style={[styles.filterChip, filter === item.value && styles.filterChipActive]}
          >
            <Text style={filter === item.value ? styles.filterTextActive : styles.filterText}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando comprovantes...</Text>
        </View>
      ) : visibleSubmissions.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.emptyIcon}>🧾</Text>
          <Text style={styles.emptyTitle}>Nenhum comprovante neste filtro</Text>
          <Text style={styles.stateText}>Os pagamentos enviados pelos clientes aparecerão aqui.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visibleSubmissions.map((submission) => {
            const order = ordersById.get(submission.order_id);
            const client = profilesById.get(submission.client_id);
            const busy = busyId === submission.id;

            return (
              <View key={submission.id} style={styles.reviewCard}>
                <View style={styles.reviewHeading}>
                  <View>
                    <Text style={styles.orderLabel}>PEDIDO #{formatOrder(order?.order_number)}</Text>
                    <Text style={styles.eventName}>{order?.ticket_drafts?.event_name ?? "Ingresso SeuChico"}</Text>
                    <Text style={styles.createdAt}>Enviado em {formatDateTime(submission.created_at)}</Text>
                  </View>
                  <Text style={styles.total}>{order ? formatCurrency(order.total_cents) : "—"}</Text>
                </View>

                <View style={styles.infoGrid}>
                  <Info label="CLIENTE" value={client?.full_name ?? "Cliente"} />
                  <Info label="TELEFONE" value={client?.phone ?? "Não informado"} />
                  <Info label="ARQUIVO" value={submission.proof_name} />
                  <Info label="SITUAÇÃO" value={statusLabel(submission.status)} />
                </View>

                {submission.customer_note ? (
                  <View style={styles.noteCard}>
                    <Text style={styles.noteCardLabel}>OBSERVAÇÃO DO CLIENTE</Text>
                    <Text style={styles.noteCardText}>{submission.customer_note}</Text>
                  </View>
                ) : null}

                {proofUrls[submission.id] ? (
                  <Pressable onPress={() => void Linking.openURL(proofUrls[submission.id])} style={styles.proofButton}>
                    <Text style={styles.proofButtonText}>Abrir comprovante em nova janela →</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.proofError}>Não foi possível gerar a visualização do comprovante.</Text>
                )}

                {submission.status === "pending" ? (
                  <View style={styles.reviewPanel}>
                    <Text style={styles.label}>Observação da análise (opcional)</Text>
                    <TextInput
                      maxLength={500}
                      multiline
                      onChangeText={(value) => setNotes((current) => ({ ...current, [submission.id]: value }))}
                      placeholder="Ex.: valor ou titular divergente..."
                      placeholderTextColor="#91A4AD"
                      style={styles.noteInput}
                      value={notes[submission.id] ?? ""}
                    />
                    <View style={styles.actions}>
                      <Pressable disabled={busy} onPress={() => requestReview(submission, "rejected")} style={[styles.rejectButton, busy && styles.disabled]}>
                        <Text style={styles.rejectButtonText}>Recusar comprovante</Text>
                      </Pressable>
                      <Pressable disabled={busy} onPress={() => requestReview(submission, "approved")} style={[styles.approveButton, busy && styles.disabled]}>
                        {busy ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                        <Text style={styles.approveButtonText}>{busy ? "Processando..." : "Aprovar pagamento"}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={submission.status === "approved" ? styles.approvedCard : styles.rejectedCard}>
                    <Text style={submission.status === "approved" ? styles.approvedText : styles.rejectedText}>
                      {submission.status === "approved" ? "Pagamento aprovado" : "Comprovante recusado"}
                      {submission.reviewed_at ? ` em ${formatDateTime(submission.reviewed_at)}` : ""}
                      {submission.admin_note ? ` · ${submission.admin_note}` : ""}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ProtectedRoleScreen>
  );
}

function Summary({ accent, label, value }: { accent: string; label: string; value: number }) {
  return (
    <View style={[styles.summaryCard, { borderLeftColor: accent }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function countStatus(items: PixPaymentSubmission[], status: PixSubmissionStatus) {
  return items.filter((item) => item.status === status).length;
}

function statusLabel(status: PixSubmissionStatus) {
  if (status === "approved") return "APROVADO";
  if (status === "rejected") return "RECUSADO";
  return "AGUARDANDO ANÁLISE";
}

function formatOrder(value?: number) {
  return typeof value === "number" ? String(value).padStart(5, "0") : "-----";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function translateReviewError(message: string) {
  if (message.includes("SUBMISSION_ALREADY_REVIEWED")) return "Este comprovante já foi analisado.";
  if (message.includes("ORDER_NOT_AWAITING_PAYMENT")) return "Este pedido não está mais aguardando pagamento.";
  return "Não foi possível concluir a análise. Atualize a página e tente novamente.";
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 14 },
  backButton: { paddingVertical: 9 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  refreshButton: { borderRadius: 12, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 10 },
  refreshButtonText: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  summaryCard: { minWidth: Platform.OS === "web" ? 180 : "100%", flex: 1, borderRadius: 18, borderWidth: 1, borderLeftWidth: 5, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 17 },
  summaryLabel: { color: "#627D8A", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  summaryValue: { color: "#102A43", fontSize: 27, fontWeight: "900", marginTop: 6 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 16 },
  filterChip: { borderRadius: 20, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 13, paddingVertical: 9 },
  filterChipActive: { borderColor: "#071D2D", backgroundColor: "#071D2D" },
  filterText: { color: "#486876", fontSize: 10, fontWeight: "800" },
  filterTextActive: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  list: { gap: 14 },
  reviewCard: { ...visualShadows.card, gap: 15, borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: Platform.OS === "web" ? 23 : 18 },
  reviewHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  orderLabel: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  eventName: { color: "#102A43", fontSize: 20, fontWeight: "900", marginTop: 6 },
  createdAt: { color: "#8298A2", fontSize: 9, marginTop: 5 },
  total: { color: "#176A50", fontSize: 23, fontWeight: "900" },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  infoItem: { minWidth: 150, flex: 1, gap: 4 },
  infoLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  infoValue: { color: "#102A43", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  noteCard: { borderRadius: 13, backgroundColor: "#F4F8F9", padding: 13 },
  noteCardLabel: { color: "#627D8A", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  noteCardText: { color: "#294B5A", fontSize: 10, lineHeight: 16, marginTop: 5 },
  proofButton: { alignSelf: "flex-start", borderRadius: 12, backgroundColor: "#102A43", paddingHorizontal: 15, paddingVertical: 11 },
  proofButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  proofError: { color: "#8A3325", fontSize: 10, fontWeight: "700" },
  reviewPanel: { gap: 10, borderTopWidth: 1, borderTopColor: "#E5EDEF", paddingTop: 15 },
  label: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  noteInput: { minHeight: 82, borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#F9FBFC", color: "#102A43", fontSize: 12, padding: 12, textAlignVertical: "top" },
  actions: { flexDirection: Platform.OS === "web" ? "row" : "column", gap: 9 },
  rejectButton: { minHeight: 47, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#FFB8AC", backgroundColor: "#FFF4F1", padding: 12 },
  rejectButtonText: { color: "#9A392A", fontSize: 11, fontWeight: "900" },
  approveButton: { minHeight: 47, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, backgroundColor: "#38D6D2", padding: 12 },
  approveButtonText: { color: "#071D2D", fontSize: 11, fontWeight: "900" },
  approvedCard: { borderRadius: 13, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 13 },
  approvedText: { color: "#176A50", fontSize: 10, lineHeight: 16, fontWeight: "800" },
  rejectedCard: { borderRadius: 13, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 13 },
  rejectedText: { color: "#8A3325", fontSize: 10, lineHeight: 16, fontWeight: "800" },
  stateCard: { ...visualShadows.card, minHeight: 250, alignItems: "center", justifyContent: "center", gap: 11, borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30 },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { color: "#102A43", fontSize: 19, fontWeight: "900" },
  stateText: { maxWidth: 480, color: "#627D8A", fontSize: 12, lineHeight: 19, textAlign: "center" },
  successCard: { borderRadius: 15, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 14, marginBottom: 14 },
  successText: { color: "#176A50", fontSize: 11, fontWeight: "800" },
  errorCard: { borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 14, marginBottom: 14 },
  errorText: { color: "#8A3325", fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.5 },
});
