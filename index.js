'use strict';

const { Client, EmbedBuilder, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('./config');
const { logDonation, getDonationsByNickname, getRecentDonations, getDonationSummary } = require('./db');
const { donationGroup, isValidMinecraftName, isValidTitle } = require('./lib/validation');

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
    console.log(`${readyClient.user.tag} 후원봇 연결됨`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (!['후원', 'ban'].includes(interaction.commandName)) return;

    try {
        if (!isAuthorized(interaction)) {
            await interaction.reply({ content: '이 명령을 실행할 권한이 없습니다.', ephemeral: true });
            return;
        }

        if (interaction.commandName === 'ban') {
            await handleBan(interaction);
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

client.login(config.token).catch(error => {
    console.error('Discord 로그인 실패:', error);
    process.exitCode = 1;
});
