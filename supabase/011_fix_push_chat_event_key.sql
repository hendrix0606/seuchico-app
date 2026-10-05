-- SeuChico - Correcao da Etapa 11
-- Permite chaves iniciais do chat, como chat:1.

begin;

alter table public.push_notification_events
  drop constraint if exists push_notification_events_key_check;

alter table public.push_notification_events
  add constraint push_notification_events_key_check
  check (char_length(event_key) between 6 and 300);

commit;

select 'ETAPA_11_CHAT_PUSH_CORRIGIDO' as resultado;
