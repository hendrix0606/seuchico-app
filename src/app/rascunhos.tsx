import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import { formatDatabaseDate } from "../lib/tickets";
import { supabase } from "../lib/supabase";

type DraftListItem = {
  id: string;
  event_name: string;
  event_date: string;
  event_time: string;
  location: string;
  primary_color: string;
  accent_color: string;
  quantity: number;
  updated_at: string;
  ticket_templates: { name: string } | null;
};

export default function DraftsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDrafts = async () => {
    if (!session?.user.id) return;

    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("ticket_drafts")
      .select(
        "id, event_name, event_date, event_time, location, primary_color, accent_color, quantity, updated_at, ticket_templates(name)",
      )
      .eq("user_id", session.user.id)
      .eq("status", "draft")
      .order("updated_at", { ascending: false });

    if (error) {
      setErrorMessage(
        "Não foi possível carregar seus rascunhos. Confirme se o SQL da Etapa 5 foi executado.",
      );
    } else {
      setDrafts((data ?? []) as unknown as DraftListItem[]);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void loadDrafts();
    // O carregamento deve ser repetido somente quando o usuario mudar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  return (
    <ProtectedRoleScreen
      eyebrow="SEUS PROJETOS"
      requiredRole="client"
      subtitle="Continue editando seus ingressos antes de transformar o rascunho em pedido."
      title="Meus rascunhos"
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/cliente")}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>← Área do cliente</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/catalogo")}
          style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
        >
          <Text style={styles.newButtonText}>+ Novo ingresso</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando rascunhos...</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.stateCard}>
          <Text style={styles.errorTitle}>Rascunhos indisponíveis</Text>
          <Text style={styles.stateText}>{errorMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadDrafts()}
            style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
          >
            <Text style={styles.darkButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : drafts.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.emptyIcon}>🎟️</Text>
          <Text style={styles.emptyTitle}>Nenhum rascunho ainda</Text>
          <Text style={styles.stateText}>
            Escolha um modelo, personalize os dados e salve seu primeiro ingresso.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/catalogo")}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Escolher um modelo</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.grid}>
          {drafts.map((draft) => (
            <View key={draft.id} style={styles.card}>
              <View style={[styles.ticketStrip, { backgroundColor: draft.primary_color }]}> 
                <View style={[styles.accentBar, { backgroundColor: draft.accent_color }]} />
                <Text numberOfLines={2} style={styles.ticketTitle}>
                  {draft.event_name}
                </Text>
                <Text style={styles.ticketDate}>
                  {formatDatabaseDate(draft.event_date)} · {draft.event_time.slice(0, 5)}
                </Text>
              </View>

              <View style={styles.cardBody}>
                <Text style={styles.templateName}>
                  {draft.ticket_templates?.name ?? "Modelo SeuChico"}
                </Text>
                <Text numberOfLines={2} style={styles.location}>
                  {draft.location}
                </Text>
                <View style={styles.cardFooter}>
                  <View style={styles.draftBadge}>
                    <Text style={styles.draftBadgeText}>RASCUNHO</Text>
                  </View>
                  <Text style={styles.quantity}>{draft.quantity} unidades</Text>
                </View>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({ pathname: "/editor", params: { draft: draft.id } })
                    }
                    style={({ pressed }) => [
                      styles.editButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.editText}>Editar</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({ pathname: "/checkout", params: { draft: draft.id } })
                    }
                    style={({ pressed }) => [
                      styles.orderButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.orderButtonText}>Finalizar pedido</Text>
                    <Text style={styles.orderButtonArrow}>→</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </ProtectedRoleScreen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginTop: 22,
    marginBottom: 14,
  },
  backButton: { paddingVertical: 8 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  newButton: { borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 15, paddingVertical: 12 },
  newButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  card: {
    ...visualShadows.card,
    overflow: "hidden",
    minWidth: Platform.OS === "web" ? 290 : "100%",
    flexBasis: Platform.OS === "web" ? "31%" : "100%",
    flexGrow: 1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    backgroundColor: "#FFFFFF",
  },
  ticketStrip: { minHeight: 145, justifyContent: "flex-end", padding: 19 },
  accentBar: { position: "absolute", top: 18, left: 19, width: 48, height: 3, borderRadius: 2 },
  ticketTitle: { color: "#FFFFFF", fontSize: 23, lineHeight: 27, fontWeight: "900", textTransform: "uppercase" },
  ticketDate: { color: "#DCE7EA", fontSize: 9, fontWeight: "800", marginTop: 8 },
  cardBody: { padding: 18 },
  templateName: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  location: { color: "#102A43", fontSize: 13, lineHeight: 19, fontWeight: "800", marginTop: 8 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 15 },
  draftBadge: { borderRadius: 20, backgroundColor: "#E5FAF9", paddingHorizontal: 9, paddingVertical: 5 },
  draftBadgeText: { color: "#087E83", fontSize: 7, fontWeight: "900", letterSpacing: 0.9 },
  quantity: { color: "#627D8A", fontSize: 10, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: 1, borderTopColor: "#E7EFF1", marginTop: 16, paddingTop: 14 },
  editButton: { alignItems: "center", justifyContent: "center", minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: "#D4E1E5", paddingHorizontal: 14 },
  editText: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  orderButton: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, backgroundColor: "#38D6D2", paddingHorizontal: 12 },
  orderButtonText: { color: "#071D2D", fontSize: 11, fontWeight: "900" },
  orderButtonArrow: { color: "#071D2D", fontSize: 17, fontWeight: "900" },
  stateCard: {
    ...visualShadows.card,
    minHeight: 250,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    backgroundColor: "#FFFFFF",
    padding: 30,
  },
  stateText: { maxWidth: 470, color: "#627D8A", fontSize: 13, lineHeight: 20, textAlign: "center" },
  emptyIcon: { fontSize: 38 },
  emptyTitle: { color: "#102A43", fontSize: 20, fontWeight: "900" },
  errorTitle: { color: "#8A3325", fontSize: 18, fontWeight: "900" },
  primaryButton: { borderRadius: 13, backgroundColor: "#38D6D2", paddingHorizontal: 17, paddingVertical: 13 },
  primaryButtonText: { color: "#071D2D", fontSize: 12, fontWeight: "900" },
  darkButton: { borderRadius: 13, backgroundColor: "#071D2D", padding: 13 },
  darkButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});
