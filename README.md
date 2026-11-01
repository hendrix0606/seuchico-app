# SeuChico

Aplicativo de pedidos de ingressos personalizados com entrega, feito com **Expo (React Native)** e **Supabase**. O cliente monta o ingresso, paga (cartão, PIX ou dinheiro na entrega), acompanha a produção e a entrega e avalia o entregador. O administrador opera os pedidos, e o entregador faz a rota e o acerto de caixa.

## Funcionalidades

- **Três perfis:** cliente, entregador e administrador, com regras de acesso no banco (RLS) para cada um.
- **Catálogo e editor** de ingressos personalizados, com rascunhos.
- **Pagamento:** cartão (Stripe Checkout), PIX com comprovante analisado pelo admin e **dinheiro na entrega**.
- **Dinheiro na entrega:** o entregador confirma o recebimento, há acerto de caixa e, em caso de recusa, bloqueio de 90 dias que o admin pode liberar.
- **Entrega:** atribuição de entregador, rastreamento por GPS, painel de rota e chat do pedido.
- **Perfil do cliente** com foto em armazenamento privado e uso opcional da localização para o endereço.
- **Avaliação do entregador** (1 a 5 estrelas e comentário) e relatórios financeiros.
- **Notificações push** e recuperação de senha.

## Tecnologias

Expo SDK 57 · expo-router · React Native Web · NativeWind · Supabase (Auth, Postgres com RLS, Storage, Edge Functions) · Stripe · EAS Build.

## Como rodar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie o arquivo `.env` na raiz (ele fica fora do Git) com as chaves **públicas** do seu projeto Supabase:
   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://<seu-projeto>.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<chave anon / publishable>
   ```
3. Prepare o banco e as funções seguindo [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md).
4. Inicie o app:
   ```bash
   npm run web        # navegador
   npx expo start --go   # celular com o Expo Go
   ```

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/app` | Telas (rotas do expo-router) |
| `src/components`, `src/lib`, `src/context` | Componentes, utilitários e contexto de autenticação |
| `supabase/` | Migrações SQL (`001` a `020`), `setup_completo.sql` e Edge Functions |
| `docs/` | Guias de configuração |

## Build do APK (EAS)

O build na nuvem usa só os arquivos do Git. Por isso o `.env` e o `google-services.json` (ambos ignorados pelo Git) são enviados como variáveis do EAS. Perfis do `eas.json`: `development`, `preview` (**APK**) e `production` (AAB).

```bash
npx eas-cli login
npx eas-cli env:set preview --name EXPO_PUBLIC_SUPABASE_URL --value <url> --visibility plaintext
npx eas-cli env:set preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <chave> --visibility plaintext
npx eas-cli build --profile preview --platform android
```

O painel de rota não depende de mapa interno nem de chave do Google. Para ativar o mapa interno (opcional), veja `GOOGLE_MAPS_API_KEY` e `EXPO_PUBLIC_NATIVE_MAP=true` em [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md#mapa-interno-opcional).

## Segurança

Nenhuma chave secreta fica no repositório. Chaves do Stripe, do OpenRouteService e a `service_role` do Supabase ficam apenas nos *secrets* das Edge Functions. O app usa só a chave pública (anon/publishable).
