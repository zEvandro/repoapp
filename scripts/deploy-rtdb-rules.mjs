#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import admin from "firebase-admin";

function parseArgs(argv) {
  const out = {
    rules: "",
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",
    dbUrl: process.env.FIREBASE_DATABASE_URL || "",
    backupOut: "backup.rules.json",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rules") out.rules = argv[++i] || "";
    else if (a === "--service-account") out.serviceAccount = argv[++i] || "";
    else if (a === "--db-url") out.dbUrl = argv[++i] || "";
    else if (a === "--backup-out") out.backupOut = argv[++i] || "";
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Argumento inválido: ${a}`);
  }
  return out;
}

function usage() {
  return `
Uso:
  node scripts/deploy-rtdb-rules.mjs --rules firebase.database.rules.phase1.json --service-account ./service-account.json --db-url https://SEU-PROJETO-default-rtdb.firebaseio.com

Flags:
  --rules <arquivo>             JSON das rules a aplicar
  --service-account <arquivo>   Credencial Admin SDK
  --db-url <url>                URL do Realtime Database
  --backup-out <arquivo>        Arquivo de backup das rules atuais
`.trim();
}

async function readJson(filePath) {
  const abs = path.resolve(filePath);
  const txt = await fs.readFile(abs, "utf8");
  return JSON.parse(txt.replace(/^\uFEFF/, ""));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.rules) throw new Error("Informe --rules");
  if (!args.serviceAccount) throw new Error("Informe --service-account ou FIREBASE_SERVICE_ACCOUNT_PATH");
  if (!args.dbUrl) throw new Error("Informe --db-url ou FIREBASE_DATABASE_URL");

  const rules = await readJson(args.rules);
  if (!rules || typeof rules !== "object" || !rules.rules) throw new Error("Arquivo de rules inválido");
  const serviceAccount = await readJson(args.serviceAccount);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: args.dbUrl,
  });

  const db = admin.database();
  const current = await db.getRulesJSON();
  await fs.writeFile(path.resolve(args.backupOut), JSON.stringify(current, null, 2), "utf8");
  await db.setRules(rules);

  console.log(
    JSON.stringify(
      {
        ok: true,
        appliedFrom: args.rules,
        backupOut: args.backupOut,
        dbUrl: args.dbUrl,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[deploy-rtdb-rules] erro:", err.message);
  process.exit(1);
});
