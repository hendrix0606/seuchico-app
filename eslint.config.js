const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  // supabase/functions roda em Deno (nao no app), entao fica fora do lint.
  globalIgnores(["dist/*", ".expo/*", "supabase/functions/*"]),
  expoConfig,
  {
    // Regras novas do React Compiler que apontam padroes ja usados nas telas
    // (buscar dados dentro de useEffect). Seguem visiveis como aviso ate o
    // codigo ser refatorado, sem impedir o lint de passar.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);
