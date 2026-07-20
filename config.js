'use strict';

require('dotenv').config();

const requiredVariables = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_COMMAND_CHANNEL_ID'];

function loadConfig(env = process.env) {
    const missing = requiredVariables.filter(name => !env[name]?.trim());
    if (missing.length > 0) {
        throw new Error(`필수 환경변수가 없습니다: ${missing.join(', ')}`);
    }

    return {
        token: env.DISCORD_TOKEN.trim(),
        clientId: env.DISCORD_CLIENT_ID.trim(),
        guildId: env.DISCORD_GUILD_ID?.trim() || null,
        commandChannelId: env.DISCORD_COMMAND_CHANNEL_ID.trim(),
        logChannelId: env.DISCORD_LOG_CHANNEL_ID?.trim() || null,
        currentSeason: env.CURRENT_SEASON?.trim() || 'S1',
        punishmentLogChannelId: env.DISCORD_PUNISHMENT_LOG_CHANNEL_ID?.trim() || null,
        allowedRoleIds: new Set(
            (env.DISCORD_ALLOWED_ROLE_IDS || '')
                .split(',')
                .map(id => id.trim())
                .filter(Boolean)
        ),
    };
}

module.exports = { loadConfig };
