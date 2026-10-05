import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAppearance } from "../context/appearance-context";
import { formatMoneyInput, parseMoneyInput } from "../lib/finance";
import { pickBrandImage, safeFileName, uploadDocument } from "../lib/file-upload";
import { supabase } from "../lib/supabase";
import { DEFAULT_APPEARANCE, type AppAppearance } from "../types/appearance";
import type { PixKeyType, PixSettings } from "../types/pix";

type Feedback = { tone: "success" | "error"; text: string } | null;
type BrandImageKind = "logo" | "hero";

const keyTypes: { label: string; value: PixKeyType }[] = [
  { label: "Aleatória", value: "random" },
  { label: "E-mail", value: "email" },
  { label: "Telefone", value: "phone" },
  { label: "CPF", value: "cpf" },
  { label: "CNPJ", value: "cnpj" },
];

const palettes = [
  { name: "Turquesa", primary: "#071D2D", secondary: "#087E83", accent: "#38D6D2", background: "#F3F7F8" },
  { name: "Violeta", primary: "#24104F", secondary: "#6D28D9", accent: "#C084FC", background: "#F7F2FF" },
  { name: "Tropical", primary: "#12372A", secondary: "#0F8B6D", accent: "#FFB703", background: "#F4FFF8" },
  { name: "Coral", primary: "#3A1632", secondary: "#D94F70", accent: "#FF9F68", background: "#FFF5F2" },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { appearance, refreshAppearance } = useAppearance();
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingPix, setIsSavingPix] = useState(false);
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<BrandImageKind | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [pixEnabled, setPixEnabled] = useState(false);
  const [pixKey, setPixKey] = useState("");
  const [pixKeyType, setPixKeyType] = useState<PixKeyType>("random");
  const [recipientName, setRecipientName] = useState("");
  const [recipientCity, setRecipientCity] = useState("");
  const [copyPaste, setCopyPaste] = useState("");
  const [pixInstructions, setPixInstructions] = useState("");

  const [isCashAvailable, setIsCashAvailable] = useState(true);
  const [isSavingCash, setIsSavingCash] = useState(false);
  const [cashEnabled, setCashEnabled] = useState(false);
  const [cashMax, setCashMax] = useState("300,00");

  const [brandName, setBrandName] = useState(appearance.brand_name);
  const [tagline, setTagline] = useState(appearance.tagline);
  const [primaryColor, setPrimaryColor] = useState(appearance.primary_color);
  const [secondaryColor, setSecondaryColor] = useState(appearance.secondary_color);
  const [accentColor, setAccentColor] = useState(appearance.accent_color);
  const [backgroundColor, setBackgroundColor] = useState(appearance.background_color);
  const [logoUrl, setLogoUrl] = useState(appearance.logo_url ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(appearance.hero_image_url ?? "");

  const loadSettings = async () => {
    setIsLoading(true);
    setFeedback(null);

    const [pixResult, appearanceResult] = await Promise.all([
      supabase.from("pix_settings").select("*").eq("id", 1).single(),
      supabase.from("app_branding_settings").select("*").eq("id", 1).single(),
    ]);

    if (pixResult.error || appearanceResult.error) {
      setFeedback({
        tone: "error",
        text: "Não foi possível carregar as configurações. Confirme se o SQL 015 foi executado.",
      });
    } else {
      fillPixForm(pixResult.data as PixSettings);
      fillAppearanceForm(appearanceResult.data as AppAppearance);
    }

    // Consulta separada: antes do SQL 017 ela falha e so esconde este cartao.
    const cashResult = await supabase
      .from("cash_settings")
      .select("is_enabled, max_order_cents")
      .eq("id", 1)
      .single();

    if (cashResult.error || !cashResult.data) {
      setIsCashAvailable(false);
    } else {
      setIsCashAvailable(true);
      setCashEnabled(cashResult.data.is_enabled);
      setCashMax(formatMoneyInput(cashResult.data.max_order_cents));
    }

    setIsLoading(false);
  };

  const handleSaveCash = async () => {
    setFeedback(null);
    const maxCents = parseMoneyInput(cashMax);

    if (maxCents === null || maxCents < 100 || maxCents > 10_000_000) {
      setFeedback({
        tone: "error",
        text: "Informe um valor máximo entre R$ 1,00 e R$ 100.000,00.",
      });
      return;
    }

    setIsSavingCash(true);
    const { data, error } = await supabase
      .from("cash_settings")
      .update({ is_enabled: cashEnabled, max_order_cents: maxCents })
      .eq("id", 1)
      .select("is_enabled, max_order_cents")
      .single();

    if (error || !data) {
      setFeedback({ tone: "error", text: "Não foi possível salvar a configuração de dinheiro." });
    } else {
      setCashEnabled(data.is_enabled);
      setCashMax(formatMoneyInput(data.max_order_cents));
      setFeedback({ tone: "success", text: "Configuração de dinheiro na entrega salva." });
    }
    setIsSavingCash(false);
  };

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fillPixForm = (settings: PixSettings) => {
    setPixEnabled(settings.is_enabled);
    setPixKey(settings.pix_key ?? "");
    setPixKeyType(settings.pix_key_type);
    setRecipientName(settings.recipient_name ?? "");
    setRecipientCity(settings.recipient_city ?? "");
    setCopyPaste(settings.pix_copy_paste ?? "");
    setPixInstructions(settings.instructions ?? "");
  };

  const fillAppearanceForm = (settings: AppAppearance) => {
    setBrandName(settings.brand_name);
    setTagline(settings.tagline);
    setPrimaryColor(settings.primary_color);
    setSecondaryColor(settings.secondary_color);
    setAccentColor(settings.accent_color);
    setBackgroundColor(settings.background_color);
    setLogoUrl(settings.logo_url ?? "");
    setHeroImageUrl(settings.hero_image_url ?? "");
  };

  const handleSavePix = async () => {
    setFeedback(null);

    if (pixEnabled && (!pixKey.trim() || !recipientName.trim() || !recipientCity.trim())) {
      setFeedback({
        tone: "error",
        text: "Para ativar o PIX, informe a chave, o favorecido e a cidade.",
      });
      return;
    }

    setIsSavingPix(true);
    const { data, error } = await supabase
      .from("pix_settings")
      .update({
        is_enabled: pixEnabled,
        pix_key: pixKey.trim() || null,
        pix_key_type: pixKeyType,
        recipient_name: recipientName.trim() || null,
        recipient_city: recipientCity.trim().toUpperCase() || null,
        pix_copy_paste: copyPaste.trim() || null,
        instructions: pixInstructions.trim() || null,
      })
      .eq("id", 1)
      .select("*")
      .single();

    if (error || !data) {
      setFeedback({ tone: "error", text: "Não foi possível salvar a configuração do PIX." });
    } else {
      fillPixForm(data as PixSettings);
      setFeedback({ tone: "success", text: "Configuração do PIX salva com segurança." });
    }
    setIsSavingPix(false);
  };

  const handleSaveAppearance = async () => {
    setFeedback(null);
    const colors = [primaryColor, secondaryColor, accentColor, backgroundColor];

    if (!brandName.trim() || !tagline.trim()) {
      setFeedback({ tone: "error", text: "Informe o nome da marca e a frase de apoio." });
      return;
    }

    if (colors.some((value) => !/^#[0-9A-Fa-f]{6}$/.test(value.trim()))) {
      setFeedback({
        tone: "error",
        text: "Use cores no formato hexadecimal completo, por exemplo #38D6D2.",
      });
      return;
    }

    setIsSavingAppearance(true);
    const { data, error } = await supabase
      .from("app_branding_settings")
      .update({
        brand_name: brandName.trim(),
        tagline: tagline.trim().toUpperCase(),
        primary_color: primaryColor.trim().toUpperCase(),
        secondary_color: secondaryColor.trim().toUpperCase(),
        accent_color: accentColor.trim().toUpperCase(),
        background_color: backgroundColor.trim().toUpperCase(),
        logo_url: logoUrl.trim() || null,
        hero_image_url: heroImageUrl.trim() || null,
      })
      .eq("id", 1)
      .select("*")
      .single();

    if (error || !data) {
      setFeedback({ tone: "error", text: "Não foi possível salvar a aparência." });
    } else {
      fillAppearanceForm(data as AppAppearance);
      await refreshAppearance();
      setFeedback({
        tone: "success",
        text: "Aparência salva. As novas cores e imagens já estão aplicadas.",
      });
    }
    setIsSavingAppearance(false);
  };

  const handleUploadImage = async (kind: BrandImageKind) => {
    setFeedback(null);
    setUploadingKind(kind);

    try {
      const asset = await pickBrandImage();
      if (!asset) return;

      const path = `branding/${kind}-${Date.now()}-${safeFileName(asset.name)}`;
      await uploadDocument("brand-assets", path, asset);
      const { data } = supabase.storage.from("brand-assets").getPublicUrl(path);

      if (kind === "logo") setLogoUrl(data.publicUrl);
      else setHeroImageUrl(data.publicUrl);

      setFeedback({
        tone: "success",
        text: "Imagem enviada. Clique em Salvar aparência para publicá-la.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error && error.message === "FILE_TOO_LARGE"
            ? "A imagem deve ter no máximo 10 MB."
            : "Não foi possível enviar a imagem. Use PNG, JPG ou WEBP.",
      });
    } finally {
      setUploadingKind(null);
    }
  };

  const restoreDefaultAppearance = () => {
    fillAppearanceForm(DEFAULT_APPEARANCE);
    setFeedback({
      tone: "success",
      text: "Padrão carregado no formulário. Clique em Salvar aparência para confirmar.",
    });
  };

  return (
    <ProtectedRoleScreen
      eyebrow="CONFIGURAÇÕES"
      requiredRole="admin"
      subtitle="Configure o recebimento por PIX e a identidade visual sem editar o código."
      title="Marca e pagamentos"
    >
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.replace("/admin")} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Voltar à operação</Text>
        </Pressable>
        <Pressable onPress={() => void loadSettings()} style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>↻ Atualizar</Text>
        </Pressable>
      </View>

      {feedback ? (
        <View style={feedback.tone === "success" ? styles.successCard : styles.errorCard}>
          <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>
            {feedback.text}
          </Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.helpText}>Carregando configurações...</Text>
        </View>
      ) : (
        <View style={styles.pageGrid}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>PIX MANUAL</Text>
            <Text style={styles.title}>Recebimento por chave ou QR Code</Text>
            <Text style={styles.helpText}>
              O cliente envia o comprovante e o pedido só fica pago depois da sua aprovação.
            </Text>

            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: pixEnabled }}
              onPress={() => setPixEnabled((current) => !current)}
              style={[styles.switchRow, pixEnabled && styles.switchRowActive]}
            >
              <View style={[styles.switchTrack, pixEnabled && styles.switchTrackActive]}>
                <View style={[styles.switchKnob, pixEnabled && styles.switchKnobActive]} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.switchTitle}>{pixEnabled ? "PIX ativado" : "PIX desativado"}</Text>
                <Text style={styles.switchDescription}>Exibir esta forma de pagamento aos clientes.</Text>
              </View>
            </Pressable>

            <Text style={styles.label}>Tipo de chave</Text>
            <View style={styles.chips}>
              {keyTypes.map((item) => (
                <Pressable
                  key={item.value}
                  onPress={() => setPixKeyType(item.value)}
                  style={[styles.chip, pixKeyType === item.value && styles.chipActive]}
                >
                  <Text style={pixKeyType === item.value ? styles.chipTextActive : styles.chipText}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <FormField label="Chave PIX" onChangeText={setPixKey} placeholder="Cole a chave PIX" value={pixKey} />
            <FormField label="Nome do favorecido" onChangeText={setRecipientName} placeholder="Nome exibido no banco" value={recipientName} />
            <FormField autoCapitalize="characters" label="Cidade do favorecido" onChangeText={setRecipientCity} placeholder="BRASILIA" value={recipientCity} />
            <FormField label="PIX Copia e Cola (opcional)" multiline onChangeText={setCopyPaste} placeholder="Cole o código gerado pelo seu banco para exibir um QR Code válido" value={copyPaste} />
            <FormField label="Instruções ao cliente (opcional)" multiline onChangeText={setPixInstructions} placeholder="Ex.: envie o comprovante com o nome do pedido" value={pixInstructions} />

            <Pressable
              disabled={isSavingPix}
              onPress={() => void handleSavePix()}
              style={[styles.primaryButton, isSavingPix && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>{isSavingPix ? "Salvando..." : "Salvar configuração do PIX"}</Text>
            </Pressable>
          </View>

          {isCashAvailable ? (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>DINHEIRO NA ENTREGA</Text>
              <Text style={styles.title}>Pagamento ao entregador</Text>
              <Text style={styles.helpText}>
                O cliente escolhe pagar em dinheiro, você aceita o pedido e o entregador confirma o recebimento na entrega. Só então o valor entra na receita.
              </Text>

              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: cashEnabled }}
                onPress={() => setCashEnabled((current) => !current)}
                style={[styles.switchRow, cashEnabled && styles.switchRowActive]}
              >
                <View style={[styles.switchTrack, cashEnabled && styles.switchTrackActive]}>
                  <View style={[styles.switchKnob, cashEnabled && styles.switchKnobActive]} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.switchTitle}>{cashEnabled ? "Dinheiro ativado" : "Dinheiro desativado"}</Text>
                  <Text style={styles.switchDescription}>Exibir esta forma de pagamento aos clientes.</Text>
                </View>
              </Pressable>

              <FormField
                keyboardType="decimal-pad"
                label="Valor máximo por pedido (R$)"
                onChangeText={setCashMax}
                placeholder="300,00"
                value={cashMax}
              />

              <Pressable
                disabled={isSavingCash}
                onPress={() => void handleSaveCash()}
                style={[styles.primaryButton, isSavingCash && styles.disabled]}
              >
                <Text style={styles.primaryButtonText}>{isSavingCash ? "Salvando..." : "Salvar dinheiro na entrega"}</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.eyebrow}>IDENTIDADE VISUAL</Text>
            <Text style={styles.title}>Cores, logo e imagem principal</Text>
            <Text style={styles.helpText}>
              As mudanças são salvas no painel e aplicadas sem alterar os arquivos do aplicativo.
            </Text>

            <FormField label="Nome da marca" onChangeText={setBrandName} placeholder="SeuChico" value={brandName} />
            <FormField label="Frase de apoio" onChangeText={setTagline} placeholder="INGRESSOS PERSONALIZADOS" value={tagline} />

            <Text style={styles.label}>Paletas prontas</Text>
            <View style={styles.paletteGrid}>
              {palettes.map((palette) => (
                <Pressable
                  key={palette.name}
                  onPress={() => {
                    setPrimaryColor(palette.primary);
                    setSecondaryColor(palette.secondary);
                    setAccentColor(palette.accent);
                    setBackgroundColor(palette.background);
                  }}
                  style={styles.paletteCard}
                >
                  <View style={styles.paletteColors}>
                    <View style={[styles.paletteSwatch, { backgroundColor: palette.primary }]} />
                    <View style={[styles.paletteSwatch, { backgroundColor: palette.secondary }]} />
                    <View style={[styles.paletteSwatch, { backgroundColor: palette.accent }]} />
                    <View style={[styles.paletteSwatch, { backgroundColor: palette.background }]} />
                  </View>
                  <Text style={styles.paletteName}>{palette.name}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.colorGrid}>
              <ColorField label="Cor principal" onChangeText={setPrimaryColor} value={primaryColor} />
              <ColorField label="Cor secundária" onChangeText={setSecondaryColor} value={secondaryColor} />
              <ColorField label="Cor de destaque" onChangeText={setAccentColor} value={accentColor} />
              <ColorField label="Cor de fundo" onChangeText={setBackgroundColor} value={backgroundColor} />
            </View>

            <ImageField
              busy={uploadingKind === "logo"}
              label="Logo"
              onPick={() => void handleUploadImage("logo")}
              onRemove={() => setLogoUrl("")}
              url={logoUrl}
            />
            <ImageField
              busy={uploadingKind === "hero"}
              label="Imagem principal / banner"
              onPick={() => void handleUploadImage("hero")}
              onRemove={() => setHeroImageUrl("")}
              url={heroImageUrl}
              wide
            />

            <View style={[styles.preview, { backgroundColor: primaryColor || "#071D2D" }]}>
              {heroImageUrl ? <Image resizeMode="cover" source={{ uri: heroImageUrl }} style={styles.previewImage} /> : null}
              {heroImageUrl ? <View style={styles.previewOverlay} /> : null}
              <View style={styles.previewContent}>
                <Text style={[styles.previewEyebrow, { color: accentColor || "#38D6D2" }]}>PRÉ-VISUALIZAÇÃO</Text>
                <Text style={styles.previewTitle}>{brandName || "SeuChico"}</Text>
                <Text style={styles.previewText}>{tagline || "INGRESSOS PERSONALIZADOS"}</Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <Pressable onPress={restoreDefaultAppearance} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Restaurar padrão</Text>
              </Pressable>
              <Pressable
                disabled={isSavingAppearance}
                onPress={() => void handleSaveAppearance()}
                style={[styles.primaryButton, styles.flex, isSavingAppearance && styles.disabled]}
              >
                <Text style={styles.primaryButtonText}>{isSavingAppearance ? "Salvando..." : "Salvar aparência"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </ProtectedRoleScreen>
  );
}

function FormField({
  label,
  multiline = false,
  ...props
}: {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "decimal-pad";
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        multiline={multiline}
        placeholderTextColor="#91A4AD"
        style={[styles.input, multiline && styles.textArea]}
        {...props}
      />
    </View>
  );
}

function ColorField({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  const valid = /^#[0-9A-Fa-f]{6}$/.test(value.trim());
  return (
    <View style={styles.colorField}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.colorInputRow}>
        <View style={[styles.colorSwatch, { backgroundColor: valid ? value : "#FFFFFF" }]} />
        <TextInput
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          onChangeText={onChangeText}
          placeholder="#38D6D2"
          placeholderTextColor="#91A4AD"
          style={[styles.input, styles.colorInput]}
          value={value}
        />
      </View>
    </View>
  );
}

function ImageField({ busy, label, onPick, onRemove, url, wide = false }: { busy: boolean; label: string; onPick: () => void; onRemove: () => void; url: string; wide?: boolean }) {
  return (
    <View style={styles.imageField}>
      <Text style={styles.label}>{label}</Text>
      {url ? (
        <Image resizeMode="cover" source={{ uri: url }} style={wide ? styles.heroPreview : styles.logoPreview} />
      ) : (
        <View style={wide ? styles.heroPlaceholder : styles.logoPlaceholder}>
          <Text style={styles.placeholderText}>Nenhuma imagem selecionada</Text>
        </View>
      )}
      <View style={styles.buttonRow}>
        <Pressable disabled={busy} onPress={onPick} style={[styles.uploadButton, busy && styles.disabled]}>
          <Text style={styles.uploadButtonText}>{busy ? "Enviando..." : "Escolher imagem"}</Text>
        </Pressable>
        {url ? (
          <Pressable onPress={onRemove} style={styles.removeButton}>
            <Text style={styles.removeButtonText}>Remover</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 14 },
  backButton: { paddingVertical: 9 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  refreshButton: { borderRadius: 12, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 10 },
  refreshButtonText: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  pageGrid: { flexDirection: Platform.OS === "web" ? "row" : "column", alignItems: "flex-start", gap: 16 },
  card: { flex: 1, width: Platform.OS === "web" ? undefined : "100%", gap: 14, borderRadius: 24, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: Platform.OS === "web" ? 24 : 19 },
  stateCard: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 22, backgroundColor: "#FFFFFF", padding: 30 },
  eyebrow: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: "#102A43", fontSize: 22, lineHeight: 28, fontWeight: "900" },
  helpText: { color: "#627D8A", fontSize: 11, lineHeight: 18 },
  fieldGroup: { gap: 7 },
  label: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  input: { minHeight: 49, borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#F9FBFC", color: "#102A43", fontSize: 13, paddingHorizontal: 14, paddingVertical: 12 },
  textArea: { minHeight: 90, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 15, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#F8FBFC", padding: 14 },
  switchRowActive: { borderColor: "#8ADFD8", backgroundColor: "#EDFCF9" },
  switchTrack: { width: 45, height: 26, borderRadius: 14, justifyContent: "center", backgroundColor: "#B8C8CE", padding: 3 },
  switchTrackActive: { backgroundColor: "#38D6D2" },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFFFFF" },
  switchKnobActive: { alignSelf: "flex-end" },
  switchTitle: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  switchDescription: { color: "#627D8A", fontSize: 9, marginTop: 3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { borderColor: "#071D2D", backgroundColor: "#071D2D" },
  chipText: { color: "#486876", fontSize: 10, fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  colorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  paletteGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  paletteCard: { ...visualShadows.subtle, minWidth: 110, flex: 1, gap: 7, borderRadius: 13, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 10 },
  paletteColors: { flexDirection: "row", overflow: "hidden", height: 24, borderRadius: 8 },
  paletteSwatch: { flex: 1 },
  paletteName: { color: "#294B5A", fontSize: 9, fontWeight: "900" },
  colorField: { minWidth: Platform.OS === "web" ? "47%" : "100%", flex: 1, gap: 7 },
  colorInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  colorSwatch: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: "#D4E1E5" },
  colorInput: { flex: 1 },
  imageField: { gap: 9, borderTopWidth: 1, borderTopColor: "#E8EFF1", paddingTop: 14 },
  logoPreview: { width: 92, height: 92, borderRadius: 20, backgroundColor: "#EDF3F5" },
  heroPreview: { width: "100%", height: 160, borderRadius: 18, backgroundColor: "#EDF3F5" },
  logoPlaceholder: { width: 92, height: 92, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 1, borderStyle: "dashed", borderColor: "#C7D7DC", padding: 10 },
  heroPlaceholder: { width: "100%", height: 120, alignItems: "center", justifyContent: "center", borderRadius: 18, borderWidth: 1, borderStyle: "dashed", borderColor: "#C7D7DC", padding: 15 },
  placeholderText: { color: "#8298A2", fontSize: 9, lineHeight: 14, textAlign: "center" },
  preview: { overflow: "hidden", minHeight: 180, justifyContent: "flex-end", borderRadius: 20, padding: 20 },
  previewImage: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  previewOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(3, 18, 30, 0.65)" },
  previewContent: { zIndex: 1 },
  previewEyebrow: { fontSize: 8, fontWeight: "900", letterSpacing: 1.3 },
  previewTitle: { color: "#FFFFFF", fontSize: 25, fontWeight: "900", marginTop: 6 },
  previewText: { color: "#D4E1E5", fontSize: 10, fontWeight: "700", marginTop: 5 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  primaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#38D6D2", paddingHorizontal: 16, paddingVertical: 12 },
  primaryButtonText: { color: "#071D2D", fontSize: 11, fontWeight: "900", textAlign: "center" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 15 },
  secondaryButtonText: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  uploadButton: { borderRadius: 12, backgroundColor: "#071D2D", paddingHorizontal: 14, paddingVertical: 11 },
  uploadButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  removeButton: { borderRadius: 12, borderWidth: 1, borderColor: "#FFC2B8", backgroundColor: "#FFF5F2", paddingHorizontal: 14, paddingVertical: 10 },
  removeButtonText: { color: "#9A392A", fontSize: 10, fontWeight: "900" },
  successCard: { borderRadius: 15, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 14, marginBottom: 14 },
  successText: { color: "#176A50", fontSize: 11, fontWeight: "800" },
  errorCard: { borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 14, marginBottom: 14 },
  errorText: { color: "#8A3325", fontSize: 11, fontWeight: "800" },
  flex: { flex: 1 },
  disabled: { opacity: 0.55 },
});
