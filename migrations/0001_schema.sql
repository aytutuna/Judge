CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE account_devices (
    user_id     TEXT NOT NULL,
    device_id   TEXT NOT NULL,
    platform    TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
    country     TEXT,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    PRIMARY KEY (user_id, device_id)
  );

CREATE TABLE case_appeals (
    id              TEXT PRIMARY KEY,
    case_id         TEXT NOT NULL,
    party           TEXT NOT NULL CHECK (party IN ('a','b','c','d')),
    user_id         TEXT,
    text            TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('judging','judged','failed')),
    error           TEXT CHECK (error IN ('quota','unavailable','refused')),
    reservation_id  TEXT NOT NULL,
    attempt_token   TEXT NOT NULL,
    base_seq        INTEGER NOT NULL,
    result_seq      INTEGER,
    outcome         TEXT CHECK (outcome IN ('upheld','overturned','changed')),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (case_id, party)
  );

CREATE TABLE case_evidence (
    id          TEXT PRIMARY KEY,
    case_id     TEXT NOT NULL,
    party       TEXT NOT NULL CHECK (party IN ('a','b','c','d')),
    appeal_id   TEXT,
    seq         INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('chat','document','photo','other')),
    transcript  TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

CREATE TABLE case_invites (
    case_id         TEXT NOT NULL,
    party           TEXT NOT NULL CHECK (party IN ('c','d')),
    invite_nonce    TEXT NOT NULL,
    invite_hash     TEXT NOT NULL UNIQUE,
    respondent_idem TEXT,
    user_id         TEXT,
    claim_nonce     TEXT,
    answered_at     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (case_id, party)
  );

CREATE TABLE case_people (
    case_id   TEXT NOT NULL,
    name_key  TEXT NOT NULL,
    label     TEXT NOT NULL,
    PRIMARY KEY (case_id, name_key)
  );

CREATE TABLE case_retired_links (
    invite_hash TEXT PRIMARY KEY,
    case_id     TEXT NOT NULL
  );

CREATE TABLE case_seats (
    case_id    TEXT NOT NULL,
    party      TEXT NOT NULL CHECK (party IN ('b','c','d')),
    nonce      TEXT NOT NULL,
    user_id    TEXT,
    opened_at  TEXT NOT NULL,
    typing_at  TEXT,
    seen_at    TEXT,
    PRIMARY KEY (case_id, party)
  );

CREATE TABLE case_side_attest (
    case_id              TEXT NOT NULL,
    party                TEXT NOT NULL CHECK (party IN ('a','b','c','d')),
    adult_confirmed_at   TEXT NOT NULL,
    sensitive_agreed_at  TEXT NOT NULL,
    PRIMARY KEY (case_id, party)
  );

CREATE TABLE case_sides (
    case_id       TEXT NOT NULL,
    party         TEXT NOT NULL CHECK (party IN ('a','b','c','d')),
    text          TEXT NOT NULL,
    submitted_at  TEXT NOT NULL,
    PRIMARY KEY (case_id, party)
  );

CREATE TABLE case_verdicts (
    case_id     TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    verdict_id  TEXT NOT NULL UNIQUE,
    appeal_id   TEXT,
    mode        TEXT NOT NULL CHECK (mode IN ('two_sided','one_sided')),
    created_at  TEXT NOT NULL,
    PRIMARY KEY (case_id, seq)
  );

CREATE TABLE cases (
    id                  TEXT PRIMARY KEY,
    owner_id            TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN
                          ('awaiting_respondent','judging','judged','failed','expired')),
    mode                TEXT CHECK (mode IN ('two_sided','one_sided')),
    framework           TEXT NOT NULL,
    lang                TEXT NOT NULL,
    invite_nonce        TEXT NOT NULL,
    invite_hash         TEXT NOT NULL UNIQUE,
    idempotency_key     TEXT,
    reservation_id      TEXT,
    judging_token       TEXT,
    judging_started_at  TEXT,
    respondent_idem     TEXT,
    respondent_user_id  TEXT,
    respondent_claim_nonce TEXT,
    attempts            INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT CHECK (last_error IN ('quota','unavailable')),
    owner_notified      INTEGER NOT NULL DEFAULT 0,
    expires_at          TEXT NOT NULL,
    judged_at           TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  , names_visible INTEGER NOT NULL DEFAULT 1, display_a_sealed TEXT, display_b_sealed TEXT, display_key_id TEXT, removed_at TEXT, removed_a_at TEXT, removed_b_at TEXT, tier TEXT NOT NULL DEFAULT 'premium' CHECK (tier IN ('free','premium')), sides INTEGER NOT NULL DEFAULT 2 CHECK (sides BETWEEN 2 AND 4), display_c_sealed TEXT, display_d_sealed TEXT, removed_c_at TEXT, removed_d_at TEXT, venue TEXT, erased_at TEXT, legal_hold INTEGER NOT NULL DEFAULT 0);

