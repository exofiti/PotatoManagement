'use strict';

// 처벌 강도 프리셋.
// key: 슬래시 명령에서 선택하는 값
// label: 사람이 읽는 이름
// durationDays: 정지 기간(일). null이면 영구, 0이면 정지 없음(경고).
// buildCommands(name, reason): 마인크래프트 콘솔에서 실행할 명령 목록.
//
// 기본값은 LiteBans 계열 명령(tempban/ban/warn) 기준입니다.
// 서버 플러그인에 맞게 PUNISH_COMMAND_* 환경변수로 덮어쓸 수 있습니다.
const DEFAULT_PRESETS = [
    { key: '경고', label: '경고', durationDays: 0, kind: 'warn' },
    { key: '1일정지', label: '1일 정지', durationDays: 1, kind: 'tempban' },
    { key: '3일정지', label: '3일 정지', durationDays: 3, kind: 'tempban' },
    { key: '7일정지', label: '7일 정지', durationDays: 7, kind: 'tempban' },
    { key: '30일정지', label: '30일 정지', durationDays: 30, kind: 'tempban' },
    { key: '영구정지', label: '영구 정지', durationDays: null, kind: 'ban' },
];

function commandTemplates(env = process.env) {
    return {
        warn: env.PUNISH_COMMAND_WARN?.trim() || 'warn {name} {reason}',
        tempban: env.PUNISH_COMMAND_TEMPBAN?.trim() || 'tempban {name} {days}d {reason}',
        ban: env.PUNISH_COMMAND_BAN?.trim() || 'ban {name} {reason}',
    };
}

function fill(template, { name, days, reason }) {
    return template
        .replace(/\{name\}/g, name)
        .replace(/\{days\}/g, days == null ? '' : String(days))
        .replace(/\{reason\}/g, reason)
        .trim();
}

function getPreset(key) {
    return DEFAULT_PRESETS.find(preset => preset.key === key) || null;
}

function listPresets() {
    return DEFAULT_PRESETS.map(({ key, label }) => ({ key, label }));
}

// 특정 강도에 대해 서버에서 실행할 콘솔 명령 목록을 만든다.
function buildCommands(severityKey, name, reason, env = process.env) {
    const preset = getPreset(severityKey);
    if (!preset) return null;

    const templates = commandTemplates(env);
    const template = templates[preset.kind];
    return [fill(template, { name, days: preset.durationDays, reason })];
}

function severityLabel(key) {
    return getPreset(key)?.label || key;
}

module.exports = {
    DEFAULT_PRESETS,
    getPreset,
    listPresets,
    buildCommands,
    severityLabel,
};
