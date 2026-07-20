'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCommands, getPreset, listPresets, severityLabel } = require('../lib/punishments');
const { parseLogMessage, mapSeverity, parseAdmin } = require('../lib/logParser');
const { toDashedUuid } = require('../lib/mojang');
const { isValidReason, isValidDiscordId } = require('../lib/validation');

test('처벌 강도 프리셋을 조회한다', () => {
    assert.equal(getPreset('경고').durationDays, 0);
    assert.equal(getPreset('영구정지').durationDays, null);
    assert.equal(getPreset('없는강도'), null);
    assert.equal(severityLabel('7일정지'), '7일 정지');
    assert.ok(listPresets().length >= 6);
});

test('강도에 맞는 콘솔 명령을 생성한다', () => {
    assert.deepEqual(buildCommands('경고', 'Potato', '규칙 위반'), ['warn Potato 규칙 위반']);
    assert.deepEqual(buildCommands('3일정지', 'Potato', '욕설'), ['tempban Potato 3d 욕설']);
    assert.deepEqual(buildCommands('영구정지', 'Potato', '핵 사용'), ['ban Potato 핵 사용']);
    assert.equal(buildCommands('없는강도', 'Potato', 'x'), null);
});

test('환경변수로 명령 템플릿을 덮어쓴다', () => {
    const env = { PUNISH_COMMAND_BAN: 'litebans:ban {name} -s {reason}' };
    assert.deepEqual(buildCommands('영구정지', 'Potato', '핵', env), ['litebans:ban Potato -s 핵']);
});

test('사유와 디스코드 ID를 검증한다', () => {
    assert.equal(isValidReason('정상 사유'), true);
    assert.equal(isValidReason('bad"reason'), false);
    assert.equal(isValidReason(''), false);
    assert.equal(isValidDiscordId('123456789012345678'), true);
    assert.equal(isValidDiscordId('abc'), false);
});

test('UUID를 대시 형식으로 정규화한다', () => {
    assert.equal(
        toDashedUuid('069a79f444e94726a5befca90e38aaf5'),
        '069a79f4-44e9-4726-a5be-fca90e38aaf5'
    );
    assert.equal(toDashedUuid('not-a-uuid'), null);
});

test('처벌 강도 텍스트를 프리셋 키로 매핑한다', () => {
    assert.equal(mapSeverity('영구 밴'), '영구정지');
    assert.equal(mapSeverity('경고 1회'), '경고');
    assert.equal(mapSeverity('7일 정지'), '7일정지');
    assert.equal(mapSeverity('커스텀'), '커스텀');
});

test('처분관리자 문자열을 파싱한다', () => {
    assert.deepEqual(parseAdmin('admin#0001 (123456789012345678)'), {
        adminUserTag: 'admin#0001',
        adminUserId: '123456789012345678',
    });
    assert.deepEqual(parseAdmin('admin'), { adminUserTag: 'admin', adminUserId: null });
});

test('감사 로그 메시지를 처벌 레코드로 파싱한다', () => {
    const content = [
        '형량: 영구 밴',
        '처벌내용: 서버 접속 차단',
        '대상: PotatoKing',
        '처분관리자: admin#0001 (123456789012345678)',
        '사유: 악성 유저',
    ].join('\n');
    const record = parseLogMessage(content, { season: 'S2', punishedAt: '2026-07-20 10:00:00' });
    assert.equal(record.season, 'S2');
    assert.equal(record.minecraftName, 'PotatoKing');
    assert.equal(record.severity, '영구정지');
    assert.equal(record.reason, '악성 유저');
    assert.equal(record.adminUserId, '123456789012345678');
    assert.equal(record.source, 'import');
});

test('형식이 아닌 메시지는 무시한다', () => {
    assert.equal(parseLogMessage('안녕하세요 잡담입니다'), null);
    assert.equal(parseLogMessage('대상: OnlyName'), null);
});
