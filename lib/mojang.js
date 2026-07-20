'use strict';

// Mojang 공개 API로 닉네임 <-> UUID를 변환한다.
// Node 18+ 내장 fetch 사용.

function toDashedUuid(raw) {
    if (typeof raw !== 'string') return null;
    const hex = raw.replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function nameToProfile(name) {
    const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) throw new Error(`Mojang API 오류: ${response.status}`);
    const data = await response.json();
    if (!data?.id) return null;
    return { uuid: toDashedUuid(data.id), name: data.name };
}

async function uuidToName(uuid) {
    const hex = (uuid || '').replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
    const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${hex}`);
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) throw new Error(`Mojang API 오류: ${response.status}`);
    const data = await response.json();
    return data?.name || null;
}

module.exports = { toDashedUuid, nameToProfile, uuidToName };
