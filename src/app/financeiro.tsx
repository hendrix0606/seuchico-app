import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import {
  calculateFinancialSummary,
  estimateOrderCost,
  financialCategoryLabel,
  formatMoneyInput,
  formatPercentInput,
  isRevenueOrder,
  parseMoneyInput,
  parsePercentInput,
} from "../lib/finance";
import { supabase } from "../lib/supabase";
import { formatCurrency } from "../lib/tickets";
import type {
  FinancialCategory,
  FinancialEntry,
  FinancialEntryType,
  FinancialOrder,
  FinancialSettings,
  PricingSettings,
} from "../types/finance";

type PeriodKey = "7d" | "30d" | "90d" | "year" | "all";
type OperationFilter = "all" | "in_progress" | "delivered" | "cancelled";
type TicketCategoryFilter = "all" | "party" | "wedding" | "show" | "corporate";
type Feedback = { tone: "success" | "error"; text: string } | null;

type SettingsForm = {
  unitPrice: string;
  deliveryFee: string;
  materialCost: string;
  printingCost: string;
  paymentFeePercent: string;
  paymentFixedFee: string;
  deliveryCost: string;
  otherCost: string;
};

const EMPTY_FINANCIAL_SETTINGS: FinancialSettings = {
  id: 1,
  material_cost_per_ticket_cents: 0,
  printing_cost_per_ticket_cents: 0,
  payment_fee_basis_points: 0,
  payment_fixed_fee_cents: 0,
  delivery_operational_cost_cents: 0,
  other_cost_per_order_cents: 0,
  updated_at: new Date(0).toISOString(),
};

const periodOptions: { label: string; value: PeriodKey }[] = [
  { label: "7 dias", value: "7d" },
  { label: "30 dias", value: "30d" },
  { label: "90 dias", value: "90d" },
  { label: "Ano atual", value: "year" },
  { label: "Todo o período", value: "all" },
];

const operationOptions: { label: string; value: OperationFilter }[] = [
  { label: "Todos os pedidos", value: "all" },
  { label: "Em andamento", value: "in_progress" },
  { label: "Entregues", value: "delivered" },
  { label: "Cancelados", value: "cancelled" },
];

const categoryOptions: { label: string; value: TicketCategoryFilter }[] = [
  { label: "Todas as categorias", value: "all" },
  { label: "Festas", value: "party" },
  { label: "Casamentos", value: "wedding" },
  { label: "Shows", value: "show" },
  { label: "Corporativos", value: "corporate" },
];

const entryCategories: Record<FinancialEntryType, FinancialCategory[]> = {
  revenue: ["ticket_sale", "other"],
  expense: [
    "material",
    "printing",
    "delivery",
    "payment_fee",
    "marketing",
    "software",
    "tax",
    "other",
  ],
  refund: ["refund"],
};

