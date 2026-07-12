import { randomBytes } from "node:crypto";

/**
 * In-memory, TTL-expiring companion session store. Sessions hold ONLY the search
 * text and expire quickly. Not persisted anywhere. One session cannot read
 * another's data (lookup is by unguessable code).
 */
export interface Session {
  sessionId: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  value: string | null;
  submittedAt: number | null;
}

export type SessionStatus = "pending" | "submitted" | "expired" | "not-found";

// Base32-ish alphabet without ambiguous chars (no 0/O/1/I).
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export class SessionStore {
  private readonly byCode = new Map<string, Session>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  create(): Session {
    // Ensure code uniqueness among live sessions.
    let code = randomCode();
    while (this.byCode.has(code)) code = randomCode();
    const createdAt = this.now();
    const session: Session = {
      sessionId: randomBytes(16).toString("hex"),
      code,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      value: null,
      submittedAt: null,
    };
    this.byCode.set(code, session);
    return session;
  }

  private isExpired(session: Session): boolean {
    return this.now() > session.expiresAt;
  }

  status(code: string): { status: SessionStatus; value?: string | null } {
    const session = this.byCode.get(code.toUpperCase());
    if (!session) return { status: "not-found" };
    if (this.isExpired(session)) {
      this.byCode.delete(session.code);
      return { status: "expired" };
    }
    if (session.value !== null) return { status: "submitted", value: session.value };
    return { status: "pending" };
  }

  submit(code: string, value: string): { ok: boolean; status: SessionStatus } {
    const session = this.byCode.get(code.toUpperCase());
    if (!session) return { ok: false, status: "not-found" };
    if (this.isExpired(session)) {
      this.byCode.delete(session.code);
      return { ok: false, status: "expired" };
    }
    session.value = value;
    session.submittedAt = this.now();
    return { ok: true, status: "submitted" };
  }

  /** Remove expired sessions. Call periodically. */
  sweep(): void {
    for (const [code, session] of this.byCode) {
      if (this.isExpired(session)) this.byCode.delete(code);
    }
  }

  get size(): number {
    return this.byCode.size;
  }
}
