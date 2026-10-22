"""Keep the isolated Cloud Run build context on the canonical MCP transport code.

Only a deterministic copy is generated; provider logic and secrets never enter it.
"""
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "supabase/functions/_shared/sandy_mcp_transport.mjs"
TARGET = ROOT / "services/sandy-engineering-mcp/src/generated/mcp-transport.mjs"


def synchronize(check=False):
    source = SOURCE.read_bytes()
    expected = ("// Generated from supabase/functions/_shared/sandy_mcp_transport.mjs; SHA256 "
                + hashlib.sha256(source).hexdigest() + "; do not edit.\n").encode() + source
    if check:
        if not TARGET.exists() or TARGET.read_bytes() != expected:
            raise RuntimeError("generated_MCP_transport_drift")
    else:
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        TARGET.write_bytes(expected)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    synchronize(parser.parse_args().check)
