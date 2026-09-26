const CHUNK_ERROR_PATTERN = /failed to fetch dynamically imported module|importing a module script|dynamically imported module|chunkloaderror|loading chunk \S+ failed|error loading dynamically/i;

export function isChunkLoadError(error) {
  if (!error) return false;
  return CHUNK_ERROR_PATTERN.test(String(error.message || error));
}

export function claimChunkRecovery(storage, signature, fallback) {
  if (storage) {
    try {
      if (storage.getItem("onepos:chunk-recovery") === signature) return false;
      storage.setItem("onepos:chunk-recovery", signature);
      return true;
    } catch {
      // Storage can be disabled; use the per-tab fallback below.
    }
  }

  if (fallback.__oneposChunkRecovered) return false;
  fallback.__oneposChunkRecovered = true;
  return true;
}
