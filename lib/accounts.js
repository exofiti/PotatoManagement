'use strict';

const { uuidToName, nameToProfile } = require('./mojang');
const { getAccountLink, getAccountLinkByName, upsertAccountLink } = require('../db');
const {
    verifyConfigured,
    lookupByDiscordId,
    lookupByName,
    lookupByUuid,
} = require('./verifySource');

async function safeUuidToName(uuid) {
    try {
        return await uuidToName(uuid);
    } catch {
        return null;
    }
}

// 디스코드 ID -> { discordUserId, uuid, name, source }
// 우선순위: PotatoVerify 데이터 -> 봇 로컬 수동 매핑(account_links) -> null
async function resolveByDiscordId(discordId, env = process.env) {
    if (verifyConfigured(env)) {
        const hit = lookupByDiscordId(discordId, env);
        if (hit && (hit.uuid || hit.name)) {
            const name = hit.name || (hit.uuid ? await safeUuidToName(hit.uuid) : null);
            // Verify 결과를 로컬에도 캐시해 다음 조회를 빠르게 한다.
            upsertAccountLink({ discordUserId: discordId, minecraftUuid: hit.uuid, minecraftName: name });
            return { discordUserId: discordId, uuid: hit.uuid || null, name, source: 'verify' };
        }
    }

    const local = getAccountLink(discordId);
    if (local?.minecraft_uuid || local?.minecraft_name) {
        return {
            discordUserId: discordId,
            uuid: local.minecraft_uuid || null,
            name: local.minecraft_name || (local.minecraft_uuid ? await safeUuidToName(local.minecraft_uuid) : null),
            source: 'local',
        };
    }

    return null;
}

// 마크 닉네임 -> { discordUserId, uuid, name }
// 우선순위: PotatoVerify 데이터 -> 봇 로컬 수동 매핑 -> Mojang(UUID만)
async function resolveByName(name, env = process.env) {
    if (verifyConfigured(env)) {
        const hit = lookupByName(name, env);
        if (hit && (hit.uuid || hit.discordUserId)) {
            return { discordUserId: hit.discordUserId || null, uuid: hit.uuid || null, name };
        }
    }

    const local = getAccountLinkByName(name);
    let uuid = local?.minecraft_uuid || null;
    let discordUserId = local?.discord_user_id || null;

    if (!uuid) {
        const profile = await nameToProfile(name).catch(() => null);
        uuid = profile?.uuid || null;
    }
    if (!discordUserId && uuid && verifyConfigured(env)) {
        const byUuid = lookupByUuid(uuid, env);
        discordUserId = byUuid?.discordUserId || null;
    }
    return { discordUserId, uuid, name };
}

module.exports = {
    verifyConfigured,
    resolveByDiscordId,
    resolveByName,
};
