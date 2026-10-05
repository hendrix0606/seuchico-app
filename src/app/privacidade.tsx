import { LegalBullet, LegalDocumentScreen } from "../components/LegalDocumentScreen";

export default function PrivacyScreen() {
  return (
    <LegalDocumentScreen
      title="Política de Privacidade"
      subtitle="Como o SeuChico utiliza e protege os dados necessários para prestar o serviço."
      sections={[
        { title: "1. Dados tratados", content: <><LegalBullet>Nome, e-mail, telefone e dados de autenticação.</LegalBullet><LegalBullet>Informações do evento, personalização, pedido, pagamento, comprovante PIX e endereço de entrega.</LegalBullet><LegalBullet>Mensagens vinculadas ao pedido.</LegalBullet><LegalBullet>Localização do entregador somente durante uma entrega autorizada.</LegalBullet><LegalBullet>Token técnico do dispositivo para envio de notificações.</LegalBullet></> },
        { title: "2. Finalidades", content: <><LegalBullet>Criar e proteger a conta.</LegalBullet><LegalBullet>Produzir, cobrar, entregar e acompanhar pedidos.</LegalBullet><LegalBullet>Permitir comunicação entre cliente e entregador.</LegalBullet><LegalBullet>Enviar avisos operacionais e prevenir fraudes.</LegalBullet><LegalBullet>Gerar relatórios administrativos e financeiros.</LegalBullet></> },
        { title: "3. Serviços integrados", content: "Os dados estritamente necessários podem ser processados por serviços de autenticação e banco de dados, pagamento, mapas/rotas e notificações. Cada provedor possui controles próprios de segurança e privacidade." },
        { title: "4. Localização", content: "A posição do entregador é compartilhada apenas com as contas autorizadas enquanto o pedido está em entrega. Ao confirmar a entrega, a última coordenada operacional é removida conforme a regra implementada no banco." },
        { title: "5. Segurança", content: "O acesso utiliza autenticação, sessões protegidas e políticas por perfil no banco. Senhas não são armazenadas nas tabelas do aplicativo e as chaves secretas permanecem no ambiente seguro dos serviços de backend." },
        { title: "6. Retenção", content: "Dados são mantidos pelo tempo necessário para executar o serviço, cumprir obrigações legais, manter registros financeiros e resolver disputas. Os prazos definitivos deverão ser aprovados antes da operação comercial." },
        { title: "7. Direitos do titular", content: "O titular poderá solicitar confirmação de tratamento, acesso, correção, portabilidade, informação sobre compartilhamento e exclusão quando aplicável. O canal oficial para essas solicitações será informado antes da publicação." },
        { title: "8. Atualizações", content: "Esta política poderá ser atualizada para refletir mudanças legais, técnicas ou operacionais. A data da versão será mantida no início do documento." },
      ]}
    />
  );
}