CREATE TABLE consent_ledger (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    choice          TEXT NOT NULL CHECK (choice IN ('on','off')),
    source          TEXT NOT NULL CHECK (source IN ('card','switch')),
    at              TEXT NOT NULL,
    policy_version  TEXT NOT NULL,
    wording_key     TEXT NOT NULL,
    wording_text    TEXT NOT NULL,
    lang            TEXT NOT NULL DEFAULT 'en',
    platform        TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
    kind            TEXT NOT NULL DEFAULT 'training',
    unlinked_at     TEXT
  );

CREATE TABLE consent_state (
    user_id         TEXT PRIMARY KEY,
    choice          TEXT NOT NULL CHECK (choice IN ('on','off')),
    asked_at        TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    policy_version  TEXT NOT NULL
  );

CREATE TABLE entitlement_accounts (
    user_id     TEXT PRIMARY KEY,
    credits     INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    updated_at  TEXT NOT NULL
  );

CREATE TABLE entitlement_grants (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    source          TEXT NOT NULL,
    external_id     TEXT NOT NULL,
    kind            TEXT NOT NULL,
    product_id      TEXT,
    credits_delta   INTEGER NOT NULL DEFAULT 0,
    subscription_id TEXT,
    ref_external_id TEXT,
    note            TEXT,
    created_at      TEXT NOT NULL,
    environment     TEXT,
    UNIQUE (source, external_id)
  );

CREATE TABLE events (
    id            INTEGER PRIMARY KEY,
    at            INTEGER NOT NULL,
    user_id       TEXT,
    anon_id       TEXT,
    device_id     TEXT,
    platform      TEXT NOT NULL CHECK (platform IN ('ios','android','web','server')),
    app_version   TEXT,
    os_version    TEXT,
    device_model  TEXT,
    country       TEXT CHECK (country IS NULL OR length(country) = 2),
    locale        TEXT,
    name          TEXT NOT NULL CHECK (length(name) <= 64),
    props         TEXT CHECK (props IS NULL OR length(props) <= 2048)
  );

CREATE TABLE free_device_claims (
    device_key  TEXT NOT NULL,
    day         TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    confirmed   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (device_key, day)
  );

CREATE TABLE originals (
    subject     TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('verdict','side','appeal')),
    verdict_id  TEXT,
    case_id     TEXT,
    party       TEXT CHECK (party IN ('a','b','c','d')),
    sealed      TEXT,
    key_id      TEXT,
    removed_at  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

CREATE TABLE premium_usage (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    idempotency_key     TEXT,
    funded_by           TEXT NOT NULL,
    subscription_id     TEXT,
    sub_period_end      TEXT,
    status              TEXT NOT NULL,
    verdict_id          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  , hold_until TEXT, body_hash TEXT);

CREATE TABLE refund_tombstones (
    source          TEXT NOT NULL,
    transaction_id  TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (source, transaction_id)
  );

CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

CREATE TABLE signin_tokens (
  user_id     TEXT NOT NULL,
  provider    TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  sealed      TEXT NOT NULL,
  key_id      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, provider, client_id)
);

CREATE TABLE subscriptions (
    id                      TEXT PRIMARY KEY,
    user_id                 TEXT NOT NULL,
    source                  TEXT NOT NULL,
    original_transaction_id TEXT NOT NULL,
    product_id              TEXT NOT NULL,
    status                  TEXT NOT NULL,
    period_start            TEXT NOT NULL,
    period_end              TEXT NOT NULL,
    will_renew              INTEGER NOT NULL DEFAULT 0,
    cap                     INTEGER NOT NULL,
    used_in_period          INTEGER NOT NULL DEFAULT 0,
    updated_at              TEXT NOT NULL,
    UNIQUE (source, original_transaction_id)
  );

CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "age_confirmed_at" date, "age_source" text, "age_blocked_at" date, "age_block_final" text, "age_block_final_at" date, "age_dob" text, "age_dob_at" date, "age_signal" text, "age_signal_at" date);

