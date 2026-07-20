'use strict';

const { toDashedUuid, uuidToName, nameToProfile } = require('./mojang');
const { getAccountLink, getAccountLinkByName, upsertAccountLink } = require('../db');

// DiscordSRV MySQL 연동을 사용할지 여부.
function discordSrvConfigured(env = process.env) {
    return Boolean(env.DISCORDSRV_DB_HOST && env.DISCORDSRV_DB_NAME && env.DISCORDSRV_DB_USER);
}

let pool = null;
function getPool(env = process.env) {
    if (pool) return pool;
    // mysql2는 DiscordSRV 연동을 쓸 때만 필요하므로 지연 로딩한다.
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
        host: env.DISCORDSRV_DB_HOST,
        port: env.DISCORDSRV_DB_PORT ? Number(env.DISCORDSRV_DB_PORT) : 3306,
        user: env.DISCORDSRV_DB_USER,
        password: env.DISCORDSRV_DB_PASSWORD || '',
        database: env.DISCORDSRV_DB_NAME,
        waitForConnections: true,
        connectionLimit: 3,
        namedPlaceholders: true,
    });
    return pool;
}

function tableName(env = process.env) {
    return env.DISCORDSRV_ACCOUNTS_TABLE?.trim() || 'discordsrv_accounts';
}

async function queryDiscordSrvByDiscordId(discordId, env = process.env) {
    if (!discordSrvConfigured(env)) return null;
    const [rows] = await getPool(env).query(
        `SELECT uuid FROM \`${tableName(env)}\` WHERE discord = :discord LIMIT 1`,
        { discord: discordId }
    );
    if (!rows.length) return null;
    return toDashedUuid(rows[0].uuid);
}

async function queryDiscordSrvByUuid(uuid, env = process.env) {
    if (!discordSrvConfigured(env)) return null;
    const hexDashed = toDashedUuid(uuid);
    const [rows] = await getPool(env).query(
        `SELECT discord FROM \`${tableName(env)}\` WHERE REPLACE(LOWER(uuid),'-','') = :uuid LIMIT 1`,
        { uuid: (uuid || '').replace(/-/g, '').toLowerCase() }
    );
    if (!rows.length) return hexDashed ? null : null;
    return rows[0].discord || null;
}

// 디스코드 ID -> { discordUserId, uuid, name, source }
// 우선순위: 봇 로컬 매핑(account_links) -> DiscordSRV MySQL -> null
async function resolveByDiscordId(discordId, env = process.env) {
    const local = getAccountLink(discordId);
    if (local?.minecraft_uuid || local?.minecraft_name) {
        return {
            discordUserId: discordId,
            uuid: local.minecraft_uuid || null,
            name: local.minecraft_name || (local.minecraft_uuid ? await safeUuidToName(local.minecraft_uuid) : null),
            source: 'local',
        };
    }

    const uuid = await queryDiscordSrvByDiscordId(discordId, env);
    if (!uuid) return null;
    const name = await safeUuidToName(uuid);
    // 캐시로 로컬에도 저장해 다음 조회를 빠르게 한다.
    upsertAccountLink({ discordUserId: discordId, minecraftUuid: uuid, minecraftName: name });
    return { discordUserId: discordId, uuid, name, source: 'discordsrv' };
}

// 마크 닉네임 -> { discordUserId, uuid, name }
async function resolveByName(name, env = process.env) {
    const local = getAccountLinkByName(name);
    let uuid = local?.minecraft_uuid || null;
    let discordUserId = local?.discord_user_id || null;

    if (!uuid) {
        const profile = await nameToProfile(name).catch(() => null);
        uuid = profile?.uuid || null;
    }
    if (!discordUserId && uuid) {
        discordUserId = await queryDiscordSrvByUuid(uuid, env).catch(() => null);
    }
    return { discordUserId, uuid, name };
}

async function safeUuidToName(uuid) {
    try {
        return await uuidToName(uuid);
    } catch {
        return null;
    }
}

async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    discordSrvConfigured,
    resolveByDiscordId,
    resolveByName,
    closePool,
};
