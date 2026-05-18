# Security Specification for Souq Iraq

## Data Invariants
1. Ads must be owned by the creator (`sellerId == request.auth.uid`).
2. Timestamps must be server-validated.
3. Users can only modify their own data.
4. Public can read ads, but only owners or admins can modify.
5. Reviews are immutable once written (or only deletable by admin).

## The Dirty Dozen Payloads
1. **Identity Spoofing**: Creating an ad with a different `sellerId`.
2. **Ghost Field**: Adding `isVerified: true` to an ad or user profile.
3. **Timestamp Manipulation**: Setting `createdAt` to a past or future date.
4. **Price Poisoning**: Setting negative or extremely large price.
5. **Unauthorized Edit**: User A trying to update User B's ad.
6. **Self-Review**: Writing a review for oneself.
7. **Privilege Escalation**: Attempting to set `isAdmin: true` on user profile.
8. **Malicious ID**: Injecting a 2KB string as a document ID.
9. **Orphaned Ad**: Creating an ad without a valid user profile (optional existence check).
10. **State Skipping**: Changing ad status from `active` to `deleted` by someone other than owner.
11. **PII Leak**: Non-owner trying to read a user's private info (if any).
12. **Unbounded List**: Trying to flood an array field.

## Test Runner (Conceptual)
All the above must return `PERMISSION_DENIED`.
