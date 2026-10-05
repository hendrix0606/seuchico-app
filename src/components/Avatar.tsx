import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { createAvatarUrl } from "../lib/avatar";

type AvatarProps = {
  path?: string | null;
  name: string;
  size?: number;
};

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Avatar({ path, name, size = 40 }: AvatarProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setUrl(null);

    if (path) {
      void createAvatarUrl(path).then((signedUrl) => {
        if (isMounted) setUrl(signedUrl);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [path]);

  return (
    <View
      accessibilityLabel={`Foto de ${name}`}
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      {url ? (
        <Image
          onError={() => setUrl(null)}
          source={{ uri: url }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text style={[styles.initials, { fontSize: Math.round(size * 0.36) }]}>
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#E9F8F8",
    borderWidth: 1,
    borderColor: "#CFE8E8",
  },
  initials: { color: "#087E83", fontWeight: "900" },
});
