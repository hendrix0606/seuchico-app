import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const appJsonPath = resolve(process.cwd(), "app.json");
const raw = await readFile(appJsonPath, "utf8");
const config = JSON.parse(raw);

if (!config.expo) {
  throw new Error("app.json invalido: a chave expo nao foi encontrada.");
}

const plugins = Array.isArray(config.expo.plugins) ? config.expo.plugins : [];
const hasNotifications = plugins.some((plugin) =>
  Array.isArray(plugin)
    ? plugin[0] === "expo-notifications"
    : plugin === "expo-notifications",
);

if (!hasNotifications) plugins.push("expo-notifications");
config.expo.plugins = plugins;

await writeFile(appJsonPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log("OK: expo-notifications foi adicionado ao app.json.");
