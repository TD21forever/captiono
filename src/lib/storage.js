import {
  annotationToThread,
  threadToAnnotation,
} from "./annotations.js";

const DATABASE_NAME = "caption-review";
const STORE_NAME = "state";
const DATABASE_VERSION = 1;
const PRODUCT_STATE_KEY = "caption-review:product-state:v2";
const LEGACY_PRODUCT_STATE_KEY = "caption-review:product-state:v1";
const LEGACY_ANNOTATION_KEY = "caption-review:annotations:v1";
const EXTENSION_RECORD_PREFIX = "caption-review:state:v3:";
const MIGRATION_EPOCH = "1970-01-01T00:00:00.000Z";
const memoryRecords = new Map();
let stateWriteQueue = Promise.resolve();
let phraseFeedbackWriteQueue = Promise.resolve();

export const PRODUCT_STATE_SCHEMA_VERSION = 2;
export const CAPTION_DOCUMENT_SCHEMA_VERSION = 1;
export const DEFAULT_SETTINGS = Object.freeze({
  density: "standard",
  language: "en",
  theme: "system",
  showPhrases: true,
  autoAnalyzePhrases: true,
  includeAllCandidatesOnExport: false,
  transcriptionLanguage: "en-US",
});

function cloneJson(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function extensionStorageArea() {
  try {
    const area = globalThis.chrome?.storage?.local;
    return area?.get && area?.set && area?.remove ? area : null;
  } catch {
    return null;
  }
}

async function readExtensionRecord(key) {
  const area = extensionStorageArea();
  if (!area) return { available: false, value: null };
  try {
    const result = await area.get(key);
    return { available: true, value: result?.[key] ?? null };
  } catch {
    return { available: true, value: null };
  }
}

function extensionRecordKey(kind, documentId = "") {
  return `${EXTENSION_RECORD_PREFIX}${kind}${
    documentId ? `:${encodeURIComponent(documentId)}` : ""
  }`;
}

async function readExtensionValue(key) {
  const record = await readExtensionRecord(key);
  return record.available ? cloneJson(record.value) : null;
}

async function writeExtensionValue(key, value) {
  const area = extensionStorageArea();
  if (!area) return false;
  await area.set({ [key]: cloneJson(value) });
  return true;
}

async function removeExtensionValues(keys) {
  const area = extensionStorageArea();
  if (!area) return false;
  await area.remove(keys);
  return true;
}

async function readAllExtensionValues() {
  const area = extensionStorageArea();
  if (!area) return null;
  try {
    return await area.get(null);
  } catch {
    return {};
  }
}

function legacyAnnotationKey(documentId) {
  return documentId
    ? `${LEGACY_ANNOTATION_KEY}:${documentId}`
    : LEGACY_ANNOTATION_KEY;
}

function readLocalStorage(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeLocalStorage(key) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readIndexedDb(key) {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
}

async function writeIndexedDb(key, value) {
  const database = await openDatabase();
  if (!database) return false;
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => {
      database.close();
      resolve(true);
    };
    transaction.onerror = () => {
      database.close();
      resolve(false);
    };
    transaction.onabort = () => {
      database.close();
      resolve(false);
    };
  });
}

async function deleteIndexedDb(key) {
  const database = await openDatabase();
  if (!database) return false;
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => {
      database.close();
      resolve(true);
    };
    transaction.onerror = () => {
      database.close();
      resolve(false);
    };
    transaction.onabort = () => {
      database.close();
      resolve(false);
    };
  });
}

async function readRecord(key) {
  const extensionRecord = await readExtensionRecord(key);
  if (extensionRecord.available) {
    if (extensionRecord.value !== null) {
      memoryRecords.set(key, cloneJson(extensionRecord.value));
    }
    return cloneJson(extensionRecord.value);
  }

  const fromIndexedDb = await readIndexedDb(key);
  if (fromIndexedDb !== null) {
    memoryRecords.set(key, cloneJson(fromIndexedDb));
    return cloneJson(fromIndexedDb);
  }
  const fromLocalStorage = readLocalStorage(key);
  if (fromLocalStorage !== null) {
    memoryRecords.set(key, cloneJson(fromLocalStorage));
    return cloneJson(fromLocalStorage);
  }
  return cloneJson(memoryRecords.get(key) ?? null);
}

