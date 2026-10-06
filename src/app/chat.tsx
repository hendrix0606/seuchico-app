import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import type { ElementRef } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import { fetchOrderClientAvatarPath } from "../lib/avatar";
import { notifyOrderEvent } from "../lib/push-notifications";
import { supabase } from "../lib/supabase";
import type { ChatOrder, OrderMessage } from "../types/chat";

const ORDER_SELECT =
  "id, order_number, user_id, assigned_courier_id, status, ticket_drafts(event_name)";

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ order?: string | string[] }>();
  const orderId = firstParam(params.order);
  const { session, profile } = useAuth();
  const [order, setOrder] = useState<ChatOrder | null>(null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [body, setBody] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clientAvatarPath, setClientAvatarPath] = useState<string | null>(null);
  const scrollRef = useRef<ElementRef<typeof ScrollView>>(null);

  useEffect(() => {
    const userId = session?.user.id;
    let isMounted = true;

    if (!orderId || !userId || !profile) {
      if (isMounted && profile) setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const markRead = async () => {
      await supabase.rpc("mark_order_messages_read", {
        p_order_id: orderId,
      });
    };

    const loadMessages = async ({ shouldMarkRead = true } = {}) => {
      const { data, error } = await supabase
        .from("order_messages")
        .select(
          "id, order_id, sender_id, sender_role, sender_name, body, read_at, created_at",
        )
        .eq("order_id", orderId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (!isMounted) return;

      if (error) {
        setErrorMessage(
          "Não foi possível carregar a conversa. Confirme o SQL da Etapa 10.",
        );
        return;
      }

      setMessages((data ?? []) as OrderMessage[]);
      if (shouldMarkRead) void markRead();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    };

    const loadChat = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      const { data, error } = await supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("id", orderId)
        .single();

      if (!isMounted) return;

      if (error || !data) {
        setErrorMessage(
          "Conversa indisponível. Este pedido não pertence à sua conta ou não possui entregador.",
        );
        setIsLoading(false);
        return;
      }

      const loadedOrder = data as unknown as ChatOrder;
      const isParticipant =
        (profile.role === "client" && loadedOrder.user_id === userId) ||
        (profile.role === "courier" &&
          loadedOrder.assigned_courier_id === userId);

      if (!isParticipant || !loadedOrder.assigned_courier_id) {
        setErrorMessage(
          "A conversa será liberada quando um entregador for atribuído a este pedido.",
        );
        setIsLoading(false);
        return;
      }

      setOrder(loadedOrder);
      void fetchOrderClientAvatarPath(loadedOrder.id).then((path) => {
        if (isMounted) setClientAvatarPath(path);
      });
      await loadMessages();
      if (isMounted) setIsLoading(false);
    };

    void loadChat();

    const channel = supabase
      .channel(`order-chat-${orderId}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_messages",
          filter: `order_id=eq.${orderId}`,
        },
        () => void loadMessages(),
      )
      .subscribe();

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [orderId, profile, session?.user.id]);

  const sendMessage = async () => {
    const cleanBody = body.trim();
    if (!order || !cleanBody || isSending) return;

    setIsSending(true);
    setErrorMessage(null);

    const { error } = await supabase.rpc("send_order_message", {
      p_order_id: order.id,
      p_body: cleanBody,
    });

    if (error) {
      setErrorMessage(
        "Não foi possível enviar a mensagem. Atualize a conversa e tente novamente.",
      );
    } else {
      setBody("");
      await notifyOrderEvent(order.id, "chat_message");
    }

    setIsSending(false);
  };

  const returnRoute = profile?.role === "courier" ? "/entregador" : "/pedidos";
  const isWritable =
    order?.status === "ready_for_delivery" ||
    order?.status === "out_for_delivery";

  return (
    <ProtectedRoleScreen
      eyebrow="CONVERSA DO PEDIDO"
      requiredRole={["client", "courier"]}
      subtitle="Fale com segurança com a outra pessoa vinculada a esta entrega."
      title="Chat da entrega"
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace(returnRoute)}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Text style={styles.backButtonText}>← Voltar</Text>
      </Pressable>

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando conversa...</Text>
        </View>
      ) : errorMessage && !order ? (
        <View style={styles.stateCard}>
          <Text style={styles.errorTitle}>Conversa indisponível</Text>
          <Text style={styles.stateText}>{errorMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace(returnRoute)}
            style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
          >
            <Text style={styles.darkButtonText}>Voltar</Text>
          </Pressable>
        </View>
      ) : order ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.chatCard}
        >
          <View style={styles.chatHeader}>
            <View>
              <Text style={styles.chatEyebrow}>
                PEDIDO #{String(order.order_number).padStart(5, "0")}
              </Text>
              <Text style={styles.chatTitle}>
                {order.ticket_drafts?.event_name ?? "Ingresso SeuChico"}
              </Text>
            </View>
            <View style={styles.secureBadge}>
              <Text style={styles.secureBadgeText}>🔒 PRIVADO</Text>
            </View>
          </View>

          {errorMessage ? (
            <View accessibilityLiveRegion="polite" style={styles.errorCard}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={styles.messagesContent}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: true })
            }
            ref={scrollRef}
            style={styles.messages}
          >
            {messages.length === 0 ? (
              <View style={styles.emptyChat}>
                <Text style={styles.emptyChatIcon}>💬</Text>
                <Text style={styles.emptyChatTitle}>Comece a conversa</Text>
                <Text style={styles.emptyChatText}>
                  Use este espaço apenas para combinar detalhes desta entrega.
                </Text>
              </View>
            ) : (
              messages.map((message) => {
                const isOwn = message.sender_id === session?.user.id;
                return (
                  <View
                    key={message.id}
                    style={[
                      styles.messageRow,
                      isOwn ? styles.messageRowOwn : styles.messageRowOther,
                    ]}
                  >
                    <View style={[styles.messageLine, isOwn && styles.messageLineOwn]}>
                      {message.sender_role === "client" ? (
                        <Avatar
                          name={message.sender_name}
                          path={clientAvatarPath}
                          size={32}
                        />
                      ) : null}
                      <View
                        style={[
                          styles.messageBubble,
                          isOwn ? styles.messageBubbleOwn : styles.messageBubbleOther,
                        ]}
                      >
                        <Text
                          style={isOwn ? styles.senderNameOwn : styles.senderName}
                        >
                          {isOwn ? "Você" : message.sender_name}
                        </Text>
                        <Text
                          style={isOwn ? styles.messageBodyOwn : styles.messageBody}
                        >
                          {message.body}
                        </Text>
                        <Text
                          style={isOwn ? styles.messageMetaOwn : styles.messageMeta}
                        >
                          {formatMessageTime(message.created_at)}
                          {isOwn ? (message.read_at ? " · Lida" : " · Enviada") : ""}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {isWritable ? (
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Mensagem"
                maxLength={1000}
                multiline
                onChangeText={setBody}
                placeholder="Escreva uma mensagem sobre a entrega..."
                placeholderTextColor="#8298A2"
                style={styles.input}
                value={body}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!body.trim() || isSending}
                onPress={() => void sendMessage()}
                style={({ pressed }) => [
                  styles.sendButton,
                  (!body.trim() || isSending) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {isSending ? (
                  <ActivityIndicator color="#071D2D" size="small" />
                ) : (
                  <Text style={styles.sendButtonText}>Enviar →</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <View style={styles.readOnlyCard}>
              <Text style={styles.readOnlyTitle}>Conversa encerrada</Text>
              <Text style={styles.readOnlyText}>
                As mensagens continuam disponíveis para consulta, mas este pedido não aceita novas mensagens.
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      ) : null}
    </ProtectedRoleScreen>
  );
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const styles = StyleSheet.create({
  backButton: { alignSelf: "flex-start", paddingVertical: 10, marginTop: 12 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  chatCard: { ...visualShadows.card, overflow: "hidden", borderRadius: 23, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF" },
  chatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderBottomWidth: 1, borderBottomColor: "#E4ECEF", padding: 18 },
  chatEyebrow: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  chatTitle: { color: "#102A43", fontSize: 18, fontWeight: "900", marginTop: 5 },
  secureBadge: { borderRadius: 20, backgroundColor: "#E7F8F7", paddingHorizontal: 10, paddingVertical: 7 },
  secureBadgeText: { color: "#087E83", fontSize: 8, fontWeight: "900" },
  messages: { maxHeight: 510, minHeight: 330, backgroundColor: "#F3F7F8" },
  messagesContent: { flexGrow: 1, padding: 16, gap: 10 },
  messageRow: { width: "100%" },
  messageRowOwn: { alignItems: "flex-end" },
  messageRowOther: { alignItems: "flex-start" },
  messageLine: { maxWidth: "88%", flexDirection: "row", alignItems: "flex-end", gap: 8 },
  messageLineOwn: { flexDirection: "row-reverse" },
  messageBubble: { flexShrink: 1, borderRadius: 17, paddingHorizontal: 14, paddingVertical: 11 },
  messageBubbleOwn: { borderBottomRightRadius: 5, backgroundColor: "#087E83" },
  messageBubbleOther: { borderBottomLeftRadius: 5, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE7EA" },
  senderName: { color: "#087E83", fontSize: 9, fontWeight: "900", marginBottom: 4 },
  senderNameOwn: { color: "#BFF3F1", fontSize: 9, fontWeight: "900", marginBottom: 4 },
  messageBody: { color: "#102A43", fontSize: 13, lineHeight: 19 },
  messageBodyOwn: { color: "#FFFFFF", fontSize: 13, lineHeight: 19 },
  messageMeta: { color: "#8298A2", fontSize: 8, marginTop: 6 },
  messageMetaOwn: { color: "#C7EEEC", fontSize: 8, marginTop: 6, textAlign: "right" },
  emptyChat: { flex: 1, minHeight: 300, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyChatIcon: { fontSize: 34 },
  emptyChatTitle: { color: "#102A43", fontSize: 17, fontWeight: "900" },
  emptyChatText: { maxWidth: 410, color: "#627D8A", fontSize: 11, lineHeight: 18, textAlign: "center" },
  composer: { flexDirection: Platform.OS === "web" ? "row" : "column", alignItems: "stretch", gap: 10, borderTopWidth: 1, borderTopColor: "#E4ECEF", padding: 14 },
  input: { flex: 1, minHeight: 50, maxHeight: 125, borderRadius: 14, borderWidth: 1, borderColor: "#CFE0E5", backgroundColor: "#F8FAFB", color: "#102A43", fontSize: 13, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: "top" },
  sendButton: { minWidth: 110, minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#38D6D2", paddingHorizontal: 18 },
  sendButtonText: { color: "#071D2D", fontSize: 12, fontWeight: "900" },
  readOnlyCard: { borderTopWidth: 1, borderTopColor: "#E4ECEF", backgroundColor: "#FFF7EB", padding: 15 },
  readOnlyTitle: { color: "#77530D", fontSize: 11, fontWeight: "900" },
  readOnlyText: { color: "#8A6848", fontSize: 10, lineHeight: 16, marginTop: 4 },
  errorCard: { borderBottomWidth: 1, borderBottomColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 12 },
  errorText: { color: "#8A3325", fontSize: 10, lineHeight: 16, fontWeight: "800" },
  stateCard: { minHeight: 300, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 23, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30 },
  stateText: { maxWidth: 480, color: "#627D8A", fontSize: 13, lineHeight: 20, textAlign: "center" },
  errorTitle: { color: "#8A3325", fontSize: 18, fontWeight: "900" },
  darkButton: { borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 16, paddingVertical: 12 },
  darkButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});
