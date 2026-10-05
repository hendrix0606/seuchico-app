import { safeFileName, uploadDocument } from "./file-upload";
import { supabase } from "./supabase";

const AVATAR_BUCKET = "avatars";
const SIGNED_URL_SECONDS = 60 * 60;

export async function fetchOwnAvatarPath(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.avatar_path as string | null | undefined) ?? null;
}

// Envia a nova foto, grava o caminho no perfil e so entao apaga a anterior.
// Se gravar no perfil falhar, o arquivo recem enviado e removido.
export async function saveOwnAvatar(
  userId: string,
  asset: { uri: string; name: string; mimeType?: string },
  previousPath: string | null,
) {
  const path = `${userId}/avatar-${Date.now()}-${safeFileName(asset.name)}`;

  await uploadDocument(AVATAR_BUCKET, path, asset);

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", userId);

  if (error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    throw error;
  }

  if (previousPath) {
    await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);
  }

  return path;
}

export async function removeOwnAvatar(userId: string, currentPath: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", userId);

  if (error) throw error;

  await supabase.storage.from(AVATAR_BUCKET).remove([currentPath]);
}

export async function createAvatarUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);

  if (error || !data) return null;
  return data.signedUrl;
}

export async function fetchOrderClientAvatarPath(orderId: string) {
  const { data, error } = await supabase.rpc("get_order_client_avatar", {
    p_order_id: orderId,
  });

  if (error) return null;
  return (data as string | null) ?? null;
}
