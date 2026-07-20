const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = process.env.DONATIONS_DB_PATH || path.join(__dirname, 'donations.db');
const db = new Database(dbPath);

db.exec(`
    CREATE TABLE IF NOT EXISTS donations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT NOT NULL,
        amount INTEGER NOT NULL,
        title TEXT NOT NULL,
        group_name TEXT NOT NULL,
        discord_user_id TEXT,
        discord_user_tag TEXT,
        donor_user_id TEXT,
        donor_user_tag TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
`);

const columns = new Set(db.prepare('PRAGMA table_info(donations)').all().map(column => column.name));
if (!columns.has('donor_user_id')) db.exec('ALTER TABLE donations ADD COLUMN donor_user_id TEXT');
if (!columns.has('donor_user_tag')) db.exec('ALTER TABLE donations ADD COLUMN donor_user_tag TEXT');

db.exec(`CREATE INDEX IF NOT EXISTS idx_donations_nickname ON donations(nickname)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season TEXT NOT NULL,
        discord_user_id TEXT,
        minecraft_uuid TEXT,
        minecraft_name TEXT,
        severity TEXT NOT NULL,
        reason TEXT NOT NULL,
        admin_user_id TEXT,
        admin_user_tag TEXT,
        source TEXT NOT NULL DEFAULT 'command',
        punished_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        dedupe_key TEXT UNIQUE
    )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_punishments_season ON punishments(season)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_punishments_discord ON punishments(discord_user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_punishments_uuid ON punishments(minecraft_uuid)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_punishments_name ON punishments(minecraft_name)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS account_links (
        discord_user_id TEXT PRIMARY KEY,
        minecraft_uuid TEXT,
        minecraft_name TEXT,
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_account_links_name ON account_links(minecraft_name)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_account_links_uuid ON account_links(minecraft_uuid)`);

const insertStmt = db.prepare(`
    INSERT INTO donations (
        nickname, amount, title, group_name,
        discord_user_id, discord_user_tag, donor_user_id, donor_user_tag
    ) VALUES (
        @nickname, @amount, @title, @group_name,
        @processor_user_id, @processor_user_tag, @donor_user_id, @donor_user_tag
    )
`);

function logDonation({
    nickname, amount, title, group,
    donorUserId, donorUserTag, processorUserId, processorUserTag,
}) {
    return insertStmt.run({
        nickname,
        amount,
        title,
        group_name: group,
        processor_user_id: processorUserId ?? null,
        processor_user_tag: processorUserTag ?? null,
        donor_user_id: donorUserId ?? null,
        donor_user_tag: donorUserTag ?? null,
    });
}

function getDonationsByNickname(nickname, limit = 10) {
    return db.prepare(`
        SELECT * FROM donations
        WHERE nickname = ?
        ORDER BY id DESC
        LIMIT ?
    `).all(nickname, limit);
}

function getRecentDonations(limit = 10) {
    return db.prepare(`
        SELECT * FROM donations
        ORDER BY id DESC
        LIMIT ?
    `).all(limit);
}

function getDonationSummary(nickname) {
    return db.prepare(`
        SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
        FROM donations
        WHERE nickname = ?
    `).get(nickname);
}

// ---------------------------------------------------------------------------
// 처벌 관리
// ---------------------------------------------------------------------------

function buildDedupeKey({ season, minecraftName, severity, reason, punishedAt }) {
    return crypto
        .createHash('sha1')
        .update([season, (minecraftName || '').toLowerCase(), severity, reason, punishedAt || ''].join('|'))
        .digest('hex');
}

const insertPunishmentStmt = db.prepare(`
    INSERT INTO punishments (
        season, discord_user_id, minecraft_uuid, minecraft_name,
        severity, reason, admin_user_id, admin_user_tag,
        source, punished_at, dedupe_key
    ) VALUES (
        @season, @discord_user_id, @minecraft_uuid, @minecraft_name,
        @severity, @reason, @admin_user_id, @admin_user_tag,
        @source, @punished_at, @dedupe_key
    )
`);

const insertPunishmentIgnoreStmt = db.prepare(`
    INSERT OR IGNORE INTO punishments (
        season, discord_user_id, minecraft_uuid, minecraft_name,
        severity, reason, admin_user_id, admin_user_tag,
        source, punished_at, dedupe_key
    ) VALUES (
        @season, @discord_user_id, @minecraft_uuid, @minecraft_name,
        @severity, @reason, @admin_user_id, @admin_user_tag,
        @source, @punished_at, @dedupe_key
    )
`);

