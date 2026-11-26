const state = globalThis as typeof globalThis & { fridayShutdown?: AbortController };
state.fridayShutdown ??= new AbortController();
const shutdown = state.fridayShutdown;
export function getShutdownSignal() {
  return shutdown.signal;
}
export function abortPendingOperations() {
  shutdown.abort();
}
