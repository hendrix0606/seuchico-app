// Estende o app.json com valores que vem do ambiente de build (EAS), para que
// arquivos e chaves sensiveis nao fiquem no Git:
//   * GOOGLE_SERVICES_JSON: variavel do tipo arquivo com o google-services.json
//     (no .gitignore). Localmente, usa o arquivo da raiz do projeto.
//   * GOOGLE_MAPS_API_KEY: chave do Maps SDK for Android, usada pelo mapa do
//     entregador (react-native-maps). Sem ela, o plugin nao e adicionado e o
//     mapa pode aparecer em branco em um APK proprio. No Expo Go nao e preciso.
module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];

  if (process.env.GOOGLE_MAPS_API_KEY) {
    plugins.push([
      "react-native-maps",
      { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY },
    ]);
  }

  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile:
        process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    },
    plugins,
  };
};
