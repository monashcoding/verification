import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';

// Standard mac-auth JWT verification via JWKS (§5). This service is a *consumer*
// of identity — it never mints or modifies mac-auth tokens/claims.
//
// Note the account-chooser requirement (`prompt=select_account`) lives on the
// login redirect the frontend builds, not here — this module only verifies the
// resulting token.

const JWKS_URL =
  process.env.MAC_AUTH_JWKS_URL ?? 'https://auth.monashcoding.com/.well-known/jwks.json';
const ISSUER = process.env.MAC_AUTH_ISSUER ?? 'https://auth.monashcoding.com';
const AUDIENCE = process.env.MAC_AUTH_AUDIENCE; // optional

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

export interface MacUser {
  macUserId: string;
  email: string;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      macUser?: MacUser;
    }
  }
}

function extractRoles(payload: Record<string, unknown>): string[] {
  const raw = payload.roles ?? payload.role ?? [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return [raw];
  return [];
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  // Fall back to a cookie set by the SPA after login, if present.
  const cookie = req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('mac_token='));
  return cookie ? decodeURIComponent(cookie.slice('mac_token='.length)) : null;
}

export async function verifyToken(token: string): Promise<MacUser> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: ISSUER,
    ...(AUDIENCE ? { audience: AUDIENCE } : {}),
  });
  const macUserId = String(payload.sub ?? '');
  const email = String(payload.email ?? '').toLowerCase();
  if (!macUserId) throw new Error('token missing sub');
  return { macUserId, email, roles: extractRoles(payload as Record<string, unknown>) };
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

const ADMIN_ROLES = (process.env.MAC_ADMIN_ROLES ?? 'admin,exec,committee')
  .split(',')
  .map((r) => r.trim().toLowerCase())
  .filter(Boolean);

/** Require an exec/admin role claim (§11). */
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
