export type AuditSeverity = 'blocker' | 'warning' | 'info';

export interface AuditCheckResult {
  category: string;
  name: string;
  passed: boolean;
  severity: AuditSeverity;
  details: string;
}

export interface AuditOptions {
  confirm?: boolean;
}

export interface AuditReport {
  projectPath: string;
  timestamp: string;
  status: 'ready' | 'needs_attention';
  prerequisites: string;
  /** Share of presence checks that found their file or script, 0-100. */
  score: number;
  scope: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  results: AuditCheckResult[];
  recommendations: string[];
  previewOnly?: boolean;
  requiresConfirmation?: boolean;
  message?: string;
}

export interface StackDetection {
  isRust: boolean;
  isGo: boolean;
  isNode: boolean;
  isPython: boolean;
  isJava: boolean;
  isCpp: boolean;
  isPhp: boolean;
  isBash: boolean;
  hasMakefile: boolean;
  isWebProject: boolean;
  hasEnvFiles: boolean;
  hasManifest: boolean;
}

export interface AuditContext {
  projectPath: string;
  resolvedPath: string;
  parentPath: string;
  stack: StackDetection;
  fileExists: (rel: string) => boolean;
  parentFileExists: (rel: string) => boolean;
  findUp: (rel: string) => string | null;
  findFiles: (maxDepth: number, predicate: (relPath: string, fileName: string) => boolean) => string[];
  hasDir: (rel: string) => boolean;
  readFile: (rel: string) => string | null;
  readParentFile: (rel: string) => string | null;
  readDir: (rel: string) => string[];
}