CREATE TABLE verdict_appeals (
    id          TEXT PRIMARY KEY,
    verdict_id  TEXT NOT NULL,
    text        TEXT NOT NULL,
    evidence    TEXT NOT NULL DEFAULT '[]',
    base_id     TEXT NOT NULL,
    outcome     TEXT CHECK (outcome IN ('upheld','overturned','changed')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

CREATE TABLE verdict_jobs (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('free','premium')),
    status          TEXT NOT NULL CHECK (status IN ('judging','ready','failed')),
    error_code      TEXT CHECK (error_code IN ('quota','unavailable','refused')),
    reservation_id  TEXT,
    owner_user_id   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

CREATE TABLE verdict_meta (
    verdict_id        TEXT PRIMARY KEY,
    kind              TEXT NOT NULL CHECK (kind IN ('free','premium','case','legacy')),
    owner_user_id     TEXT,
    owner_token_hash  TEXT,
    case_id           TEXT,
    names_visible     INTEGER NOT NULL DEFAULT 1,
    display_sealed    TEXT,
    display_key_id    TEXT,
    names_confirmed_at TEXT,
    removed_at        TEXT,
    removal_reason    TEXT CHECK (removal_reason IN ('owner','party_a','party_b','party_c','party_d','account_deleted','operator')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  , training_ok_at TEXT, training_withdrawn_at TEXT, policy_version TEXT, lang TEXT, sides INTEGER);

CREATE TABLE verdict_ratings (
    verdict_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    rating      TEXT CHECK (rating IN ('up','down')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    training_ok_at         TEXT,
    training_withdrawn_at  TEXT,
    PRIMARY KEY (verdict_id, user_id)
  );

CREATE TABLE verdict_translations (
    id TEXT NOT NULL,
    lang TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, lang)
  );

CREATE TABLE verdicts (
    id TEXT PRIMARY KEY,
    input TEXT NOT NULL,
    framework TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  , venue TEXT, erased_at TEXT, legal_hold INTEGER NOT NULL DEFAULT 0);

CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE welcome_claims (
    claim           TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    age_blocked_at  TEXT,
    age_block_final TEXT
  );

CREATE INDEX account_devices_device ON account_devices (device_id);

CREATE INDEX "account_userId_idx" on "account" ("userId");

CREATE INDEX case_appeals_status ON case_appeals (status, updated_at);

CREATE INDEX case_evidence_case ON case_evidence (case_id, party, appeal_id, seq);

CREATE INDEX case_invites_user ON case_invites (user_id) WHERE user_id IS NOT NULL;

CREATE INDEX case_seats_user ON case_seats (user_id) WHERE user_id IS NOT NULL;

CREATE INDEX cases_owner ON cases (owner_id, created_at);

CREATE UNIQUE INDEX cases_owner_idem ON cases (owner_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX cases_respondent ON cases (respondent_user_id)
    WHERE respondent_user_id IS NOT NULL;

CREATE INDEX cases_status_expires ON cases (status, expires_at);

CREATE INDEX cases_status_started ON cases (status, judging_started_at);

CREATE INDEX consent_ledger_user ON consent_ledger (user_id, id);

CREATE INDEX entitlement_grants_user ON entitlement_grants (user_id, created_at);

CREATE INDEX events_at ON events (at);

CREATE INDEX events_user ON events (user_id, at) WHERE user_id IS NOT NULL;

CREATE INDEX originals_case ON originals (case_id, party) WHERE case_id IS NOT NULL;

CREATE INDEX originals_verdict ON originals (verdict_id) WHERE verdict_id IS NOT NULL;

CREATE INDEX premium_usage_created ON premium_usage (created_at);

CREATE UNIQUE INDEX premium_usage_idem ON premium_usage (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX premium_usage_user ON premium_usage (user_id, status, created_at);

CREATE INDEX "session_userId_idx" on "session" ("userId");

CREATE INDEX subscriptions_user ON subscriptions (user_id, status, period_end);

CREATE INDEX verdict_appeals_verdict ON verdict_appeals (verdict_id, created_at);

CREATE INDEX verdict_jobs_judging ON verdict_jobs (created_at) WHERE status = 'judging';

CREATE INDEX verdict_jobs_owner ON verdict_jobs (owner_user_id, created_at) WHERE owner_user_id IS NOT NULL;

CREATE INDEX verdict_jobs_reservation ON verdict_jobs (reservation_id) WHERE reservation_id IS NOT NULL;

CREATE INDEX verdict_meta_case ON verdict_meta (case_id) WHERE case_id IS NOT NULL;

CREATE INDEX verdict_meta_owner ON verdict_meta (owner_user_id, created_at)
    WHERE owner_user_id IS NOT NULL;

CREATE UNIQUE INDEX verdict_meta_token ON verdict_meta (owner_token_hash)
    WHERE owner_token_hash IS NOT NULL;

CREATE INDEX "verification_identifier_idx" on "verification" ("identifier");

CREATE TRIGGER consent_ledger_guard_delete BEFORE DELETE ON consent_ledger
    WHEN OLD.unlinked_at IS NULL OR OLD.unlinked_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 years')
    BEGIN SELECT RAISE(ABORT, 'consent_ledger is append-only'); END;

CREATE TRIGGER consent_ledger_guard_update BEFORE UPDATE ON consent_ledger
    WHEN NOT (
      OLD.user_id NOT GLOB 'deleted:*' AND NEW.user_id GLOB 'deleted:*'
      AND OLD.unlinked_at IS NULL AND NEW.unlinked_at IS NOT NULL
      AND NEW.unlinked_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
      AND NEW.id IS OLD.id AND NEW.kind IS OLD.kind AND NEW.choice IS OLD.choice AND NEW.source IS OLD.source
      AND NEW.at IS OLD.at AND NEW.policy_version IS OLD.policy_version AND NEW.wording_key IS OLD.wording_key
      AND NEW.wording_text IS OLD.wording_text AND NEW.lang IS OLD.lang AND NEW.platform IS OLD.platform)
    BEGIN SELECT RAISE(ABORT, 'consent_ledger is append-only'); END;
