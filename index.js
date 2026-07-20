'use strict';

// dotenv 는 config.js 에서 로드됩니다.
const { Client, EmbedBuilder, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('./config');
const {
    logDonation, getDonationsByNickname, getRecentDonations, getDonationSummary,
    logPunishment, importPunishments, getPunishments, getPunishmentSummary,
    upsertAccountLink,
} = require('./db');
const {
    donationGroup, isValidMinecraftName, isValidTitle, isValidReason,
} = require('./lib/validation');
const { buildCommands, listPresets, severityLabel } = require('./lib/punishments');
const { resolveByDiscordId, resolveByName } = require('./lib/accounts');
const { parseLogMessage } = require('./lib/logParser');
const { nameToProfile } = require('./lib/mojang');

const config = loadConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isAuthorized(interaction) {
    if (!interaction.inCachedGuild()) return false;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    return interaction.member.roles.cache.some(role => config.allowedRoleIds.has(role.id));
}

async function getCommandChannel() {
    const channel = await client.channels.fetch(config.commandChannelId);
    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
        throw new Error('DISCORD_COMMAND_CHANNEL_ID가 메시지를 보낼 수 있는 채널이 아닙니다.');
    }
    return channel;
}

async function sendAuditLog(message) {
    if (!config.logChannelId) {
        console.log(message);
        return;
    }

    const channel = await client.channels.fetch(config.logChannelId);
    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
        throw new Error('DISCORD_LOG_CHANNEL_ID가 메시지를 보낼 수 있는 채널이 아닙니다.');
    }
    await channel.send({ content: message, allowedMentions: { parse: [] } });
}

async function sendServerCommand(channel, command) {
    await channel.send({ content: command, allowedMentions: { parse: [] } });
}

async function reportError(interaction) {
    const message = '처리 중 오류가 발생했습니다. 로그를 확인해주세요.';
    if (interaction.deferred) await interaction.editReply(message);
    else if (interaction.replied) await interaction.followUp({ content: message, ephemeral: true });
    else await interaction.reply({ content: message, ephemeral: true });
}

client.once('ready', readyClient => {
    console.log(`${readyClient.user.tag} 관리봇 연결됨 (시즌: ${config.currentSeason})`);
});

const HANDLED_COMMANDS = ['후원', 'ban', '처분', 'whois', '처벌가져오기', '연동등록'];

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (!HANDLED_COMMANDS.includes(interaction.commandName)) return;

    try {
        if (!isAuthorized(interaction)) {
            await interaction.reply({ content: '이 명령을 실행할 권한이 없습니다.', ephemeral: true });
            return;
        }

        if (interaction.commandName === 'ban') {
            await handleBan(interaction);
            return;
        }
        if (interaction.commandName === '처분') {
            await handlePunish(interaction);
            return;
        }
        if (interaction.commandName === 'whois') {
            await handleWhois(interaction);
            return;
        }
        if (interaction.commandName === '처벌가져오기') {
            await handleImportLogs(interaction);
            return;
        }
        if (interaction.commandName === '연동등록') {
            await handleLinkAccount(interaction);
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand === '처리') await handleDonation(interaction);
        else if (subcommand === '조회') await handleLookup(interaction);
    } catch (error) {
        console.error('명령 처리 실패:', error);
        try {
            await reportError(interaction);
        } catch (reportingError) {
            console.error('오류 응답 전송 실패:', reportingError);
        }
    }
});

