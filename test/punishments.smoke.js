'use strict';

process.env.DONATIONS_DB_PATH = ':memory:';

const assert = require('node:assert/strict');
const {
    logPunishment,
    importPunishments,
    getPunishments,
    getPunishmentSummary,
    upsertAccountLink,
    getAccountLink,
    getAccountLinkByName,
} = require('../db');

// 슬래시 명령 처벌 기록
logPunishment({
    season: 'S1',
    discordUserId: '111',
    minecraftUuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
    minecraftName: 'PotatoKing',
    severity: '영구정지',
    reason: '핵 사용',
    adminUserId: '999',
    adminUserTag: 'admin#0001',
    source: 'command',
});

let records = getPunishments({ season: 'S1', minecraftName: 'PotatoKing' });
assert.equal(records.length, 1);
assert.equal(records[0].severity, '영구정지');

// 시즌 필터
assert.equal(getPunishmentSummary({ minecraftName: 'PotatoKing', season: 'S1' }).count, 1);
assert.equal(getPunishmentSummary({ minecraftName: 'PotatoKing', season: 'S9' }).count, 0);

// 로그 가져오기 중복 제거
const imported = [
    { season: 'S1', minecraftName: 'Spud', severity: '3일정지', reason: '욕설', punishedAt: '2026-07-20 10:00:00', source: 'import' },
    { season: 'S1', minecraftName: 'Spud', severity: '3일정지', reason: '욕설', punishedAt: '2026-07-20 10:00:00', source: 'import' },
];
const inserted = importPunishments(imported);
assert.equal(inserted, 1, '동일 로그는 중복 삽입되지 않아야 한다');

records = getPunishments({ season: 'S1', minecraftName: 'Spud' });
assert.equal(records.length, 1);

// 계정 연동 매핑
upsertAccountLink({ discordUserId: '111', minecraftUuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', minecraftName: 'PotatoKing' });
assert.equal(getAccountLink('111').minecraft_name, 'PotatoKing');
assert.equal(getAccountLinkByName('potatoking').discord_user_id, '111');

// 업데이트(upsert) 동작
upsertAccountLink({ discordUserId: '111', minecraftUuid: null, minecraftName: 'PotatoQueen' });
assert.equal(getAccountLink('111').minecraft_name, 'PotatoQueen');

console.log('Punishment smoke test passed.');
