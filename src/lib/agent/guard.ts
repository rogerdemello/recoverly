/**
 * Static guard for LLM-generated Python (technical-spec 5.4). Defense in depth: the sandbox
 * (egress locked, hard timeout) is the real boundary.
 */

export const MAX_SCRIPT_LINES = 300;
export const MAX_SCRIPT_BYTES = 12 * 1024;

export const ALLOWED_IMPORTS = new Set([
  "json",
  "sys",
  "datetime",
  "math",
  "statistics",
  "collections",
  "itertools",
  "functools",
  "decimal",
  "typing",
  "re",
  "recoverly_lib",
]);

const DENIED_CALLS = ["eval", "exec", "compile", "open", "input", "globals", "locals", "getattr", "setattr"];
const DENIED_NAMES = ["__import__", "subprocess", "socket", "importlib", "ctypes", "builtins", "urllib", "http"];

export interface GuardResult {
  ok: boolean;
  violations: string[];
}

export function extractPythonBlock(reply: string): string | null {
  const fenced = /```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/i.exec(reply);
  return fenced ? fenced[1]!.trim() : null;
}

export function guardGeneratedCode(code: string): GuardResult {
  const violations: string[] = [];
  if (!code.trim()) return { ok: false, violations: ["empty_script"] };

  if (Buffer.byteLength(code, "utf8") > MAX_SCRIPT_BYTES) violations.push(`script_too_large(>${MAX_SCRIPT_BYTES}B)`);
  if (code.split(/\r?\n/).length > MAX_SCRIPT_LINES) violations.push(`script_too_long(>${MAX_SCRIPT_LINES} lines)`);

  let importsLib = false;
  for (const line of code.split(/\r?\n/)) {
    const importMatch = /^\s*import\s+(.+)$/.exec(line);
    const fromMatch = /^\s*from\s+([\w.]+)\s+import\b/.exec(line);
    const modules: string[] = [];
    if (importMatch) {
      for (const part of importMatch[1]!.split(",")) {
        const mod = part.trim().split(/\s+as\s+/)[0]?.trim() ?? "";
        if (mod) modules.push(mod);
      }
    } else if (fromMatch) {
      modules.push(fromMatch[1]!);
    }
    for (const mod of modules) {
      const root = mod.split(".")[0]!;
      if (!ALLOWED_IMPORTS.has(root)) violations.push(`import_not_allowed:${mod}`);
      if (root === "recoverly_lib") importsLib = true;
    }
  }

  for (const name of DENIED_CALLS) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(code)) violations.push(`denied_call:${name}(`);
  }
  for (const name of DENIED_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(code)) violations.push(`denied_name:${name}`);
  }
  if (/\bos\./.test(code)) violations.push("denied_name:os.");

  for (const match of code.matchAll(/\b__\w+__\b/g)) {
    if (match[0] !== "__name__" && match[0] !== "__main__") violations.push(`dunder_not_allowed:${match[0]}`);
  }

  if (!importsLib) violations.push("missing_recoverly_lib_import");
  if (!/\bprint\s*\(/.test(code) || !/json/.test(code)) violations.push("missing_json_print");

  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}
