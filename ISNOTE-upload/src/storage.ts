import { validateDoc, type Doc } from "./model.ts";

const MAX_BYTES = 256 * 1024 * 1024;

async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** .isnote (formerly .openink) = gzip(JSON). The internal format id stays "OpenInk" so old files keep opening. */
export async function encodeDoc(doc: Doc): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream("gzip"));
}

/** Accepts gzip or plain JSON. */
export async function decodeDoc(bytes: Uint8Array): Promise<Doc> {
  if (bytes.length > MAX_BYTES) throw new Error("File too large");
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await pipe(bytes, new DecompressionStream("gzip")) : bytes;
  let json: unknown;
  try { json = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error("Not an ISNOTE notebook"); }
  return validateDoc(json);
}

// Autosave in IndexedDB so work survives reloads (and works offline on iPad).
const DB = "openink", STORE = "kv";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function saveLocal(doc: Doc): Promise<void> {
  try {
    const db = await idb();
    const data = await encodeDoc(doc);
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, "current");
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch { /* private mode etc.: autosave is best-effort */ }
}
export async function loadLocal(): Promise<Doc | null> {
  try {
    const db = await idb();
    const data = await new Promise<Uint8Array | undefined>((res, rej) => {
      const r = db.transaction(STORE).objectStore(STORE).get("current");
      r.onsuccess = () => res(r.result as Uint8Array | undefined);
      r.onerror = () => rej(r.error);
    });
    return data ? await decodeDoc(data) : null;
  } catch { return null; }
}

/** Save via share sheet (iPad) / download (everywhere else). */
export async function deliverFile(data: Blob, name: string): Promise<void> {
  const file = new File([data], name, { type: data.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPad|iPhone|Macintosh/.test(navigator.userAgent) && "ontouchend" in document) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(data);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = accept;
    i.style.display = "none";
    i.addEventListener("change", () => { resolve(i.files?.[0] ?? null); i.remove(); });
    i.addEventListener("cancel", () => { resolve(null); i.remove(); });
    document.body.appendChild(i);
    i.click();
  });
}
