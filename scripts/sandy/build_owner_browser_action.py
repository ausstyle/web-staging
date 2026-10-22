#!/usr/bin/env python3
"""Build the fixed, reviewable Owner browser action without handling credentials."""
from pathlib import Path
import argparse
ROOT = Path(__file__).resolve().parents[2]
def build() -> str:
    sources = [(ROOT / "sandy/controller" / name).read_text() for name in ("session-transport.mjs", "authorized-deadline-action.mjs")]
    code = "\n".join(s.replace("export function ", "function ").replace("export async function ", "async function ").replace("export const ", "const ") for s in sources)
    return '''// Run only in the already signed-in Sandy Controller owner's browser.
// No credential is displayed, copied, exported, or sent outside this project.
(async () => {
if (location.origin !== "https://ausstyle.github.io" || !location.pathname.includes("/sandy/controller")) throw Error("Open the normal Sandy Controller page first.");
''' + code + '''
const {createClient}=await import("https://esm.sh/@supabase/supabase-js@2.105.0");
const sb=createClient("https://zmqlyygzqoidkcwdysok.supabase.co","sb_publishable_OVP7LUMDhtcymPRzZuCK3Q_8JkLC3ts",{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
console.info(await recordAuthorizedDeadline(createControllerTransport(sb.auth)));
})().catch(error => console.error(error.message));
'''
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument("output", type=Path)
    args = parser.parse_args();args.output.write_text(build())
