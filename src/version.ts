export const CLOUD_VERSION='0.6.7';
export const MCP_PROTOCOLS=['2026-07-28','2025-11-25','2025-06-18','2025-03-26'];
export function negotiatedProtocol(params:Record<string,unknown>) {
  return MCP_PROTOCOLS.includes(String(params.protocolVersion))?String(params.protocolVersion):'2025-03-26';
}
