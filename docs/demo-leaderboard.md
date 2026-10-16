# Demo leaderboard and administrator access

The public leaderboard returns real results in `entries` and fictional display records in `demo_entries`. Every demo name is followed by `(demo)` in the interface. The demo section is separate, with its own positions. Country and institution demo averages are weighted by their fictional completed-set counts.

Migration `0007_demo_leaderboard.sql` seeds 24 fictional readers in 12 countries. Their study circles are fictional. These rows live only in `game_demo_leaders`: they are never users, submissions, paid credits, verified references or training candidates.

Sign in to the main site, then open `/admin/`. An authorized account can rename a demo reader, delete one demo record, or delete all demos. The annotation in parentheses cannot be removed. Renames use revision checks, preserve other unsaved names, and survive reloads. Deleted rows are not reseeded by deployment; the migration runs once. Deletion does not affect real rankings, users or annotations. A database backup can restore accidentally removed demo rows.

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
