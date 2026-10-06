// Estende o app.json. O google-services.json esta no .gitignore (por seguranca),
// entao o build na nuvem (EAS) recebe esse arquivo por uma variavel de ambiente
// do tipo arquivo chamada GOOGLE_SERVICES_JSON. Localmente, usa o arquivo da
// raiz do projeto.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
