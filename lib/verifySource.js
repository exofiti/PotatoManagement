'use strict';

const fs = require('fs');
const path = require('path');

// PotatoVerify 사용자 데이터 소스.
// VERIFY_SOURCE_TYPE 로 'json' 또는 'sqlite' 를 토글한다. (기본: 'none')
//
// 필드명은 서버 환경에 맞게 env로 조정할 수 있다:
//   VERIFY_FIELD_DISCORD  (기본: discordId)
//   VERIFY_FIELD_UUID     (기본: uuid)
//   VERIFY_FIELD_NAME     (기본: name)
//
// JSON:   VERIFY_JSON_PATH   + (선택) VERIFY_JSON_ROOT (기본: users)
// SQLite: VERIFY_SQLITE_PATH + (선택) VERIFY_SQLITE_TABLE (기본: users)

function sourceType(env = process.env) {
    const t = (env.VERIFY_SOURCE_TYPE || 'none').trim().toLowerCase();
    return ['json', 'sqlite'].includes(t) ? t : 'none';
}

function fields(env = process.env) {
    return {
        discord: env.VERIFY_FIELD_DISCORD?.trim() || 'discordId',
        uuid: env.VERIFY_FIELD_UUID?.trim() || 'uuid',
        name: env.VERIFY_FIELD_NAME?.trim() || 'name',
    };
}

function normalizeUuid(uuid) {
    if (!uuid || typeof uuid !== 'string') return null;
    const hex = uuid.replace(/-/g, '').toLowerCase();
    if (hex.length !== 32) return uuid;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── JSON ────────────────────────────────────────────────────────────
function readJsonUsers(env = process.env) {
    const filePath = env.VERIFY_JSON_PATH?.trim();
    if (!filePath) return [];
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) return [];
    const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const rootKey = env.VERIFY_JSON_ROOT?.trim() || 'users';
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw[rootKey])) return raw[rootKey];
    // { "<discordId>": { uuid, name } } 형태도 지원한다.
    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([key, value]) => ({ discordId: key, ...value }));
    }
    return [];
}

function lookupJsonByDiscordId(discordId, env = process.env) {
    const f = fields(env);
    const user = readJsonUsers(env).find(u => String(u[f.discord]) === String(discordId));
    if (!user) return null;
    return { uuid: normalizeUuid(user[f.uuid]), name: user[f.name] || null };
}

function lookupJsonByName(name, env = process.env) {
    const f = fields(env);
    const user = readJsonUsers(env).find(
        u => (u[f.name] || '').toLowerCase() === name.toLowerCase()
    );
    if (!user) return null;
    return { discordUserId: user[f.discord] ? String(user[f.discord]) : null, uuid: normalizeUuid(user[f.uuid]) };
}

function lookupJsonByUuid(uuid, env = process.env) {
    const f = fields(env);
    const target = (uuid || '').replace(/-/g, '').toLowerCase();
    const user = readJsonUsers(env).find(
        u => (u[f.uuid] || '').replace(/-/g, '').toLowerCase() === target
    );
    if (!user) return null;
    return { discordUserId: user[f.discord] ? String(user[f.discord]) : null };
}

// ── SQLite ──────────────────────────────────────────────────────────
let verifyDb = null;
function getVerifyDb(env = process.env) {
    if (verifyDb) return verifyDb;
    const filePath = env.VERIFY_SQLITE_PATH?.trim();
    if (!filePath) return null;
    const Database = require('better-sqlite3');
    verifyDb = new Database(filePath, { readonly: true, fileMustExist: true });
    return verifyDb;
}

function verifyTable(env = process.env) {
    return (env.VERIFY_SQLITE_TABLE?.trim() || 'users').replace(/[^A-Za-z0-9_]/g, '');
}

function lookupSqliteByDiscordId(discordId, env = process.env) {
    const db = getVerifyDb(env);
    if (!db) return null;
    const f = fields(env);
    const row = db.prepare(
        `SELECT "${f.uuid}" AS uuid, "${f.name}" AS name FROM "${verifyTable(env)}" WHERE "${f.discord}" = ? LIMIT 1`
    ).get(String(discordId));
    if (!row) return null;
    return { uuid: normalizeUuid(row.uuid), name: row.name || null };
}

function lookupSqliteByName(name, env = process.env) {
    const db = getVerifyDb(env);
    if (!db) return null;
    const f = fields(env);
    const row = db.prepare(
        `SELECT "${f.discord}" AS discord, "${f.uuid}" AS uuid FROM "${verifyTable(env)}" WHERE LOWER("${f.name}") = LOWER(?) LIMIT 1`
    ).get(name);
    if (!row) return null;
    return { discordUserId: row.discord ? String(row.discord) : null, uuid: normalizeUuid(row.uuid) };
}

function lookupSqliteByUuid(uuid, env = process.env) {
    const db = getVerifyDb(env);
    if (!db) return null;
    const f = fields(env);
    const row = db.prepare(
        `SELECT "${f.discord}" AS discord FROM "${verifyTable(env)}" WHERE REPLACE(LOWER("${f.uuid}"),'-','') = ? LIMIT 1`
    ).get((uuid || '').replace(/-/g, '').toLowerCase());
    if (!row) return null;
    return { discordUserId: row.discord ? String(row.discord) : null };
}

// ── 공통 인터페이스 ─────────────────────────────────────────────────
function verifyConfigured(env = process.env) {
    const t = sourceType(env);
    if (t === 'json') return Boolean(env.VERIFY_JSON_PATH?.trim());
    if (t === 'sqlite') return Boolean(env.VERIFY_SQLITE_PATH?.trim());
    return false;
}

function lookupByDiscordId(discordId, env = process.env) {
    if (!verifyConfigured(env)) return null;
    return sourceType(env) === 'json'
        ? lookupJsonByDiscordId(discordId, env)
        : lookupSqliteByDiscordId(discordId, env);
}

function lookupByName(name, env = process.env) {
    if (!verifyConfigured(env)) return null;
    return sourceType(env) === 'json'
        ? lookupJsonByName(name, env)
        : lookupSqliteByName(name, env);
}

function lookupByUuid(uuid, env = process.env) {
    if (!verifyConfigured(env)) return null;
    return sourceType(env) === 'json'
        ? lookupJsonByUuid(uuid, env)
        : lookupSqliteByUuid(uuid, env);
}

function closeVerifyDb() {
    if (verifyDb) {
        verifyDb.close();
        verifyDb = null;
    }
}

module.exports = {
    sourceType,
    normalizeUuid,
    verifyConfigured,
    lookupByDiscordId,
    lookupByName,
    lookupByUuid,
    closeVerifyDb,
};
