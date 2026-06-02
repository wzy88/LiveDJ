import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");
const localEnvPath = path.join(rootDir, ".env.local");

reloadEnv();

export function reloadEnv({ override = false } = {}) {
  loadDotEnv(envPath, { override });
  loadDotEnv(localEnvPath, { override });
}

export function saveLocalEnv(updates = {}) {
  const existing = readEnvFile(localEnvPath);
  const next = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    const cleanKey = String(key || "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) continue;
    const cleanValue = String(value ?? "").trim();
    if (!cleanValue) {
      delete next[cleanKey];
    } else {
      next[cleanKey] = cleanValue;
    }
  }
  const body = Object.entries(next)
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
    .join("\n");
  fs.writeFileSync(localEnvPath, body ? `${body}\n` : "");
  reloadEnv({ override: true });
}

function loadDotEnv(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return;
  const values = readEnvFile(filePath);
  for (const [key, value] of Object.entries(values)) {
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    result[match[1]] = unwrapEnvValue(match[2].trim());
  }
  return result;
}

function unwrapEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteEnvValue(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) return text;
  return JSON.stringify(text);
}
