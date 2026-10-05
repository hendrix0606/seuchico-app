import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Coordinate, DeliveryRoute } from "../types/delivery";

type DeliveryRouteMapProps = {
  currentLocation: Coordinate;
  route: DeliveryRoute | null;
  onOpenExternal?: () => void;
};

export function DeliveryRouteMap({
  currentLocation,
  route,
  onOpenExternal,
}: DeliveryRouteMapProps) {
  return (
    <View style={styles.frame}>
      <View style={styles.gridHorizontalOne} />
      <View style={styles.gridHorizontalTwo} />
      <View style={styles.gridVerticalOne} />
      <View style={styles.gridVerticalTwo} />
      <View style={styles.originMarker}>
        <Text style={styles.markerText}>🛵</Text>
      </View>
      <View style={styles.routeLine} />
      <View style={styles.destinationMarker}>
        <Text style={styles.markerText}>📍</Text>
      </View>
      <View style={styles.webNotice}>
        <Text style={styles.noticeTitle}>PRÉVIA DA ROTA</Text>
        <Text style={styles.noticeText}>
          O mapa interativo aparece no aplicativo para Android e iPhone.
        </Text>
        <Text style={styles.coordinateText}>
          GPS: {currentLocation.latitude.toFixed(5)}, {currentLocation.longitude.toFixed(5)}
        </Text>
        {route && onOpenExternal ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenExternal}
            style={({ pressed }) => [
              styles.openButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.openButtonText}>Abrir mapa real →</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 330,
    overflow: "hidden",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#CFE0E5",
    backgroundColor: "#E8F3F4",
  },
  gridHorizontalOne: { position: "absolute", top: 90, left: 0, right: 0, height: 1, backgroundColor: "#D2E5E8" },
  gridHorizontalTwo: { position: "absolute", top: 220, left: 0, right: 0, height: 1, backgroundColor: "#D2E5E8" },
  gridVerticalOne: { position: "absolute", top: 0, bottom: 0, left: "32%", width: 1, backgroundColor: "#D2E5E8" },
  gridVerticalTwo: { position: "absolute", top: 0, bottom: 0, right: "29%", width: 1, backgroundColor: "#D2E5E8" },
  originMarker: { position: "absolute", left: "12%", bottom: 47, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#FFFFFF" },
  destinationMarker: { position: "absolute", right: "12%", top: 45, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#FFFFFF" },
  markerText: { fontSize: 22 },
  routeLine: { position: "absolute", left: "18%", right: "18%", top: "49%", height: 5, borderRadius: 3, backgroundColor: "#38D6D2", transform: [{ rotate: "-18deg" }] },
  webNotice: { position: "absolute", left: "32%", right: "29%", top: 87, alignItems: "center", gap: 8, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.94)", padding: 16 },
  noticeTitle: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  noticeText: { color: "#526E7A", fontSize: 10, lineHeight: 15, textAlign: "center" },
  coordinateText: { color: "#8298A2", fontSize: 8, fontWeight: "700" },
  openButton: { borderRadius: 11, backgroundColor: "#071D2D", paddingHorizontal: 13, paddingVertical: 10 },
  openButtonText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  pressed: { opacity: 0.74 },
});
