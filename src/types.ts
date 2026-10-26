/**
 * Types for Fredo QA Skills MCP Server
 */

export type SkillTier = 'free' | 'pro' | 'enterprise';

export interface SkillMetadata {
  id: string;
  name: string;
  tier: SkillTier;
  category: 'core' | 'language' | 'quality' | 'compliance' | 'enterprise';
  description: string;
  rulesSummary: string[];
}

export interface LicenseValidationResult {
  valid: boolean;
  tier: SkillTier;
  keyType: 'none' | 'signed';
  customerName?: string;
  licenseId?: string;
  /** Last release date covered by the license (version retention), ISO-8601 UTC. */
  updatesUntil?: string;
  /** True when this build was released after `updatesUntil`. */
  isExpired: boolean;
  fallbackMode: boolean;
  message: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}
