'use strict';

// 채널에 쌓여 있는 처벌 로그 메시지를 파싱한다.
// 봇이 남기는 감사 로그 형식을 기준으로 한다:
//
//   형량: 영구 밴
//   처벌내용: 서버 접속 차단
//   대상: PlayerName
//   처분관리자: user#0000 (123456789012345678)
//   사유: 사유 내용
//
// 라벨 별칭도 일부 허용한다(대상/닉네임/유저, 사유/이유 등).

const LABEL_ALIASES = {
    형량: 'severityText',
    강도: 'severityText',
    처벌강도: 'severityText',
    처벌내용: 'detail',
    대상: 'name',
    닉네임: 'name',
    유저: 'name',
    처분관리자: 'admin',
    관리자: 'admin',
    사유: 'reason',
    이유: 'reason',
    uuid: 'uuid',
    UUID: 'uuid',
};

function mapSeverity(text) {
    if (!text) return null;
    const value = text.trim();
    if (/영구/.test(value)) return '영구정지';
    if (/경고/.test(value)) return '경고';
    const dayMatch = value.match(/(\d+)\s*일/);
    if (dayMatch) return `${dayMatch[1]}일정지`;
    return value; // 알 수 없는 형식은 원문 그대로 강도로 사용
}

function parseAdmin(text) {
    if (!text) return { adminUserTag: null, adminUserId: null };
    const match = text.match(/^(.*?)\s*\((\d{17,20})\)\s*$/);
    if (match) return { adminUserTag: match[1].trim(), adminUserId: match[2] };
    return { adminUserTag: text.trim(), adminUserId: null };
}

// content: 메시지 원문, options: { season, punishedAt }
function parseLogMessage(content, { season, punishedAt } = {}) {
    if (typeof content !== 'string') return null;

    const fields = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const label = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        const key = LABEL_ALIASES[label];
        if (key) fields[key] = value;
    }

    if (!fields.name && !fields.uuid) return null;
    if (!fields.severityText && !fields.reason) return null;

    const { adminUserTag, adminUserId } = parseAdmin(fields.admin);

    return {
        season: season || null,
        minecraftName: fields.name || null,
        minecraftUuid: fields.uuid || null,
        severity: mapSeverity(fields.severityText) || '기타',
        reason: fields.reason || (fields.detail ?? ''),
        adminUserTag,
        adminUserId,
        punishedAt: punishedAt || null,
        source: 'import',
    };
}

module.exports = { parseLogMessage, mapSeverity, parseAdmin };