async function handleBan(interaction) {
    const nickname = interaction.options.getString('닉네임', true);
    const reason = interaction.options.getString('사유', true);

    if (!isValidMinecraftName(nickname)) {
        await interaction.reply({ content: 'Minecraft 닉네임은 영문, 숫자, 밑줄로 구성된 3~16자여야 합니다.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = await getCommandChannel();
    await sendServerCommand(channel, `ban ${nickname}`);
    await interaction.editReply(`${nickname}님을 밴했습니다.`);
    try {
        await sendAuditLog([
        '형량: 영구 밴',
        '처벌내용: 서버 접속 차단',
        `대상: ${nickname}`,
        `처분관리자: ${interaction.user.tag} (${interaction.user.id})`,
        `사유: ${reason}`,
        ].join('\n'));
    } catch (error) {
        console.error('밴 감사 로그 전송 실패:', error);
    }
}

async function handleDonation(interaction) {
    const nickname = interaction.options.getString('닉네임', true);
    const amount = interaction.options.getInteger('금액', true);
    const title = interaction.options.getString('칭호', true).trim();
    const donor = interaction.options.getUser('유저', true);
    const group = donationGroup(amount);

    if (!isValidMinecraftName(nickname)) {
        await interaction.reply({ content: 'Minecraft 닉네임은 영문, 숫자, 밑줄로 구성된 3~16자여야 합니다.', ephemeral: true });
        return;
    }
    if (!group) {
        await interaction.reply({ content: '최소 후원 금액은 5,000원입니다.', ephemeral: true });
        return;
    }
    if (!isValidTitle(title)) {
        await interaction.reply({ content: '칭호는 따옴표, 역슬래시, 줄바꿈을 제외한 1~32자여야 합니다.', ephemeral: true });
        return;
    }

    await interaction.deferReply();
    const channel = await getCommandChannel();
    await sendServerCommand(channel, `lp user ${nickname} parent add ${group}`);
    await sendServerCommand(channel, `lp user ${nickname} meta setsuffix "&f[${title}]"`);

    logDonation({
        nickname,
        amount,
        title,
        group,
        donorUserId: donor.id,
        donorUserTag: donor.tag,
        processorUserId: interaction.user.id,
        processorUserTag: interaction.user.tag,
    });

    const embed = new EmbedBuilder()
        .setTitle('후원 처리 완료')
        .setColor(0x57f287)
        .addFields(
            { name: '후원자', value: donor.tag, inline: true },
            { name: '닉네임', value: nickname, inline: true },
            { name: '금액', value: `${amount.toLocaleString('ko-KR')}원`, inline: true },
            { name: '등급', value: group, inline: true },
            { name: '칭호', value: title },
        )
        .setFooter({ text: `처리자: ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

async function handleLookup(interaction) {
    const nickname = interaction.options.getString('닉네임');
    if (nickname && !isValidMinecraftName(nickname)) {
        await interaction.reply({ content: 'Minecraft 닉네임 형식이 올바르지 않습니다.', ephemeral: true });
        return;
    }

    await interaction.deferReply();
    if (nickname) {
        const records = getDonationsByNickname(nickname, 10);
        const summary = getDonationSummary(nickname);
        if (records.length === 0) {
            await interaction.editReply(`**${nickname}**님의 후원 기록이 없습니다.`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${nickname}님의 후원 기록`)
            .setColor(0x5865f2)
            .setDescription(records.map(record =>
                `• ${record.created_at} — ${record.amount.toLocaleString()}원 / ${record.group_name} / 칭호: ${record.title}`
            ).join('\n'))
            .setFooter({ text: `총 ${summary.count}회, 누적 ${summary.total.toLocaleString()}원` });
        await interaction.editReply({ embeds: [embed] });
        return;
    }

    const records = getRecentDonations(10);
    if (records.length === 0) {
        await interaction.editReply('아직 등록된 후원 기록이 없습니다.');
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('최근 후원 기록 (전체)')
        .setColor(0x5865f2)
        .setDescription(records.map(record =>
            `• **${record.nickname}** — ${record.created_at} — ${record.amount.toLocaleString()}원 / ${record.group_name}`
        ).join('\n'));
    await interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// 처벌 관리 핸들러
// ---------------------------------------------------------------------------

// 디코 유저 또는 닉네임으로 마크 계정을 확정한다.
async function resolveTarget(interaction) {
    const discordUser = interaction.options.getUser('디코id');
    const nameOption = interaction.options.getString('닉네임');

    if (discordUser) {
        const resolved = await resolveByDiscordId(discordUser.id);
        return {
            discordUser,
            discordUserId: discordUser.id,
            uuid: resolved?.uuid || null,
            name: resolved?.name || nameOption || null,
            linked: Boolean(resolved),
        };
    }

    if (nameOption) {
        const resolved = await resolveByName(nameOption);
        return {
            discordUser: null,
            discordUserId: resolved?.discordUserId || null,
            uuid: resolved?.uuid || null,
            name: nameOption,
            linked: Boolean(resolved?.discordUserId),
        };
    }

    return null;
}

async function handlePunish(interaction) {
    const severity = interaction.options.getString('강도', true);
    const reason = interaction.options.getString('사유', true).trim();

    if (!listPresets().some(preset => preset.key === severity)) {
        await interaction.reply({ content: '알 수 없는 처벌 강도입니다.', ephemeral: true });
        return;
    }
    if (!isValidReason(reason)) {
        await interaction.reply({ content: '사유는 따옴표, 역슬래시, 줄바꿈을 제외한 1~500자여야 합니다.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const target = await resolveTarget(interaction);
    if (!target) {
        await interaction.editReply('처분 대상을 지정해주세요. `디코id` 또는 `닉네임` 중 하나가 필요합니다.');
        return;
    }
    if (!target.name || !isValidMinecraftName(target.name)) {
        const who = target.discordUser ? `${target.discordUser.tag}님` : '해당 대상';
        await interaction.editReply(
            `${who}의 Minecraft 닉네임을 찾지 못했습니다. DiscordSRV 연동이 없다면 \`/연동등록\`으로 먼저 계정을 등록해주세요.`
        );
        return;
    }

    const commands = buildCommands(severity, target.name, reason);
    const channel = await getCommandChannel();
    for (const command of commands) {
        await sendServerCommand(channel, command);
    }

    logPunishment({
        season: config.currentSeason,
        discordUserId: target.discordUserId,
        minecraftUuid: target.uuid,
        minecraftName: target.name,
        severity,
        reason,
        adminUserId: interaction.user.id,
        adminUserTag: interaction.user.tag,
        source: 'command',
    });

    const seasonCount = getPunishmentSummary({
        minecraftName: target.name,
        season: config.currentSeason,
    }).count;

    const embed = new EmbedBuilder()
        .setTitle('처벌 처리 완료')
        .setColor(0xed4245)
        .addFields(
            { name: '대상 닉네임', value: target.name, inline: true },
            { name: '강도', value: severityLabel(severity), inline: true },
            { name: '시즌', value: config.currentSeason, inline: true },
            { name: '디스코드', value: target.discordUser ? `<@${target.discordUser.id}>` : (target.discordUserId ? `<@${target.discordUserId}>` : '연동 없음'), inline: true },
            { name: '이번 시즌 누적', value: `${seasonCount}회`, inline: true },
            { name: 'UUID', value: target.uuid || '알 수 없음', inline: false },
            { name: '사유', value: reason },
        )
        .setFooter({ text: `처분관리자: ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    try {
        await sendAuditLog([
            `형량: ${severityLabel(severity)}`,
            '처벌내용: /처분 명령 처리',
            `대상: ${target.name}`,
            `처분관리자: ${interaction.user.tag} (${interaction.user.id})`,
            `사유: ${reason}`,
        ].join('\n'));
    } catch (error) {
        console.error('처벌 감사 로그 전송 실패:', error);
    }
}

async function handleWhois(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = await resolveTarget(interaction);
    if (!target) {
        await interaction.editReply('조회 대상을 지정해주세요. `디코id` 또는 `닉네임` 중 하나가 필요합니다.');
        return;
    }

    const records = getPunishments({
        discordUserId: target.discordUserId || undefined,
        minecraftName: target.name || undefined,
        limit: 10,
    });
    const totalCount = getPunishmentSummary({
        discordUserId: target.discordUserId || undefined,
        minecraftName: target.name || undefined,
    }).count;
    const seasonCount = getPunishmentSummary({
        discordUserId: target.discordUserId || undefined,
        minecraftName: target.name || undefined,
        season: config.currentSeason,
    }).count;

    const discordValue = target.discordUser
        ? `${target.discordUser.tag} (<@${target.discordUser.id}>)`
        : target.discordUserId
            ? `<@${target.discordUserId}>`
            : '연동 없음';

    const embed = new EmbedBuilder()
        .setTitle('WHOIS 조회 결과')
        .setColor(0x5865f2)
        .addFields(
            { name: '디스코드', value: discordValue, inline: false },
            { name: '마크 닉네임', value: target.name || '알 수 없음', inline: true },
            { name: 'UUID', value: target.uuid || '알 수 없음', inline: false },
            { name: `처벌 기록 (이번 시즌 ${config.currentSeason})`, value: `${seasonCount}회`, inline: true },
            { name: '처벌 기록 (전체)', value: `${totalCount}회`, inline: true },
        );

    if (records.length > 0) {
        embed.addFields({
            name: '최근 처벌 내역',
            value: records.map(formatPunishmentLine).join('\n').slice(0, 1024),
        });
    } else {
        embed.addFields({ name: '최근 처벌 내역', value: '기록 없음' });
    }

    await interaction.editReply({ embeds: [embed] });
}

function formatPunishmentLine(record) {
    const when = (record.punished_at || record.created_at || '').slice(0, 16);
    const name = record.minecraft_name || record.discord_user_id || '?';
    return `• [${record.season}] ${when} — ${name} / ${severityLabel(record.severity)} / ${record.reason}`;
}

async function handleImportLogs(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const limit = interaction.options.getInteger('개수') || 100;
    const channelOption = interaction.options.getChannel('���널');
    const channelId = channelOption?.id || config.punishmentLogChannelId;

    if (!channelId) {
        await interaction.editReply('가져올 채널이 없습니다. `채널` 옵션을 지정하거나 DISCORD_PUNISHMENT_LOG_CHANNEL_ID를 설정해주세요.');
        return;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.messages?.fetch !== 'function') {
        await interaction.editReply('해당 채널의 메시지를 읽을 수 없습니다.');
        return;
    }

    const collected = [];
    let before;
    while (collected.length < limit) {
        const batchSize = Math.min(100, limit - collected.length);
        const batch = await channel.messages.fetch({ limit: batchSize, before });
        if (batch.size === 0) break;
        for (const message of batch.values()) {
            const parsed = parseLogMessage(message.content, {
                season: config.currentSeason,
                punishedAt: message.createdAt.toISOString().slice(0, 19).replace('T', ' '),
            });
            if (parsed) collected.push(parsed);
        }
        before = batch.last()?.id;
        if (!before) break;
    }

    if (collected.length === 0) {
        await interaction.editReply(`파싱 가능한 처벌 로그를 찾지 못했습니다. (검사한 메시지에서 인식된 항목 0건)`);
        return;
    }

    const inserted = importPunishments(collected);
    await interaction.editReply(
        `가져오기 완료 — 인식 ${collected.length}건 중 신규 ${inserted}건을 시즌 ${config.currentSeason}에 저장했습니다. (중복 ${collected.length - inserted}건 제외)`
    );
}

async function handleLinkAccount(interaction) {
    const discordUser = interaction.options.getUser('디코id', true);
    const nickname = interaction.options.getString('닉네임', true).trim();

    if (!isValidMinecraftName(nickname)) {
        await interaction.reply({ content: 'Minecraft 닉네임은 영문, 숫자, 밑줄로 구성된 3~16자여야 합니다.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const profile = await nameToProfile(nickname).catch(() => null);
    upsertAccountLink({
        discordUserId: discordUser.id,
        minecraftUuid: profile?.uuid || null,
        minecraftName: profile?.name || nickname,
    });

    await interaction.editReply(
        `연동 등록 완료 — <@${discordUser.id}> ↔ ${profile?.name || nickname}` +
        (profile?.uuid ? ` (UUID: ${profile.uuid})` : ' (UUID 조회 실패, 닉네임만 저장)')
    );
}

client.login(config.token).catch(error => {
    console.error('Discord 로그인 실패:', error);
    process.exitCode = 1;
});
