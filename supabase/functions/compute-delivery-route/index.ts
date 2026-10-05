import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RouteRequest = {
  order_id?: unknown;
  origin?: {
    latitude?: unknown;
    longitude?: unknown;
  };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return json({ error: "AUTH_REQUIRED" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = readSupabasePublicKey();
    const routesKey = Deno.env.get("OPENROUTESERVICE_API_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase public configuration is missing.");
      return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
    }

    if (!routesKey) {
      console.error("OPENROUTESERVICE_API_KEY is missing.");
      return json({ error: "ROUTES_NOT_CONFIGURED" }, 500);
    }

    const token = authorization.slice("Bearer ".length);
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return json({ error: "INVALID_SESSION" }, 401);
    }

    const body = (await request.json()) as RouteRequest;
    const orderId = body.order_id;
    const latitude = body.origin?.latitude;
    const longitude = body.origin?.longitude;

    if (
      typeof orderId !== "string" ||
      !isUuid(orderId) ||
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return json({ error: "INVALID_ROUTE_REQUEST" }, 400);
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id, status, delivery_zip_code, delivery_street, delivery_number, delivery_complement, delivery_neighborhood, delivery_city, delivery_state",
      )
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return json({ error: "ORDER_NOT_FOUND_OR_FORBIDDEN" }, 404);
    }

    if (![
      "ready_for_delivery",
      "out_for_delivery",
    ].includes(order.status)) {
      return json({ error: "ORDER_HAS_NO_ACTIVE_ROUTE" }, 409);
    }

    const destinationAddress = formatAddress(order);
    const geocodeUrl = new URL(
      "https://api.heigit.org/pelias/v1/search",
    );
    geocodeUrl.searchParams.set("text", destinationAddress);
    geocodeUrl.searchParams.set("boundary.country", "BR");
    geocodeUrl.searchParams.set("size", "1");

    const geocodeResponse = await fetch(geocodeUrl, {
      headers: {
        Accept: "application/json",
        Authorization: routesKey,
      },
    });

    if (!geocodeResponse.ok) {
      console.error("Route geocoding failed with status", geocodeResponse.status);
      return json({ error: "GEOCODING_PROVIDER_ERROR" }, 502);
    }

    const geocodeData = await geocodeResponse.json();
    const destinationCoordinates =
      geocodeData?.features?.[0]?.geometry?.coordinates;

    if (
      !Array.isArray(destinationCoordinates) ||
      destinationCoordinates.length < 2 ||
      !destinationCoordinates.every((value: unknown) =>
        typeof value === "number" && Number.isFinite(value)
      )
    ) {
      return json({ error: "DESTINATION_NOT_FOUND" }, 422);
    }

    const [destinationLongitude, destinationLatitude] = destinationCoordinates;
    const routeResponse = await fetch(
      "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Accept: "application/geo+json, application/json",
          Authorization: routesKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [
            [longitude, latitude],
            [destinationLongitude, destinationLatitude],
          ],
          instructions: false,
          preference: "recommended",
          units: "m",
        }),
      },
    );

    if (!routeResponse.ok) {
      console.error("Route calculation failed with status", routeResponse.status);
      return json({ error: "ROUTE_PROVIDER_ERROR" }, 502);
    }

    const routeData = await routeResponse.json();
    const route = routeData?.features?.[0];
    const routeCoordinates = route?.geometry?.coordinates;
    const summary = route?.properties?.summary;

    if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      return json({ error: "ROUTE_NOT_FOUND" }, 422);
    }

    return json({
      route: {
        coordinates: routeCoordinates.map((coordinate: unknown) => {
          if (
            !Array.isArray(coordinate) ||
            coordinate.length < 2 ||
            typeof coordinate[0] !== "number" ||
            typeof coordinate[1] !== "number"
          ) {
            throw new Error("INVALID_PROVIDER_COORDINATE");
          }

          return {
            latitude: coordinate[1],
            longitude: coordinate[0],
          };
        }),
        distance_meters:
          typeof summary?.distance === "number" ? summary.distance : null,
        duration_seconds:
          typeof summary?.duration === "number"
            ? Math.round(summary.duration)
            : null,
        destination_address: destinationAddress,
      },
    });
  } catch (error) {
    console.error(
      "Unexpected route error:",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "UNEXPECTED_ROUTE_ERROR" }, 500);
  }
});

function readSupabasePublicKey() {
  const directKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (directKey) return directKey;

  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!publishableKeys) return null;

  try {
    const parsed = JSON.parse(publishableKeys);
    return typeof parsed?.default === "string" ? parsed.default : null;
  } catch {
    return null;
  }
}

function formatAddress(order: Record<string, unknown>) {
  const complement = order.delivery_complement
    ? `, ${String(order.delivery_complement)}`
    : "";

  return `${order.delivery_street}, ${order.delivery_number}${complement}, ${order.delivery_neighborhood}, ${order.delivery_city} - ${order.delivery_state}, CEP ${order.delivery_zip_code}, Brasil`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
