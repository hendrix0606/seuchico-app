import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const packagePath = resolve(projectRoot, "package.json");

if (!existsSync(packagePath)) {
  console.error("ERRO: execute este arquivo dentro da raiz do projeto SeuChico.");
  console.error("Pasta esperada: C:\\Projetos\\seuchico-app");
  process.exit(1);
}

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const packages = [
  "expo-document-picker",
  "expo-clipboard",
  "expo-file-system",
  "react-native-svg",
  "react-native-qrcode-svg",
];

console.log("Instalando os pacotes necessários para PIX, QR Code e upload...");
const result = spawnSync(npxCommand, ["expo", "install", ...packages], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  console.error("\nERRO: a instalação não foi concluída.");
  console.error(`Execute manualmente: ${npxCommand} expo install ${packages.join(" ")}`);
  process.exit(result.status ?? 1);
}

console.log("\nOK: dependências da Etapa 15 instaladas.");
console.log("Agora execute o arquivo supabase/015_pix_branding_secure.sql no Supabase.");
