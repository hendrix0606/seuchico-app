import { LegalBullet, LegalDocumentScreen, LegalParagraph } from "../components/LegalDocumentScreen";

export default function TermsScreen() {
  return (
    <LegalDocumentScreen
      title="Termos de Uso"
      subtitle="Regras gerais para utilização do SeuChico por clientes, entregadores e administradores."
      sections={[
        { title: "1. Finalidade do SeuChico", content: "O SeuChico permite criar e personalizar ingressos físicos, realizar pedidos, efetuar pagamentos e acompanhar as etapas de produção e entrega." },
        { title: "2. Contas e responsabilidades", content: <><LegalBullet>Clientes criam a própria conta e devem fornecer dados verdadeiros e atualizados.</LegalBullet><LegalBullet>Entregadores utilizam acessos criados pelo administrador e não devem compartilhar suas credenciais.</LegalBullet><LegalBullet>Cada pessoa é responsável por proteger sua senha e informar qualquer uso não autorizado.</LegalBullet></> },
        { title: "3. Personalização e aprovação", content: "Antes de concluir o pedido, o cliente deve revisar nomes, datas, horários, quantidades, cores, local do evento e observações. A produção utiliza os dados confirmados no pedido." },
        { title: "4. Pagamentos", content: "Pagamentos por cartão são processados em ambiente seguro pelo provedor integrado, sem armazenamento do número completo do cartão pelo SeuChico. No PIX manual, o cliente envia o comprovante e o pedido somente é liberado após conferência administrativa. Valores, taxas e condições são apresentados antes da confirmação." },
        { title: "5. Produção e entrega", content: "O acompanhamento informa o andamento operacional do pedido. Previsões de rota e horário podem variar conforme trânsito, disponibilidade de GPS, conectividade e condições externas." },
        { title: "6. Uso adequado", content: "Não é permitido tentar acessar contas de terceiros, manipular pedidos, enviar conteúdo ilegal, interferir no serviço ou utilizar o aplicativo para fins fraudulentos." },
        { title: "7. Suspensão de acesso", content: "Contas podem ser temporariamente desativadas em caso de risco de segurança, fraude, uso indevido ou violação destes termos. O administrador não consegue visualizar senhas." },
        { title: "8. Disponibilidade e alterações", content: "O serviço pode passar por manutenção ou atualização. Mudanças relevantes nestes termos deverão ser comunicadas pelos canais oficiais do SeuChico." },
        { title: "9. Atendimento", content: <LegalParagraph>O canal oficial de atendimento e os dados empresariais serão inseridos nesta seção antes da publicação comercial.</LegalParagraph> },
      ]}
    />
  );
}