async function writeRecord(key, value) {
  const snapshot = cloneJson(value);
  memoryRecords.set(key, snapshot);
  const extensionArea = extensionStorageArea();
  if (extensionArea) {
    await extensionArea.set({ [key]: snapshot });
    return cloneJson(snapshot);
  }
  writeLocalStorage(key, snapshot);
  await writeIndexedDb(key, snapshot);
  return cloneJson(snapshot);
}

async function deleteRecord(key) {
  memoryRecords.delete(key);
  const extensionArea = extensionStorageArea();
  if (extensionArea) {
    await extensionArea.remove(key);
    return;
  }
  removeLocalStorage(key);
  await deleteIndexedDb(key);
}

export function createEmptyProductState() {
  return {
    schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
    documents: {},
    annotationThreadsByDocument: {},
    savedPhrasesByDocument: {},
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: null,
  };
}

function documentsToRecord(documents) {
  if (Array.isArray(documents)) {
    return Object.fromEntries(
      documents
        .filter((document) => document?.id)
        .map((document) => [
          document.id,
          {
            ...cloneJson(document),
            schemaVersion: CAPTION_DOCUMENT_SCHEMA_VERSION,
          },
        ]),
    );
  }
  if (!isRecord(documents)) return {};
  return Object.fromEntries(
    Object.entries(documents).map(([documentId, document]) => [
      documentId,
      {
        ...cloneJson(document),
        id: document?.id || documentId,
        schemaVersion: CAPTION_DOCUMENT_SCHEMA_VERSION,
      },
    ]),
  );
}

function normalizeSavedPhrase(item, documentId) {
  const phrase = item?.kind === "phrase" && item.learning
    ? item.learning
    : item;
  const id =
    item?.phraseId ||
    phrase?.id ||
    `saved-${documentId || "document"}-${phrase?.sentenceId || "sentence"}-${phrase?.start ?? 0}`;
  return {
    ...cloneJson(phrase || {}),
    id,
    documentId: item?.documentId ?? phrase?.documentId ?? documentId ?? null,
    savedAt: item?.savedAt ?? item?.createdAt ?? phrase?.savedAt ?? null,
    ...(item?.id && item?.kind === "phrase" ? { annotationId: item.id } : {}),
    ...(item?.body ? { note: item.body } : {}),
  };
}

function migrateSavedPhraseRecord(record = {}) {
  const result = {};
  for (const [documentId, items] of Object.entries(record)) {
    result[documentId] = (Array.isArray(items) ? items : []).map((item) =>
      normalizeSavedPhrase(item, documentId),
    );
  }
  return result;
}

/**
 * Pure migration function for imported backups and older browser state.
 */
export function migrateProductState(rawState) {
  if (!rawState) return createEmptyProductState();

  if (Array.isArray(rawState)) {
    return {
      ...createEmptyProductState(),
      annotationThreadsByDocument: {
        default: rawState
          .filter((item) => item?.kind !== "phrase")
          .map((item) =>
            annotationToThread(item, {
              documentId: "default",
              now: item?.createdAt || MIGRATION_EPOCH,
            }),
          ),
      },
      savedPhrasesByDocument: {
        default: rawState
          .filter((item) => item?.kind === "phrase")
          .map((item) => normalizeSavedPhrase(item, "default")),
      },
    };
  }

  const state = rawState.state && isRecord(rawState.state)
    ? rawState.state
    : rawState;
  const annotationsByDocument =
    state.annotationThreadsByDocument ||
    state.threadsByDocument ||
    state.annotationsByDocument ||
    (Array.isArray(state.annotations) ? { default: state.annotations } : null) ||
    {};
  const savedPhrasesByDocument =
    state.savedPhrasesByDocument ||
    state.phrasesByDocument ||
    {};
  const migratedThreads = {};
  const migratedPhrases = migrateSavedPhraseRecord(savedPhrasesByDocument);

  for (const [documentId, items] of Object.entries(annotationsByDocument)) {
    const values = Array.isArray(items) ? items : [];
    migratedThreads[documentId] = values
      .filter((item) => item?.kind !== "phrase")
      .map((item) =>
        item?.anchor && Array.isArray(item?.comments)
          ? {
              ...cloneJson(item),
              documentId: item.documentId ?? documentId,
            }
          : annotationToThread(item, {
              documentId,
              now: item?.createdAt || state.updatedAt || MIGRATION_EPOCH,
            }),
      );
    const phraseItems = values.filter((item) => item?.kind === "phrase");
    if (phraseItems.length > 0) {
      migratedPhrases[documentId] = [
        ...(migratedPhrases[documentId] || []),
        ...phraseItems.map((item) => normalizeSavedPhrase(item, documentId)),
      ];
    }
  }

  return {
    schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
    documents: documentsToRecord(state.documents),
    annotationThreadsByDocument: migratedThreads,
    savedPhrasesByDocument: migratedPhrases,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(isRecord(state.settings) ? cloneJson(state.settings) : {}),
    },
    updatedAt: state.updatedAt || null,
  };
}

