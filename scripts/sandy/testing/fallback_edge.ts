// Test declarations mirror the Edge runtime global without starting a worker.
declare global {
  const EdgeRuntime: { waitUntil: (work: Promise<unknown>) => void };
}
export {};
