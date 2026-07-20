'use strict';

const { PermissionFlagsBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('./config');

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
