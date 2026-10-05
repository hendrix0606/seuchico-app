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
import { categoryDetails } from "../lib/tickets";
import { supabase } from "../lib/supabase";
import type { TicketTemplate } from "../types/tickets";

export default function CatalogScreen() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTemplates = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("ticket_templates")
      .select(
        "id, slug, name, category, description, primary_color, accent_color, sort_order",
      )
      .eq("is_active", true)
      .order("sort_order");

    if (error) {
      setErrorMessage(
        "Não foi possível carregar os modelos. Confirme se o SQL da Etapa 5 foi executado.",
      );
    } else {
      setTemplates((data ?? []) as TicketTemplate[]);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  return (
    <ProtectedRoleScreen
      eyebrow="CATALOGO SEUCHICO"
      requiredRole="client"
      subtitle="Escolha um ponto de partida. Você poderá alterar os dados e as cores no editor."
      title="Escolha seu modelo"
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/cliente")}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.backButtonText}>← Área do cliente</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/rascunhos")}
        >
          <Text style={styles.draftsLink}>Meus rascunhos</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando modelos...</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.stateCard}>
          <Text style={styles.errorTitle}>Catálogo indisponível</Text>
          <Text style={styles.stateText}>{errorMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadTemplates()}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.grid}>
          {templates.map((template) => {
            const category = categoryDetails(template.category);

            return (
              <Pressable
                accessibilityRole="button"
                key={template.id}
                onPress={() =>
                  router.push({
                    pathname: "/editor",
                    params: { template: template.id },
                  })
                }
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.ticketMock,
                    { backgroundColor: template.primary_color },
                  ]}
                >
                  <View style={styles.ticketTop}>
                    <Text
                      style={[
                        styles.ticketLabel,
                        { color: template.accent_color },
                      ]}
                    >
                      SEUCHICO
                    </Text>
                    <Text style={styles.ticketNumber}>Nº 001</Text>
                  </View>
                  <Text style={styles.ticketTitle}>SEU EVENTO</Text>
                  <View style={styles.ticketBottom}>
                    <View
                      style={[
                        styles.ticketLine,
                        { backgroundColor: template.accent_color },
                      ]}
                    />
                    <Text style={styles.ticketDate}>DATA · HORARIO</Text>
                  </View>
                </View>

                <View style={styles.categoryRow}>
                  <Text style={styles.categoryIcon}>{category.icon}</Text>
                  <Text style={styles.categoryText}>{category.label}</Text>
                </View>
                <Text style={styles.cardTitle}>{template.name}</Text>
                <Text style={styles.cardDescription}>
                  {template.description}
                </Text>
                <View style={styles.selectRow}>
                  <Text style={styles.selectText}>Personalizar</Text>
                  <Text style={styles.selectArrow}>→</Text>
                </View>
              </Pressable>
            );
          })}
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
    gap: 16,
    marginTop: 22,
    marginBottom: 14,
  },
  backButton: { paddingVertical: 8 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  draftsLink: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  card: {
    ...visualShadows.card,
    minWidth: Platform.OS === "web" ? 245 : "100%",
    flexBasis: Platform.OS === "web" ? "48%" : "100%",
    flexGrow: 1,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "#DCE7EA",
    backgroundColor: "#FFFFFF",
    padding: 17,
  },
  ticketMock: {
    minHeight: 170,
    justifyContent: "space-between",
    borderRadius: 18,
    padding: 19,
  },
  ticketTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ticketLabel: { fontSize: 8, fontWeight: "900", letterSpacing: 1.5 },
  ticketNumber: { color: "#BFD0D7", fontSize: 8, fontWeight: "800" },
  ticketTitle: { color: "#FFFFFF", fontSize: 25, fontWeight: "900" },
  ticketBottom: { gap: 8 },
  ticketLine: { width: 52, height: 3, borderRadius: 2 },
  ticketDate: { color: "#DCE7EA", fontSize: 8, fontWeight: "800" },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 16,
  },
  categoryIcon: { fontSize: 16 },
  categoryText: { color: "#087E83", fontSize: 10, fontWeight: "900" },
  cardTitle: { color: "#102A43", fontSize: 18, fontWeight: "900", marginTop: 9 },
  cardDescription: { color: "#627D8A", fontSize: 12, lineHeight: 18, marginTop: 5 },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
  },
  selectText: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  selectArrow: { color: "#087E83", fontSize: 20, fontWeight: "900" },
  stateCard: {
    ...visualShadows.card,
    minHeight: 220,
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
  retryButton: { borderRadius: 13, backgroundColor: "#071D2D", padding: 13 },
  retryButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});
