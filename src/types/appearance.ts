export type AppAppearance = {
  id: number;
  brand_name: string;
  tagline: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  logo_url: string | null;
  hero_image_url: string | null;
  updated_at: string;
};

export const DEFAULT_APPEARANCE: AppAppearance = {
  id: 1,
  brand_name: "SeuChico",
  tagline: "INGRESSOS PERSONALIZADOS",
  primary_color: "#071D2D",
  secondary_color: "#087E83",
  accent_color: "#38D6D2",
  background_color: "#F3F7F8",
  logo_url: null,
  hero_image_url: null,
  updated_at: new Date(0).toISOString(),
};
