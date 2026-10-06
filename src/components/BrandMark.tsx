import { Image, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useAppearance } from "../context/appearance-context";

type BrandMarkProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

function brandInitials(brandName: string) {
  const capitals = brandName.match(/[A-ZÀ-Ý]/g);
  const initials = capitals && capitals.length >= 2 ? capitals.slice(0, 2).join("") : brandName.slice(0, 2);

  return initials.toUpperCase();
}

export function BrandMark({ size = 45, style }: BrandMarkProps) {
  const { appearance } = useAppearance();
  const logoSize = Math.round(size * 0.78);

  return (
    <View
      accessibilityLabel={appearance.brand_name}
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.33),
          backgroundColor: appearance.primary_color,
        },
        style,
      ]}
    >
      {appearance.logo_url ? (
        <Image
          resizeMode="contain"
          source={{ uri: appearance.logo_url }}
          style={{
            width: logoSize,
            height: logoSize,
            borderRadius: Math.round(size * 0.22),
          }}
        />
      ) : (
        <Text
          style={[
            styles.initials,
            { color: appearance.accent_color, fontSize: Math.round(size * 0.31) },
          ]}
        >
          {brandInitials(appearance.brand_name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  initials: { fontWeight: "900" },
});
