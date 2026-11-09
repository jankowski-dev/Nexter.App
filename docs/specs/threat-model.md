# Threat Model

## Assets

Crypto funds, Tangem seed/keys (never on server), auth credentials, TOTP secret, recovery codes, sessions, trade history, balances, P&L, API keys, backups, Notion export, password-vault ciphertext, tasks, notes.

## Adversaries

Opportunistic attackers, credential stuffing, phishing, malware, malicious browser extensions, supply-chain attackers, cloud/provider compromise, MEV bots, malicious tokens/calldata, address poisoning, device theft, AI-agent mistakes, prompt injection, insider error.

## Trust boundaries

- Browser and wallet are untrusted for server decisions.
- The server builds and validates transactions but never holds keys.
- The database is private.
- External APIs (KyberSwap, RPC, prices) are untrusted and validated.
- Notion/web content is data, not instructions.
- Agents have no production access.

## Key controls

- Single user, closed registration, setup token.
- Argon2id passwords, mandatory TOTP, recovery codes.
- httpOnly/Secure/SameSite cookies, server-side sessions, rotation, revocation.
- CSRF token and Origin checks for mutations.
- Rate limits, lockout, audit log.
- Helmet: CSP, HSTS, DENY framing, strict-origin-when-cross-origin, Permissions-Policy.
- Secrets only in env; no secrets in logs; pino allowlist serializer; Sentry scrubbing.
- Private Postgres, least privilege, PITR, encrypted dumps to R2, restore tests.
- Swap allowlists, calldata decoding, simulation, exact approvals, MEV protection, step-up TOTP, kill switch.
- Vault: client-side PBKDF2/AES-256-GCM, random data key wrapped by the master key, no plaintext/master key on the server, no vault ciphertext in audit logs, no server-side recovery.
- Dependency audit, lockfile, secret scan. Exact version pinning and base-image digest pinning remain hardening items.
- AI agents: no prod access, read-only research, worktrees, security review.

## Residual risks

Self-hosting shifts responsibility to the owner; Railway/Cloudflare/GitHub may be compromised; the user's device may be infected; Tangem firmware and DEX contracts are outside our control; market risk remains.

## Verification

Auth tests, CSRF/XSS tests, header assertions, secret scanning, dependency audit, backup restore, calldata tampering tests, RPC outage tests, gzip/static smoke tests, vault crypto/unit/E2E tests, and independent phase review.
