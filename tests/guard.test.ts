import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractPythonBlock, guardGeneratedCode } from "../src/lib/agent/guard";

const replay = readFileSync(path.join(process.cwd(), "sandbox", "replay", "rank_recoverable.py"), "utf8");

const wrap = (line: string) => `import json\nimport recoverly_lib as lib\n${line}\nprint(json.dumps({}))\n`;

describe("static guard", () => {
  it("accepts the saved replay script", () => {
    expect(guardGeneratedCode(replay)).toEqual({ ok: true, violations: [] });
  });

  it.each([
    ["import os", "import_not_allowed:os"],
    ["import subprocess", "denied_name:subprocess"],
    ["import socket", "denied_name:socket"],
    ["import urllib.request", "import_not_allowed:urllib.request"],
    ["from http import client", "import_not_allowed:http"],
    ["import requests", "import_not_allowed:requests"],
    ["import importlib", "denied_name:importlib"],
    ["import ctypes", "denied_name:ctypes"],
    ["import pathlib", "import_not_allowed:pathlib"],
  ])("rejects %s", (line, violation) => {
    const res = guardGeneratedCode(wrap(line));
    expect(res.ok).toBe(false);
    expect(res.violations).toContain(violation);
  });

  it.each([
    ["x = eval('1')", "denied_call:eval("],
    ["exec('x=1')", "denied_call:exec("],
    ["c = compile('1', 'f', 'eval')", "denied_call:compile("],
    ["f = open('/etc/passwd')", "denied_call:open("],
    ["x = input()", "denied_call:input("],
    ["g = globals()", "denied_call:globals("],
    ["l = locals()", "denied_call:locals("],
    ["a = getattr(lib, 'x')", "denied_call:getattr("],
    ["setattr(lib, 'x', 1)", "denied_call:setattr("],
    ["m = __import__('os')", "denied_name:__import__"],
    ["x = ().__class__", "dunder_not_allowed:__class__"],
    ["b = builtins", "denied_name:builtins"],
    ["p = os.getcwd()", "denied_name:os."],
  ])("rejects %s", (line, violation) => {
    const res = guardGeneratedCode(wrap(line));
    expect(res.ok).toBe(false);
    expect(res.violations).toContain(violation);
  });

  it("matches whole identifiers, so pos.x does not trip os.", () => {
    expect(guardGeneratedCode(wrap("pos = type('P', (), {})()\nv = pos.x if hasattr(pos, 'x') else 0"))).toEqual({ ok: true, violations: [] });
  });

  it("allows __name__ and __main__", () => {
    expect(guardGeneratedCode(wrap("if __name__ == '__main__':\n    pass")).ok).toBe(true);
  });

  it("requires the library import and a JSON print", () => {
    expect(guardGeneratedCode("import json\nprint(json.dumps({}))").violations).toContain("missing_recoverly_lib_import");
    expect(guardGeneratedCode("import recoverly_lib\nx = 1").violations).toContain("missing_json_print");
  });

  it("rejects oversized and over-long scripts", () => {
    expect(guardGeneratedCode(`${wrap("x = 1")}${"# pad pad pad pad pad\n".repeat(700)}`).violations.join()).toContain("script_too_large");
    expect(guardGeneratedCode(`${wrap("x = 1")}${"\n".repeat(320)}`).violations.join()).toContain("script_too_long");
  });

  it("rejects an empty script", () => {
    expect(guardGeneratedCode("  \n").ok).toBe(false);
  });
});

describe("python block extraction", () => {
  it("extracts one fenced block", () => {
    expect(extractPythonBlock("here\n```python\nprint(1)\n```\nbye")).toBe("print(1)");
  });
  it("returns null without a fence", () => {
    expect(extractPythonBlock("print(1)")).toBeNull();
  });
});
