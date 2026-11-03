import { Image, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useAppearance } from "../context/appearance-context";

// Logo oficial do SeuChico (PNG com fundo transparente, proporcao 1383x1020).
const officialLogo = require("../../assets/images/logo-seuchico.png");
const OFFICIAL_LOGO_RATIO = 1383 / 1020;

type BrandMarkProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

function brandInitials(brandName: string) {
  const capitals = brandName.match(/[A-ZÀ-Ý]/g);
  const initials = capitals && capitals.length >= 2 ? capitals.slice(0, 2).join("") : brandName.slice(0, 2);

  return initials.toUpperCase();
}

// Verdadeiro quando o administrador enviou outro logo em "Marca e pagamentos".
// Sem logo proprio, o app mostra o logo oficial, que ja traz o nome da marca.
export function useHasCustomLogo() {
  const { appearance } = useAppearance();

  return Boolean(appearance.logo_url);
}

export function BrandLogo({ height = 56, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View accessibilityLabel="SeuChico, delivery de entregas" style={style}>
      <Image
        resizeMode="contain"
        source={officialLogo}
        style={{ width: Math.round(height * OFFICIAL_LOGO_RATIO), height }}
      />
    </View>
  );
}

export function BrandMark({ size = 45, style }: BrandMarkProps) {
  const { appearance } = useAppearance();
  const logoSize = Math.round(size * 0.78);

  if (!appearance.logo_url) {
    return <BrandLogo height={Math.round(size * 1.3)} style={style} />;
  }

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
