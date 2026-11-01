import * as assert from 'node:assert';
import test from 'node:test';
import { FredoQaMcpServer } from '../dist/server/server.js';
import type { JsonRpcRequest } from '../dist/types.js';

test('MCP Protocol Negative: Unknown JSON-RPC method returns code -32601', () => {
  const server = new FredoQaMcpServer();
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 101,
    method: 'unsupported/method',
    params: {},
  };
  const res = server.handleRequest(req);
  assert.strictEqual(res.id, 101);
  assert.ok(res.error);
  assert.strictEqual(res.error.code, -32601);
  assert.match(res.error.message, /Method not found/i);
});

test('MCP Protocol Negative: Unknown tool name returns code -32601', () => {
  const server = new FredoQaMcpServer();
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 102,
    method: 'tools/call',
    params: {
      name: 'non_existent_tool_xyz',
      arguments: {},
    },
  };
  const res = server.handleRequest(req);
  assert.strictEqual(res.id, 102);
  assert.ok(res.error);
  assert.strictEqual(res.error.code, -32601);
  assert.match(res.error.message, /Tool not found/i);
});

test('MCP Protocol Negative: Missing required parameter returns code -32602', () => {
  const server = new FredoQaMcpServer();
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 103,
    method: 'tools/call',
    params: {
      name: 'get_skill_rules',
      arguments: {}, // Missing required 'skill_id'
    },
  };
  const res = server.handleRequest(req);
  assert.strictEqual(res.id, 103);
  assert.ok(res.error);
  assert.strictEqual(res.error.code, -32602);
  assert.match(res.error.message, /Missing required parameter: 'skill_id'/i);
});

test('MCP Protocol Negative: Undeclared property violates additionalProperties: false with code -32602', () => {
  const server = new FredoQaMcpServer();
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 104,
    method: 'tools/call',
    params: {
      name: 'list_skills',
      arguments: {
        category: 'core',
        injected_bad_param: 'malicious_payload', // Not declared in schema
      },
    },
  };
  const res = server.handleRequest(req);
  assert.strictEqual(res.id, 104);
  assert.ok(res.error);
  assert.strictEqual(res.error.code, -32602);
  assert.match(res.error.message, /does not allow additional properties/i);
});
