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
  keyType: 'none' | 'test' | 'live';
  customerName?: string;
  expiresAt?: string;
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
  };
}
