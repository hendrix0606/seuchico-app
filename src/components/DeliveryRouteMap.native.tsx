import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import {
  DeliveryRoutePanel,
  type DeliveryRouteMapProps,
} from "./DeliveryRoutePanel";

// O mapa interno usa o Google Maps e exige uma chave de API (Google Cloud com
// faturamento). Por padrao ele fica DESLIGADO e o app usa o painel de rota, que
// abre o mapa real pelo botao. Para ligar: defina EXPO_PUBLIC_NATIVE_MAP=true e
// GOOGLE_MAPS_API_KEY no EAS (veja o README) e gere um novo build.
const USE_NATIVE_MAP = process.env.EXPO_PUBLIC_NATIVE_MAP === "true";

export function DeliveryRouteMap(props: DeliveryRouteMapProps) {
  if (!USE_NATIVE_MAP) return <DeliveryRoutePanel {...props} />;
  return <GoogleRouteMap {...props} />;
}

function GoogleRouteMap({
  currentLocation,
  route,
}: DeliveryRouteMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const destination = route?.coordinates.at(-1) ?? null;

  useEffect(() => {
    const coordinates = route?.coordinates?.length
      ? route.coordinates
      : [currentLocation];

    if (coordinates.length > 1) {
      mapRef.current?.fitToCoordinates(coordinates, {
        animated: true,
        edgePadding: { top: 55, right: 55, bottom: 55, left: 55 },
      });
    }
  }, [currentLocation, route]);

  return (
    <View style={styles.frame}>
      <MapView
        initialRegion={{
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        }}
        ref={mapRef}
        style={styles.map}
      >
        <Marker
          coordinate={currentLocation}
          description="Localização atual do entregador"
          pinColor="#087E83"
          title="Entregador"
        />
        {destination ? (
          <Marker
            coordinate={destination}
            description="Endereço de entrega"
            pinColor="#E16B45"
            title="Destino"
          />
        ) : null}
        {route ? (
          <Polyline
            coordinates={route.coordinates}
            lineCap="round"
            lineJoin="round"
            strokeColor="#087E83"
            strokeWidth={5}
          />
        ) : null}
      </MapView>
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
  map: { flex: 1 },
});
