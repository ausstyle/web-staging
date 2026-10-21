/** Actual WSMan HTTPS shell lifecycle; Basic authentication only inside pinned TLS. */
import { DOMParser } from "npm:@xmldom/xmldom@0.8.11";
import { ProtocolRefusal } from "./errors.ts";
import { soapHttps, type WinrmEndpoint } from "./tls_http.ts";
const S = "http://www.w3.org/2003/05/soap-envelope",
  A = "http://schemas.xmlsoap.org/ws/2004/08/addressing",
  W = "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd",
  R = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell",
  X = "http://schemas.xmlsoap.org/ws/2004/09/transfer";
const UUID =
  /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const action = (name: string) =>
  (["Create", "Delete"].includes(name) ? X : R) + "/" + name;
function parse(bytes: Uint8Array, expectedAction: string, id: string) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProtocolRefusal("winrm_soap_response_invalid");
  }
  if (
    bytes.length > 524288 || /<!DOCTYPE|<!ENTITY/i.test(text) ||
    text.includes("\0")
  ) throw new ProtocolRefusal("winrm_xml_entities_refused");
  let invalid = false;
  const document = new DOMParser({
    errorHandler: {
      warning: () => {
        invalid = true;
      },
      error: () => {
        invalid = true;
      },
      fatalError: () => {
        invalid = true;
      },
    },
  }).parseFromString(text, "application/xml");
  if (
    invalid || document.documentElement.namespaceURI !== S ||
    document.documentElement.localName !== "Envelope"
  ) throw new ProtocolRefusal("winrm_soap_response_invalid");
  const walk = (n: Node, depth = 0): number => {
    if (depth > 32) throw new ProtocolRefusal("winrm_soap_depth_limit");
    let size = 1;
    for (let child = n.firstChild; child; child = child.nextSibling) {
      size += walk(child, depth + 1);
      if (size > 10000) throw new ProtocolRefusal("winrm_soap_node_limit");
    }
    return size;
  };
  walk(document as unknown as Node);
  const one = (ns: string, name: string) => {
    const found = document.getElementsByTagNameNS(ns, name);
    if (found.length !== 1) {
      throw new ProtocolRefusal("winrm_soap_response_invalid");
    }
    return found[0];
  };
  one(S, "Header");
  one(S, "Body");
  if (document.getElementsByTagNameNS(S, "Fault").length) {
    throw new ProtocolRefusal("winrm_soap_fault");
  }
  if (
    one(A, "Action").textContent !== expectedAction ||
    one(A, "RelatesTo").textContent !== id
  ) throw new ProtocolRefusal("winrm_soap_response_binding_mismatch");
  return { document, one };
}
function envelope(
  endpoint: WinrmEndpoint,
  kind: string,
  id: string,
  body: string,
  shell?: string,
) {
  return `<s:Envelope xmlns:s="${S}" xmlns:a="${A}" xmlns:w="${W}" xmlns:rsp="${R}"><s:Header><a:To>https://${
    escape(endpoint.serverName)
  }:${endpoint.port}/wsman</a:To><w:ResourceURI s:mustUnderstand="true">${R}/cmd</w:ResourceURI><a:ReplyTo><a:Address>${A}/role/anonymous</a:Address></a:ReplyTo><a:Action s:mustUnderstand="true">${
    action(kind)
  }</a:Action><w:MaxEnvelopeSize s:mustUnderstand="true">524288</w:MaxEnvelopeSize><a:MessageID>${id}</a:MessageID><w:OperationTimeout>PT5S</w:OperationTimeout>${
    shell
      ? `<w:SelectorSet><w:Selector Name="ShellId">${shell}</w:Selector></w:SelectorSet>`
      : ""
  }</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
}
export type WinrmResult = {
  protocol: "winrm_https";
  exit_code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  tls_identity_verified: true;
  shell_deleted: true;
};
export async function winrmExecute(
  endpoint: WinrmEndpoint,
  command: string,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<WinrmResult> {
  if (
    typeof command !== "string" || !command.length ||
    new TextEncoder().encode(command).length > 16384 || command.includes("\0")
  ) throw new ProtocolRefusal("bounded_winrm_command_required");
  const limit = options.timeoutMs ?? 30000,
    max = options.maxOutputBytes ?? 65536;
  if (
    !Number.isSafeInteger(limit) || limit < 100 || limit > 30000 ||
    !Number.isSafeInteger(max) || max < 1 || max > 65536
  ) throw new ProtocolRefusal("bounded_winrm_transport_required");
  const started = performance.now();
  let shell: string | undefined,
    commandId: string | undefined,
    attempted = false,
    total = 0,
    finished = false,
    deleted = false,
    deleteAttempted = false;
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const request = async (kind: string, body: string) => {
    const remaining = limit - (performance.now() - started);
    if (remaining <= 0) {
      throw new ProtocolRefusal("winrm_execution_timeout", attempted);
    }
    const id = "uuid:" + crypto.randomUUID();
    let reply;
    try {
      reply = await soapHttps(
        endpoint,
        envelope(endpoint, kind, id, body, shell),
        Math.max(1, Math.floor(remaining)),
      );
      attempted = true;
    } catch (error) {
      if (error instanceof ProtocolRefusal && error.mayHaveExecuted) {
        attempted = true;
      }
      throw error;
    }
    if (reply.status !== 200) {
      throw new ProtocolRefusal(
        reply.status >= 300 && reply.status < 400
          ? "winrm_redirect_refused"
          : "winrm_http_or_authentication_refused",
        true,
      );
    }
    return parse(reply.body, action(kind) + "Response", id);
  };
  const removeShell = async () => {
    deleteAttempted = true;
    await request("Delete", "");
    deleted = true;
  };
  try {
    const created = await request(
      "Create",
      `<rsp:Shell><rsp:InputStreams>stdin</rsp:InputStreams><rsp:OutputStreams>stdout stderr</rsp:OutputStreams><rsp:IdleTimeOut>PT60S</rsp:IdleTimeOut></rsp:Shell>`,
    );
    const shellIds = Array.from(
      created.document.getElementsByTagNameNS(R, "ShellId"),
    ).map((n) => n.textContent ?? "");
    for (
      const selector of Array.from(
        created.document.getElementsByTagNameNS(W, "Selector"),
      )
    ) {
      if (selector.getAttribute("Name") === "ShellId") {
        shellIds.push(selector.textContent ?? "");
      }
    }
    if (
      shellIds.length < 1 || shellIds.length > 2 ||
      !shellIds.every((v) => v === shellIds[0] && UUID.test(v))
    ) throw new ProtocolRefusal("winrm_shell_identity_invalid", true);
    shell = shellIds[0];
    const encoded = Buffer.from(command, "utf16le").toString("base64"),
      createdCommand = await request(
        "Command",
        `<rsp:CommandLine><rsp:Command>powershell.exe</rsp:Command><rsp:Arguments>-NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}</rsp:Arguments></rsp:CommandLine>`,
      );
    commandId = createdCommand.one(R, "CommandId").textContent ?? "";
    if (!UUID.test(commandId)) {
      throw new ProtocolRefusal("winrm_command_identity_invalid", true);
    }
    let code: number | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      const reply = await request(
        "Receive",
        `<rsp:Receive><rsp:DesiredStream CommandId="${commandId}">stdout stderr</rsp:DesiredStream></rsp:Receive>`,
      );
      for (
        const stream of Array.from(
          reply.document.getElementsByTagNameNS(R, "Stream"),
        )
      ) {
        const name = stream.getAttribute("Name"),
          id = stream.getAttribute("CommandId"),
          encoded = stream.textContent ?? "";
        if (
          !["stdout", "stderr"].includes(name ?? "") || id !== commandId ||
          encoded.length > 87384 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
            .test(encoded)
        ) throw new ProtocolRefusal("winrm_output_binding_invalid", true);
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.toString("base64") !== encoded) {
          throw new ProtocolRefusal("winrm_output_binding_invalid", true);
        }
        total += bytes.length;
        if (total > max) {
          throw new ProtocolRefusal("winrm_output_limit_outcome_unknown", true);
        }
        (name === "stdout" ? stdout : stderr).push(new Uint8Array(bytes));
      }
      const state = reply.one(R, "CommandState");
      if (state.getAttribute("CommandId") !== commandId) {
        throw new ProtocolRefusal("winrm_output_binding_invalid", true);
      }
      if (state.getAttribute("State") === R + "/CommandState/Done") {
        const value = reply.one(R, "ExitCode").textContent ?? "";
        if (!/^[0-9]{1,10}$/.test(value) || Number(value) > 2147483647) {
          throw new ProtocolRefusal("winrm_exit_code_invalid", true);
        }
        code = Number(value);
        finished = true;
        break;
      }
      if (state.getAttribute("State") !== R + "/CommandState/Running") {
        throw new ProtocolRefusal("winrm_command_state_invalid", true);
      }
    }
    if (!finished || code === undefined) {
      throw new ProtocolRefusal("winrm_execution_outcome_unknown", true);
    }
    await removeShell();
    return {
      protocol: "winrm_https",
      exit_code: code,
      stdout: new Uint8Array(Buffer.concat(stdout)),
      stderr: new Uint8Array(Buffer.concat(stderr)),
      tls_identity_verified: true,
      shell_deleted: true,
    };
  } catch (error) {
    if (shell && !deleteAttempted) {
      try {
        await removeShell();
      } catch {
        /* deadline or network loss requires reconciliation, never redispatch */
      }
    }
    throw new ProtocolRefusal(
      error instanceof ProtocolRefusal
        ? error.code
        : "winrm_execution_outcome_unknown",
      attempted,
      !!shell && !deleted,
    );
  }
}
