import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import { formatCurrency, formatDatabaseDate } from "../lib/tickets";
import { supabase } from "../lib/supabase";
import { detectCurrentAddress, locationErrorMessage } from "../lib/user-location";

type CheckoutDraft = {
  id: string;
  event_name: string;
  event_date: string;
  event_time: string;
  location: string;
  quantity: number;
  primary_color: string;
  accent_color: string;
  status: "draft" | "ordered";
  ticket_templates: { name: string } | null;
};

type Pricing = {
  unit_price_cents: number;
  delivery_fee_cents: number;
};

export default function CheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ draft?: string | string[] }>();
  const draftId = firstParam(params.draft);
  const { session, profile } = useAuth();

  const [draft, setDraft] = useState<CheckoutDraft | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [reference, setReference] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const handleUseLocation = async () => {
    if (isLocating) return;

    setIsLocating(true);
    setLocationMessage(null);

    try {
      const address = await detectCurrentAddress();

      if (address.zipCode) setZipCode(formatZipCode(address.zipCode));
      if (address.street) setStreet(address.street);
      if (address.number) setNumber(address.number);
      if (address.neighborhood) setNeighborhood(address.neighborhood);
      if (address.city) setCity(address.city);
      if (address.state) setState(address.state);

      const missing = [
        !address.zipCode && "CEP",
        !address.street && "rua",
        !address.number && "número",
        !address.neighborhood && "bairro",
        !address.city && "cidade",
        !address.state && "UF",
      ].filter(Boolean);

      setLocationMessage({
        tone: "success",
        text: missing.length
          ? `Endereço preenchido. Complete: ${missing.join(", ")}.`
          : "Endereço preenchido. Confira os dados antes de confirmar.",
      });
    } catch (error) {
      setLocationMessage({ tone: "error", text: locationErrorMessage(error) });
    } finally {
      setIsLocating(false);
    }
  };

  useEffect(() => {
    if (!profile) return;
    setRecipient((current) => current || profile.full_name);
    setPhone((current) => current || profile.phone || "");
  }, [profile]);

  useEffect(() => {
    if (!session?.user.id) return;

    let isMounted = true;

    const loadCheckout = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      if (!draftId) {
        setErrorMessage("Selecione um rascunho antes de abrir o checkout.");
        setIsLoading(false);
        return;
      }

      const [draftResult, pricingResult] = await Promise.all([
        supabase
          .from("ticket_drafts")
          .select(
            "id, event_name, event_date, event_time, location, quantity, primary_color, accent_color, status, ticket_templates(name)",
          )
          .eq("id", draftId)
          .eq("user_id", session.user.id)
          .single(),
        supabase
          .from("pricing_settings")
          .select("unit_price_cents, delivery_fee_cents")
          .eq("id", 1)
          .single(),
      ]);

      if (!isMounted) return;

      if (draftResult.error || !draftResult.data) {
        setErrorMessage("O rascunho não foi encontrado ou não pertence à sua conta.");
      } else if (pricingResult.error || !pricingResult.data) {
        setErrorMessage(
          "Os preços ainda não foram configurados. Confirme o SQL da Etapa 6.",
        );
      } else {
        const loadedDraft = draftResult.data as unknown as CheckoutDraft;

        if (loadedDraft.status !== "draft") {
          setErrorMessage("Este rascunho já foi transformado em pedido.");
        } else {
          setDraft(loadedDraft);
          setPricing(pricingResult.data as Pricing);
        }
      }

      setIsLoading(false);
    };

    void loadCheckout();

    return () => {
      isMounted = false;
    };
  }, [draftId, session?.user.id]);

  const handleCreateOrder = async () => {
    if (!draft || !pricing) return;

    setFormMessage(null);

    const phoneDigits = phone.replace(/\D/g, "");
    const zipDigits = zipCode.replace(/\D/g, "");
    const stateCode = state.trim().toUpperCase();

    if (
      !recipient.trim() ||
      !phoneDigits ||
      !zipDigits ||
      !street.trim() ||
      !number.trim() ||
      !neighborhood.trim() ||
      !city.trim() ||
      !stateCode
    ) {
      showFormError(
        "Endereço incompleto",
        "Preencha todos os campos marcados com asterisco.",
      );
      return;
    }

    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      showFormError("Telefone inválido", "Digite o DDD e o número do telefone.");
      return;
    }

    if (zipDigits.length !== 8) {
      showFormError("CEP inválido", "O CEP precisa ter exatamente 8 números.");
      return;
    }

    if (!/^[A-Z]{2}$/.test(stateCode)) {
      showFormError("Estado inválido", "Use a sigla com duas letras, como DF.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.rpc("create_order_from_draft", {
        p_draft_id: draft.id,
        p_recipient: recipient.trim(),
        p_phone: phoneDigits,
        p_zip_code: zipDigits,
        p_street: street.trim(),
        p_number: number.trim(),
        p_complement: complement.trim() || null,
        p_neighborhood: neighborhood.trim(),
        p_city: city.trim(),
        p_state: stateCode,
        p_reference: reference.trim() || null,
      });

      if (error) {
        showFormError(
          "Não foi possível criar o pedido",
          translateOrderError(error.message),
        );
        return;
      }

      const createdOrder = Array.isArray(data) ? data[0] : null;
      const orderNumber = createdOrder?.created_order_number;

      if (Platform.OS !== "web") {
        Alert.alert(
          "Pedido criado",
          orderNumber
            ? `Pedido #${String(orderNumber).padStart(5, "0")} criado. Abra Meus pedidos para realizar o pagamento.`
            : "Pedido criado. Abra Meus pedidos para realizar o pagamento.",
        );
      }

      router.replace("/pedidos");
    } catch {
      showFormError(
        "Não foi possível criar o pedido",
        "Houve uma falha de conexão. Tente novamente em instantes.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const showFormError = (title: string, message: string) => {
    setFormMessage(`${title}: ${message}`);

    if (Platform.OS !== "web") {
      Alert.alert(title, message);
    }
  };

  const subtotal = draft && pricing ? draft.quantity * pricing.unit_price_cents : 0;
  const total = pricing ? subtotal + pricing.delivery_fee_cents : 0;

  return (
    <ProtectedRoleScreen
      eyebrow="FINALIZAR PEDIDO"
      requiredRole="client"
      subtitle="Confira o projeto, informe onde deseja receber e revise o valor total."
      title="Checkout"
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/rascunhos")}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>← Voltar aos rascunhos</Text>
        </Pressable>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color="#087E83" size="large" />
            <Text style={styles.stateText}>Preparando checkout...</Text>
          </View>
        ) : errorMessage || !draft || !pricing ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorTitle}>Checkout indisponível</Text>
            <Text style={styles.stateText}>{errorMessage}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/rascunhos")}
              style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
            >
              <Text style={styles.darkButtonText}>Voltar aos rascunhos</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.layout}>
            <View style={styles.formCard}>
              <Text style={styles.cardEyebrow}>ENDEREÇO DE ENTREGA</Text>
              <Text style={styles.cardTitle}>Quem receberá o pedido?</Text>

              {Platform.OS !== "web" ? (
                <View style={styles.locationBox}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.72}
                    disabled={isLocating}
                    onPress={() => void handleUseLocation()}
                    style={[styles.locationButton, isLocating && styles.disabled]}
                  >
                    {isLocating ? <ActivityIndicator color="#087E83" size="small" /> : null}
                    <Text style={styles.locationButtonText}>
                      {isLocating ? "Buscando localização..." : "📍 Usar minha localização"}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.locationHint}>
                    Usamos sua localização uma única vez, só para preencher o endereço abaixo. Ela não é guardada, e você confere tudo antes de confirmar.
                  </Text>
                  {locationMessage ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={locationMessage.tone === "success" ? styles.locationSuccess : styles.locationError}
                    >
                      {locationMessage.text}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <InputField
                label="Nome do destinatário *"
                maxLength={100}
                onChangeText={setRecipient}
                placeholder="Nome completo"
                value={recipient}
              />
              <InputField
                keyboardType="phone-pad"
                label="Telefone com DDD *"
                maxLength={16}
                onChangeText={setPhone}
                placeholder="(61) 99999-9999"
                value={phone}
              />

              <View style={styles.twoColumns}>
                <View style={styles.columnWide}>
                  <InputField
                    keyboardType="number-pad"
                    label="CEP *"
                    maxLength={9}
                    onChangeText={(value) => setZipCode(formatZipCode(value))}
                    placeholder="00000-000"
                    value={zipCode}
                  />
                </View>
                <View style={styles.columnSmall}>
                  <InputField
                    autoCapitalize="characters"
                    label="UF *"
                    maxLength={2}
                    onChangeText={(value) => setState(value.toUpperCase())}
                    placeholder="DF"
                    value={state}
                  />
                </View>
              </View>

              <InputField
                label="Rua ou avenida *"
                maxLength={160}
                onChangeText={setStreet}
                placeholder="Nome da rua"
                value={street}
              />

              <View style={styles.twoColumns}>
                <View style={styles.columnSmall}>
                  <InputField
                    label="Número *"
                    maxLength={20}
                    onChangeText={setNumber}
                    placeholder="123"
                    value={number}
                  />
                </View>
                <View style={styles.columnWide}>
                  <InputField
                    label="Complemento"
                    maxLength={120}
                    onChangeText={setComplement}
                    placeholder="Casa, bloco ou apartamento"
                    value={complement}
                  />
                </View>
              </View>

              <InputField
                label="Bairro *"
                maxLength={100}
                onChangeText={setNeighborhood}
                placeholder="Seu bairro"
                value={neighborhood}
              />
              <InputField
                label="Cidade *"
                maxLength={100}
                onChangeText={setCity}
                placeholder="Sua cidade"
                value={city}
              />
              <InputField
                label="Ponto de referência"
                maxLength={200}
                onChangeText={setReference}
                placeholder="Próximo a..."
                value={reference}
              />
            </View>

            <View style={styles.summaryColumn}>
              <View
                style={[
                  styles.ticketSummary,
                  { backgroundColor: draft.primary_color },
                ]}
              >
                <View
                  style={[
                    styles.ticketAccent,
                    { backgroundColor: draft.accent_color },
                  ]}
                />
                <Text style={styles.templateName}>
                  {draft.ticket_templates?.name ?? "Modelo SeuChico"}
                </Text>
                <Text style={styles.eventName}>{draft.event_name}</Text>
                <Text style={styles.eventDetails}>
                  {formatDatabaseDate(draft.event_date)} · {draft.event_time.slice(0, 5)}
                </Text>
                <Text numberOfLines={2} style={styles.eventDetails}>
                  {draft.location}
                </Text>
              </View>

              <View style={styles.priceCard}>
                <Text style={styles.cardEyebrow}>RESUMO DO PEDIDO</Text>
                <PriceRow
                  label={`${draft.quantity} ingressos × ${formatCurrency(pricing.unit_price_cents)}`}
                  value={formatCurrency(subtotal)}
                />
                <PriceRow
                  label="Entrega"
                  value={formatCurrency(pricing.delivery_fee_cents)}
                />
                <View style={styles.divider} />
                <PriceRow label="Total" value={formatCurrency(total)} total />

                <View style={styles.paymentNotice}>
                  <Text style={styles.paymentNoticeTitle}>Pagamento na próxima tela</Text>
                  <Text style={styles.paymentNoticeText}>
                    Depois de confirmar o pedido, escolha PIX com comprovante ou cartão.
                  </Text>
                </View>

                {formMessage ? (
                  <View accessibilityLiveRegion="polite" style={styles.formMessage}>
                    <Text style={styles.formMessageText}>{formMessage}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.72}
                  disabled={isSubmitting}
                  onPress={handleCreateOrder}
                  style={[
                    styles.confirmButton,
                    isSubmitting && styles.disabled,
                  ]}
                >
                  <Text style={styles.confirmButtonText}>
                    {isSubmitting ? "Criando pedido..." : "Confirmar pedido"}
                  </Text>
                  <Text style={styles.confirmArrow}>→</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </ProtectedRoleScreen>
  );
}

