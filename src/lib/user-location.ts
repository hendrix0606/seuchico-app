import * as Location from "expo-location";

export type DetectedAddress = {
  zipCode: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type LocationErrorCode =
  | "PERMISSION_DENIED"
  | "LOCATION_UNAVAILABLE"
  | "ADDRESS_NOT_FOUND";

const STATE_CODES: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

// Le a posicao UMA vez, converte em endereco e descarta as coordenadas.
// Nada e enviado ao backend: o resultado so preenche o formulario, que o
// cliente revisa antes de confirmar o pedido. Nao funciona na web, pois o
// expo-location nao oferece geocodificacao reversa nessa plataforma.
export async function detectCurrentAddress(): Promise<DetectedAddress> {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (permission.status !== "granted") {
    throw new Error("PERMISSION_DENIED" satisfies LocationErrorCode);
  }

  let position: Location.LocationObject;
  try {
    position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
  } catch {
    throw new Error("LOCATION_UNAVAILABLE" satisfies LocationErrorCode);
  }

  let places: Location.LocationGeocodedAddress[];
  try {
    places = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
  } catch {
    throw new Error("ADDRESS_NOT_FOUND" satisfies LocationErrorCode);
  }

  const place = places[0];
  if (!place) {
    throw new Error("ADDRESS_NOT_FOUND" satisfies LocationErrorCode);
  }

  return {
    zipCode: (place.postalCode ?? "").replace(/\D/g, "").slice(0, 8),
    street: place.street ?? "",
    number: place.streetNumber ?? "",
    neighborhood: place.district ?? "",
    city: place.city ?? place.subregion ?? "",
    state: toStateCode(place.region),
  };
}

export function locationErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";

  if (code === "PERMISSION_DENIED") {
    return "Sem permissão de localização. Ative nas configurações do aparelho ou digite o endereço.";
  }
  if (code === "LOCATION_UNAVAILABLE") {
    return "Não foi possível obter sua localização agora. Verifique o GPS ou digite o endereço.";
  }
  return "Não encontramos um endereço para este local. Digite o endereço manualmente.";
}

function toStateCode(region: string | null) {
  if (!region) return "";

  const trimmed = region.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();

  const normalized = trimmed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  return STATE_CODES[normalized] ?? "";
}
