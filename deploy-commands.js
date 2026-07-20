'use strict';

const { ChannelType, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('./config');
const { listPresets } = require('./lib/punishments');

const severityChoices = listPresets().map(preset => ({ name: preset.label, value: preset.key }));

const config = loadConfig();
const adminOnly = PermissionFlagsBits.Administrator;
const restrictByDefault = command => {
    if (config.allowedRoleIds.size === 0) command.setDefaultMemberPermissions(adminOnly);
    return command;
};
const commands = [
    restrictByDefault(new SlashCommandBuilder()
        .setName('후원')
        .setDescription('후원 관련 명령어')
        .addSubcommand(subcommand => subcommand
            .setName('처리')
            .setDescription('후원 처리 및 혜택 지급')
            .addUserOption(option => option.setName('유저').setDescription('후원한 Discord 유저').setRequired(true))
            .addStringOption(option => option.setName('닉네임').setDescription('Minecraft 닉네임').setRequired(true))
            .addIntegerOption(option => option.setName('금액').setDescription('후원 금액').setMinValue(5000).setMaxValue(100000000).setRequired(true))
            .addStringOption(option => option.setName('칭호').setDescription('커스텀 칭호 내용').setMinLength(1).setMaxLength(32).setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('조회')
            .setDescription('후원 기록 조회')
            .addStringOption(option => option.setName('닉네임').setDescription('비우면 최근 전체 기록을 조회합니다')))),
    restrictByDefault(new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Minecraft 유저를 영구 밴합니다')
        .addStringOption(option => option.setName('닉네임').setDescription('Minecraft 닉네임').setRequired(true))
        .addStringOption(option => option.setName('사유').setDescription('밴 사유').setMaxLength(500).setRequired(true))),
    restrictByDefault(new SlashCommandBuilder()
        .setName('처분')
        .setDescription('디스코드 유저를 처벌하고 마크 서버에 반영합니다')
        .addStringOption(option => option
            .setName('강도').setDescription('처벌 강도').setRequired(true).addChoices(...severityChoices))
        .addStringOption(option => option
            .setName('사유').setDescription('처벌 사유').setMaxLength(500).setRequired(true))
        .addUserOption(option => option
            .setName('디코id').setDescription('처벌할 Discord 유저 (연동 계정 기준)'))
        .addStringOption(option => option
            .setName('닉네임').setDescription('연동이 없을 때 직접 지정할 Minecraft 닉네임'))),
    restrictByDefault(new SlashCommandBuilder()
        .setName('whois')
        .setDescription('디스코드 유저의 마크 계정과 처벌 기록을 조회합니다')
        .addUserOption(option => option
            .setName('디코id').setDescription('조회할 Discord 유저'))
        .addStringOption(option => option
            .setName('닉네임').setDescription('마크 닉네임으로 조회'))),
    restrictByDefault(new SlashCommandBuilder()
        .setName('처벌기록')
        .setDescription('시즌별 처벌 기록을 조회합니다')
        .addStringOption(option => option
            .setName('시즌').setDescription('시즌 값 (비우면 현재 시즌, "전체" 입력 시 전체)'))
        .addUserOption(option => option
            .setName('디코id').setDescription('특정 Discord 유저로 필터'))
        .addStringOption(option => option
            .setName('닉네임').setDescription('특정 마크 닉네임으로 필터'))),
    restrictByDefault(new SlashCommandBuilder()
        .setName('처벌가져오기')
        .setDescription('채널에 쌓인 처벌 로그를 파싱해 현재 시즌 DB로 가져옵니다')
        .addIntegerOption(option => option
            .setName('개수').setDescription('검사할 최근 메시지 수 (기본 100)').setMinValue(1).setMaxValue(1000))
        .addChannelOption(option => option
            .setName('채널').setDescription('가져올 채널 (기본: 처벌 로그 채널)').addChannelTypes(ChannelType.GuildText))),
    restrictByDefault(new SlashCommandBuilder()
        .setName('연동등록')
        .setDescription('디스코드 유저와 마크 닉네임을 수동으로 연동합니다')
        .addUserOption(option => option
            .setName('디코id').setDescription('Discord 유저').setRequired(true))
        .addStringOption(option => option
            .setName('닉네임').setDescription('Minecraft 닉네임').setRequired(true))),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
        console.log('슬래시 명령 등록 완료');
    } catch (error) {
        console.error('슬래시 명령 등록 실패:', error);
        process.exitCode = 1;
    }
})();
