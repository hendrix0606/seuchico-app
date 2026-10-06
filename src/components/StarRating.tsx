import { Pressable, StyleSheet, Text, View } from "react-native";

type StarRatingProps = {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
};

// Com onChange vira um seletor; sem onChange so exibe a nota.
export function StarRating({ value, onChange, size = 24 }: StarRatingProps) {
  return (
    <View
      accessibilityLabel={`Nota ${value} de 5`}
      accessibilityRole={onChange ? "adjustable" : "image"}
      style={styles.row}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.round(value);
        const glyph = (
          <Text style={[styles.star, { fontSize: size }, filled ? styles.filled : styles.empty]}>
            {filled ? "★" : "☆"}
          </Text>
        );

        return onChange ? (
          <Pressable
            accessibilityLabel={`${star} ${star === 1 ? "estrela" : "estrelas"}`}
            accessibilityRole="button"
            hitSlop={6}
            key={star}
            onPress={() => onChange(star)}
          >
            {glyph}
          </Pressable>
        ) : (
          <View key={star}>{glyph}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 2 },
  star: { lineHeight: undefined },
  filled: { color: "#F0A81E" },
  empty: { color: "#C5D3D8" },
});
