import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { visualShadows } from "../constants/visual-style";
import { BrandMark } from "./BrandMark";

export type LegalSection = {
  title: string;
  content: ReactNode;
};

export function LegalDocumentScreen({
  title,
  subtitle,
  sections,
}: {
  title: string;
  subtitle: string;
  sections: LegalSection[];
}) {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.page}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Text style={styles.backButtonText}>← Voltar</Text>
            </Pressable>
            <View style={styles.brand}><BrandMark size={39} /><Text style={styles.brandName}>SeuChico</Text></View>
          </View>

          <View style={styles.hero}>
            <Text style={styles.eyebrow}>TRANSPARÊNCIA E SEGURANÇA</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            <Text style={styles.version}>Versão de homologação · 02/09/2026</Text>
          </View>

          <View style={styles.contentCard}>
            {sections.map((section, index) => (
              <View key={section.title} style={[styles.section, index > 0 && styles.sectionBorder]}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {typeof section.content === "string" ? <Text style={styles.paragraph}>{section.content}</Text> : section.content}
              </View>
            ))}
          </View>

          <Text style={styles.footer}>Antes da publicação comercial, os dados jurídicos e o canal oficial de atendimento deverão ser preenchidos e revisados.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

export function LegalParagraph({ children }: { children: ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

export function LegalBullet({ children }: { children: ReactNode }) {
  return <Text style={styles.bullet}>• {children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFF7F3" },
  scrollContent: { paddingBottom: 48 },
  page: { width: "100%", maxWidth: 920, alignSelf: "center", paddingHorizontal: 20, paddingTop: Platform.OS === "web" ? 28 : 58 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 },
  backButton: { paddingVertical: 10, paddingRight: 12 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandName: { color: "#102A43", fontSize: 17, fontWeight: "900" },
  hero: { ...visualShadows.hero, borderRadius: 28, backgroundColor: "#071D2D", padding: Platform.OS === "web" ? 38 : 25 },
  eyebrow: { color: "#38D6D2", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: "#FFFFFF", fontSize: 33, lineHeight: 40, fontWeight: "900", letterSpacing: -1, marginTop: 9 },
  subtitle: { color: "#B8CCD4", fontSize: 13, lineHeight: 21, marginTop: 9, maxWidth: 650 },
  version: { color: "#7FA1AE", fontSize: 9, fontWeight: "800", marginTop: 18 },
  contentCard: { ...visualShadows.card, borderRadius: 24, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", paddingHorizontal: Platform.OS === "web" ? 30 : 21, marginTop: 17 },
  section: { paddingVertical: 24 },
  sectionBorder: { borderTopWidth: 1, borderTopColor: "#E7EFF1" },
  sectionTitle: { color: "#102A43", fontSize: 17, fontWeight: "900", marginBottom: 10 },
  paragraph: { color: "#56717D", fontSize: 12, lineHeight: 20, marginTop: 4 },
  bullet: { color: "#56717D", fontSize: 12, lineHeight: 20, marginTop: 4, paddingLeft: 4 },
  footer: { color: "#8298A2", fontSize: 9, lineHeight: 15, textAlign: "center", marginTop: 20, paddingHorizontal: 20 },
  pressed: { opacity: 0.72 },
});
