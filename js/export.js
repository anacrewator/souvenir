// Saving the sorted albums: straight into a folder (Chrome/Edge) or as a ZIP (everywhere).
import { loadScript, sanitizeName, saveBlob } from './util.js';

const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

export const canSaveToFolder = () => typeof window.showDirectoryPicker === 'function';

async function blobOf(item) {
  if (item.file) return item.file;
  if (item.fetchBlob) return item.fetchBlob();
  throw new Error(`No data for ${item.name}`);
}

function uniqueName(used, name) {
  const dot = name.lastIndexOf('.');
  let n = name;
  for (let i = 1; used.has(n.toLowerCase()); i++) {
    n = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
  }
  used.add(n.toLowerCase());
  return n;
}

// folders: [{ path: ['Trips', '2026-06 Lisbon'], items: [...] }]
export async function saveToFolder(folders, onProgress) {
  const root = await window.showDirectoryPicker({ id: 'souvenir', mode: 'readwrite' });
  const total = folders.reduce((s, f) => s + f.items.length, 0);
  let done = 0, failed = 0;
  for (const f of folders) {
    let dir = root;
    for (const part of f.path) dir = await dir.getDirectoryHandle(sanitizeName(part), { create: true });
    const used = new Set();
    for (const it of f.items) {
      try {
        const blob = await blobOf(it);
        const fh = await dir.getFileHandle(uniqueName(used, it.name), { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
      } catch (e) {
        failed++;
        console.warn('Could not save', it.name, e);
      }
      onProgress?.(++done, total);
    }
  }
  return { folder: root.name, saved: done - failed, failed };
}

export async function downloadZip(folders, zipName, onProgress) {
  await loadScript(JSZIP);
  const zip = new window.JSZip();
  let failed = 0;
  for (const f of folders) {
    const z = f.path.reduce((acc, p) => acc.folder(sanitizeName(p)), zip);
    const used = new Set();
    for (const it of f.items) {
      try {
        z.file(uniqueName(used, it.name), await blobOf(it), { binary: true, date: it.date || undefined });
      } catch { failed++; }
    }
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true },
    (m) => onProgress?.(m.percent / 100));
  saveBlob(blob, sanitizeName(zipName) + '.zip');
  return { failed };
}
