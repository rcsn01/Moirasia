export function authorizeIpcSender(actual: unknown, expected: unknown, capability: "main" | "shelf"): void {
  const destroyed = typeof expected === 'object' && expected !== null && 'isDestroyed' in expected && typeof expected.isDestroyed === 'function' && expected.isDestroyed()
  if (expected === undefined || actual !== expected || destroyed) throw new Error(`Unauthorized ${capability}-window IPC sender`);
}