type InputFieldProps = {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "number-pad" | "phone-pad";
  label: string;
  maxLength?: number;
  onChangeText: (value: string) => void;
  placeholder: string;
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

function PriceRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <View style={styles.priceRow}>
      <Text style={total ? styles.totalLabel : styles.priceLabel}>{label}</Text>
      <Text style={total ? styles.totalValue : styles.priceValue}>{value}</Text>
    </View>
  );
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatZipCode(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function translateOrderError(message: string) {
  if (message.includes("DRAFT_ALREADY_ORDERED")) {
    return "Este rascunho já foi transformado em pedido.";
  }
  if (message.includes("INVALID_")) {
    return "Confira os dados do endereço e tente novamente.";
  }
  if (message.includes("CLIENT_ACCOUNT_REQUIRED")) {
    return "Sua conta não está autorizada a criar pedidos.";
  }
  return "Confira sua conexão e tente novamente.";
}

const styles = StyleSheet.create({
  backButton: { alignSelf: "flex-start", paddingVertical: 10, marginTop: 12, marginBottom: 8 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  layout: {
    width: "100%",
    flexDirection: Platform.OS === "web" ? "row" : "column",
    alignItems: "flex-start",
    gap: 18,
  },
  formCard: {
    ...visualShadows.card,
    flexGrow: 1.05,
    flexShrink: 1,
    flexBasis: Platform.OS === "web" ? 0 : "auto",
    minWidth: 0,
    width: Platform.OS === "web" ? undefined : "100%",
    gap: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    backgroundColor: "#FFFFFF",
    padding: Platform.OS === "web" ? 25 : 20,
  },
  cardEyebrow: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  cardTitle: { color: "#102A43", fontSize: 21, fontWeight: "900", marginBottom: 4 },
  locationBox: { gap: 8, borderRadius: 16, borderWidth: 1, borderColor: "#CFE8E8", backgroundColor: "#F3FBFB", padding: 14 },
  locationButton: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 13, borderWidth: 1, borderColor: "#087E83", backgroundColor: "#FFFFFF", paddingHorizontal: 14 },
  locationButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  locationHint: { color: "#627D8A", fontSize: 10, lineHeight: 16 },
  locationSuccess: { color: "#176A50", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  locationError: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  fieldGroup: { gap: 8 },
  label: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D4E1E5",
    backgroundColor: "#F9FBFC",
    color: "#102A43",
    fontSize: 14,
    paddingHorizontal: 15,
  },
  twoColumns: { flexDirection: "row", gap: 12 },
  columnSmall: { flex: 0.42 },
  columnWide: { flex: 1 },
  summaryColumn: {
    flexGrow: 0.95,
    flexShrink: 1,
    flexBasis: Platform.OS === "web" ? 0 : "auto",
    minWidth: 0,
    width: Platform.OS === "web" ? undefined : "100%",
    gap: 14,
    position: "relative",
    zIndex: 2,
  },
  ticketSummary: { minHeight: 215, justifyContent: "flex-end", borderRadius: 24, padding: 23 },
  ticketAccent: { position: "absolute", top: 22, left: 23, width: 55, height: 4, borderRadius: 2 },
  templateName: { color: "#BFD0D7", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  eventName: { color: "#FFFFFF", fontSize: 29, lineHeight: 34, fontWeight: "900", textTransform: "uppercase", marginTop: 9 },
  eventDetails: { color: "#DCE7EA", fontSize: 10, lineHeight: 16, fontWeight: "700", marginTop: 5 },
  priceCard: { ...visualShadows.hero, borderRadius: 24, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 23 },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 15, marginTop: 15 },
  priceLabel: { flex: 1, color: "#627D8A", fontSize: 12 },
  priceValue: { color: "#102A43", fontSize: 13, fontWeight: "800" },
  divider: { height: 1, backgroundColor: "#DCE7EA", marginTop: 18 },
  totalLabel: { color: "#102A43", fontSize: 15, fontWeight: "900" },
  totalValue: { color: "#087E83", fontSize: 20, fontWeight: "900" },
  paymentNotice: { borderRadius: 14, backgroundColor: "#FFF5E9", padding: 14, marginTop: 20 },
  paymentNoticeTitle: { color: "#7A4B1C", fontSize: 11, fontWeight: "900" },
  paymentNoticeText: { color: "#8A6848", fontSize: 10, lineHeight: 16, marginTop: 4 },
  formMessage: { borderRadius: 14, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 13, marginTop: 14 },
  formMessageText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  confirmButton: { height: 55, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 13, borderRadius: 15, backgroundColor: "#38D6D2", marginTop: 18, position: "relative", zIndex: 3 },
  confirmButtonText: { color: "#071D2D", fontSize: 14, fontWeight: "900" },
  confirmArrow: { color: "#071D2D", fontSize: 20, fontWeight: "900" },
  stateCard: { minHeight: 240, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30, marginTop: 14 },
  stateText: { maxWidth: 460, color: "#627D8A", fontSize: 13, lineHeight: 20, textAlign: "center" },
  errorTitle: { color: "#8A3325", fontSize: 18, fontWeight: "900" },
  darkButton: { borderRadius: 13, backgroundColor: "#071D2D", padding: 13 },
  darkButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});
