import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MIME_EXTENSIONS = Object.freeze({
  "application/pdf": new Set([".pdf"]),
  "application/json": new Set([".json"]),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set([".docx"]),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": new Set([".xlsx"]),
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": new Set([".pptx"]),
  "text/csv": new Set([".csv"]),
  "text/plain": new Set([".txt", ".log"]),
  "image/gif": new Set([".gif"]),
  "image/jpeg": new Set([".jpeg", ".jpg"]),
  "image/png": new Set([".png"]),
  "image/webp": new Set([".webp"]),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const configuredMaxFileBytes = Number.parseInt(process.env.PLATFORM_FILE_MAX_BYTES || "", 10);
const MAX_FILE_BYTES = Number.isSafeInteger(configuredMaxFileBytes) && configuredMaxFileBytes > 0
  ? Math.min(configuredMaxFileBytes, 7 * 1024 * 1024)
  : 7 * 1024 * 1024;

export function isPlatformFileUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function storageDirectory() {
  const configured = process.env.PLATFORM_FILE_STORAGE_DIR;
  const directory = path.resolve(configured || path.join(os.homedir(), ".onepos-private", "platform-files"));
  const publicDirectory = path.resolve(process.cwd(), "public");
  const publicRelativePath = path.relative(publicDirectory, directory);
  if (!publicRelativePath || (publicRelativePath !== ".." && !publicRelativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(publicRelativePath))) {
    throw new Error("Platform file storage must be outside the public directory");
  }
  return directory;
}

function filePath(storageKey) {
  if (typeof storageKey !== "string" || !/^[0-9a-f-]{36}\.bin$/i.test(storageKey)) {
    throw new Error("Invalid platform file storage key");
  }
  return path.join(storageDirectory(), storageKey);
}

function normalizeUpload({ filename, mimeType, base64 }) {
  if (typeof filename !== "string" || filename.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(filename)) {
    throw Object.assign(new Error("A valid filename of at most 255 characters is required"), { status: 400 });
  }
  const cleanFilename = filename.trim();
  if (!cleanFilename || cleanFilename === "." || cleanFilename === "..") {
    throw Object.assign(new Error("A valid filename is required"), { status: 400 });
  }
  const normalizedMime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const allowedExtensions = MIME_EXTENSIONS[normalizedMime];
  if (!allowedExtensions || !allowedExtensions.has(path.extname(cleanFilename).toLowerCase())) {
    throw Object.assign(new Error("File type is not supported or does not match the filename"), { status: 415 });
  }
  if (typeof base64 !== "string" || !base64.length || base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw Object.assign(new Error("A valid base64 file body is required"), { status: 400 });
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString("base64") !== base64) {
    throw Object.assign(new Error("File size is invalid or exceeds the upload limit"), { status: 413 });
  }
  return { filename: cleanFilename, mimeType: normalizedMime, bytes };
}

export async function verifyPlatformObjectRecord({ db, companyId, object, recordId, storeId = null }) {
  if (!isPlatformFileUuid(recordId)) return false;
  if (!object || typeof object.source_table !== "string" || !/^[a-z_][a-z0-9_]*$/.test(object.source_table)) return false;
  const columns = await db(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema=current_schema() AND table_name=$1 AND column_name = ANY($2::text[])`,
    [object.source_table, ["id", "company_id", "store_id"]]
  );
  const available = new Set(columns.rows.map((row) => row.column_name));
  if (!available.has("id") || !available.has("company_id") || (object.store_scoped && !available.has("store_id"))) return false;
  const params = [recordId, companyId];
  let storeClause = "";
  if (object.store_scoped) {
    if (!storeId) return false;
    params.push(storeId);
    storeClause = ` AND store_id=$3`;
  }
  const result = await db(
    `SELECT id FROM "${object.source_table}" WHERE id=$1 AND company_id=$2${storeClause} LIMIT 1`,
    params
  );
  return result.rows.length > 0;
}

export async function writePlatformFile({ db, companyId, userId, object, recordId, upload, category = null, metadata = {} }) {
  const { filename, mimeType, bytes } = normalizeUpload(upload);
  if (category !== null && (typeof category !== "string" || category.length > 100)) {
    throw Object.assign(new Error("Category must be a string of at most 100 characters"), { status: 400 });
  }
  const serializedMetadata = JSON.stringify(metadata);
  if (serializedMetadata.length > 8192) {
    throw Object.assign(new Error("File metadata exceeds the 8 KB limit"), { status: 400 });
  }
  const storageKey = `${randomUUID()}.bin`;
  const directory = storageDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(filePath(storageKey), bytes, { flag: "wx", mode: 0o600 });
  try {
    const result = await db(
      `INSERT INTO platform_files
         (company_id,object_id,record_id,entity_type,filename,mime_type,size_bytes,storage_key,uploaded_by,category,visibility,metadata)
       VALUES ($1,$2,$3,'OBJECT',$4,$5,$6,$7,$8,$9,'PRIVATE',$10::jsonb)
       RETURNING id,object_id,record_id,entity_type,filename,mime_type,size_bytes,uploaded_by,category,visibility,metadata,created_at`,
      [companyId, object.id, recordId, filename, mimeType, bytes.length, storageKey, userId || null, category, serializedMetadata]
    );
    return result.rows[0];
  } catch (error) {
    try {
      await unlink(filePath(storageKey));
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") console.error("Platform file cleanup error:", cleanupError);
    }
    throw error;
  }
}

export async function readPlatformFile({ db, companyId, fileId }) {
  const result = await db(
    `SELECT id,object_id,record_id,entity_type,filename,mime_type,size_bytes,storage_key,uploaded_by,category,visibility,metadata,created_at
     FROM platform_files WHERE id=$1 AND company_id=$2 AND entity_type='OBJECT'`,
    [fileId, companyId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const bytes = await readFile(filePath(row.storage_key));
  const metadata = { ...row };
  delete metadata.storage_key;
  return { ...metadata, base64: bytes.toString("base64") };
}

export async function listPlatformFiles({ db, companyId, objectId, recordId }) {
  const result = await db(
    `SELECT id,object_id,record_id,entity_type,filename,mime_type,size_bytes,uploaded_by,category,visibility,metadata,created_at
     FROM platform_files
     WHERE company_id=$1 AND object_id=$2 AND record_id=$3 AND entity_type='OBJECT'
     ORDER BY created_at DESC`,
    [companyId, objectId, recordId]
  );
  return result.rows;
}

export async function deletePlatformFile({ db, companyId, fileId }) {
  const result = await db(
    `DELETE FROM platform_files WHERE id=$1 AND company_id=$2 AND entity_type='OBJECT'
     RETURNING id,storage_key`,
    [fileId, companyId]
  );
  const row = result.rows[0];
  if (!row) return false;
  await unlink(filePath(row.storage_key)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  return true;
}
