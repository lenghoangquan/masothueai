# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Authentication & Email Verification Invariant**:
   - All read and write operations on `/watchlist/{itemId}` and `/invoices/{invoiceId}` require an authenticated user (`request.auth != null`) with a verified Google email (`request.auth.token.email_verified == true`).
2. **Ownership & Relational Integrity Invariant**:
   - Every `WatchlistSupplier` and `ExtractedInvoice` document must have `userId == request.auth.uid`.
   - `userId`, `mst`, `baselineStatus`, and `createdAt` are immutable after document creation.
3. **Strict Schema & Volumetric Invariant**:
   - Every document creation and update must pass `isValidWatchlistSupplier(incoming())` or `isValidExtractedInvoice(incoming())`, enforcing exact key allowlists (`hasAll` + `hasOnly`), string `.size()` boundaries, regex patterns, and bounded arrays (`impactedInvoices.size() <= 50`).
4. **Temporal Integrity Invariant**:
   - `createdAt` must equal `request.time` on `create`.
   - `updatedAt` must equal `request.time` on `create` and `update`.
5. **Query Enforcer Invariant**:
   - `allow list` on `/watchlist/{itemId}` and `/invoices/{invoiceId}` strictly requires `resource.data.userId == request.auth.uid`. Blanket `isSignedIn()` reads are forbidden.

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Unauthenticated Write)**: `request.auth == null` attempting to create `/watchlist/item_1`.
2. **Payload 2 (Unverified Email Spoof)**: Authenticated user with `email_verified: false` attempting to create `/watchlist/item_1`.
3. **Payload 3 (Identity Spoofing on Create)**: Authenticated user `uid_A` setting `userId: "uid_B"` in `/watchlist/item_1`.
4. **Payload 4 (Shadow Field Injection on Create)**: Payload includes all required fields plus `"isAdmin": true` on `/watchlist/item_1`.
5. **Payload 5 (ID Poisoning Attack)**: Document ID `{itemId}` containing invalid characters or length > 128 chars.
6. **Payload 6 (Denial-of-Wallet String Overflow)**: `riskReason` string with length 5,000 characters (> max 1000).
7. **Payload 7 (Unbounded Array Overflow)**: `impactedInvoices` array with 100 items (> max 50) or non-string first element.
8. **Payload 8 (Timestamp Forgery on Create)**: Client provides past/future `createdAt` not matching `request.time`.
9. **Payload 9 (Immutable Baseline Mutation on Update)**: Owner attempts to change `baselineStatus` or `mst` or `userId` during an update on `/watchlist/item_1`.
10. **Payload 10 (Update-Gap Type Poisoning)**: Owner updates an allowed key (`currentStatus`) with a number `12345` or a 10KB string.
11. **Payload 11 (Cross-Tenant Document Read)**: User `uid_B` attempts `get` on `/watchlist/item_owned_by_A`.
12. **Payload 12 (Unconstrained Collection List Scrape)**: User `uid_B` attempts `list` on `/invoices` without filtering `userId == uid_B`.

## 3. Red Team Audit & Verification Summary

- **Shadow Update Test**: Blocked by `data.keys().hasOnly(...)` in `isValidWatchlistSupplier` and `incoming().diff(existing()).affectedKeys().hasOnly(...)` in `allow update`.
- **Email Spoofing Test**: Blocked by `isVerifiedUser()` requiring `request.auth.token.email_verified == true`.
- **PII / Cross-User Blanket Test**: Blocked by `existing().userId == request.auth.uid` on both `get` and `list`.
- **Value Poisoning Test**: Blocked because `isValidWatchlistSupplier(incoming())` wraps the entire `allow update` expression before action branches.
