import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';

// mac-auth token verification (§5). Mirrors the canonical verifier the auth
// service ships (monashcoding/mac-auth examples/verify.ts): a Better Auth EdDSA
// JWT verified locally against the service's JWKS. This service is a *consumer*
// of identity — it never mints or modifies mac-auth tokens/claims/JWKS.

const AUTH_URL = process.env.AUTH_URL ?? 'https://auth.monashcoding.com';
const ISSUER = AUTH_URL;
const AUDIENCE = process.env.JWT_AUDIENCE ?? 'mac-suite';

// Cached remote JWKS (Ed25519 public keys), refreshed in the background by jose.
// Do NOT recreate per request — that would hit the auth service every call.
const JWKS = createRemoteJWKSet(new URL(`${AUTH_URL}/api/auth/jwks`));

/** The claims a verified MAC token is guaranteed to carry. */
export interface MacUser {
  macUserId: string;
  email: string;
  name: string;
  roles: string[];
  /** Functional team, or null if the person isn't on the committee roster. */
  team: string | null;
  ver: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      macUser?: MacUser;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/**
 * Verify a MAC-issued JWT. Throws if the signature, issuer, audience, or expiry
 * is invalid. Returns the typed MAC claims on success. The canonical user id is
 * the `macUserId` claim (not `sub`).
 */
export async function verifyToken(token: string): Promise<MacUser> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER, // checks `iss`
    audience: AUDIENCE, // checks `aud`
    // `exp` is enforced by jwtVerify automatically.
  });
  const macUserId = payload.macUserId as string | undefined;
  if (!macUserId) throw new Error('token missing macUserId');
  return {
    macUserId,
    email: ((payload.email as string) ?? '').toLowerCase(),
    name: (payload.name as string) ?? '',
    roles: (payload.roles as string[]) ?? [],
    team: (payload.team as string | null) ?? null,
    ver: (payload.ver as number) ?? 1,
  };
}

/** Populate req.macUser if a valid token is present; never rejects. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearer(req);
  if (token) {
    try {
      req.macUser = await verifyToken(token);
    } catch {
      // Leave unauthenticated — routes decide whether that matters.
    }
  }
  next();
}

/** Require any authenticated mac-auth user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.macUser) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
}

// Admin surfaces (§11) are exec/committee. `member` is a normal member, not admin.
const ADMIN_ROLES = (process.env.MAC_ADMIN_ROLES ?? 'exec,committee')
  .split(',')
  .map((r) => r.trim().toLowerCase())
  .filter(Boolean);

/** Require an exec/committee role claim (§11). */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.macUser) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  const has = req.macUser.roles.some((r) => ADMIN_ROLES.includes(r.toLowerCase()));
  if (!has) {
    res.status(403).json({ error: 'admin access required' });
    return;
  }
  next();
}
