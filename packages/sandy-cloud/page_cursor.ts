/** Server-side signed cursors. Context comes from current admission, never from
 * unverified token claims. This is not an identity issuer or an access grant.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
export interface PagePosition {
  snapshot: string;
  after: number;
  context: string;
  expiresAt: number;
}
export class PageCursor {
  private readonly key: Uint8Array;
  constructor(key: Uint8Array) {
    if (key.byteLength < 32) throw Error("CURSOR_KEY_TOO_SHORT");
    this.key = key.slice();
  }
  sign(position: PagePosition): string {
    const payload = Buffer.from(JSON.stringify({ v: 1, ...position })).toString(
      "base64url",
    );
    const signature = createHmac("sha256", this.key).update(payload).digest(
      "base64url",
    );
    return payload + "." + signature;
  }
  verify(token: string, context: string, now = Date.now()): PagePosition {
    const invalid = (): never => {
      throw Error("CURSOR_INVALID_OR_EXPIRED");
    };
    if (
      typeof token !== "string" || token.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)
    ) return invalid();
    const [payload, mac] = token.split(".");
    const signature = Buffer.from(mac, "base64url");
    const expected = createHmac("sha256", this.key).update(payload).digest();
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    ) return invalid();
    let p;
    try {
      p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return invalid();
    }
    if (
      !p || p.v !== 1 || p.context !== context ||
      typeof p.snapshot !== "string" || !/^[a-f0-9-]{36}$/.test(p.snapshot) ||
      !Number.isSafeInteger(p.after) || p.after < 0 ||
      !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now
    ) return invalid();
    return p;
  }
}