export async function loadProductState() {
  const extensionRecords = await readAllExtensionValues();
  if (extensionRecords) {
    const state = createEmptyProductState();
    for (const [key, value] of Object.entries(extensionRecords)) {
      if (!key.startsWith(EXTENSION_RECORD_PREFIX)) continue;
      if (key === extensionRecordKey("settings")) {
        state.settings = { ...DEFAULT_SETTINGS, ...cloneJson(value) };
      } else if (key.startsWith(extensionRecordKey("document") + ":")) {
        if (value?.id) state.documents[value.id] = cloneJson(value);
      } else if (key.startsWith(extensionRecordKey("threads") + ":")) {
        if (value?.documentId) {
          state.annotationThreadsByDocument[value.documentId] = cloneJson(
            value.items ?? [],
          );
        }
      } else if (key.startsWith(extensionRecordKey("phrases") + ":")) {
        if (value?.documentId) {
          state.savedPhrasesByDocument[value.documentId] = cloneJson(
            value.items ?? [],
          );
        }
      }
    }
    return state;
  }

  const current = await readRecord(PRODUCT_STATE_KEY);
  if (current) {
    const migrated = migrateProductState(current);
    if (current.schemaVersion !== PRODUCT_STATE_SCHEMA_VERSION) {
      await writeRecord(PRODUCT_STATE_KEY, migrated);
    }
    return cloneJson(migrated);
  }

  const legacy = await readRecord(LEGACY_PRODUCT_STATE_KEY);
  if (legacy) {
    const migrated = migrateProductState(legacy);
    await writeRecord(PRODUCT_STATE_KEY, migrated);
    return cloneJson(migrated);
  }
  return createEmptyProductState();
}

export async function saveProductState(state, { now } = {}) {
  const migrated = migrateProductState(state);
  const snapshot = {
    ...migrated,
    schemaVersion: PRODUCT_STATE_SCHEMA_VERSION,
    updatedAt: now || new Date().toISOString(),
  };
  const extensionArea = extensionStorageArea();
  if (extensionArea) {
    const current = await extensionArea.get(null);
    const staleKeys = Object.keys(current).filter((key) =>
      key.startsWith(EXTENSION_RECORD_PREFIX),
    );
    if (staleKeys.length) await extensionArea.remove(staleKeys);
    const records = {
      [extensionRecordKey("settings")]: snapshot.settings,
    };
    for (const document of Object.values(snapshot.documents)) {
      records[extensionRecordKey("document", document.id)] = document;
    }
    for (const [documentId, items] of Object.entries(
      snapshot.annotationThreadsByDocument,
    )) {
      records[extensionRecordKey("threads", documentId)] = {
        documentId,
        items,
      };
    }
    for (const [documentId, items] of Object.entries(
      snapshot.savedPhrasesByDocument,
    )) {
      records[extensionRecordKey("phrases", documentId)] = {
        documentId,
        items,
      };
    }
    await extensionArea.set(records);
    return cloneJson(snapshot);
  }
  return writeRecord(PRODUCT_STATE_KEY, snapshot);
}

async function updateProductState(mutator) {
  const operation = stateWriteQueue.then(async () => {
    const current = await loadProductState();
    const next = (await mutator(cloneJson(current))) || current;
    return saveProductState(next);
  });
  stateWriteQueue = operation.catch(() => undefined);
  return operation;
}

