import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { supabase } from "./supabase";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export async function pickPaymentProof() {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  });

  if (result.canceled) return null;
  const asset = result.assets[0];

  if (asset.size && asset.size > MAX_FILE_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  return asset;
}

export async function pickBrandImage() {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: ["image/jpeg", "image/png", "image/webp"],
  });

  if (result.canceled) return null;
  const asset = result.assets[0];

  if (asset.size && asset.size > MAX_FILE_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  return asset;
}

export async function pickAvatarImage() {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: ["image/jpeg", "image/png", "image/webp"],
  });

  if (result.canceled) return null;
  const asset = result.assets[0];

  if (asset.size && asset.size > MAX_AVATAR_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  return asset;
}

export async function uploadDocument(
  bucket: "pix-proofs" | "brand-assets" | "avatars",
  path: string,
  asset: { uri: string; name: string; mimeType?: string },
) {
  const fileData = await readAsset(asset.uri);
  const { error } = await supabase.storage.from(bucket).upload(path, fileData, {
    cacheControl: "3600",
    contentType: normalizeMimeType(asset.mimeType, asset.name),
    upsert: false,
  });

  if (error) throw error;
}

function normalizeMimeType(value: string | undefined, name: string) {
  if (["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(value ?? "")) {
    return value!;
  }

  const extension = name.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "pdf") return "application/pdf";
  return "image/jpeg";
}

export function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);

  return cleaned || "arquivo";
}

async function readAsset(uri: string) {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    if (!response.ok) throw new Error("FILE_READ_FAILED");
    return response.arrayBuffer();
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return decodeBase64(base64);
}

function decodeBase64(value: string) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, "");
  const outputLength = Math.floor((clean.length * 3) / 4) -
    (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0);
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;

  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index]);
    const b = alphabet.indexOf(clean[index + 1]);
    const c = clean[index + 2] === "=" ? 0 : alphabet.indexOf(clean[index + 2]);
    const d = clean[index + 3] === "=" ? 0 : alphabet.indexOf(clean[index + 3]);
    const bits = (a << 18) | (b << 12) | (c << 6) | d;

    if (outputIndex < outputLength) output[outputIndex++] = (bits >> 16) & 255;
    if (outputIndex < outputLength) output[outputIndex++] = (bits >> 8) & 255;
    if (outputIndex < outputLength) output[outputIndex++] = bits & 255;
  }

  return output.buffer;
}
