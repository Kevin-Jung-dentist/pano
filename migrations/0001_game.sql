PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS game_users(
 id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, nickname TEXT, nickname_key TEXT UNIQUE,
 country TEXT, university TEXT, university_key TEXT, consent_version TEXT, consent_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES game_users(id),expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS game_oauth(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS game_cases(
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL UNIQUE, object_key TEXT NOT NULL UNIQUE,
 width INTEGER NOT NULL,height INTEGER NOT NULL,scope_json TEXT NOT NULL,
 reference_json TEXT,reference_version TEXT,explanation TEXT,
 attribution TEXT NOT NULL,license TEXT NOT NULL,source TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('verified','unscored')),active INTEGER NOT NULL DEFAULT 1,
 quality_reviewed_by TEXT,created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_rounds(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES game_users(id),state TEXT NOT NULL DEFAULT 'active',
 scored_target INTEGER NOT NULL,total_target INTEGER NOT NULL,rule_version TEXT NOT NULL,
 country TEXT NOT NULL,university TEXT NOT NULL,university_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS game_one_active_round ON game_rounds(user_id) WHERE state='active';
CREATE TABLE IF NOT EXISTS game_round_cases(
 round_id TEXT NOT NULL REFERENCES game_rounds(id),case_id TEXT NOT NULL REFERENCES game_cases(id),user_id TEXT NOT NULL,
 position INTEGER NOT NULL,kind TEXT NOT NULL,reference_json TEXT,reference_version TEXT,explanation TEXT,
 draft_json TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 0,submission_json TEXT,submitted_at INTEGER,
 grade_json TEXT,points INTEGER,PRIMARY KEY(round_id,case_id),UNIQUE(round_id,position),UNIQUE(user_id,case_id)
);
CREATE TABLE IF NOT EXISTS game_claims(case_id TEXT NOT NULL,slot INTEGER NOT NULL,round_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(case_id,slot));
CREATE INDEX IF NOT EXISTS game_round_owner ON game_rounds(user_id,created_at);
CREATE INDEX IF NOT EXISTS game_round_scores ON game_round_cases(round_id,submitted_at);
CREATE INDEX IF NOT EXISTS game_session_expiry ON game_sessions(expires_at);
CREATE INDEX IF NOT EXISTS game_oauth_expiry ON game_oauth(expires_at);
