import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type UserRole = "client" | "courier" | "admin";

type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
};

type ManageRequest = {
  action?: unknown;
  email?: unknown;
  full_name?: unknown;
  phone?: unknown;
  password?: unknown;
  user_id?: unknown;
  is_active?: unknown;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "AUTH_REQUIRED" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publicKey = readPublicKey();
    const secretKey = readSecretKey();

    if (!supabaseUrl || !publicKey || !secretKey) {
      console.error("Supabase server configuration is missing.");
      return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
    }

    const token = authorization.slice("Bearer ".length);
    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } =
      await userClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "INVALID_SESSION" }, 401);
    }

    const { data: actorProfile } = await adminClient
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", authData.user.id)
      .single();

    if (
      !actorProfile ||
      actorProfile.role !== "admin" ||
      actorProfile.is_active !== true
    ) {
      return json({ error: "ACTIVE_ADMIN_REQUIRED" }, 403);
    }

    const body = (await request.json()) as ManageRequest;

    if (body.action === "list_accounts") {
      return await listAccounts(adminClient);
    }

    if (body.action === "create_courier") {
      return await createCourier(adminClient, body);
    }

    if (body.action === "set_active") {
      return await setAccountActive(adminClient, authData.user.id, body);
    }

    return json({ error: "INVALID_ACTION" }, 400);
  } catch (error) {
    console.error(
      "Unexpected account management error:",
      error instanceof Error ? error.message : JSON.stringify(error),
    );
    return json({ error: "UNEXPECTED_ACCOUNT_MANAGEMENT_ERROR" }, 500);
  }
});

async function listAccounts(
  adminClient: ReturnType<typeof createClient>,
) {
  const [{ data: profiles, error: profilesError }, usersResult] =
    await Promise.all([
      adminClient
        .from("profiles")
        .select(
          "id, full_name, phone, role, is_active, must_change_password, created_at",
        )
        .order("created_at", { ascending: false }),
      adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

  if (profilesError || usersResult.error) {
    console.error(
      "Could not list accounts:",
      profilesError?.message ?? usersResult.error?.message,
    );
    return json({ error: "ACCOUNT_LIST_FAILED" }, 500);
  }

  const usersById = new Map(
    usersResult.data.users.map((user) => [user.id, user]),
  );

  const accounts = ((profiles ?? []) as Profile[]).map((profile) => ({
    ...profile,
    email: usersById.get(profile.id)?.email ?? null,
  }));

  return json({ ok: true, accounts });
}

async function createCourier(
  adminClient: ReturnType<typeof createClient>,
  body: ManageRequest,
) {
  const fullName = typeof body.full_name === "string"
    ? body.full_name.trim()
    : "";
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  const phone = typeof body.phone === "string"
    ? body.phone.replace(/\D/g, "")
    : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (fullName.length < 2 || fullName.length > 120) {
    return json({ error: "INVALID_FULL_NAME" }, 400);
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return json({ error: "INVALID_EMAIL" }, 400);
  }
  if (phone.length < 10 || phone.length > 20) {
    return json({ error: "INVALID_PHONE" }, 400);
  }
  if (!isStrongPassword(password)) {
    return json({ error: "WEAK_TEMPORARY_PASSWORD" }, 400);
  }

  const { data: created, error: createError } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        phone,
        provisioned_by: "seuchico_admin",
      },
    });

  if (createError || !created.user) {
    const normalized = createError?.message.toLowerCase() ?? "";
    if (
      normalized.includes("already") ||
      normalized.includes("registered") ||
      normalized.includes("exists")
    ) {
      return json({ error: "EMAIL_ALREADY_REGISTERED" }, 409);
    }
    console.error("Could not create courier:", createError?.message);
    return json({ error: "COURIER_CREATION_FAILED" }, 500);
  }

  const { error: profileError } = await adminClient.from("profiles").upsert({
    id: created.user.id,
    full_name: fullName,
    phone,
    role: "courier",
    is_active: true,
    must_change_password: true,
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    console.error("Could not create courier profile:", profileError.message);
    return json({ error: "COURIER_PROFILE_FAILED" }, 500);
  }

  return json({
    ok: true,
    account: {
      id: created.user.id,
      email,
      full_name: fullName,
      phone,
      role: "courier",
      is_active: true,
      must_change_password: true,
      created_at: created.user.created_at,
    },
  });
}

async function setAccountActive(
  adminClient: ReturnType<typeof createClient>,
  actorId: string,
  body: ManageRequest,
) {
  if (
    typeof body.user_id !== "string" ||
    !isUuid(body.user_id) ||
    typeof body.is_active !== "boolean"
  ) {
    return json({ error: "INVALID_ACCOUNT_UPDATE" }, 400);
  }
  if (body.user_id === actorId) {
    return json({ error: "CANNOT_CHANGE_OWN_ACCESS" }, 400);
  }

  const { data: target } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("id", body.user_id)
    .single();

  if (!target) return json({ error: "ACCOUNT_NOT_FOUND" }, 404);
  if (target.role === "admin") {
    return json({ error: "ADMIN_ACCOUNT_PROTECTED" }, 403);
  }

  const { error: updateError } = await adminClient
    .from("profiles")
    .update({
      is_active: body.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.user_id);

  if (updateError) {
    console.error("Could not update account:", updateError.message);
    return json({ error: "ACCOUNT_UPDATE_FAILED" }, 500);
  }

  if (!body.is_active) {
    await adminClient
      .from("push_tokens")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", body.user_id);
  }

  return json({ ok: true, user_id: body.user_id, is_active: body.is_active });
}

function isStrongPassword(value: string) {
  return value.length >= 10 &&
    value.length <= 72 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value);
}

function readPublicKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  return readDefaultJsonKey("SUPABASE_PUBLISHABLE_KEYS");
}

function readSecretKey() {
  const current = readDefaultJsonKey("SUPABASE_SECRET_KEYS");
  if (current) return current;
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

function readDefaultJsonKey(name: string) {
  const value = Deno.env.get(name);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.default === "string" ? parsed.default : null;
  } catch {
    return null;
  }
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
