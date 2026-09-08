import fs from "node:fs";
import path from "node:path";

function storePath() {
  const envPath = process.env.PAL_ACCOUNT_DOCS_PATH?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
  }
  return path.join(process.cwd(), "data", "pal_account_docs.json");
}

/**
 * @returns {Record<string, { docId: string, accountName?: string, lastExportedAt?: string }>}
 */
export function loadAccountDocs() {
  const file = storePath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} salesforceAccountId
 */
export function getDocForAccount(salesforceAccountId) {
  if (!salesforceAccountId) return null;
  const map = loadAccountDocs();
  return map[salesforceAccountId] || null;
}

/**
 * @param {string} salesforceAccountId
 * @param {string} docId
 * @param {{ accountName?: string }} [meta]
 */
export function saveDocForAccount(salesforceAccountId, docId, meta = {}) {
  if (!salesforceAccountId || !docId) return;
  const map = loadAccountDocs();
  map[salesforceAccountId] = {
    docId,
    accountName: meta.accountName || map[salesforceAccountId]?.accountName || "",
    lastExportedAt: new Date().toISOString(),
  };
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(map, null, 2), "utf8");
  fs.renameSync(tmpFile, file);
}
