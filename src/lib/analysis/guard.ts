/**
 * Static guard for LLM-generated Python. Denylist + size cap. Not a sandbox replacement —
 * the CreateOS sandbox is the real boundary; this fails fast before a sandbox create.
 */

export const MAX_SCRIPT_BYTES = 8 * 1024;

const DENY_SUBSTRINGS = [
  "import socket",
  "import socketserver",
  "import subprocess",
  "import multiprocessing",
  "import urllib",
  "import requests",
  "import httpx",
  "import aiohttp",
  "import os",
  "import pathlib",
  "import ftplib",
  "import smtplib",
  "import poplib",
  "import imaplib",
  "import telnetlib",
  "import paramiko",
  "import shutil",
  "import ctypes",
  "import signal",
  "os.system",
  "os.popen",
  "os.exec",
  "os.spawn",
  "subprocess.",
  "eval(",
  "exec(",
  "compile(",
  "__import__(",
  "open('/",
  'open("/',
  "open('/etc",
  "pathlib.Path('/",
  "globals()",
  "locals()",
  "vars(",
  "getattr(__builtins__",
  "breakpoint(",
  "pty.",
  "webbrowser",
  "ctypes.",
  "pty.spawn",
];

export interface GuardFailure {
  ok: false;
  reason: string;
}

export interface GuardSuccess {
  ok: true;
}

export function guardGeneratedCode(code: string): GuardSuccess | GuardFailure {
  if (!code || !code.trim()) {
    return { ok: false, reason: "Generated script is empty." };
  }
  if (Buffer.byteLength(code, "utf8") > MAX_SCRIPT_BYTES) {
    return { ok: false, reason: `Generated script exceeds ${MAX_SCRIPT_BYTES} bytes.` };
  }
  const lowered = code.toLowerCase();
  for (const needle of DENY_SUBSTRINGS) {
    if (lowered.includes(needle.toLowerCase())) {
      return { ok: false, reason: `Generated script contains banned construct: ${needle}` };
    }
  }
  if (!lowered.includes("print(")) {
    return { ok: false, reason: "Generated script must print a single JSON document to stdout." };
  }
  return { ok: true };
}
