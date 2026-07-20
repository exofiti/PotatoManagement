'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    normalizeUuid,
    verifyConfigured,
    lookupByDiscordId,
    lookupByName,
    lookupByUuid,
} = require('../lib/verifySource');

function writeFixture(data) {
    const file = path.join(os.tmpdir(), `verify-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');
    return file;
}

test('UUID를 대시 형식으로 정규화한다', () => {
    assert.equal(
        normalizeUuid('069a79f444e94726a5befca90e38aaf5'),
        '069a79f4-44e9-4726-a5be-fca90e38aaf5'
    );
    assert.equal(normalizeUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5'), '069a79f4-44e9-4726-a5be-fca90e38aaf5');
    assert.equal(normalizeUuid(''), null);
});

test('none 소스는 미설정으로 취급한다', () => {
    assert.equal(verifyConfigured({ VERIFY_SOURCE_TYPE: 'none' }), false);
    assert.equal(verifyConfigured({}), false);
});

test('기본 스키마(discord_id/mc_uuid, 닉네임 컬럼 없음)로 조회한다', () => {
    const file = writeFixture({
        users: [
            { discord_id: '111', mc_uuid: '069a79f444e94726a5befca90e38aaf5' },
            { discord_id: '222', mc_uuid: 'abcdefabcdefabcdefabcdefabcdefab' },
        ],
    });
    const env = { VERIFY_SOURCE_TYPE: 'json', VERIFY_JSON_PATH: file };

    assert.equal(verifyConfigured(env), true);
    const byId = lookupByDiscordId('111', env);
    assert.equal(byId.uuid, '069a79f4-44e9-4726-a5be-fca90e38aaf5');
    // 닉네임 컬럼이 없으므로 name 은 null (accounts.js 가 Mojang 으로 보완)
    assert.equal(byId.name, null);

    // 닉네임 컬럼이 없으면 이름 조회는 불가(null)
    assert.equal(lookupByName('anything', env), null);

    const byUuid = lookupByUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5', env);
    assert.equal(byUuid.discordUserId, '111');

    fs.unlinkSync(file);
});

test('JSON 객체 맵 형식({ "<id>": {...} })도 지원한다', () => {
    const file = writeFixture({
        '333': { mc_uuid: '069a79f444e94726a5befca90e38aaf5' },
    });
    const env = { VERIFY_SOURCE_TYPE: 'json', VERIFY_JSON_PATH: file };
    const byId = lookupByDiscordId('333', env);
    assert.equal(byId.uuid, '069a79f4-44e9-4726-a5be-fca90e38aaf5');
    fs.unlinkSync(file);
});

test('구버전 JSON 키(minecraft-uuid/discord-acount)도 자동 인식한다', () => {
    const file = writeFixture({
        users: [{ 'discord-acount': '555', 'minecraft-uuid': '069a79f444e94726a5befca90e38aaf5' }],
    });
    const env = { VERIFY_SOURCE_TYPE: 'json', VERIFY_JSON_PATH: file };
    const byId = lookupByDiscordId('555', env);
    assert.equal(byId.uuid, '069a79f4-44e9-4726-a5be-fca90e38aaf5');
    fs.unlinkSync(file);
});

test('커스텀 필드명을 존중한다', () => {
    const file = writeFixture({
        users: [{ discord_id: '444', mc_uuid: '069a79f444e94726a5befca90e38aaf5', ign: 'Spud' }],
    });
    const env = {
        VERIFY_SOURCE_TYPE: 'json',
        VERIFY_JSON_PATH: file,
        VERIFY_FIELD_DISCORD: 'discord_id',
        VERIFY_FIELD_UUID: 'mc_uuid',
        VERIFY_FIELD_NAME: 'ign',
    };
    const byId = lookupByDiscordId('444', env);
    assert.equal(byId.name, 'Spud');
    assert.equal(byId.uuid, '069a79f4-44e9-4726-a5be-fca90e38aaf5');
    fs.unlinkSync(file);
});
