#!/usr/bin/env python3
"""End-to-end MCP protocol test against the compiled Seme MCP server.

Speaks newline-delimited JSON-RPC over stdio, exactly like an MCP client.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

NODE = os.environ.get("NODE", "node")
SERVER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist", "mcp", "mcp-server.js")
STORE = os.environ.get("SEME_MCP_TEST_DIR", tempfile.mkdtemp(prefix="seme-mcp-"))

os.makedirs(STORE, exist_ok=True)

env = dict(os.environ)
env["SEME_STORAGE_DIR"] = STORE
env.setdefault("OLLAMA_URL", "http://localhost:11434")

proc = subprocess.Popen(
    [NODE, SERVER],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env,
    text=True,
    bufsize=1,
)

_id = 0
def call(method, params=None, expect_reply=True, timeout=30):
    global _id
    _id += 1
    msg = {"jsonrpc": "2.0", "id": _id, "method": method}
    if params is not None:
        msg["params"] = params
    proc.stdin.write(json.dumps(msg) + "\n")
    proc.stdin.flush()
    if not expect_reply:
        return None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            print("  (non-JSON output):", line[:200])
    raise TimeoutError(f"no reply to {method}")

def text_of(resp):
    try:
        return resp["result"]["content"][0]["text"]
    except Exception:
        return json.dumps(resp)[:400]

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))

try:
    r = call("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "hermes-test", "version": "1.0"}})
    check("initialize", r.get("result", {}).get("serverInfo", {}).get("name") == "seme",
          json.dumps(r.get("result", {}).get("serverInfo", {})))

    call("notifications/initialized", expect_reply=False)
    time.sleep(0.2)

    r = call("tools/list")
    tools = r.get("result", {}).get("tools", [])
    check("tools/list", len(tools) >= 10, f"{len(tools)} tools: {', '.join(t['name'] for t in tools)[:120]}")

    r = call("tools/call", {"name": "seme_save", "arguments": {"content": "The user's name is Charles and he lives in Edinburgh.", "kind": "fact", "session_id": "mcp-test"}}, timeout=60)
    body = text_of(r)
    check("tools/call seme_save", '"saved": true' in body.replace(" ", " ").lower() or "saved" in body.lower(), body[:160].replace("\n", " "))

    time.sleep(1.5)

    r = call("tools/call", {"name": "seme_recall", "arguments": {"query": "where does the user live?", "session_id": "mcp-test"}}, timeout=120)
    body = text_of(r)
    check("tools/call seme_recall", "Edinburgh" in body or "Charles" in body, body[:200].replace("\n", " "))

    r = call("tools/call", {"name": "seme_graph_stats", "arguments": {}}, timeout=60)
    body = text_of(r)
    check("tools/call seme_graph_stats", "entities" in body.lower() and "relationships" in body.lower(), body[:160].replace("\n", " "))

    r = call("tools/call", {"name": "seme_profile", "arguments": {}}, timeout=60)
    body = text_of(r)
    check("tools/call seme_profile", len(body) > 2, body[:160].replace("\n", " "))

    r = call("tools/call", {"name": "seme_list_entities", "arguments": {}}, timeout=60)
    body = text_of(r)
    check("tools/call seme_list_entities", "Charles" in body or "entities" in body.lower(), body[:160].replace("\n", " "))

    r = call("bogus/method")
    check("unknown method → -32601", r.get("error", {}).get("code") == -32601, str(r.get("error")))

finally:
    proc.stdin.close()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    err = proc.stderr.read()
    if err and "Error" in err:
        print("\nSERVER STDERR:\n" + err[:1500])

print("\n" + "=" * 60)
passed = sum(1 for _, ok, _ in results if ok)
print(f"MCP TEST: {passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