export async function clearProductState() {
  await stateWriteQueue.catch(() => undefined);
  const extensionRecords = await readAllExtensionValues();
  if (extensionRecords) {
    const keys = Object.keys(extensionRecords).filter(
      (key) =>
        key.startsWith(EXTENSION_RECORD_PREFIX) ||
        key === PRODUCT_STATE_KEY ||
        key === LEGACY_PRODUCT_STATE_KEY ||
        key.startsWith(LEGACY_ANNOTATION_KEY),
    );
    if (keys.length) await removeExtensionValues(keys);
    return;
  }
  await deleteRecord(PRODUCT_STATE_KEY);
  await deleteRecord(LEGACY_PRODUCT_STATE_KEY);
}

export async function saveCaptionDocument(document, { now } = {}) {
  if (!document?.id) throw new TypeError("Caption document requires an id");
  const stamp = now || new Date().toISOString();
  const normalized = {
    ...cloneJson(document),
    schemaVersion: CAPTION_DOCUMENT_SCHEMA_VERSION,
    createdAt: document.createdAt || stamp,
    updatedAt: stamp,
  };
  if (
    await writeExtensionValue(
      extensionRecordKey("document", normalized.id),
      normalized,
    )
  ) {
    return cloneJson(normalized);
  }
  await updateProductState((state) => {
    state.documents[normalized.id] = normalized;
    return state;
  });
  return cloneJson(normalized);
}

export async function loadCaptionDocument(documentId) {
  if (extensionStorageArea()) {
    return cloneJson(
      await readExtensionValue(extensionRecordKey("document", documentId)),
    );
  }
  const state = await loadProductState();
  return cloneJson(state.documents[documentId] ?? null);
}

export async function listCaptionDocuments() {
  const extensionRecords = await readAllExtensionValues();
  if (extensionRecords) {
    return Object.entries(extensionRecords)
      .filter(([key, value]) =>
        key.startsWith(extensionRecordKey("document") + ":") && value?.id,
      )
      .map(([, value]) => cloneJson(value))
      .sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
      );
  }
  const state = await loadProductState();
  return Object.values(state.documents)
    .map(cloneJson)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function deleteCaptionDocument(documentId, { cascade = true } = {}) {
  if (extensionStorageArea()) {
    const keys = [extensionRecordKey("document", documentId)];
    if (cascade) {
      keys.push(
        extensionRecordKey("threads", documentId),
        extensionRecordKey("phrases", documentId),
      );
    }
    await removeExtensionValues(keys);
    return;
  }
  await updateProductState((state) => {
    delete state.documents[documentId];
    if (cascade) {
      delete state.annotationThreadsByDocument[documentId];
      delete state.savedPhrasesByDocument[documentId];
    }
    return state;
  });
}

async function readLegacyAnnotations(documentId) {
  const value = await readRecord(legacyAnnotationKey(documentId));
  return Array.isArray(value) ? value : null;
}

export async function loadAnnotationThreads(documentId = "default") {
  if (extensionStorageArea()) {
    const record = await readExtensionValue(
      extensionRecordKey("threads", documentId),
    );
    return cloneJson(record?.items ?? []);
  }
  const state = await loadProductState();
  if (own(state.annotationThreadsByDocument, documentId)) {
    return cloneJson(state.annotationThreadsByDocument[documentId]);
  }

  const legacy = await readLegacyAnnotations(documentId);
  if (!legacy) return [];
  const threads = legacy
    .filter((item) => item?.kind !== "phrase")
    .map((item) =>
      annotationToThread(item, {
        documentId,
        now: item?.createdAt || MIGRATION_EPOCH,
      }),
    );
  const phrases = legacy
    .filter((item) => item?.kind === "phrase")
    .map((item) => normalizeSavedPhrase(item, documentId));
  await updateProductState((next) => {
    next.annotationThreadsByDocument[documentId] = threads;
    next.savedPhrasesByDocument[documentId] = phrases;
    return next;
  });
  return cloneJson(threads);
}

