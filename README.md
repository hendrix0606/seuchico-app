# SeuChico

Aplicativo de pedidos de ingressos personalizados com entrega, feito com **Expo (React Native)** e **Supabase**. O cliente monta o ingresso, paga (cartÃ£o, PIX ou dinheiro na entrega), acompanha a produÃ§Ã£o e a entrega e avalia o entregador. O administrador opera os pedidos, e o entregador faz a rota e o acerto de caixa.

## Funcionalidades

- **TrÃªs perfis:** cliente, entregador e administrador, com regras de acesso no banco (RLS) para cada um.
- **CatÃ¡logo e editor** de ingressos personalizados, com rascunhos.
- **Pagamento:** cartÃ£o (Stripe Checkout), PIX com comprovante analisado pelo admin e **dinheiro na entrega**.
- **Dinheiro na entrega:** o entregador confirma o recebimento, hÃ¡ acerto de caixa e, em caso de recusa, bloqueio de 90 dias que o admin pode liberar.
- **Entrega:** atribuiÃ§Ã£o de entregador, rastreamento por GPS, painel de rota e chat do pedido.
- **Perfil do cliente** com foto em armazenamento privado e uso opcional da localizaÃ§Ã£o para o endereÃ§o.
- **AvaliaÃ§Ã£o do entregador** (1 a 5 estrelas e comentÃ¡rio) e relatÃ³rios financeiros.
- **NotificaÃ§Ãµes push** e recuperaÃ§Ã£o de senha.

## Tecnologias

Expo SDK 57 Â· expo-router Â· React Native Web Â· NativeWind Â· Supabase (Auth, Postgres com RLS, Storage, Edge Functions) Â· Stripe Â· EAS Build.

## Como rodar

1. Instale as dependÃªncias:
   ```bash
   npm install
   ```
2. Crie o arquivo `.env` na raiz (ele fica fora do Git) com as chaves **pÃºblicas** do seu projeto Supabase:
   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://<seu-projeto>.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<chave anon / publishable>
   ```
3. Prepare o banco e as funÃ§Ãµes seguindo [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md).
4. Inicie o app:
   ```bash
   npm run web        # navegador
   npx expo start --go   # celular com o Expo Go
   ```

## Estrutura

| Pasta | ConteÃºdo |
|---|---|
| `src/app` | Telas (rotas do expo-router) |
| `src/components`, `src/lib`, `src/context` | Componentes, utilitÃ¡rios e contexto de autenticaÃ§Ã£o |
| `supabase/` | MigraÃ§Ãµes SQL (`001` a `020`), `setup_completo.sql` e Edge Functions |
| `apresentacao/` | Gerador da apresentaÃ§Ã£o das novidades |
| `docs/` | Guias de configuraÃ§Ã£o |

## Build do APK (EAS)

O build na nuvem usa sÃ³ os arquivos do Git. Por isso o `.env` e o `google-services.json` (ambos ignorados pelo Git) sÃ£o enviados como variÃ¡veis do EAS. Perfis do `eas.json`: `development`, `preview` (**APK**) e `production` (AAB).

```bash
npx eas-cli login
npx eas-cli env:set preview --name EXPO_PUBLIC_SUPABASE_URL --value <url> --visibility plaintext
npx eas-cli env:set preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <chave> --visibility plaintext
npx eas-cli build --profile preview --platform android
```

O painel de rota nÃ£o depende de mapa interno nem de chave do Google. Para ativar o mapa interno (opcional), veja `GOOGLE_MAPS_API_KEY` e `EXPO_PUBLIC_NATIVE_MAP=true` em [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md#mapa-interno-opcional).

## SeguranÃ§a

Nenhuma chave secreta fica no repositÃ³rio. Chaves do Stripe, do OpenRouteService e a `service_role` do Supabase ficam apenas nos *secrets* das Edge Functions. O app usa sÃ³ a chave pÃºblica (anon/publishable).
