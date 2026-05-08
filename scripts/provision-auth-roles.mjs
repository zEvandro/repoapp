#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const VALID_ROLES = new Set(["repositor", "operador", "expedicao", "manobrista"]);

function parseArgs(argv) {
  const out = {
    input: "",
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",
    dbUrl: process.env.FIREBASE_DATABASE_URL || "",
    dryRun: false,
    resetPasswords: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") out.input = argv[++i] || "";
    else if (a === "--service-account") out.serviceAccount = argv[++i] || "";
    else if (a === "--db-url") out.dbUrl = argv[++i] || "";
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--reset-passwords") out.resetPasswords = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Argumento inválido: ${a}`);
  }
  return out;
}

function usage() {
  return `
Uso:
  node scripts/provision-auth-roles.mjs --input scripts/users.example.json --service-account ./service-account.json --db-url https://SEU-PROJETO-default-rtdb.firebaseio.com

Flags:
  --input <arquivo>             JSON com usuários
  --service-account <arquivo>   Credencial Admin SDK (JSON)
  --db-url <url>                URL do Realtime Database
  --dry-run                     Valida e mostra plano sem gravar
  --reset-passwords             Atualiza senha dos usuários já existentes

Formato do JSON de entrada:
[
  {
    "email": "op1@empresa.com",
    "password": "SenhaForte123!",
    "role": "operador",
    "name": "Operador 1"
  }
]
`.trim();
}

function normalizeEntry(raw, idx) {
  const email = String(raw?.email || "").trim().toLowerCase();
  const password = String(raw?.password || "");
  const role = String(raw?.role || "").trim();
  const name = String(raw?.name || "").trim();

  if (!email || !email.includes("@")) throw new Error(`Entrada ${idx}: email inválido`);
  if (!VALID_ROLES.has(role)) throw new Error(`Entrada ${idx}: role inválido (${role})`);
  if (!name) throw new Error(`Entrada ${idx}: name obrigatório`);
  if (password.length < 8) throw new Error(`Entrada ${idx}: password deve ter ao menos 8 caracteres`);

  return { email, password, role, name };
}

async function readJson(filePath) {
  const abs = path.resolve(filePath);
  const raw = await fs.readFile(abs, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.input) throw new Error("Informe --input");
  if (!args.dryRun && !args.serviceAccount) throw new Error("Informe --service-account ou FIREBASE_SERVICE_ACCOUNT_PATH");
  if (!args.dryRun && !args.dbUrl) throw new Error("Informe --db-url ou FIREBASE_DATABASE_URL");

  const input = await readJson(args.input);
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Arquivo de input deve ser um array com ao menos 1 usuário");
  }
  const entries = input.map((x, i) => normalizeEntry(x, i + 1));
  const serviceAccount = args.dryRun ? null : await readJson(args.serviceAccount);

  let admin = null;
  if (!args.dryRun) {
    const mod = await import("firebase-admin");
    admin = mod.default;
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: args.dbUrl,
    });
  }

  const report = [];
  for (const e of entries) {
    if (args.dryRun) {
      report.push({ email: e.email, role: e.role, action: "VALIDATED_ONLY" });
      continue;
    }

    let userRecord;
    let created = false;
    try {
      userRecord = await admin.auth().getUserByEmail(e.email);
    } catch (err) {
      if (err?.code !== "auth/user-not-found") throw err;
      userRecord = await admin.auth().createUser({
        email: e.email,
        password: e.password,
        displayName: e.name,
        disabled: false,
      });
      created = true;
    }

    const updatePayload = { displayName: e.name };
    if (!created && args.resetPasswords) updatePayload.password = e.password;
    if (!created) await admin.auth().updateUser(userRecord.uid, updatePayload);

    const currentClaims = userRecord.customClaims || {};
    await admin.auth().setCustomUserClaims(userRecord.uid, { ...currentClaims, role: e.role });

    await admin
      .database()
      .ref(`roles/${userRecord.uid}`)
      .set({
        role: e.role,
        name: e.name,
        email: e.email,
        updatedAt: Date.now(),
      });

    report.push({
      email: e.email,
      uid: userRecord.uid,
      role: e.role,
      action: created ? "CREATED" : "UPDATED",
    });
  }

  console.log(JSON.stringify({ dryRun: args.dryRun, count: report.length, report }, null, 2));
}

main().catch((err) => {
  console.error("[provision-auth-roles] erro:", err.message);
  process.exit(1);
});