export async function saveAnnotationThreads(threads, documentId = "default") {
  const normalized = (Array.isArray(threads) ? threads : []).map((thread) =>
    thread?.anchor && Array.isArray(thread?.comments)
      ? { ...cloneJson(thread), documentId }
      : annotationToThread(thread, { documentId, now: thread?.createdAt }),
  );
  if (
    await writeExtensionValue(extensionRecordKey("threads", documentId), {
      documentId,
      items: normalized,
    })
  ) {
    return cloneJson(normalized);
  }
  await updateProductState((state) => {
    state.annotationThreadsByDocument[documentId] = normalized;
    return state;
  });
  return cloneJson(normalized);
}

export async function loadSavedPhrases(documentId = "default") {
  if (extensionStorageArea()) {
    const record = await readExtensionValue(
      extensionRecordKey("phrases", documentId),
    );
    return cloneJson(record?.items ?? []);
  }
  let state = await loadProductState();
  if (
    !own(state.savedPhrasesByDocument, documentId) &&
    !own(state.annotationThreadsByDocument, documentId)
  ) {
    await loadAnnotationThreads(documentId);
    state = await loadProductState();
  }
  return cloneJson(state.savedPhrasesByDocument[documentId] ?? []);
}

export async function saveSavedPhrases(phrases, documentId = "default") {
  const normalized = (Array.isArray(phrases) ? phrases : []).map((phrase) =>
    normalizeSavedPhrase(phrase, documentId),
  );
  if (
    await writeExtensionValue(extensionRecordKey("phrases", documentId), {
      documentId,
      items: normalized,
    })
  ) {
    return cloneJson(normalized);
  }
  await updateProductState((state) => {
    state.savedPhrasesByDocument[documentId] = normalized;
    return state;
  });
  return cloneJson(normalized);
}

