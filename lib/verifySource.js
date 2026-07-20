'use strict';

const fs = require('fs');
const path = require('path');

// PotatoVerify 사용자 데이터 소스.
// VERIFY_SOURCE_TYPE 로 'json' 또는 'sqlite' 를 토글한다. (기본: 'none')
//
// PotatoVerify 는 2026-07 커밋에서 데이터를 SQLite 로 이전했다. 실제 스키마:
//   CREATE TABLE users (
//     mc_uuid TEXT PRIMARY KEY,          -- 하이픈 없는 소문자 32자
//     discord_id TEXT NOT NULL UNIQUE,
//     first_verified_at TEXT NOT NULL,
//     last_verified_at TEXT NOT NULL
//   )
// 파일 기본 경로는 user-data.sqlite (DATABASE_PATH 로 변경) 이며 닉네임 컬럼은 없다.
// 닉네임은 accounts.js 가 Mojang API(UUID->이름)로 보완한다.
//
// 필드명은 서버 환경에 맞게 env로 조정할 수 있다:
//   VERIFY_FIELD_DISCORD  (기본: discord_id)
//   VERIFY_FIELD_UUID     (기본: mc_uuid)
//   VERIFY_FIELD_NAME     (기본: 없음 — 닉네임 컬럼이 있으면 지정)
//
// JSON:   VERIFY_JSON_PATH   + (선택) VERIFY_JSON_ROOT (기본: users)
// SQLite: VERIFY_SQLITE_PATH + (선택) VERIFY_SQLITE_TABLE (기본: users)

function sourceType(env = process.env) {
    const t = (env.VERIFY_SOURCE_TYPE || 'none').trim().toLowerCase();
    return ['json', 'sqlite'].includes(t) ? t : 'none';
}

function fields(env = process.env) {
    return {
        discord: env.VERIFY_FIELD_DISCORD?.trim() || 'discord_id',
        uuid: env.VERIFY_FIELD_UUID?.trim() || 'mc_uuid',
        // 실제 PotatoVerify 스키마에는 닉네임 컬럼이 없다. 있으면 env로 지정.
        name: env.VERIFY_FIELD_NAME?.trim() || null,
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
    // { "<discordId>": { mc_uuid } } 형태도 지원한다.
    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([key, value]) => ({ discord_id: key, ...value }));
    }
    return [];
}

function jsonGet(user, key, ...fallbacks) {
    for (const k of [key, ...fallbacks]) {
        if (k && user[k] != null) return user[k];
    }
    return null;
}

function lookupJsonByDiscordId(discordId, env = process.env) {
    const f = fields(env);
    const user = readJsonUsers(env).find(
        u => String(jsonGet(u, f.discord, 'discord_id', 'discordId', 'discord-acount')) === String(discordId)
    );
    if (!user) return null;
    const uuid = jsonGet(user, f.uuid, 'mc_uuid', 'uuid', 'minecraft-uuid');
    return { uuid: normalizeUuid(uuid), name: f.name ? user[f.name] || null : null };
}

function lookupJsonByName(name, env = process.env) {
    const f = fields(env);
    if (!f.name) return null; // 닉네임 컬럼이 없으면 JSON 이름 조회 불가
    const user = readJsonUsers(env).find(
        u => (u[f.name] || '').toLowerCase() === name.toLowerCase()
    );
    if (!user) return null;
    const discord = jsonGet(user, f.discord, 'discord_id', 'discordId', 'discord-acount');
    const uuid = jsonGet(user, f.uuid, 'mc_uuid', 'uuid', 'minecraft-uuid');
    return { discordUserId: discord ? String(discord) : null, uuid: normalizeUuid(uuid) };
}

function lookupJsonByUuid(uuid, env = process.env) {
    const f = fields(env);
    const target = (uuid || '').replace(/-/g, '').toLowerCase();
    const user = readJsonUsers(env).find(u => {
        const raw = jsonGet(u, f.uuid, 'mc_uuid', 'uuid', 'minecraft-uuid') || '';
        return raw.replace(/-/g, '').toLowerCase() === target;
    });
    if (!user) return null;
    const discord = jsonGet(user, f.discord, 'discord_id', 'discordId', 'discord-acount');
    return { discordUserId: discord ? String(discord) : null };
}

// ── SQLite ──────────────────────────────────────────────────────────
// PotatoVerify 는 Node 내장 node:sqlite 로 WAL 파일을 쓴다. 이를 읽기 위해
// node:sqlite(DatabaseSync)를 우선 사용하고, 없으면 better-sqlite3 로 폴백한다.
let verifyDb = null;
let verifyDbKind = null; // 'node' | 'better'

function getVerifyDb(env = process.env) {
    if (verifyDb) return verifyDb;
    const filePath = env.VERIFY_SQLITE_PATH?.trim();
    if (!filePath) return null;
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

    try {
        const { DatabaseSync } = require('node:sqlite');
        verifyDb = new DatabaseSync(resolved, { readOnly: true });
        verifyDbKind = 'node';
        return verifyDb;
    } catch {
        // node:sqlite 미지원(구버전 Node)일 때 better-sqlite3 로 폴백
        const Database = require('better-sqlite3');
        verifyDb = new Database(resolved, { readonly: true, fileMustExist: true });
        verifyDbKind = 'better';
        return verifyDb;
    }
}

function queryOne(db, sql, param) {
    if (verifyDbKind === 'node') {
        return db.prepare(sql).get(param) || null;
    }
    return db.prepare(sql).get(param) || null;
}

function verifyTable(env = process.env) {
    return (env.VERIFY_SQLITE_TABLE?.trim() || 'users').replace(/[^A-Za-z0-9_]/g, '');
}

function lookupSqliteByDiscordId(discordId, env = process.env) {
    const db = getVerifyDb(env);
    if (!db) return null;
    const f = fields(env);
    const table = verifyTable(env);
    const nameSelect = f.name ? `"${f.name}"` : 'NULL';
    const row = queryOne(
        db,
        `SELECT "${f.uuid}" AS uuid, ${nameSelect} AS name FROM "${table}" WHERE "${f.discord}" = ? LIMIT 1`,
        String(discordId)
    );
    if (!row) return null;
    return { uuid: normalizeUuid(row.uuid), name: row.name || null };
}

function lookupSqliteByName(name, env = process.env) {
    const db = getVerifyDb(env);
    if (!db) return null;
    const f = fields(env);
    if (!f.name) return null; // 닉네임 컬럼이 없으면 SQL 이름 조회 불가
    const table = verifyTable(env);
    const row = queryOne(
        db,
        `SELECT "${f.discord}" AS discord, "${f.uuid}" AS uuid FROM "${table}" WHERE LOWER("${f.name}") = LOWER(?) LIMIT 1`,
        name
    );
    if (!row) return null;
    return { discordUserId: row.discord ? String(row.discord) : null, uuid: normalizeUuid(row.uuid) };
}

function lookupSqliteByUuid(uuid, env = process.env) {
    const db = getVerifyDb(env);
    if (!db) return null;
    const f = fields(env);
    const table = verifyTable(env);
    const row = queryOne(
        db,
        `SELECT "${f.discord}" AS discord FROM "${table}" WHERE REPLACE(LOWER("${f.uuid}"),'-','') = ? LIMIT 1`,
        (uuid || '').replace(/-/g, '').toLowerCase()
    );
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
        verifyDbKind = null;
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
