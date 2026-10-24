# PST conversion investigation — no support claim

Mail v1.0 §6.2 requires a validated PST parser, preserved source archive, reproducible conversion records and unexplained-loss accounting. PST export is separately P1 (§6.1). This investigation does not enable either route. No private PST/OST, real mailbox, converter workload, credential or paid licence was used.

Two established upstream candidates were reviewed on 2026-10-24:

- **libpst/readpst:** upstream documentation describes ANSI/Unicode PST conversion and separate RFC822 messages with embedded attachments. `-e` adds EML/ICS/VCF extensions; `-j 0` disables parallel conversion. This is the first candidate for a bounded synthetic conversion trial. Source: [project](https://www.five-ten-sg.com/libpst/) and [readpst manual](https://www.five-ten-sg.com/libpst/rn01re01.html). Upstream's documented release is 0.6.76; a build must pin the actual source/package digest and review its licence and current distribution patches before redistribution. The manual alone is not evidence of current security or successful Sandy conversion.
- **libyal/libpff/pffexport:** upstream identifies its status as alpha and licence as LGPL-3.0-or-later, supports ANSI and Unicode formats, and provides allocated-item and recovery export modes. It is a candidate inventory/comparison tool, not evidence that its output is a complete original-MIME export. Sources: [upstream README](https://github.com/libyal/libpff/blob/main/README) and [pffexport source](https://github.com/libyal/libpff/blob/main/pfftools/pffexport.c).

A safe local trial should use a verified, entirely synthetic PST with a known creation manifest: empty nested folders, duplicate folder basenames, drafts, flags, Unicode, recipients/dates, embedded and regular attachments, plus explicitly inventoried non-mail items. No such provenance-verified PST fixture is available in this workspace; `readpst` and `pffexport` are not installed. No conversion result is claimed. Downloading arbitrary example PSTs would not establish permission or synthetic provenance.

The candidate worker must read a hash-pinned source mounted read-only, run without network/credentials as an unprivileged process under memory/time/output bounds, and write a fresh private output directory. Validate every output path/type/count before ingestion; never follow links or render content. Record converter build, source digest, options, item IDs, folder inventory, converted hashes, property differences and every excluded/unsupported item. Preserve original PST bytes and unsupported ICS/VCF/RTF/MAPI properties alongside the conversion manifest. Converted MIME is not byte-exact original MIME when the source does not expose one.

For an eventual readpst trial, review the `-e -j 0` output first. Do not use overwrite (`-w`), attachment filtering (`-a`), RTF attachment omission (`-b`), deletion recovery (`-D`) or type filtering as shortcuts to successful reconciliation. Exit code zero and an output-file count are insufficient: compare the known source inventory and attachments, prove empty hierarchy retention, exercise interruption/corruption, and run the resulting EMLs through the existing quarantined import/reconciliation path. Tool-generated names need explicit mapping; the new portable collection inventory does not automatically certify a PST converter's hierarchy.

Until those fixture tests and a pinned sandboxed build pass, `ImportSpec` continues to reject PST/OST. No converter adapter or production dependency was added. The current completed capability is native portable collection/draft/message round-trip, not PST conversion or Outlook compatibility.

## Synthetic fixture feasibility follow-up

Reviewed Microsoft's current `outlook-pst-rs` source at
[`cfb721daee538acc50d2bad6faac5ce724f6037d`](https://github.com/microsoft/outlook-pst-rs/tree/cfb721daee538acc50d2bad6faac5ce724f6037d).
Its [PST crate README](https://github.com/microsoft/outlook-pst-rs/blob/cfb721daee538acc50d2bad6faac5ce724f6037d/crates/pst/README.md)
explicitly excludes full file modification; crash recovery/AMap rebuilding is not
a message writer. The source tree includes `examples/Empty.pst`, but no reviewed
creation recipe proving a nonempty synthetic mailbox and its complete fields.
The filename alone is insufficient provenance; that binary was not imported or
used as a conversion pass. No Outlook/Windows mailbox writer is available in this
Linux environment. No arbitrary sample mailbox was downloaded and no unsupported
converter was installed.

Result: a provenance-verifiable populated PST fixture was **not obtained**. The
remaining practical route is an existing licensed offline Outlook environment or
a separately reviewed writer that creates a fresh store solely from the committed
synthetic MIME fixture, accompanied by its creation script/version, hashes, item
inventory and folder/recipient/attachment expectations. No account connection,
real mailbox, send, paid licence or converter support claim is inferred. Native
EML/MIME, JSON, TAR/ZIP and MBOXrd coverage remains separate from unverified PST/OST.
