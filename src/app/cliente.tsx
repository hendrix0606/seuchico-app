import { useRouter } from "expo-router";
import {
  DashboardCard,
  DashboardGrid,
  ProtectedRoleScreen,
} from "../components/ProtectedRoleScreen";

export default function ClientScreen() {
  const router = useRouter();

  return (
    <ProtectedRoleScreen
      eyebrow="ÁREA DO CLIENTE"
      requiredRole="client"
      subtitle="Crie seus ingressos personalizados e acompanhe cada etapa do pedido."
      title="Olá"
    >
      <DashboardGrid>
        <DashboardCard
          description="Escolha um modelo e comece a personalizar."
          icon="✨"
          onPress={() => router.push("/catalogo")}
          title="Criar ingresso"
        />
        <DashboardCard
          description="Continue os ingressos que ainda estão em criação."
          icon="🎟️"
          onPress={() => router.push("/rascunhos")}
          title="Meus rascunhos"
        />
        <DashboardCard
          accent="warm"
          description="Consulte produção, pagamento e entrega."
          icon="📦"
          onPress={() => router.push("/pedidos")}
          title="Meus pedidos"
        />
        <DashboardCard
          description="Atualize seus dados e preferências."
          icon="👤"
          onPress={() => router.push("/perfil")}
          title="Meu perfil"
        />
        <DashboardCard
          description="Volte à página inicial do SeuChico."
          icon="⌂"
          onPress={() => router.replace("/")}
          title="Página inicial"
        />
      </DashboardGrid>
    </ProtectedRoleScreen>
  );
}
