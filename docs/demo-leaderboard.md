# Demo leaderboard and administrator access

The public leaderboard API keeps real results in `entries` and fictional display records in `demo_entries` for provenance. The public interface combines these into one list without demo badges or a separate demo section; positions follow the displayed score order. Country and institution display averages are weighted by completed-set counts, merging matching groups without duplicate country rows. This is presentation-only aggregation: real scores, account statistics and training records do not change. The `/admin/` page retains the explicit `(demo)` badges and demo-only management controls.

Migration `0007_demo_leaderboard.sql` seeds 24 fictional readers in 12 countries. Their study circles are fictional. These rows live only in `game_demo_leaders`: they are never users, submissions, paid credits, verified references or training candidates.

Sign in to the main site, then open the bookmarked `/admin/` address. The public navigation does not link to administration. An authorized account can open **Add demo record** (`/admin/new/`) and enter a nickname, country, affiliation, average score (0–100) and number of completed sets (1–100000). Each form submission has a UUID so retrying the same request does not insert a duplicate. A failed request keeps the input; an ambiguous save locks the fields until the identical request is retried. No real user, answer or training record is created.

An authorized account can also rename a demo reader, delete one demo record, or delete all demos. The admin-only annotation in parentheses cannot be removed. Renames use revision checks, preserve other unsaved names, and survive reloads. Deleted rows are not reseeded by deployment; the migration runs once. Deletion removes the rows from the public display but does not modify real scores, users or annotations. A database backup can restore accidentally removed demo rows.

Cloudflare Pages middleware checks the session and the server administrator allowlist before serving `/admin`, `/admin/*`, including the form and its assets. Unauthorized or expired sessions receive a generic 404; authorized responses are private, uncached and excluded from indexing. Keeping the address out of navigation is only a presentation choice; authorization is enforced independently on pages and every management API. Administrator accounts are excluded from public individual, country and university standings, but retain their own scores and reading history.

## Owner bootstrap

Administrator access comes from `game_admins`, not a nickname or profile field. No public API can grant it. After verifying the owner's existing account identity, an operator with D1 access can add its internal user UUID using a private SQL file:

```sql
INSERT INTO game_admins(user_id,granted_at)
VALUES ('<verified-owner-user-uuid>',unixepoch())
ON CONFLICT(user_id) DO NOTHING;
```

Keep the actual owner identity and bootstrap SQL outside the public repository. Do not grant access by matching a mutable nickname such as `admin`. Account deletion cascades the role removal. All management requests require a valid session and the allowlisted account; POSTs also require the same site origin and JSON content type.

## Languages and checks

Korean, English, Japanese, Simplified Chinese (`zh`), Spanish, Italian and French are available for the game, payments UI, errors, participation text and demo administration. The preference persists in the browser, and `?lang=fr` (etc.) can select a language directly. Browser region variants such as `zh-CN` fall back to the supported base language. Institution and nickname content is not translated; country names and number formatting use the selected locale.

`node --test tests/*.test.*` checks key/placeholder parity, role enforcement, cross-origin rejection, stale edits, deletion isolation and existing game/payment behavior. `PANO_QA_ADMIN=alice` enables an administrator only in the isolated localhost `scripts/game-preview.mjs` test fixture; this code is never deployed as an authentication endpoint.
