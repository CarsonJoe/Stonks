export interface StorageSnapshot {
  supported: boolean;
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

export async function getStorageSnapshot(): Promise<StorageSnapshot> {
  if (!('storage' in navigator) || !navigator.storage) {
    return {
      supported: false
    };
  }

  const [estimate, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted?.() ?? Promise.resolve(undefined)
  ]);

  return {
    supported: true,
    usage: estimate.usage,
    quota: estimate.quota,
    persisted
  };
}

export async function requestStoragePersistence() {
  if (!navigator.storage?.persist) {
    return false;
  }

  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function formatBytes(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = -1;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}
