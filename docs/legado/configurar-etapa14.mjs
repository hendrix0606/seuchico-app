import fs from "node:fs";
import path from "node:path";

const appJsonPath = path.resolve(process.cwd(), "app.json");

if (!fs.existsSync(appJsonPath)) {
  console.error("ERRO: app.json não encontrado. Execute este comando na raiz do projeto SeuChico.");
  process.exit(1);
}

const appConfig = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
appConfig.expo ??= {};

const currentScheme = appConfig.expo.scheme;
if (!currentScheme) {
  appConfig.expo.scheme = "seuchico";
} else if (typeof currentScheme === "string" && currentScheme !== "seuchico") {
  appConfig.expo.scheme = [currentScheme, "seuchico"];
} else if (Array.isArray(currentScheme) && !currentScheme.includes("seuchico")) {
  appConfig.expo.scheme = [...currentScheme, "seuchico"];
}

fs.writeFileSync(appJsonPath, `${JSON.stringify(appConfig, null, 2)}\n`, "utf8");
console.log("OK: esquema seguro seuchico:// adicionado ao app.json.");
