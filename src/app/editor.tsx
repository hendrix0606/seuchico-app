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
  View,
} from "react-native";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import {
  categoryDetails,
  colorPalettes,
  formatDatabaseDate,
  normalizeDate,
} from "../lib/tickets";
import { supabase } from "../lib/supabase";
import type { TicketDraft, TicketTemplate } from "../types/tickets";

export default function TicketEditorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    draft?: string | string[];
    template?: string | string[];
  }>();
  const { session } = useAuth();
  const templateParam = firstParam(params.template);
  const draftParam = firstParam(params.draft);

  const [template, setTemplate] = useState<TicketTemplate | null>(null);
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [location, setLocation] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#12364A");
  const [accentColor, setAccentColor] = useState("#38D6D2");
  const [quantity, setQuantity] = useState("50");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user.id) return;

    let isMounted = true;

    const loadTemplate = async (templateId: string) => {
      const { data, error } = await supabase
        .from("ticket_templates")
        .select(
          "id, slug, name, category, description, primary_color, accent_color, sort_order",
        )
        .eq("id", templateId)
        .single();

      if (!isMounted) return null;
      if (error) return null;

      const selectedTemplate = data as TicketTemplate;
      setTemplate(selectedTemplate);
      return selectedTemplate;
    };

    const loadEditor = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      if (draftParam) {
        const { data, error } = await supabase
          .from("ticket_drafts")
          .select(
            "id, template_id, event_name, event_date, event_time, location, primary_color, accent_color, quantity, notes, status, updated_at",
          )
          .eq("id", draftParam)
          .single();

        if (!isMounted) return;

        if (error || !data) {
          setErrorMessage(
            "Este rascunho não foi encontrado ou não pertence à sua conta.",
          );
          setIsLoading(false);
          return;
        }

        const draft = data as TicketDraft;

        if (draft.status === "ordered") {
          setErrorMessage(
            "Este projeto já foi transformado em pedido e não pode mais ser alterado.",
          );
          setIsLoading(false);
          return;
        }

        const loadedTemplate = await loadTemplate(draft.template_id);

        if (!loadedTemplate) {
          setErrorMessage("O modelo deste rascunho não está mais disponível.");
          setIsLoading(false);
          return;
        }

        setEventName(draft.event_name);
        setEventDate(formatDatabaseDate(draft.event_date));
        setEventTime(draft.event_time.slice(0, 5));
        setLocation(draft.location);
        setPrimaryColor(draft.primary_color);
        setAccentColor(draft.accent_color);
        setQuantity(String(draft.quantity));
        setNotes(draft.notes ?? "");
        setIsLoading(false);
        return;
      }

      if (templateParam) {
        const loadedTemplate = await loadTemplate(templateParam);

        if (!loadedTemplate) {
          setErrorMessage("O modelo selecionado não foi encontrado.");
        } else {
          setPrimaryColor(loadedTemplate.primary_color);
          setAccentColor(loadedTemplate.accent_color);
        }

        setIsLoading(false);
        return;
      }

      setErrorMessage("Escolha um modelo no catálogo antes de abrir o editor.");
      setIsLoading(false);
    };

    void loadEditor();

    return () => {
      isMounted = false;
    };
  }, [draftParam, session?.user.id, templateParam]);

  const handleSave = async () => {
    if (!session?.user.id || !template) return;

    const normalizedDate = normalizeDate(eventDate);
    const normalizedTime = eventTime.trim();
    const parsedQuantity = Number.parseInt(quantity, 10);

    if (!eventName.trim() || !eventDate.trim() || !eventTime.trim() || !location.trim()) {
      Alert.alert(
        "Preencha os dados",
        "Nome, data, horário e local são obrigatórios.",
      );
      return;
    }

    if (!normalizedDate) {
      Alert.alert("Data inválida", "Use o formato DD/MM/AAAA.");
      return;
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedTime)) {
      Alert.alert("Horário inválido", "Use o formato HH:MM, como 19:30.");
      return;
    }

    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 5000) {
      Alert.alert("Quantidade inválida", "Escolha uma quantidade entre 1 e 5000.");
      return;
    }

    if (eventName.trim().length > 80 || location.trim().length > 160) {
      Alert.alert(
        "Texto muito longo",
        "Reduza o nome do evento ou o endereço informado.",
      );
      return;
    }

    if (notes.trim().length > 500) {
      Alert.alert("Observações muito longas", "Use no máximo 500 caracteres.");
      return;
    }

    setIsSaving(true);

    const draftData = {
      template_id: template.id,
      event_name: eventName.trim(),
      event_date: normalizedDate,
      event_time: normalizedTime,
      location: location.trim(),
      primary_color: primaryColor,
      accent_color: accentColor,
      quantity: parsedQuantity,
      notes: notes.trim() || null,
    };

    const result = draftParam
      ? await supabase
          .from("ticket_drafts")
          .update({ ...draftData, updated_at: new Date().toISOString() })
          .eq("id", draftParam)
      : await supabase.from("ticket_drafts").insert({
          ...draftData,
          user_id: session.user.id,
        });

    setIsSaving(false);

    if (result.error) {
      Alert.alert(
        "Não foi possível salvar",
        "Confira sua conexão e tente novamente.",
      );
      return;
    }

    Alert.alert(
      draftParam ? "Rascunho atualizado" : "Rascunho salvo",
      "Seu ingresso foi salvo com segurança.",
    );
    router.replace("/rascunhos");
  };

  const category = template ? categoryDetails(template.category) : null;

  return (
    <ProtectedRoleScreen
      eyebrow="EDITOR DE INGRESSOS"
      requiredRole="client"
      subtitle="Preencha os dados e acompanhe a pré-visualização enquanto personaliza."
      title={draftParam ? "Continue criando" : "Personalize"}
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace(draftParam ? "/rascunhos" : "/catalogo")}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backButtonText}>
              ← {draftParam ? "Meus rascunhos" : "Voltar ao catálogo"}
            </Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color="#087E83" size="large" />
            <Text style={styles.stateText}>Preparando o editor...</Text>
          </View>
        ) : errorMessage || !template ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorTitle}>Editor indisponível</Text>
            <Text style={styles.stateText}>{errorMessage}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/catalogo")}
              style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
            >
              <Text style={styles.darkButtonText}>Escolher um modelo</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.editorLayout}>
            <View style={styles.formCard}>
              <View style={styles.templateRow}>
                <Text style={styles.templateIcon}>{category?.icon}</Text>
                <View style={styles.templateText}>
                  <Text style={styles.templateLabel}>{category?.label}</Text>
                  <Text style={styles.templateName}>{template.name}</Text>
                </View>
              </View>

              <InputField
                label="Nome do evento"
                maxLength={80}
                onChangeText={setEventName}
                placeholder="Ex.: Aniversário da Ana"
                value={eventName}
              />

              <View style={styles.twoColumns}>
                <View style={styles.columnField}>
                  <InputField
                    keyboardType="numbers-and-punctuation"
                    label="Data"
                    maxLength={10}
                    onChangeText={setEventDate}
                    placeholder="DD/MM/AAAA"
                    value={eventDate}
                  />
                </View>
                <View style={styles.columnField}>
                  <InputField
                    keyboardType="numbers-and-punctuation"
                    label="Horário"
                    maxLength={5}
                    onChangeText={setEventTime}
                    placeholder="19:30"
                    value={eventTime}
                  />
                </View>
              </View>

              <InputField
                label="Local do evento"
                maxLength={160}
                onChangeText={setLocation}
                placeholder="Nome do local ou endereço"
                value={location}
              />

              <InputField
                keyboardType="number-pad"
                label="Quantidade de ingressos fisicos"
                maxLength={4}
                onChangeText={(value) => setQuantity(value.replace(/\D/g, ""))}
                placeholder="50"
                value={quantity}
              />

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Cores do ingresso</Text>
                <View style={styles.palettes}>
                  {colorPalettes.map((palette) => {
                    const isSelected =
                      palette.primary === primaryColor && palette.accent === accentColor;

                    return (
                      <Pressable
                        accessibilityLabel={`Paleta ${palette.name}`}
                        accessibilityRole="button"
                        key={palette.name}
                        onPress={() => {
                          setPrimaryColor(palette.primary);
                          setAccentColor(palette.accent);
                        }}
                        style={({ pressed }) => [
                          styles.paletteButton,
                          isSelected && styles.paletteButtonSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.paletteDots}>
                          <View
                            style={[styles.colorDot, { backgroundColor: palette.primary }]}
                          />
                          <View
                            style={[styles.colorDot, { backgroundColor: palette.accent }]}
                          />
                        </View>
                        <Text style={styles.paletteName}>{palette.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Observações para produção</Text>
                  <Text style={styles.counter}>{notes.length}/500</Text>
                </View>
                <TextInput
                  maxLength={500}
                  multiline
                  onChangeText={setNotes}
                  placeholder="Detalhes opcionais para a equipe do SeuChico"
                  placeholderTextColor="#91A4AD"
                  style={styles.notesInput}
                  textAlignVertical="top"
                  value={notes}
                />
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={handleSave}
                style={({ pressed }) => [
                  styles.saveButton,
                  isSaving && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.saveButtonText}>
                  {isSaving
                    ? "Salvando..."
                    : draftParam
                      ? "Atualizar rascunho"
                      : "Salvar rascunho"}
                </Text>
                <Text style={styles.saveArrow}>→</Text>
              </Pressable>
            </View>

            <View style={styles.previewColumn}>
              <Text style={styles.previewEyebrow}>PRÉ-VISUALIZAÇÃO</Text>
              <Text style={styles.previewHelp}>
                Esta é uma simulação do ingresso físico.
              </Text>

              <View style={[styles.ticketPreview, { backgroundColor: primaryColor }]}>
                <View style={styles.ticketHeader}>
                  <Text style={[styles.ticketBrand, { color: accentColor }]}>SEUCHICO</Text>
                  <Text style={styles.ticketSerial}>Nº 001</Text>
                </View>

                <View>
                  <View style={[styles.ticketBadge, { borderColor: accentColor }]}>
                    <Text style={[styles.ticketBadgeText, { color: accentColor }]}>INGRESSO</Text>
                  </View>
                  <Text numberOfLines={3} style={styles.ticketEventName}>
                    {eventName.trim() || "SEU EVENTO INCRÍVEL"}
                  </Text>
                </View>

                <View style={[styles.ticketDivider, { borderColor: accentColor }]} />

                <View style={styles.ticketInfoGrid}>
                  <PreviewInfo label="DATA" value={eventDate || "DD/MM/AAAA"} />
                  <PreviewInfo label="HORÁRIO" value={eventTime || "--:--"} />
                  <PreviewInfo label="LOCAL" value={location || "Local do evento"} wide />
                </View>

                <View style={styles.ticketFooter}>
                  <Text style={styles.ticketQuantity}>LOTE DE {quantity || "0"}</Text>
                  <View style={[styles.qrMock, { backgroundColor: accentColor }]}>
                    <Text style={styles.qrText}>▦</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </ProtectedRoleScreen>
  );
}

type InputFieldProps = {
  keyboardType?: "default" | "number-pad" | "numbers-and-punctuation";
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

function PreviewInfo({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={wide ? styles.previewInfoWide : styles.previewInfo}>
      <Text style={styles.previewInfoLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.previewInfoValue}>{value}</Text>
    </View>
  );
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  toolbar: { marginTop: 22, marginBottom: 14 },
  backButton: { alignSelf: "flex-start", paddingVertical: 8 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  editorLayout: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    alignItems: "flex-start",
    gap: 18,
  },
  formCard: {
    ...visualShadows.card,
    flex: 1.05,
    width: "100%",
    gap: 17,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    backgroundColor: "#FFFFFF",
    padding: Platform.OS === "web" ? 25 : 20,
  },
  templateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E7EFF1",
    paddingBottom: 17,
  },
  templateIcon: { fontSize: 25 },
  templateText: { flex: 1 },
  templateLabel: { color: "#087E83", fontSize: 9, fontWeight: "900" },
  templateName: { color: "#102A43", fontSize: 18, fontWeight: "900", marginTop: 3 },
  fieldGroup: { gap: 8 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  label: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  counter: { color: "#8298A2", fontSize: 10 },
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
  notesInput: {
    minHeight: 105,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D4E1E5",
    backgroundColor: "#F9FBFC",
    color: "#102A43",
    fontSize: 14,
    lineHeight: 20,
    padding: 15,
  },
  twoColumns: { flexDirection: "row", gap: 12 },
  columnField: { flex: 1 },
  palettes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  paletteButton: {
    minWidth: 105,
    alignItems: "center",
    gap: 6,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    backgroundColor: "#FFFFFF",
    padding: 10,
  },
  paletteButtonSelected: { borderColor: "#087E83", backgroundColor: "#F0FBFA" },
  paletteDots: { flexDirection: "row", gap: 4 },
  colorDot: { width: 19, height: 19, borderRadius: 7 },
  paletteName: { color: "#627D8A", fontSize: 9, fontWeight: "800" },
  saveButton: {
    height: 55,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    borderRadius: 15,
    backgroundColor: "#38D6D2",
    marginTop: 3,
  },
  saveButtonText: { color: "#071D2D", fontSize: 14, fontWeight: "900" },
  saveArrow: { color: "#071D2D", fontSize: 20, fontWeight: "900" },
  previewColumn: {
    flex: 0.95,
    width: "100%",
    position: "relative",
  },
  previewEyebrow: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  previewHelp: { color: "#627D8A", fontSize: 11, marginTop: 5, marginBottom: 13 },
  ticketPreview: {
    minHeight: 500,
    justifyContent: "space-between",
    borderRadius: 27,
    padding: Platform.OS === "web" ? 30 : 23,
    shadowColor: "#071D2D",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  ticketHeader: { flexDirection: "row", justifyContent: "space-between", gap: 15 },
  ticketBrand: { fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  ticketSerial: { color: "#BFD0D7", fontSize: 9, fontWeight: "800" },
  ticketBadge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  ticketBadgeText: { fontSize: 8, fontWeight: "900", letterSpacing: 1.4 },
  ticketEventName: {
    color: "#FFFFFF",
    fontSize: Platform.OS === "web" ? 37 : 31,
    lineHeight: Platform.OS === "web" ? 42 : 36,
    fontWeight: "900",
    letterSpacing: -1,
    textTransform: "uppercase",
    marginTop: 13,
  },
  ticketDivider: { borderTopWidth: 1, borderStyle: "dashed", opacity: 0.65 },
  ticketInfoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 15 },
  previewInfo: { width: "45%", gap: 4 },
  previewInfoWide: { width: "100%", gap: 4 },
  previewInfoLabel: { color: "#9FB6C0", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  previewInfoValue: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, fontWeight: "800" },
  ticketFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  ticketQuantity: { color: "#BFD0D7", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  qrMock: { width: 50, height: 50, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  qrText: { color: "#071D2D", fontSize: 27, fontWeight: "900" },
  stateCard: {
    minHeight: 230,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    backgroundColor: "#FFFFFF",
    padding: 30,
  },
  stateText: { color: "#627D8A", fontSize: 13, lineHeight: 20, textAlign: "center" },
  errorTitle: { color: "#8A3325", fontSize: 18, fontWeight: "900" },
  darkButton: { borderRadius: 13, backgroundColor: "#071D2D", padding: 13 },
  darkButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});