function normalizePunishment(record, source) {
    const season = record.season;
    const minecraftName = record.minecraftName ?? null;
    const severity = record.severity;
    const reason = record.reason;
    const punishedAt = record.punishedAt ?? null;
    return {
        season,
        discord_user_id: record.discordUserId ?? null,
        minecraft_uuid: record.minecraftUuid ?? null,
        minecraft_name: minecraftName,
        severity,
        reason,
        admin_user_id: record.adminUserId ?? null,
        admin_user_tag: record.adminUserTag ?? null,
        source,
        punished_at: punishedAt,
        dedupe_key: record.dedupeKey ?? buildDedupeKey({ season, minecraftName, severity, reason, punishedAt }),
    };
}

// 슬래시 명령으로 새 처벌을 기록한다.
function logPunishment(record) {
    return insertPunishmentStmt.run(normalizePunishment(record, record.source || 'command'));
}

// 채널 로그 가져오기 등 대량 삽입 시 중복(dedupe_key)은 건너뛴다.
function importPunishment(record) {
    const result = insertPunishmentIgnoreStmt.run(normalizePunishment(record, record.source || 'import'));
    return result.changes > 0;
}

function importPunishments(records) {
    const run = db.transaction(items => {
        let inserted = 0;
        for (const item of items) {
            if (importPunishment(item)) inserted += 1;
        }
        return inserted;
    });
    return run(records);
}

function getPunishments({ season, discordUserId, minecraftUuid, minecraftName, limit = 15 } = {}) {
    const clauses = [];
    const params = [];
    if (season) {
        clauses.push('season = ?');
        params.push(season);
    }
    if (discordUserId) {
        clauses.push('discord_user_id = ?');
        params.push(discordUserId);
    }
    if (minecraftUuid) {
        clauses.push('minecraft_uuid = ?');
        params.push(minecraftUuid);
    }
    if (minecraftName) {
        clauses.push('LOWER(minecraft_name) = LOWER(?)');
        params.push(minecraftName);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    return db.prepare(`
        SELECT * FROM punishments
        ${where}
        ORDER BY COALESCE(punished_at, created_at) DESC, id DESC
        LIMIT ?
    `).all(...params);
}

// 디스코드 ID 또는 UUID 기준 통계. season을 주면 해당 시즌만.
function getPunishmentSummary({ discordUserId, minecraftUuid, minecraftName, season } = {}) {
    const clauses = [];
    const params = [];
    if (discordUserId) {
        clauses.push('discord_user_id = ?');
        params.push(discordUserId);
    }
    if (minecraftUuid) {
        clauses.push('minecraft_uuid = ?');
        params.push(minecraftUuid);
    }
    if (minecraftName) {
        clauses.push('LOWER(minecraft_name) = LOWER(?)');
        params.push(minecraftName);
    }
    if (season) {
        clauses.push('season = ?');
        params.push(season);
    }
    if (clauses.length === 0) return { count: 0 };
    return db.prepare(`
        SELECT COUNT(*) AS count
        FROM punishments
        WHERE ${clauses.join(' AND ')}
    `).get(...params);
}

// ---------------------------------------------------------------------------
// 계정 연동 (DiscordSRV 보조 매핑)
// ---------------------------------------------------------------------------

const upsertAccountLinkStmt = db.prepare(`
    INSERT INTO account_links (discord_user_id, minecraft_uuid, minecraft_name, updated_at)
    VALUES (@discord_user_id, @minecraft_uuid, @minecraft_name, datetime('now', 'localtime'))
    ON CONFLICT(discord_user_id) DO UPDATE SET
        minecraft_uuid = excluded.minecraft_uuid,
        minecraft_name = excluded.minecraft_name,
        updated_at = excluded.updated_at
`);

function upsertAccountLink({ discordUserId, minecraftUuid, minecraftName }) {
    return upsertAccountLinkStmt.run({
        discord_user_id: discordUserId,
        minecraft_uuid: minecraftUuid ?? null,
        minecraft_name: minecraftName ?? null,
    });
}

function getAccountLink(discordUserId) {
    return db.prepare('SELECT * FROM account_links WHERE discord_user_id = ?').get(discordUserId) || null;
}

function getAccountLinkByName(minecraftName) {
    return db.prepare('SELECT * FROM account_links WHERE LOWER(minecraft_name) = LOWER(?)').get(minecraftName) || null;
}

module.exports = {
    logDonation,
    getDonationsByNickname,
    getRecentDonations,
    getDonationSummary,
    buildDedupeKey,
    logPunishment,
    importPunishment,
    importPunishments,
    getPunishments,
    getPunishmentSummary,
    upsertAccountLink,
    getAccountLink,
    getAccountLinkByName,
};
