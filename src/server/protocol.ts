/** The newest MCP revision this server implements. */
export const LATEST_PROTOCOL_VERSION = '2024-11-05';

/** Every MCP revision this server implements, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = Object.freeze([
  LATEST_PROTOCOL_VERSION,
]);

/**
 * Version negotiation of `initialize`: a supported version asked for by the client is
 * answered as is, anything else (unknown, future, malformed, not a string) with the
 * newest version this server supports.
 */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}