function phraseAnalysisSignature(document) {
  const input = (document?.sentences ?? [])
    .map((sentence) => `${sentence?.id ?? ""}:${sentence?.text ?? ""}`)
    .join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function phraseAnalysisStorageKey(documentId, analyzerVersion) {
  return extensionRecordKey(
    "phrase-analysis",
    `${documentId || "default"}:${analyzerVersion || "unknown"}`,
  );
}

export async function loadPhraseAnalysisCache(document, analyzerVersion) {
  if (!document?.id || !analyzerVersion) return null;
  const key = phraseAnalysisStorageKey(document.id, analyzerVersion);
  const record = extensionStorageArea()
    ? await readExtensionValue(key)
    : await readRecord(key);
  if (
    !record ||
    record.documentId !== document.id ||
    record.analyzerVersion !== analyzerVersion ||
    record.transcriptSignature !== phraseAnalysisSignature(document) ||
    !Array.isArray(record.candidates)
  ) {
    return null;
  }
  return cloneJson(record);
}

export async function savePhraseAnalysisCache(
  document,
  analyzerVersion,
  candidates,
) {
  if (!document?.id || !analyzerVersion || !Array.isArray(candidates)) return null;
  const record = {
    documentId: document.id,
    analyzerVersion,
    transcriptSignature: phraseAnalysisSignature(document),
    candidates: cloneJson(candidates),
    analyzedAt: new Date().toISOString(),
  };
  const key = phraseAnalysisStorageKey(document.id, analyzerVersion);
  if (!(await writeExtensionValue(key, record))) await writeRecord(key, record);
  return cloneJson(record);
}

const PHRASE_FEEDBACK_KEY = extensionRecordKey("phrase-feedback");

export async function loadPhraseFeedback() {
  const record = extensionStorageArea()
    ? await readExtensionValue(PHRASE_FEEDBACK_KEY)
    : await readRecord(PHRASE_FEEDBACK_KEY);
  return isRecord(record?.entries) ? cloneJson(record.entries) : {};
}

export async function recordPhraseFeedback(phrase, action) {
  const phraseId = String(phrase?.lexiconId || phrase?.ruleId || phrase?.canonical || "").trim();
  if (!phraseId || !["saved", "unsaved", "ignored", "corrected"].includes(action)) {
    return null;
  }
  const operation = phraseFeedbackWriteQueue.then(async () => {
    const entries = await loadPhraseFeedback();
    const current = isRecord(entries[phraseId]) ? entries[phraseId] : {};
    const deltas = {
      saved: 4,
      unsaved: -4,
      ignored: -10,
      corrected: 2,
    };
    entries[phraseId] = {
      score: Math.max(-30, Math.min(30, Number(current.score ?? 0) + deltas[action])),
      savedCount: Number(current.savedCount ?? 0) + (action === "saved" ? 1 : 0),
      ignoredCount: Number(current.ignoredCount ?? 0) + (action === "ignored" ? 1 : 0),
      correctedCount: Number(current.correctedCount ?? 0) + (action === "corrected" ? 1 : 0),
      lastAction: action,
      updatedAt: new Date().toISOString(),
    };
    const record = { entries, updatedAt: new Date().toISOString() };
    if (!(await writeExtensionValue(PHRASE_FEEDBACK_KEY, record))) {
      await writeRecord(PHRASE_FEEDBACK_KEY, record);
    }
    return cloneJson(entries[phraseId]);
  });
  phraseFeedbackWriteQueue = operation.catch(() => undefined);
  return operation;
}

export async function loadSettings() {
  if (extensionStorageArea()) {
    const settings = await readExtensionValue(extensionRecordKey("settings"));
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }
  const state = await loadProductState();
  return { ...DEFAULT_SETTINGS, ...cloneJson(state.settings) };
}

export async function saveSettings(settings) {
  if (extensionStorageArea()) {
    const current = await loadSettings();
    const saved = {
      ...DEFAULT_SETTINGS,
      ...current,
      ...(isRecord(settings) ? cloneJson(settings) : {}),
    };
    await writeExtensionValue(extensionRecordKey("settings"), saved);
    return cloneJson(saved);
  }
  let saved;
  await updateProductState((state) => {
    saved = {
      ...DEFAULT_SETTINGS,
      ...state.settings,
      ...(isRecord(settings) ? cloneJson(settings) : {}),
    };
    state.settings = saved;
    return state;
  });
  return cloneJson(saved);
}

function savedPhraseToAnnotation(phrase) {
  return {
    id: phrase.annotationId || `phrase_${phrase.id}`,
    kind: "phrase",
    status: "accepted",
    phraseId: phrase.id,
    sentenceId: phrase.sentenceId ?? null,
    exact: phrase.exact ?? phrase.phrase ?? "",
    body: phrase.note ?? phrase.glossZh ?? phrase.translationZh ?? "",
    startMs: phrase.startMs ?? null,
    endMs: phrase.endMs ?? null,
    learning: cloneJson(phrase),
    createdAt: phrase.savedAt ?? undefined,
  };
}

/**
 * Compatibility facade for the original UI. New code should prefer explicit
 * annotation-thread and saved-phrase functions.
 */
export async function loadAnnotations(documentId = "default") {
  const threads = await loadAnnotationThreads(documentId);
  const phrases = await loadSavedPhrases(documentId);
  return [
    ...threads.map(threadToAnnotation),
    ...phrases.map(savedPhraseToAnnotation),
  ];
}

export async function saveAnnotations(items, documentId = "default") {
  const values = Array.isArray(items) ? items : [];
  const threads = values
    .filter((item) => item?.kind !== "phrase")
    .map((item) => annotationToThread(item, { documentId, now: item?.createdAt }));
  const phrases = values
    .filter((item) => item?.kind === "phrase")
    .map((item) => normalizeSavedPhrase(item, documentId));

  if (extensionStorageArea()) {
    await Promise.all([
      saveAnnotationThreads(threads, documentId),
      saveSavedPhrases(phrases, documentId),
    ]);
    return [
      ...threads.map(threadToAnnotation),
      ...phrases.map(savedPhraseToAnnotation),
    ];
  }

  await updateProductState((state) => {
    state.annotationThreadsByDocument[documentId] = threads;
    state.savedPhrasesByDocument[documentId] = phrases;
    return state;
  });
  return [
    ...threads.map(threadToAnnotation),
    ...phrases.map(savedPhraseToAnnotation),
  ];
}

export async function clearAnnotations(documentId = "default") {
  if (extensionStorageArea()) {
    await Promise.all([
      saveAnnotationThreads([], documentId),
      saveSavedPhrases([], documentId),
    ]);
    return;
  }
  await updateProductState((state) => {
    state.annotationThreadsByDocument[documentId] = [];
    state.savedPhrasesByDocument[documentId] = [];
    return state;
  });
  await deleteRecord(legacyAnnotationKey(documentId));
}
