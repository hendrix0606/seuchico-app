import { Platform } from "react-native";
import type { ViewStyle } from "react-native";

function createShadow(
  webShadow: string,
  elevation: number,
  opacity: number,
  radius: number,
  offsetY: number,
): ViewStyle {
  return (
    Platform.select<ViewStyle>({
      web: { boxShadow: webShadow },
      default: {
        elevation,
        shadowColor: "#071D2D",
        shadowOffset: { width: 0, height: offsetY },
        shadowOpacity: opacity,
        shadowRadius: radius,
      },
    }) ?? {}
  );
}

/** Sombras compartilhadas para dar profundidade sem alterar a estrutura das telas. */
export const visualShadows = {
  subtle: createShadow("0 8px 24px rgba(7, 29, 45, 0.06)", 2, 0.06, 10, 4),
  card: createShadow("0 14px 36px rgba(7, 29, 45, 0.09)", 4, 0.09, 16, 8),
  raised: createShadow("0 22px 60px rgba(7, 29, 45, 0.13)", 7, 0.13, 24, 12),
  hero: createShadow("0 24px 64px rgba(7, 29, 45, 0.20)", 9, 0.2, 28, 14),
  button: createShadow("0 10px 24px rgba(8, 126, 131, 0.18)", 3, 0.16, 10, 5),
} as const;
