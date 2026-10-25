"""Free NIGHTSHIFT calls with plain `requests`. No key, no wallet, no payment.

    pip install requests
    python free.py
"""
import json
import sys

import requests

BASE = "https://getnightshift.tech"
USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"


def mcp(tool, arguments=None):
    """Call one tool on the keyless public MCP endpoint (JSON-RPC 2.0)."""
    r = requests.post(
        f"{BASE}/mcp/public",
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": arguments or {}}},
        timeout=40,
    )
    r.raise_for_status()
    if "text/event-stream" in r.headers.get("content-type", ""):
        # server-sent events: the JSON-RPC message is on a "data:" line
        data = [l[5:].strip() for l in r.text.splitlines() if l.startswith("data:")][-1]
        msg = json.loads(data)
    else:
        msg = r.json()
    if "error" in msg:
        raise RuntimeError(msg["error"])
    text = msg["result"]["content"][0]["text"]
    if msg["result"].get("isError"):
        raise RuntimeError(text)
    try:
        return json.loads(text)
    except ValueError:
        return text


def get(path):
    r = requests.get(BASE + path, timeout=40)
    if not r.ok:
        # NIGHTSHIFT errors are JSON like {"error": "..."}
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
    return r.json()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # answers can contain non-Latin text
    try:
        start = mcp("start_here")
        print("start_here ->", start["nightshift"][:120])

        ask = mcp("swarm_mind_ask", {"question": "What is IMD?"})
        print("swarm_mind_ask ->", ask["answer"][:160], f"({len(ask.get('sources', []))} sources)")

        prev = get(f"/api/v1/verdict/ethereum/{USDT}/preview")
        print("verdict preview ->", prev["market"]["symbol"], prev["market"]["liquidityUsd"], "verdict:", prev["verdict"])

        services = get("/api/v1/services")
        for o in services["offers"][:3]:
            print("service:", o["id"], "$" + str(o["priceUsd"]), "holders $" + str(o["holderPriceUsd"]))
    except Exception as e:  # keep the example short: print and exit non-zero
        print("error:", e, file=sys.stderr)
        sys.exit(1)
