// ---------------------------------------------------------------------------
// agent/transport/index.ts — Unified transport dispatch
// ---------------------------------------------------------------------------

export { buildSyncResponse, type SyncAgentResponse } from './sync';
export { buildStreamResponse } from './stream';
export { startBackgroundRun, type BackgroundRunResult } from './background';
