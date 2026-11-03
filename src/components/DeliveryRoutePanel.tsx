import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Coordinate, DeliveryRoute } from "../types/delivery";

export type DeliveryRouteMapProps = {
  currentLocation: Coordinate;
  route: DeliveryRoute | null;
  onOpenExternal?: () => void;
};

// Painel de rota sem mapa interno: nao depende de nenhuma chave do Google.
// A navegacao e a visualizacao do mapa abrem no aplicativo Google Maps do
// aparelho (ou no navegador) pelo botao.
export function DeliveryRoutePanel({
  currentLocation,
  route,
  onOpenExternal,
}: DeliveryRouteMapProps) {
  return (
    <View style={styles.frame}>
      <View style={styles.pathRow}>
        <View style={styles.marker}>
          <Text style={styles.markerText}>🛵</Text>
        </View>
        <View style={styles.pathLine} />
        <View style={styles.marker}>
          <Text style={styles.markerText}>📍</Text>
        </View>
      </View>

      <Text style={styles.title}>ROTA DA ENTREGA</Text>
      <Text style={styles.text}>
        {route
          ? "Rota calculada. Abra o mapa para ver o trajeto e navegar."
          : "A rota será calculada assim que o GPS enviar a posição."}
      </Text>
      <Text style={styles.coordinates}>
        GPS: {currentLocation.latitude.toFixed(5)}, {currentLocation.longitude.toFixed(5)}
      </Text>

      {onOpenExternal ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenExternal}
          style={({ pressed }) => [styles.openButton, pressed && styles.pressed]}
        >
          <Text style={styles.openButtonText}>Abrir no mapa →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    gap: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#CFE0E5",
    backgroundColor: "#E8F3F4",
    padding: 20,
  },
  pathRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center" },
  marker: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#FFFFFF" },
  markerText: { fontSize: 22 },
  pathLine: { flex: 1, maxWidth: 160, height: 5, borderRadius: 3, backgroundColor: "#38D6D2", marginHorizontal: 8 },
  title: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.1, marginTop: 4 },
  text: { color: "#526E7A", fontSize: 11, lineHeight: 16, textAlign: "center" },
  coordinates: { color: "#8298A2", fontSize: 9, fontWeight: "700" },
  openButton: { borderRadius: 12, backgroundColor: "#071D2D", paddingHorizontal: 16, paddingVertical: 11, marginTop: 4 },
  openButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  pressed: { opacity: 0.74 },
});
