# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Create a `.env` file in the project root with your Supabase credentials (the app throws on startup without them, see `src/lib/supabase.ts`). The file is git-ignored, so it is never committed:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
   ```

3. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **src/app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Build nativo (EAS) e APK

O build na nuvem (EAS) usa apenas os arquivos do Git, então `.env` e `google-services.json`
(ambos no `.gitignore`) são enviados como variáveis do EAS. Perfis de `eas.json`:
`development` (cliente de desenvolvimento), `preview` (**APK** para instalar direto) e
`production` (AAB, para a Google Play).

Antes do primeiro build, uma vez por ambiente (`development`, `preview` e `production`):

1. Entre na conta Expo dona do projeto: `npx eas-cli login`.
2. Envie o `.env`: `npx eas-cli env:push preview --path .env`.
3. Envie o `google-services.json` como variável de **arquivo**:
   `npx eas-cli env:set preview --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility sensitive`.
4. Notificações push: cadastre a chave de conta de serviço do Firebase (FCM V1) com
   `npx eas-cli credentials`.

**Mapa interno (opcional).** Por padrão o app **não** usa mapa interno: entregador e cliente veem
distância, previsão e um botão que abre o trajeto no Google Maps do aparelho (não precisa de chave
nem de Google Cloud). Para ligar o mapa interno, crie uma chave do *Maps SDK for Android*
(exige conta com faturamento), restrinja-a ao pacote `com.henryq00.seuchico` e ao SHA-1 do build, e
cadastre `GOOGLE_MAPS_API_KEY` e `EXPO_PUBLIC_NATIVE_MAP=true` no EAS
(`npx eas-cli env:set preview --name <NOME> --value <valor> --visibility sensitive`).

Gerar o APK: `npx eas-cli build --profile preview --platform android`.

No Supabase (Authentication → URL Configuration), libere os endereços de retorno do app
(`seuchico://**` e `seuchicoapp://**`). O plugin `expo-location` exige um novo build nativo
para a permissão de localização valer.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
