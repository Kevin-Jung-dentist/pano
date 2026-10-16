PRAGMA foreign_keys=ON;
CREATE TABLE game_payments(
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT REFERENCES game_users(id) ON DELETE SET NULL,
 paypal_order_id TEXT UNIQUE, capture_id TEXT UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('creating','created','pending','completed','cancelled','failed','refunded','reversed')),
 mode TEXT NOT NULL CHECK(mode IN ('sandbox','live')),
 merchant_id TEXT NOT NULL, currency TEXT NOT NULL, amount TEXT NOT NULL,
 create_request_id TEXT NOT NULL UNIQUE, capture_request_id TEXT NOT NULL UNIQUE,
 approval_url TEXT, terms_version TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX game_one_open_payment ON game_payments(user_id) WHERE status IN ('creating','created','pending');
CREATE INDEX game_payment_owner ON game_payments(user_id,created_at);
CREATE TABLE game_payment_uses(
 order_id TEXT PRIMARY KEY NOT NULL REFERENCES game_payments(id),
 round_id TEXT UNIQUE REFERENCES game_rounds(id) ON DELETE SET NULL,
 used_at INTEGER NOT NULL
);
CREATE TABLE game_payment_events(
 id TEXT PRIMARY KEY NOT NULL,order_id TEXT NOT NULL REFERENCES game_payments(id),
 event_type TEXT NOT NULL,processed_at INTEGER NOT NULL
);

-- Keep an unpaid checkout and a newly allocated set mutually exclusive, even across tabs.
CREATE TRIGGER game_payment_requires_idle BEFORE INSERT ON game_payments
WHEN EXISTS(SELECT 1 FROM game_rounds WHERE user_id=NEW.user_id AND state='active')
 OR EXISTS(SELECT 1 FROM game_payments p WHERE p.user_id=NEW.user_id AND p.status='completed'
 AND NOT EXISTS(SELECT 1 FROM game_payment_uses u WHERE u.order_id=p.id))
BEGIN SELECT RAISE(ABORT,'paymentFinishRound'); END;
CREATE TRIGGER game_round_requires_settled_payment BEFORE INSERT ON game_rounds
WHEN EXISTS(SELECT 1 FROM game_payments WHERE user_id=NEW.user_id AND status IN ('creating','created','pending'))
BEGIN SELECT RAISE(ABORT,'paymentResolveFirst'); END;
