#!/usr/bin/env python3
"""Inject a Chaos tab into a k6 web-dashboard HTML export.

The k6 web dashboard (and its HTML export) only charts built-in metrics by default; custom metrics such as the
chaos storm's fault shares appear solely as final aggregates in the Summary tab. This script rewrites the
dashboard configuration embedded in the exported HTML, adding a Chaos tab whose panels plot the evolution of the
custom metrics over time, using the same panel/query schema as the built-in tabs.

Usage: python3 chaos-report-panels.py chaos-storm-report.html
"""
import base64
import gzip
import json
import re
import sys


def panel(panel_id, title, series, summary, kind="chart"):
    return {
        "series": [{"query": query, "legend": legend} for query, legend in series],
        "title": title,
        "kind": kind,
        "id": panel_id,
        "summary": summary,
    }


def chaos_tab():
    return {
        "id": "tab-3",
        "title": "Chaos",
        "summary": "Evolution of the chaos experiment usage over time: fault shares per service, storm latency"
            " against the clean baseline and request rates.",
        "sections": [
            {
                "id": "tab-3.section-0",
                "panels": [
                    panel("tab-3.section-0.panel-0", "Fault shares (pastry storm)", [
                        ("storm_rate_limited[?!tags && rate]", "429 rate limited"),
                        ("storm_server_errors[?!tags && rate]", "5xx server errors"),
                        ("storm_timeouts[?!tags && rate]", "client timeouts"),
                        ("storm_slow[?!tags && rate]", "degraded (slow) responses"),
                    ], "Share of GET /pastry responses affected by each fault layer over time: the latency ramp"
                        " shows up as degraded responses, the 429 layer as rate limited, the 5xx outage as server"
                        " errors and the 30s latency layer as client timeouts."),
                    panel("tab-3.section-0.panel-1", "Fault shares (petstore overlaps)", [
                        ("petstore_rate_limited[?!tags && rate]", "429 rate limited"),
                        ("petstore_server_errors[?!tags && rate]", "5xx server errors"),
                    ], "Share of GET /v2/pet/findByStatus responses affected by the cross-service overlap layers:"
                        " 429s between 3 and 5 minutes, 5xx between 5.5 and 8 minutes, at the same time as the"
                        " pastry storm."),
                ],
            },
            {
                "id": "tab-3.section-1",
                "panels": [
                    panel("tab-3.section-1.panel-0", "Storm duration vs clean baseline", [
                        ("storm_duration[?!tags && avg]", "GET /pastry avg"),
                        ("storm_duration[?!tags && p95]", "GET /pastry p(95)"),
                        ("baseline_item_duration[?!tags && avg]", "GET /pastry/{name} avg (clean control)"),
                    ], "Evolution of the storm target latency against the unaffected control operation: the"
                        " 12-keyframe ramp, the 30s timeout phase cut at the 10s client timeout, and the flat"
                        " baseline."),
                    panel("tab-3.section-1.panel-1", "Chaos request rates", [
                        ("storm_requests[?!tags && rate]", "GET /pastry req/s"),
                        ("petstore_requests[?!tags && rate]", "GET /v2/pet/findByStatus req/s"),
                    ], "Per-second request rate on both chaos targets; dips and stalls line up with the fault"
                        " layers."),
                ],
            },
        ],
    }


def main(path):
    try:
        html = open(path, encoding="utf-8").read()
    except OSError as error:
        sys.exit(f"cannot read {path}: {error}")

    match = re.search(r'(<script[^>]*id="data"[^>]*>)(.*?)(</script>)', html, re.S)
    if not match:
        sys.exit(f"no dashboard data blob found in {path}")

    text = gzip.decompress(base64.b64decode(match.group(2).strip())).decode()
    docs = [json.loads(line) for line in text.splitlines() if line.strip()]
    config = next(doc["data"] for doc in docs if doc["event"] == "config")

    if any(tab.get("title") == "Chaos" for tab in config["tabs"]):
        print("Chaos tab already present, nothing to do.")
        return

    config["tabs"].append(chaos_tab())
    encoded = base64.b64encode(
        gzip.compress("\n".join(json.dumps(doc) for doc in docs).encode("utf-8"))).decode()
    html = html[:match.start(2)] + encoded + html[match.end(2):]
    open(path, "w", encoding="utf-8").write(html)
    print(f"Chaos tab added to {path}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
