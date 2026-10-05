import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import { pickPaymentProof, safeFileName, uploadDocument } from "../lib/file-upload";
import { supabase } from "../lib/supabase";
import { formatCurrency } from "../lib/tickets";
import type { PixPaymentSubmission, PixSettings } from "../types/pix";

type PixOrder = {
  id: string;
  order_number: number;
  user_id: string;
  status: string;
  payment_status: string;
  payment_provider: "stripe" | "pix";
  total_cents: number;
  ticket_drafts: { event_name: string } | null;
};

type PickedProof = {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
};

type Feedback = { tone: "success" | "error"; text: string } | null;

export default function PixPaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ order?: string | string[] }>();
  const orderId = firstParam(params.order);
  const { session } = useAuth();
  const [order, setOrder] = useState<PixOrder | null>(null);
  const [settings, setSettings] = useState<PixSettings | null>(null);
  const [submission, setSubmission] = useState<PixPaymentSubmission | null>(null);
  const [proof, setProof] = useState<PickedProof | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadPayment = async () => {
    if (!session?.user.id || !orderId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    const [orderResult, settingsResult, submissionResult] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, user_id, status, payment_status, payment_provider, total_cents, ticket_drafts(event_name)")
        .eq("id", orderId)
        .eq("user_id", session.user.id)
        .single(),
      supabase.from("pix_settings").select("*").eq("id", 1).single(),
      supabase
        .from("pix_payment_submissions")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle(),
    ]);

    if (orderResult.error || settingsResult.error) {
      setFeedback({
        tone: "error",
        text: "Não foi possível abrir o PIX. Confirme se o SQL 015 foi executado.",
      });
    } else {
      setOrder(orderResult.data as unknown as PixOrder);
      setSettings(settingsResult.data as PixSettings);
      const nextSubmission = (submissionResult.data as PixPaymentSubmission | null) ?? null;
      setSubmission(nextSubmission);
      setNote(nextSubmission?.customer_note ?? "");

      if (nextSubmission?.proof_path) {
        const { data } = await supabase.storage
          .from("pix-proofs")
          .createSignedUrl(nextSubmission.proof_path, 600);
        setProofUrl(data?.signedUrl ?? null);
      } else {
        setProofUrl(null);
      }
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void loadPayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, session?.user.id]);

  const handleCopy = async (value: string, label: string) => {
    await Clipboard.setStringAsync(value);
    setFeedback({ tone: "success", text: `${label} copiado.` });
  };

  const handlePickProof = async () => {
    setIsPicking(true);
    setFeedback(null);
    try {
      const asset = await pickPaymentProof();
      if (asset) setProof(asset);
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error && error.message === "FILE_TOO_LARGE"
            ? "O comprovante deve ter no máximo 10 MB."
            : "Não foi possível ler o comprovante.",
      });
    } finally {
      setIsPicking(false);
    }
  };

  const handleSubmit = async () => {
    if (!order || !session?.user.id || !proof) {
      setFeedback({ tone: "error", text: "Escolha a imagem ou o PDF do comprovante." });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    const fileName = safeFileName(proof.name);
    const proofPath = `${session.user.id}/${order.id}/${Date.now()}-${fileName}`;

    try {
      await uploadDocument("pix-proofs", proofPath, proof);
      const { error } = await supabase.rpc("submit_pix_payment", {
        p_order_id: order.id,
        p_proof_path: proofPath,
        p_proof_name: proof.name,
        p_proof_mime_type: proof.mimeType ?? null,
        p_customer_note: note.trim() || null,
      });

      if (error) throw error;

      setProof(null);
      await loadPayment();
      setFeedback({
        tone: "success",
        text: "Comprovante enviado. O pagamento está aguardando análise do administrador.",
      });
    } catch (error) {
      setFeedback({ tone: "error", text: translatePixError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    order?.status === "awaiting_payment" &&
    order.payment_status !== "paid" &&
    submission?.status !== "pending" &&
    submission?.status !== "approved";

  return (
    <ProtectedRoleScreen
      eyebrow="PAGAMENTO"
      requiredRole="client"
      subtitle="Pague pela chave ou pelo QR Code e envie o comprovante para análise."
      title="PIX"
    >
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.replace("/pedidos")} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Voltar aos pedidos</Text>
        </Pressable>
        <Pressable onPress={() => void loadPayment()} style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>↻ Atualizar</Text>
        </Pressable>
      </View>

      {feedback ? (
        <View style={feedback.tone === "success" ? styles.successCard : styles.errorCard}>
          <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>
            {feedback.text}
          </Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.muted}>Carregando dados do PIX...</Text>
        </View>
      ) : !order || !settings ? (
        <View style={styles.stateCard}>
          <Text style={styles.errorTitle}>PIX indisponível</Text>
          <Text style={styles.muted}>O pedido ou a configuração não foi encontrado.</Text>
        </View>
      ) : order.payment_status === "paid" || submission?.status === "approved" ? (
        <View style={styles.stateCard}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.stateTitle}>Pagamento aprovado</Text>
          <Text style={styles.muted}>O pedido #{formatOrder(order.order_number)} já está marcado como pago.</Text>
          <Pressable onPress={() => router.replace("/pedidos")} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Acompanhar pedido</Text>
          </Pressable>
        </View>
      ) : !settings.is_enabled || !settings.pix_key ? (
        <View style={styles.stateCard}>
          <Text style={styles.errorTitle}>PIX temporariamente indisponível</Text>
          <Text style={styles.muted}>Escolha o pagamento por cartão ou tente novamente mais tarde.</Text>
        </View>
      ) : (
        <View style={styles.layout}>
          <View style={styles.paymentCard}>
            <Text style={styles.eyebrow}>PEDIDO #{formatOrder(order.order_number)}</Text>
            <Text style={styles.title}>{order.ticket_drafts?.event_name ?? "Ingresso SeuChico"}</Text>
            <Text style={styles.totalLabel}>VALOR EXATO</Text>
            <Text style={styles.totalValue}>{formatCurrency(order.total_cents)}</Text>

            {settings.pix_copy_paste ? (
              <View style={styles.qrPanel}>
                <View style={styles.qrCard}>
                  <QRCode backgroundColor="#FFFFFF" color="#071D2D" size={190} value={settings.pix_copy_paste} />
                </View>
                <Text style={styles.qrTitle}>Escaneie o QR Code no aplicativo do seu banco</Text>
                <Pressable onPress={() => void handleCopy(settings.pix_copy_paste!, "PIX Copia e Cola")} style={styles.darkButton}>
                  <Text style={styles.darkButtonText}>Copiar PIX Copia e Cola</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.keyCard}>
              <Text style={styles.keyLabel}>CHAVE PIX · {pixKeyTypeLabel(settings.pix_key_type)}</Text>
              <Text selectable style={styles.keyValue}>{settings.pix_key}</Text>
              <Pressable onPress={() => void handleCopy(settings.pix_key!, "Chave PIX")} style={styles.copyButton}>
                <Text style={styles.copyButtonText}>Copiar chave</Text>
              </Pressable>
            </View>

            <View style={styles.recipientGrid}>
              <Info label="FAVORECIDO" value={settings.recipient_name ?? "Não informado"} />
              <Info label="CIDADE" value={settings.recipient_city ?? "Não informada"} />
            </View>

            {settings.instructions ? <Text style={styles.instructions}>{settings.instructions}</Text> : null}
          </View>

          <View style={styles.proofCard}>
            <Text style={styles.eyebrow}>COMPROVANTE</Text>
            <Text style={styles.darkTitle}>Confirme que realizou o pagamento</Text>

            {submission?.status === "pending" ? (
              <View style={styles.pendingCard}>
                <Text style={styles.pendingTitle}>Comprovante em análise</Text>
                <Text style={styles.pendingText}>Aguarde a aprovação. O pedido ainda não entrou em produção.</Text>
                {proofUrl ? (
                  <Pressable onPress={() => void Linking.openURL(proofUrl)} style={styles.outlineButton}>
                    <Text style={styles.outlineButtonText}>Ver comprovante enviado</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : submission?.status === "rejected" ? (
              <View style={styles.rejectedCard}>
                <Text style={styles.rejectedTitle}>Comprovante não aprovado</Text>
                <Text style={styles.rejectedText}>{submission.admin_note || "Confira os dados e envie um novo comprovante."}</Text>
              </View>
            ) : null}

            {canSubmit ? (
              <>
                <Text style={styles.helpText}>Formatos aceitos: JPG, PNG, WEBP ou PDF, com até 10 MB.</Text>
                <Pressable disabled={isPicking} onPress={() => void handlePickProof()} style={styles.uploadButton}>
                  <Text style={styles.uploadButtonText}>{isPicking ? "Abrindo arquivos..." : proof ? "Trocar comprovante" : "Escolher comprovante"}</Text>
                </Pressable>
                {proof ? (
                  <View style={styles.selectedFile}>
                    <Text numberOfLines={1} style={styles.selectedFileName}>{proof.name}</Text>
                    <Text style={styles.selectedFileMeta}>{proof.size ? formatFileSize(proof.size) : "Arquivo selecionado"}</Text>
                  </View>
                ) : null}
                <Text style={styles.label}>Observação (opcional)</Text>
                <TextInput
                  maxLength={500}
                  multiline
                  onChangeText={setNote}
                  placeholder="Ex.: pagamento feito em nome de..."
                  placeholderTextColor="#91A4AD"
                  style={styles.noteInput}
                  value={note}
                />
                <Pressable
                  disabled={isSubmitting || !proof}
                  onPress={() => void handleSubmit()}
                  style={[styles.primaryButton, (isSubmitting || !proof) && styles.disabled]}
                >
                  {isSubmitting ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                  <Text style={styles.primaryButtonText}>{isSubmitting ? "Enviando..." : "Já paguei · enviar comprovante"}</Text>
                </Pressable>
              </>
            ) : null}

            <View style={styles.securityCard}>
              <Text style={styles.securityTitle}>CONFERÊNCIA MANUAL</Text>
              <Text style={styles.securityText}>O envio do comprovante não confirma o pagamento automaticamente. O pedido só será liberado após a conferência do administrador.</Text>
            </View>
          </View>
        </View>
      )}
    </ProtectedRoleScreen>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatOrder(value: number) {
  return String(value).padStart(5, "0");
}

function pixKeyTypeLabel(value: string) {
  const labels: Record<string, string> = { random: "ALEATÓRIA", email: "E-MAIL", phone: "TELEFONE", cpf: "CPF", cnpj: "CNPJ" };
  return labels[value] ?? "CHAVE";
}

function formatFileSize(value: number) {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function translatePixError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("PIX_NOT_CONFIGURED")) return "O PIX foi desativado ou ainda não foi configurado.";
  if (message.includes("ORDER_NOT_AWAITING_PAYMENT")) return "Este pedido não está mais aguardando pagamento.";
  if (message.includes("CARD_PAYMENT_IN_PROGRESS")) return "Existe um pagamento por cartão em processamento. Aguarde a confirmação antes de enviar um PIX.";
  if (message.includes("FILE_TOO_LARGE")) return "O comprovante deve ter no máximo 10 MB.";
  return "Não foi possível enviar o comprovante. Confira sua conexão e tente novamente.";
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 14 },
  backButton: { paddingVertical: 9 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  refreshButton: { borderRadius: 12, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 10 },
  refreshButtonText: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  layout: { flexDirection: Platform.OS === "web" ? "row" : "column", alignItems: "flex-start", gap: 16 },
  paymentCard: { ...visualShadows.hero, flex: 0.9, width: Platform.OS === "web" ? undefined : "100%", gap: 14, borderRadius: 24, backgroundColor: "#071D2D", padding: Platform.OS === "web" ? 25 : 20 },
  proofCard: { ...visualShadows.card, flex: 1.1, width: Platform.OS === "web" ? undefined : "100%", gap: 14, borderRadius: 24, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: Platform.OS === "web" ? 25 : 20 },
  eyebrow: { color: "#38D6D2", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: "#FFFFFF", fontSize: 22, lineHeight: 28, fontWeight: "900" },
  darkTitle: { color: "#102A43", fontSize: 22, lineHeight: 28, fontWeight: "900" },
  totalLabel: { color: "#A9C0C9", fontSize: 8, fontWeight: "900", letterSpacing: 1.2, marginTop: 5 },
  totalValue: { color: "#38D6D2", fontSize: 35, fontWeight: "900" },
  qrPanel: { alignItems: "center", gap: 11, borderRadius: 18, backgroundColor: "#FFFFFF", padding: 18 },
  qrCard: { borderRadius: 12, backgroundColor: "#FFFFFF", padding: 8 },
  qrTitle: { color: "#102A43", fontSize: 11, lineHeight: 17, fontWeight: "800", textAlign: "center" },
  darkButton: { borderRadius: 12, backgroundColor: "#071D2D", paddingHorizontal: 15, paddingVertical: 11 },
  darkButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  keyCard: { gap: 8, borderRadius: 16, borderWidth: 1, borderColor: "#315064", backgroundColor: "#102D3D", padding: 15 },
  keyLabel: { color: "#A9C0C9", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  keyValue: { color: "#FFFFFF", fontSize: 13, lineHeight: 20, fontWeight: "800" },
  copyButton: { alignSelf: "flex-start", borderRadius: 10, backgroundColor: "#38D6D2", paddingHorizontal: 13, paddingVertical: 9 },
  copyButtonText: { color: "#071D2D", fontSize: 10, fontWeight: "900" },
  recipientGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  infoItem: { minWidth: 130, flex: 1, gap: 4 },
  infoLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  infoValue: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  instructions: { color: "#C9D8DE", fontSize: 10, lineHeight: 17 },
  stateCard: { minHeight: 260, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30 },
  stateTitle: { color: "#102A43", fontSize: 21, fontWeight: "900" },
  errorTitle: { color: "#8A3325", fontSize: 20, fontWeight: "900" },
  successIcon: { width: 55, height: 55, borderRadius: 28, backgroundColor: "#DFF6EC", color: "#176A50", fontSize: 28, lineHeight: 55, fontWeight: "900", textAlign: "center" },
  muted: { maxWidth: 500, color: "#627D8A", fontSize: 12, lineHeight: 19, textAlign: "center" },
  pendingCard: { gap: 7, borderRadius: 15, borderWidth: 1, borderColor: "#F0D4A7", backgroundColor: "#FFF8EC", padding: 14 },
  pendingTitle: { color: "#77530D", fontSize: 12, fontWeight: "900" },
  pendingText: { color: "#866B38", fontSize: 10, lineHeight: 16 },
  rejectedCard: { gap: 7, borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 14 },
  rejectedTitle: { color: "#8A3325", fontSize: 12, fontWeight: "900" },
  rejectedText: { color: "#8A5A52", fontSize: 10, lineHeight: 16 },
  helpText: { color: "#627D8A", fontSize: 10, lineHeight: 16 },
  uploadButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderStyle: "dashed", borderColor: "#8BB8C2", backgroundColor: "#F4FAFB", padding: 13 },
  uploadButtonText: { color: "#087E83", fontSize: 11, fontWeight: "900" },
  selectedFile: { borderRadius: 13, backgroundColor: "#EDF7F7", padding: 13 },
  selectedFileName: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  selectedFileMeta: { color: "#627D8A", fontSize: 9, marginTop: 4 },
  label: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  noteInput: { minHeight: 90, borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#F9FBFC", color: "#102A43", fontSize: 13, padding: 13, textAlignVertical: "top" },
  primaryButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 13, backgroundColor: "#38D6D2", paddingHorizontal: 16, paddingVertical: 12 },
  primaryButtonText: { color: "#071D2D", fontSize: 11, fontWeight: "900", textAlign: "center" },
  outlineButton: { alignSelf: "flex-start", borderRadius: 11, borderWidth: 1, borderColor: "#C8A86A", backgroundColor: "#FFFFFF", paddingHorizontal: 13, paddingVertical: 9, marginTop: 4 },
  outlineButtonText: { color: "#77530D", fontSize: 10, fontWeight: "900" },
  securityCard: { borderRadius: 14, backgroundColor: "#EDF7F7", padding: 13 },
  securityTitle: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  securityText: { color: "#52717D", fontSize: 9, lineHeight: 15, marginTop: 5 },
  successCard: { borderRadius: 15, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 14, marginBottom: 14 },
  successText: { color: "#176A50", fontSize: 11, fontWeight: "800" },
  errorCard: { borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 14, marginBottom: 14 },
  errorText: { color: "#8A3325", fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.5 },
});
