'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');
const { donationGroup, isValidMinecraftName, isValidTitle } = require('../lib/validation');

test('Minecraft 닉네임 형식을 검증한다', () => {
    assert.equal(isValidMinecraftName('Potato_123'), true);
    assert.equal(isValidMinecraftName('ab'), false);
    assert.equal(isValidMinecraftName('한글닉네임'), false);
    assert.equal(isValidMinecraftName('name with space'), false);
    assert.equal(isValidMinecraftName('a'.repeat(17)), false);
});

test('후원 금액에 맞는 등급을 반환한다', () => {
    assert.equal(donationGroup(4999), null);
    assert.equal(donationGroup(5000), '01후원a');
    assert.equal(donationGroup(6999), '01후원a');
    assert.equal(donationGroup(7000), '02후원a');
    assert.equal(donationGroup(-1), null);
    assert.equal(donationGroup(5000.5), null);
});

test('명령 문자열을 깨뜨릴 수 있는 칭호를 거부한다', () => {
    assert.equal(isValidTitle('감자왕'), true);
    assert.equal(isValidTitle(''), false);
    assert.equal(isValidTitle('bad"title'), false);
    assert.equal(isValidTitle('bad\\title'), false);
    assert.equal(isValidTitle('bad\ntitle'), false);
});

test('환경변수 설정과 허용 역할 목록을 읽는다', () => {
    const config = loadConfig({
        DISCORD_TOKEN: 'token',
        DISCORD_CLIENT_ID: 'client',
        DISCORD_COMMAND_CHANNEL_ID: 'channel',
        DISCORD_ALLOWED_ROLE_IDS: 'role-1, role-2',
    });
    assert.deepEqual([...config.allowedRoleIds], ['role-1', 'role-2']);
});

test('필수 환경변수 누락을 즉시 알린다', () => {
    assert.throws(() => loadConfig({}), /DISCORD_TOKEN/);
});
