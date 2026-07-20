'use strict';

const MINECRAFT_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const TITLE_PATTERN = /^[^"\\\r\n]{1,32}$/;
const REASON_PATTERN = /^[^"\\\r\n]{1,500}$/;
const DISCORD_ID_PATTERN = /^\d{17,20}$/;

function isValidMinecraftName(name) {
    return typeof name === 'string' && MINECRAFT_NAME_PATTERN.test(name);
}

function isValidTitle(title) {
    return typeof title === 'string' && TITLE_PATTERN.test(title.trim());
}

function isValidReason(reason) {
    return typeof reason === 'string' && REASON_PATTERN.test(reason.trim());
}

function isValidDiscordId(id) {
    return typeof id === 'string' && DISCORD_ID_PATTERN.test(id.trim());
}

function donationGroup(amount) {
    if (!Number.isSafeInteger(amount) || amount < 0) return null;
    if (amount >= 7000) return '02후원a';
    if (amount >= 5000) return '01후원a';
    return null;
}

module.exports = {
    donationGroup,
    isValidMinecraftName,
    isValidTitle,
    isValidReason,
    isValidDiscordId,
};