export default function FinancialScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<FinancialOrder[]>([]);
  const [entries, setEntries] = useState<FinancialEntry[]>([]);
  const [financialSettings, setFinancialSettings] = useState<FinancialSettings>(
    EMPTY_FINANCIAL_SETTINGS,
  );
  const [pricingSettings, setPricingSettings] = useState<PricingSettings | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [operationFilter, setOperationFilter] = useState<OperationFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<TicketCategoryFilter>("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    unitPrice: "3,00",
    deliveryFee: "15,00",
    materialCost: "0,00",
    printingCost: "0,00",
    paymentFeePercent: "0,00",
    paymentFixedFee: "0,00",
    deliveryCost: "0,00",
    otherCost: "0,00",
  });
  const [entryType, setEntryType] = useState<FinancialEntryType>("expense");
  const [entryCategory, setEntryCategory] = useState<FinancialCategory>("material");
  const [entryDescription, setEntryDescription] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDate, setEntryDate] = useState(todayDatabaseDate());
  const [entryOrderNumber, setEntryOrderNumber] = useState("");

  const loadFinancialData = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setIsLoading(true);
    setLoadError(null);

    const [ordersResult, entriesResult, financialResult, pricingResult] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, order_number, user_id, payment_provider, status, payment_status, quantity, total_cents, delivery_city, delivery_state, created_at, paid_at, ticket_drafts(event_name, ticket_templates(name, category))",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("financial_entries")
        .select(
          "id, entry_type, category, description, amount_cents, occurred_on, order_id, created_at",
        )
        .order("occurred_on", { ascending: false })
        .order("id", { ascending: false }),
      supabase.from("financial_settings").select("*").eq("id", 1).single(),
      supabase.from("pricing_settings").select("*").eq("id", 1).single(),
    ]);

    if (
      ordersResult.error ||
      entriesResult.error ||
      financialResult.error ||
      pricingResult.error
    ) {
      setLoadError(
        "Não foi possível carregar o financeiro. Confirme se o SQL 013 da Etapa 13 foi executado.",
      );
    } else {
      const nextFinancial = financialResult.data as FinancialSettings;
      const nextPricing = pricingResult.data as PricingSettings;
      setOrders((ordersResult.data ?? []) as unknown as FinancialOrder[]);
      setEntries((entriesResult.data ?? []) as FinancialEntry[]);
      setFinancialSettings(nextFinancial);
      setPricingSettings(nextPricing);
      setSettingsForm({
        unitPrice: formatMoneyInput(nextPricing.unit_price_cents),
        deliveryFee: formatMoneyInput(nextPricing.delivery_fee_cents),
        materialCost: formatMoneyInput(nextFinancial.material_cost_per_ticket_cents),
        printingCost: formatMoneyInput(nextFinancial.printing_cost_per_ticket_cents),
        paymentFeePercent: formatPercentInput(nextFinancial.payment_fee_basis_points),
        paymentFixedFee: formatMoneyInput(nextFinancial.payment_fixed_fee_cents),
        deliveryCost: formatMoneyInput(nextFinancial.delivery_operational_cost_cents),
        otherCost: formatMoneyInput(nextFinancial.other_cost_per_order_cents),
      });
    }

    if (!silent) setIsLoading(false);
  };

  useEffect(() => {
    void loadFinancialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDate = useMemo(() => periodStart(period), [period]);
  const periodEntries = useMemo(
    () => entries.filter((entry) => isInsidePeriod(entry.occurred_on, startDate)),
    [entries, startDate],
  );
  const regions = useMemo(() => {
    const unique = new Set(
      orders.map((order) => `${order.delivery_city}/${order.delivery_state}`),
    );
    return [...unique].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [orders]);
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (!isInsidePeriod(order.paid_at ?? order.created_at, startDate)) return false;
        if (!matchesOperation(order, operationFilter)) return false;
        const category = order.ticket_drafts?.ticket_templates?.category;
        if (categoryFilter !== "all" && category !== categoryFilter) return false;
        const region = `${order.delivery_city}/${order.delivery_state}`;
        if (regionFilter !== "all" && region !== regionFilter) return false;
        return true;
      }),
    [categoryFilter, operationFilter, orders, regionFilter, startDate],
  );
  const filteredOrderIds = useMemo(
    () => new Set(filteredOrders.map((order) => order.id)),
    [filteredOrders],
  );
  const filteredEntries = useMemo(
    () =>
      periodEntries.filter(
        (entry) => entry.order_id === null || filteredOrderIds.has(entry.order_id),
      ),
    [filteredOrderIds, periodEntries],
  );
  const summary = useMemo(
    () => calculateFinancialSummary(filteredOrders, filteredEntries, financialSettings),
    [filteredEntries, filteredOrders, financialSettings],
  );
  const categoryBreakdown = useMemo(
    () => buildCategoryBreakdown(filteredOrders),
    [filteredOrders],
  );
  const cashFlow = useMemo(
    () => buildCashFlow(filteredOrders, filteredEntries, financialSettings),
    [filteredEntries, filteredOrders, financialSettings],
  );
  const expenseBreakdown = useMemo(
    () => buildExpenseBreakdown(filteredOrders, filteredEntries, financialSettings),
    [filteredEntries, filteredOrders, financialSettings],
  );
  const orderProfitability = useMemo(
    () =>
      filteredOrders
        .filter(isRevenueOrder)
        .map((order) => {
          const cost = estimateOrderCost(order, financialSettings).total_cents;
          const netRevenue = order.payment_status === "refunded" ? 0 : order.total_cents;
          const profit = netRevenue - cost;
          return {
            order,
            cost,
            profit,
            margin: netRevenue > 0 ? (profit / netRevenue) * 100 : 0,
          };
        })
        .sort(
          (a, b) =>
            new Date(b.order.paid_at ?? b.order.created_at).getTime() -
            new Date(a.order.paid_at ?? a.order.created_at).getTime(),
        )
        .slice(0, 20),
    [filteredOrders, financialSettings],
  );
  const costsConfigured = useMemo(
    () =>
      financialSettings.material_cost_per_ticket_cents > 0 ||
      financialSettings.printing_cost_per_ticket_cents > 0 ||
      financialSettings.payment_fee_basis_points > 0 ||
      financialSettings.payment_fixed_fee_cents > 0 ||
      financialSettings.delivery_operational_cost_cents > 0 ||
      financialSettings.other_cost_per_order_cents > 0,
    [financialSettings],
  );

  const handleSaveSettings = async () => {
    setFeedback(null);
    const parsed = {
      unitPrice: parseMoneyInput(settingsForm.unitPrice),
      deliveryFee: parseMoneyInput(settingsForm.deliveryFee),
      materialCost: parseMoneyInput(settingsForm.materialCost),
      printingCost: parseMoneyInput(settingsForm.printingCost),
      paymentFeePercent: parsePercentInput(settingsForm.paymentFeePercent),
      paymentFixedFee: parseMoneyInput(settingsForm.paymentFixedFee),
      deliveryCost: parseMoneyInput(settingsForm.deliveryCost),
      otherCost: parseMoneyInput(settingsForm.otherCost),
    };

    if (Object.values(parsed).some((value) => value === null)) {
      setFeedback({
        tone: "error",
        text: "Preencha preços e custos com valores válidos e não negativos.",
      });
      return;
    }

    setIsSavingSettings(true);
    const [pricingUpdate, financialUpdate] = await Promise.all([
      supabase
        .from("pricing_settings")
        .update({
          unit_price_cents: parsed.unitPrice!,
          delivery_fee_cents: parsed.deliveryFee!,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1),
      supabase
        .from("financial_settings")
        .update({
          material_cost_per_ticket_cents: parsed.materialCost!,
          printing_cost_per_ticket_cents: parsed.printingCost!,
          payment_fee_basis_points: parsed.paymentFeePercent!,
          payment_fixed_fee_cents: parsed.paymentFixedFee!,
          delivery_operational_cost_cents: parsed.deliveryCost!,
          other_cost_per_order_cents: parsed.otherCost!,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1),
    ]);

    if (pricingUpdate.error || financialUpdate.error) {
      setFeedback({
        tone: "error",
        text: "Não foi possível salvar a configuração financeira.",
      });
    } else {
      setFeedback({
        tone: "success",
        text: "Preços e custos atualizados. Os novos preços valem para pedidos futuros.",
      });
      await loadFinancialData({ silent: true });
    }
    setIsSavingSettings(false);
  };

  const handleEntryType = (nextType: FinancialEntryType) => {
    setEntryType(nextType);
    setEntryCategory(entryCategories[nextType][0]);
  };

  const handleCreateEntry = async () => {
    setFeedback(null);
    const amountCents = parseMoneyInput(entryAmount);
    if (entryDescription.trim().length < 2) {
      setFeedback({ tone: "error", text: "Descreva o lançamento financeiro." });
      return;
    }
    if (amountCents === null || amountCents <= 0) {
      setFeedback({ tone: "error", text: "Digite um valor maior que zero." });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      setFeedback({ tone: "error", text: "Use a data no formato AAAA-MM-DD." });
      return;
    }

    let orderId: string | null = null;
    if (entryOrderNumber.trim()) {
      const number = Number(entryOrderNumber.replace(/\D/g, ""));
      const order = orders.find((item) => item.order_number === number);
      if (!order) {
        setFeedback({ tone: "error", text: "O número do pedido informado não foi encontrado." });
        return;
      }
      orderId = order.id;
    }

    setIsSavingEntry(true);
    const { error } = await supabase.from("financial_entries").insert({
      entry_type: entryType,
      category: entryCategory,
      description: entryDescription.trim(),
      amount_cents: amountCents,
      occurred_on: entryDate,
      order_id: orderId,
    });

    if (error) {
      setFeedback({ tone: "error", text: "Não foi possível registrar o lançamento." });
    } else {
      setEntryDescription("");
      setEntryAmount("");
      setEntryOrderNumber("");
      setFeedback({ tone: "success", text: "Lançamento financeiro registrado." });
      await loadFinancialData({ silent: true });
    }
    setIsSavingEntry(false);
  };

  const handleDeleteEntry = (entry: FinancialEntry) => {
    const message = `Excluir o lançamento “${entry.description}”?`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) {
        void deleteEntry(entry.id);
      }
      return;
    }
    Alert.alert("Excluir lançamento", message, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => void deleteEntry(entry.id) },
    ]);
  };

  const deleteEntry = async (entryId: number) => {
    setBusyEntryId(entryId);
    setFeedback(null);
    const { error } = await supabase.from("financial_entries").delete().eq("id", entryId);
    if (error) {
      setFeedback({ tone: "error", text: "Não foi possível excluir o lançamento." });
    } else {
      setFeedback({ tone: "success", text: "Lançamento excluído." });
      await loadFinancialData({ silent: true });
    }
    setBusyEntryId(null);
  };

  const handleExportCsv = () => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      Alert.alert(
        "Exportação pelo painel web",
        "Abra a área administrativa em um computador para baixar o relatório CSV.",
      );
      return;
    }
    const csv = createCsvReport(
      filteredOrders,
      filteredEntries,
      financialSettings,
      summary,
    );
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seuchico-financeiro-${todayDatabaseDate()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      Alert.alert(
        "Exportação pelo painel web",
        "Abra a área administrativa em um computador para gerar o relatório em PDF.",
      );
      return;
    }
    const reportWindow = window.open("", "_blank", "width=1100,height=760");
    if (!reportWindow) {
      setFeedback({ tone: "error", text: "Permita pop-ups para gerar o relatório em PDF." });
      return;
    }
    reportWindow.document.write(
      createPrintableReport(filteredOrders, financialSettings, summary, period),
    );
    reportWindow.document.close();
    reportWindow.focus();
    window.setTimeout(() => reportWindow.print(), 350);
  };

  return (
    <ProtectedRoleScreen
      eyebrow="FINANCEIRO E RELATÓRIOS"
      requiredRole="admin"
      subtitle="Acompanhe receitas, custos, margens e fluxo de caixa em uma área administrativa protegida."
      title="Financeiro"
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/admin")}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>← Voltar à operação</Text>
        </Pressable>
        <View style={styles.toolbarActions}>
          <Pressable
            accessibilityRole="button"
            onPress={handleExportCsv}
            style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
          >
            <Text style={styles.outlineButtonText}>Baixar CSV</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleExportPdf}
            style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
          >
            <Text style={styles.darkButtonText}>Gerar PDF</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => void loadFinancialData()}
            style={({ pressed }) => [
              styles.outlineButton,
              isLoading && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.outlineButtonText}>↻ Atualizar</Text>
          </Pressable>
        </View>
      </View>

      {feedback ? (
        <View
          accessibilityLiveRegion="polite"
          style={feedback.tone === "success" ? styles.successCard : styles.errorCard}
        >
          <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>
            {feedback.text}
          </Text>
        </View>
      ) : null}

      <View style={styles.filterCard}>
        <FilterGroup label="PERÍODO">
          {periodOptions.map((option) => (
            <FilterChip
              active={period === option.value}
              key={option.value}
              label={option.label}
              onPress={() => setPeriod(option.value)}
            />
          ))}
        </FilterGroup>
        <FilterGroup label="STATUS OPERACIONAL">
          {operationOptions.map((option) => (
            <FilterChip
              active={operationFilter === option.value}
              key={option.value}
              label={option.label}
              onPress={() => setOperationFilter(option.value)}
            />
          ))}
        </FilterGroup>
        <FilterGroup label="CATEGORIA DO INGRESSO">
          {categoryOptions.map((option) => (
            <FilterChip
              active={categoryFilter === option.value}
              key={option.value}
              label={option.label}
              onPress={() => setCategoryFilter(option.value)}
            />
          ))}
        </FilterGroup>
        <FilterGroup label="REGIÃO">
          <FilterChip
            active={regionFilter === "all"}
            label="Todas as regiões"
            onPress={() => setRegionFilter("all")}
          />
          {regions.map((region) => (
            <FilterChip
              active={regionFilter === region}
              key={region}
              label={region}
              onPress={() => setRegionFilter(region)}
            />
          ))}
        </FilterGroup>
        <Text style={styles.filterNote}>
          Lançamentos gerais sem pedido vinculado seguem apenas o filtro de período.
        </Text>
      </View>

      {isLoading ? (
        <StateCard>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando informações financeiras...</Text>
        </StateCard>
      ) : loadError ? (
        <StateCard>
          <Text style={styles.stateErrorTitle}>Financeiro indisponível</Text>
          <Text style={styles.stateText}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadFinancialData()}
            style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
          >
            <Text style={styles.darkButtonText}>Tentar novamente</Text>
          </Pressable>
        </StateCard>
      ) : (
        <>
          {!costsConfigured ? (
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>Configure seus custos operacionais</Text>
              <Text style={styles.warningText}>
                Os custos estão zerados. Preencha material, impressão, taxas e entrega para o lucro estimado ficar fiel ao negócio.
              </Text>
            </View>
          ) : null}

          <View style={styles.metricsGrid}>
            <MetricCard label="RECEITA BRUTA" value={formatCurrency(summary.gross_revenue_cents)} />
            <MetricCard label="REEMBOLSOS" tone="warm" value={formatCurrency(summary.refunds_cents)} />
            <MetricCard label="RECEITA LÍQUIDA" value={formatCurrency(summary.net_revenue_cents)} />
            <MetricCard label="CUSTOS TOTAIS" tone="warm" value={formatCurrency(summary.total_costs_cents)} />
            <MetricCard label="LUCRO ESTIMADO" tone={summary.estimated_profit_cents < 0 ? "danger" : "green"} value={formatCurrency(summary.estimated_profit_cents)} />
            <MetricCard label="MARGEM ESTIMADA" tone={summary.margin_percent < 0 ? "danger" : "green"} value={formatPercent(summary.margin_percent)} />
            <MetricCard label="PEDIDOS PAGOS" value={summary.paid_orders} />
            <MetricCard label="TICKET MÉDIO" value={formatCurrency(summary.average_ticket_cents)} />
            <MetricCard label="INGRESSOS VENDIDOS" value={summary.units_sold} />
          </View>

          <View style={styles.reportGrid}>
            <View style={styles.reportCard}>
              <Text style={styles.cardEyebrow}>FLUXO DE CAIXA</Text>
              <Text style={styles.cardTitle}>Receitas e custos por mês</Text>
              {cashFlow.length === 0 ? (
                <EmptyText text="Nenhuma movimentação no período selecionado." />
              ) : (
                <View style={styles.chartList}>
                  {cashFlow.map((bucket) => (
                    <View key={bucket.key} style={styles.chartGroup}>
                      <Text style={styles.chartLabel}>{bucket.label}</Text>
                      <ChartBar
                        color="#38D6D2"
                        label={`Receita ${formatCurrency(bucket.revenue)}`}
                        max={Math.max(...cashFlow.flatMap((item) => [item.revenue, item.cost]))}
                        value={bucket.revenue}
                      />
                      <ChartBar
                        color="#F0A086"
                        label={`Custos ${formatCurrency(bucket.cost)}`}
                        max={Math.max(...cashFlow.flatMap((item) => [item.revenue, item.cost]))}
                        value={bucket.cost}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.reportCard}>
              <Text style={styles.cardEyebrow}>COMPOSIÇÃO</Text>
              <Text style={styles.cardTitle}>Custos e despesas</Text>
              {expenseBreakdown.length === 0 ? (
                <EmptyText text="Configure custos ou registre despesas para visualizar a composição." />
              ) : (
                <View style={styles.rankingList}>
                  {expenseBreakdown.map((item) => (
                    <View key={item.label} style={styles.rankingRow}>
                      <View style={styles.rankingText}>
                        <Text style={styles.rankingLabel}>{item.label}</Text>
                        <Text style={styles.rankingValue}>{formatCurrency(item.value)}</Text>
                      </View>
                      <View style={styles.rankingTrack}>
                        <View
                          style={[
                            styles.rankingFill,
                            { width: `${Math.max(3, (item.value / expenseBreakdown[0].value) * 100)}%` as `${number}%` },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.reportCard}>
              <Text style={styles.cardEyebrow}>DEMANDA</Text>
              <Text style={styles.cardTitle}>Categorias mais vendidas</Text>
              {categoryBreakdown.length === 0 ? (
                <EmptyText text="Nenhum pedido pago neste filtro." />
              ) : (
                <View style={styles.rankingList}>
                  {categoryBreakdown.map((item, index) => (
                    <View key={item.category} style={styles.categoryRow}>
                      <View style={styles.categoryPosition}>
                        <Text style={styles.categoryPositionText}>{index + 1}</Text>
                      </View>
                      <View style={styles.categoryContent}>
                        <Text style={styles.rankingLabel}>{ticketCategoryLabel(item.category)}</Text>
                        <Text style={styles.categoryMeta}>
                          {item.orders} pedidos · {item.units} ingressos
                        </Text>
                      </View>
                      <Text style={styles.rankingValue}>{formatCurrency(item.revenue)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>

          <View style={styles.tableCard}>
            <Text style={styles.cardEyebrow}>MARGEM POR PEDIDO</Text>
            <Text style={styles.cardTitle}>Rentabilidade estimada</Text>
            {orderProfitability.length === 0 ? (
              <EmptyText text="Nenhum pedido pago neste filtro." />
            ) : (
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <Text style={[styles.tableCell, styles.tableCellOrder, styles.tableHeaderText]}>PEDIDO</Text>
                  <Text style={[styles.tableCell, styles.tableCellEvent, styles.tableHeaderText]}>EVENTO</Text>
                  <Text style={[styles.tableCell, styles.tableHeaderText]}>RECEITA</Text>
                  <Text style={[styles.tableCell, styles.tableHeaderText]}>CUSTO</Text>
                  <Text style={[styles.tableCell, styles.tableHeaderText]}>LUCRO</Text>
                  <Text style={[styles.tableCell, styles.tableHeaderText]}>MARGEM</Text>
                </View>
                {orderProfitability.map((item) => (
                  <View key={item.order.id} style={styles.tableRow}>
                    <Text style={[styles.tableCell, styles.tableCellOrder]}>
                      #{String(item.order.order_number).padStart(5, "0")}
                    </Text>
                    <Text numberOfLines={1} style={[styles.tableCell, styles.tableCellEvent]}>
                      {item.order.ticket_drafts?.event_name ?? "Ingresso personalizado"}
                    </Text>
                    <Text style={styles.tableCell}>
                      {formatCurrency(item.order.payment_status === "refunded" ? 0 : item.order.total_cents)}
                    </Text>
                    <Text style={styles.tableCell}>{formatCurrency(item.cost)}</Text>
                    <Text style={[styles.tableCell, item.profit < 0 ? styles.negativeText : styles.positiveText]}>
                      {formatCurrency(item.profit)}
                    </Text>
                    <Text style={styles.tableCell}>{formatPercent(item.margin)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.managementGrid}>
            <View style={styles.formCard}>
              <Text style={styles.cardEyebrow}>REGRAS FINANCEIRAS</Text>
              <Text style={styles.cardTitle}>Preços e custos padrão</Text>
              <Text style={styles.cardDescription}>
                O preço de venda afeta apenas pedidos futuros. Os custos são usados para estimar a margem dos relatórios.
              </Text>
              <View style={styles.fieldsGrid}>
                <Field label="Preço por ingresso (R$)" onChangeText={(value) => setSettingsForm((current) => ({ ...current, unitPrice: value }))} value={settingsForm.unitPrice} />
                <Field label="Taxa de entrega cobrada (R$)" onChangeText={(value) => setSettingsForm((current) => ({ ...current, deliveryFee: value }))} value={settingsForm.deliveryFee} />
                <Field label="Material por ingresso (R$)" onChangeText={(value) => setSettingsForm((current) => ({ ...current, materialCost: value }))} value={settingsForm.materialCost} />
                <Field label="Impressão por ingresso (R$)" onChangeText={(value) => setSettingsForm((current) => ({ ...current, printingCost: value }))} value={settingsForm.printingCost} />
                <Field label="Taxa do pagamento (%)" onChangeText={(value) => setSettingsForm((current) => ({ ...current, paymentFeePercent: value }))} value={settingsForm.paymentFeePercent} />
                <Field label="Taxa fixa do pagamento (R$)" onChangeText={(value) => setSettingsForm((current) => ({ ...current, paymentFixedFee: value }))} value={settingsForm.paymentFixedFee} />
                <Field label="Custo operacional da entrega (R$)" onChangeText={(value) => setSettingsForm((current) => ({ ...current, deliveryCost: value }))} value={settingsForm.deliveryCost} />
                <Field label="Outros custos por pedido (R$)" onChangeText={(value) => setSettingsForm((current) => ({ ...current, otherCost: value }))} value={settingsForm.otherCost} />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isSavingSettings}
                onPress={() => void handleSaveSettings()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isSavingSettings && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {isSavingSettings ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                <Text style={styles.primaryButtonText}>
                  {isSavingSettings ? "Salvando..." : "Salvar configuração financeira"}
                </Text>
              </Pressable>
              {pricingSettings ? (
                <Text style={styles.updatedText}>
                  Preço atual: {formatCurrency(pricingSettings.unit_price_cents)} por ingresso + {formatCurrency(pricingSettings.delivery_fee_cents)} de entrega.
                </Text>
              ) : null}
            </View>

            <View style={styles.formCard}>
              <Text style={styles.cardEyebrow}>FLUXO DE CAIXA</Text>
              <Text style={styles.cardTitle}>Novo lançamento</Text>
              <Text style={styles.cardDescription}>
                Registre receitas adicionais, despesas reais e reembolsos fora do fluxo automático do Stripe.
              </Text>
              <View style={styles.chipRow}>
                <FilterChip active={entryType === "revenue"} label="Receita" onPress={() => handleEntryType("revenue")} />
                <FilterChip active={entryType === "expense"} label="Despesa" onPress={() => handleEntryType("expense")} />
                <FilterChip active={entryType === "refund"} label="Reembolso" onPress={() => handleEntryType("refund")} />
              </View>
              <Text style={styles.fieldLabel}>Categoria</Text>
              <View style={styles.chipRow}>
                {entryCategories[entryType].map((category) => (
                  <FilterChip
                    active={entryCategory === category}
                    key={category}
                    label={financialCategoryLabel(category)}
                    onPress={() => setEntryCategory(category)}
                  />
                ))}
              </View>
              <Field label="Descrição" onChangeText={setEntryDescription} placeholder="Ex.: compra de papel especial" value={entryDescription} />
              <View style={styles.fieldsGrid}>
                <Field label="Valor (R$)" onChangeText={setEntryAmount} placeholder="0,00" value={entryAmount} />
                <Field label="Data (AAAA-MM-DD)" onChangeText={setEntryDate} placeholder="2026-09-02" value={entryDate} />
              </View>
              <Field label="Número do pedido (opcional)" onChangeText={setEntryOrderNumber} placeholder="Ex.: 00002" value={entryOrderNumber} />
              <Pressable
                accessibilityRole="button"
                disabled={isSavingEntry}
                onPress={() => void handleCreateEntry()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isSavingEntry && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {isSavingEntry ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                <Text style={styles.primaryButtonText}>
                  {isSavingEntry ? "Registrando..." : "Registrar lançamento"}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.tableCard}>
            <Text style={styles.cardEyebrow}>HISTÓRICO FINANCEIRO</Text>
            <Text style={styles.cardTitle}>Lançamentos registrados</Text>
            {periodEntries.length === 0 ? (
              <EmptyText text="Nenhum lançamento manual neste período." />
            ) : (
              <View style={styles.entryList}>
                {periodEntries.slice(0, 50).map((entry) => {
                  const isNegative = entry.entry_type !== "revenue";
                  return (
                    <View key={entry.id} style={styles.entryRow}>
                      <View style={[styles.entryIcon, isNegative && styles.entryIconNegative]}>
                        <Text style={[styles.entryIconText, isNegative && styles.entryIconTextNegative]}>
                          {entry.entry_type === "revenue" ? "+" : "−"}
                        </Text>
                      </View>
                      <View style={styles.entryContent}>
                        <Text style={styles.entryDescription}>{entry.description}</Text>
                        <Text style={styles.entryMeta}>
                          {financialCategoryLabel(entry.category)} · {formatDatabaseDate(entry.occurred_on)}
                          {entry.order_id ? " · vinculado a pedido" : ""}
                        </Text>
                      </View>
                      <Text style={isNegative ? styles.entryAmountNegative : styles.entryAmountPositive}>
                        {isNegative ? "− " : "+ "}{formatCurrency(entry.amount_cents)}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busyEntryId === entry.id}
                        onPress={() => handleDeleteEntry(entry)}
                        style={({ pressed }) => [
                          styles.deleteButton,
                          busyEntryId === entry.id && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.deleteButtonText}>
                          {busyEntryId === entry.id ? "Excluindo..." : "Excluir"}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </>
      )}
    </ProtectedRoleScreen>
  );
}

function MetricCard({ label, tone = "cyan", value }: { label: string; tone?: "cyan" | "warm" | "green" | "danger"; value: number | string }) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricAccent, metricAccent(tone)]} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function FilterGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.pressed]}
    >
      <Text style={active ? styles.filterChipTextActive : styles.filterChipText}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, onChangeText, placeholder = "0,00", value }: { label: string; onChangeText: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoComplete="off"
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#91A4AD"
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function ChartBar({ color, label, max, value }: { color: string; label: string; max: number; value: number }) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <View style={styles.chartRow}>
      <Text style={styles.chartValue}>{label}</Text>
      <View style={styles.chartTrack}>
        <View style={[styles.chartFill, { backgroundColor: color, width: `${width}%` as `${number}%` }]} />
      </View>
    </View>
  );
}

function StateCard({ children }: { children: ReactNode }) {
  return <View style={styles.stateCard}>{children}</View>;
}

function EmptyText({ text }: { text: string }) {
  return <Text style={styles.emptyText}>{text}</Text>;
}

function periodStart(period: PeriodKey) {
  const now = new Date();
  if (period === "all") return null;
  if (period === "year") return new Date(now.getFullYear(), 0, 1);
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return start;
}

function isInsidePeriod(value: string, start: Date | null) {
  if (!start) return true;
  const normalized = value.length === 10 ? `${value}T12:00:00` : value;
  return new Date(normalized).getTime() >= start.getTime();
}

function matchesOperation(order: FinancialOrder, filter: OperationFilter) {
  if (filter === "all") return true;
  if (filter === "delivered") return order.status === "delivered";
  if (filter === "cancelled") return order.status === "cancelled";
  return ["paid", "in_production", "ready_for_delivery", "out_for_delivery"].includes(order.status);
}

function buildCategoryBreakdown(orders: FinancialOrder[]) {
  const map = new Map<string, { category: string; orders: number; units: number; revenue: number }>();
  orders.filter(isRevenueOrder).forEach((order) => {
    const category = order.ticket_drafts?.ticket_templates?.category ?? "other";
    const current = map.get(category) ?? { category, orders: 0, units: 0, revenue: 0 };
    current.orders += 1;
    current.units += order.quantity;
    current.revenue += order.payment_status === "refunded" ? 0 : order.total_cents;
    map.set(category, current);
  });
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

function buildExpenseBreakdown(
  orders: FinancialOrder[],
  entries: FinancialEntry[],
  settings: FinancialSettings,
) {
  const values = new Map<string, number>();
  orders.filter(isRevenueOrder).forEach((order) => {
    const cost = estimateOrderCost(order, settings);
    addMap(values, "Materiais", cost.material_cents);
    addMap(values, "Impressão", cost.printing_cents);
    addMap(values, "Taxas de pagamento", cost.payment_fee_cents);
    addMap(values, "Entrega", cost.delivery_cents);
    addMap(values, "Outros custos por pedido", cost.other_cents);
  });
  entries.filter((entry) => entry.entry_type === "expense").forEach((entry) => {
    addMap(values, financialCategoryLabel(entry.category), entry.amount_cents);
  });
  return [...values.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function buildCashFlow(
  orders: FinancialOrder[],
  entries: FinancialEntry[],
  settings: FinancialSettings,
) {
  const map = new Map<string, { key: string; label: string; revenue: number; cost: number }>();
  const ensure = (dateValue: string) => {
    const date = new Date(dateValue.length === 10 ? `${dateValue}T12:00:00` : dateValue);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const current = map.get(key) ?? {
      key,
      label: date.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }),
      revenue: 0,
      cost: 0,
    };
    map.set(key, current);
    return current;
  };
  orders.filter(isRevenueOrder).forEach((order) => {
    const bucket = ensure(order.paid_at ?? order.created_at);
    if (order.payment_status !== "refunded") bucket.revenue += order.total_cents;
    bucket.cost += estimateOrderCost(order, settings).total_cents;
  });
  entries.forEach((entry) => {
    const bucket = ensure(entry.occurred_on);
    if (entry.entry_type === "revenue") bucket.revenue += entry.amount_cents;
    else if (entry.entry_type === "expense") bucket.cost += entry.amount_cents;
    else bucket.revenue -= entry.amount_cents;
  });
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-8);
}

function addMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function createCsvReport(
  orders: FinancialOrder[],
  entries: FinancialEntry[],
  settings: FinancialSettings,
  summary: ReturnType<typeof calculateFinancialSummary>,
) {
  const rows: (string | number)[][] = [
    ["RELATÓRIO FINANCEIRO SEUCHICO"],
    ["Gerado em", new Date().toLocaleString("pt-BR")],
    [],
    ["Receita bruta", formatCurrency(summary.gross_revenue_cents)],
    ["Reembolsos", formatCurrency(summary.refunds_cents)],
    ["Receita líquida", formatCurrency(summary.net_revenue_cents)],
    ["Custos totais", formatCurrency(summary.total_costs_cents)],
    ["Lucro estimado", formatCurrency(summary.estimated_profit_cents)],
    ["Margem estimada", formatPercent(summary.margin_percent)],
    [],
    ["PEDIDOS"],
    ["Pedido", "Data", "Pagamento", "Evento", "Categoria", "Região", "Quantidade", "Receita líquida", "Custo estimado", "Lucro estimado", "Margem"],
  ];
  orders.filter(isRevenueOrder).forEach((order) => {
    const cost = estimateOrderCost(order, settings).total_cents;
    const revenue = order.payment_status === "refunded" ? 0 : order.total_cents;
    const profit = revenue - cost;
    rows.push([
      String(order.order_number).padStart(5, "0"),
      formatDatabaseDate((order.paid_at ?? order.created_at).slice(0, 10)),
      order.payment_status === "refunded" ? "Reembolsado" : "Pago",
      order.ticket_drafts?.event_name ?? "Ingresso personalizado",
      ticketCategoryLabel(order.ticket_drafts?.ticket_templates?.category ?? "other"),
      `${order.delivery_city}/${order.delivery_state}`,
      order.quantity,
      formatCurrency(revenue),
      formatCurrency(cost),
      formatCurrency(profit),
      formatPercent(revenue > 0 ? (profit / revenue) * 100 : 0),
    ]);
  });
  rows.push([], ["LANÇAMENTOS"], ["Data", "Tipo", "Categoria", "Descrição", "Valor"]);
  entries.forEach((entry) => {
    rows.push([
      formatDatabaseDate(entry.occurred_on),
      entryTypeLabel(entry.entry_type),
      financialCategoryLabel(entry.category),
      entry.description,
      formatCurrency(entry.amount_cents),
    ]);
  });
  return rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

function createPrintableReport(
  orders: FinancialOrder[],
  settings: FinancialSettings,
  summary: ReturnType<typeof calculateFinancialSummary>,
  period: PeriodKey,
) {
  const orderRows = orders
    .filter(isRevenueOrder)
    .map((order) => {
      const cost = estimateOrderCost(order, settings).total_cents;
      const revenue = order.payment_status === "refunded" ? 0 : order.total_cents;
      const profit = revenue - cost;
      return `<tr><td>#${String(order.order_number).padStart(5, "0")}</td><td>${escapeHtml(order.ticket_drafts?.event_name ?? "Ingresso personalizado")}</td><td>${order.quantity}</td><td>${formatCurrency(revenue)}</td><td>${formatCurrency(cost)}</td><td>${formatCurrency(profit)}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório financeiro SeuChico</title><style>body{font-family:Arial,sans-serif;color:#102A43;margin:32px}header{background:#071D2D;color:white;padding:28px;border-radius:18px}h1{margin:0 0 6px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:22px 0}.card{border:1px solid #dce7ea;border-radius:12px;padding:14px}.label{font-size:10px;color:#627d8a;font-weight:bold}.value{font-size:20px;font-weight:bold;margin-top:7px}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12px}th,td{border-bottom:1px solid #dce7ea;padding:9px;text-align:left}th{background:#f3f7f8}@media print{body{margin:0}button{display:none}}</style></head><body><header><h1>SeuChico — Relatório financeiro</h1><div>Período: ${escapeHtml(periodLabel(period))} · Gerado em ${new Date().toLocaleString("pt-BR")}</div></header><section class="grid"><div class="card"><div class="label">RECEITA BRUTA</div><div class="value">${formatCurrency(summary.gross_revenue_cents)}</div></div><div class="card"><div class="label">RECEITA LÍQUIDA</div><div class="value">${formatCurrency(summary.net_revenue_cents)}</div></div><div class="card"><div class="label">CUSTOS</div><div class="value">${formatCurrency(summary.total_costs_cents)}</div></div><div class="card"><div class="label">LUCRO ESTIMADO</div><div class="value">${formatCurrency(summary.estimated_profit_cents)}</div></div><div class="card"><div class="label">MARGEM</div><div class="value">${formatPercent(summary.margin_percent)}</div></div><div class="card"><div class="label">PEDIDOS PAGOS</div><div class="value">${summary.paid_orders}</div></div></section><h2>Rentabilidade por pedido</h2><table><thead><tr><th>Pedido</th><th>Evento</th><th>Qtd.</th><th>Receita</th><th>Custo</th><th>Lucro</th></tr></thead><tbody>${orderRows || '<tr><td colspan="6">Nenhum pedido pago neste filtro.</td></tr>'}</tbody></table></body></html>`;
}

function csvCell(value: string | number) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function todayDatabaseDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDatabaseDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatPercent(value: number) {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function periodLabel(period: PeriodKey) {
  return periodOptions.find((option) => option.value === period)?.label ?? "Período selecionado";
}

function ticketCategoryLabel(category: string) {
  if (category === "party") return "Festa";
  if (category === "wedding") return "Casamento";
  if (category === "show") return "Show";
  if (category === "corporate") return "Corporativo";
  return "Outros";
}

function entryTypeLabel(type: FinancialEntryType) {
  if (type === "revenue") return "Receita";
  if (type === "refund") return "Reembolso";
  return "Despesa";
}

function metricAccent(tone: "cyan" | "warm" | "green" | "danger") {
  if (tone === "warm") return { backgroundColor: "#F0B85A" };
  if (tone === "green") return { backgroundColor: "#4CB88A" };
  if (tone === "danger") return { backgroundColor: "#EF806D" };
  return { backgroundColor: "#38D6D2" };
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 22 },
  toolbarActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  backButton: { paddingVertical: 10 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  outlineButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 14 },
  outlineButtonText: { color: "#102A43", fontSize: 10, fontWeight: "900" },
  darkButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 15 },
  darkButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  successCard: { borderRadius: 15, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 13, marginTop: 15 },
  successText: { color: "#176A50", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  errorCard: { borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 13, marginTop: 15 },
  errorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  filterCard: { ...visualShadows.card, borderRadius: 20, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 17, marginTop: 16, gap: 15 },
  filterGroup: { gap: 8 },
  filterLabel: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filterChip: { borderRadius: 20, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 11, paddingVertical: 8 },
  filterChipActive: { borderColor: "#071D2D", backgroundColor: "#071D2D" },
  filterChipText: { color: "#627D8A", fontSize: 9, fontWeight: "800" },
  filterChipTextActive: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  filterNote: { color: "#8298A2", fontSize: 8, lineHeight: 13 },
  warningCard: { borderRadius: 17, borderWidth: 1, borderColor: "#F3D39C", backgroundColor: "#FFF8EA", padding: 15, marginTop: 16 },
  warningTitle: { color: "#7A4B1C", fontSize: 11, fontWeight: "900" },
  warningText: { color: "#8A6848", fontSize: 10, lineHeight: 16, marginTop: 4 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 11, marginTop: 16 },
  metricCard: { ...visualShadows.subtle, overflow: "hidden", minWidth: Platform.OS === "web" ? 185 : "46%", flexGrow: 1, flexBasis: Platform.OS === "web" ? "21%" : "46%", minHeight: 105, borderRadius: 18, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 16 },
  metricAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  metricLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  metricValue: { color: "#102A43", fontSize: 22, lineHeight: 28, fontWeight: "900", marginTop: 11 },
  reportGrid: { flexDirection: Platform.OS === "web" ? "row" : "column", flexWrap: "wrap", gap: 14, marginTop: 16 },
  reportCard: { ...visualShadows.card, minWidth: Platform.OS === "web" ? 310 : "100%", flexGrow: 1, flexBasis: Platform.OS === "web" ? "31%" : "100%", borderRadius: 21, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 18 },
  cardEyebrow: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  cardTitle: { color: "#102A43", fontSize: 19, lineHeight: 25, fontWeight: "900", marginTop: 6 },
  cardDescription: { color: "#627D8A", fontSize: 10, lineHeight: 16, marginTop: 6, marginBottom: 14 },
  chartList: { gap: 14, marginTop: 16 },
  chartGroup: { gap: 5 },
  chartLabel: { color: "#102A43", fontSize: 10, fontWeight: "900", textTransform: "capitalize" },
  chartRow: { gap: 4 },
  chartValue: { color: "#627D8A", fontSize: 8, fontWeight: "700" },
  chartTrack: { overflow: "hidden", height: 7, borderRadius: 4, backgroundColor: "#EDF3F5" },
  chartFill: { height: "100%", borderRadius: 4 },
  rankingList: { gap: 14, marginTop: 16 },
  rankingRow: { gap: 7 },
  rankingText: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rankingLabel: { flex: 1, color: "#102A43", fontSize: 10, fontWeight: "900" },
  rankingValue: { color: "#087E83", fontSize: 10, fontWeight: "900" },
  rankingTrack: { overflow: "hidden", height: 7, borderRadius: 4, backgroundColor: "#EDF3F5" },
  rankingFill: { height: "100%", borderRadius: 4, backgroundColor: "#38D6D2" },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  categoryPosition: { width: 29, height: 29, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#E5FAF9" },
  categoryPositionText: { color: "#087E83", fontSize: 10, fontWeight: "900" },
  categoryContent: { flex: 1, minWidth: 0 },
  categoryMeta: { color: "#8298A2", fontSize: 8, marginTop: 2 },
  tableCard: { ...visualShadows.card, borderRadius: 21, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 18, marginTop: 16 },
  table: { minWidth: Platform.OS === "web" ? 820 : 0, marginTop: 15 },
  tableRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#E5EDEF", paddingVertical: 10, gap: 8 },
  tableHeader: { borderRadius: 10, borderBottomWidth: 0, backgroundColor: "#F3F8FA", paddingHorizontal: 8 },
  tableCell: { width: 105, color: "#486876", fontSize: 9, fontWeight: "700" },
  tableCellOrder: { width: 70, color: "#102A43", fontWeight: "900" },
  tableCellEvent: { flex: 1, minWidth: 150 },
  tableHeaderText: { color: "#8298A2", fontSize: 7, fontWeight: "900", letterSpacing: 0.6 },
  positiveText: { color: "#176A50", fontWeight: "900" },
  negativeText: { color: "#A43E2E", fontWeight: "900" },
  managementGrid: { flexDirection: Platform.OS === "web" ? "row" : "column", alignItems: "flex-start", gap: 14, marginTop: 16 },
  formCard: { ...visualShadows.card, width: Platform.OS === "web" ? "49%" : "100%", flexGrow: 1, borderRadius: 21, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 18 },
  fieldsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  fieldGroup: { minWidth: Platform.OS === "web" ? 190 : "100%", flex: 1, gap: 6, marginTop: 10 },
  fieldLabel: { color: "#102A43", fontSize: 9, fontWeight: "900", marginTop: 10 },
  input: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#F8FBFC", color: "#102A43", fontSize: 11, paddingHorizontal: 13 },
  primaryButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 14, backgroundColor: "#38D6D2", paddingHorizontal: 15, marginTop: 15 },
  primaryButtonText: { color: "#071D2D", fontSize: 10, fontWeight: "900" },
  updatedText: { color: "#627D8A", fontSize: 8, lineHeight: 13, marginTop: 9, textAlign: "center" },
  entryList: { gap: 9, marginTop: 15 },
  entryRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, borderRadius: 14, backgroundColor: "#F7FAFB", padding: 11 },
  entryIcon: { width: 31, height: 31, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#DFF6EC" },
  entryIconNegative: { backgroundColor: "#FFE7E2" },
  entryIconText: { color: "#176A50", fontSize: 17, fontWeight: "900" },
  entryIconTextNegative: { color: "#A43E2E" },
  entryContent: { flex: 1, minWidth: 190 },
  entryDescription: { color: "#102A43", fontSize: 10, fontWeight: "900" },
  entryMeta: { color: "#8298A2", fontSize: 8, marginTop: 3 },
  entryAmountPositive: { color: "#176A50", fontSize: 11, fontWeight: "900" },
  entryAmountNegative: { color: "#A43E2E", fontSize: 11, fontWeight: "900" },
  deleteButton: { borderRadius: 11, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", paddingHorizontal: 10, paddingVertical: 8 },
  deleteButtonText: { color: "#8A3325", fontSize: 8, fontWeight: "900" },
  stateCard: { minHeight: 260, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30, marginTop: 16 },
  stateText: { maxWidth: 470, color: "#627D8A", fontSize: 12, lineHeight: 19, textAlign: "center" },
  stateErrorTitle: { color: "#8A3325", fontSize: 18, fontWeight: "900" },
  emptyText: { color: "#8298A2", fontSize: 10, lineHeight: 16, marginTop: 15 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});
