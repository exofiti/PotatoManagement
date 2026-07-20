'use strict';

const MINECRAFT_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const TITLE_PATTERN = /^[^"\\\r\n]{1,32}$/;

function isValidMinecraftName(name) {
    return typeof name === 'string' && MINECRAFT_NAME_PATTERN.test(name);
}

function isValidTitle(title) {
    return typeof title === 'string' && TITLE_PATTERN.test(title.trim());
}

function donationGroup(amount) {
    if (!Number.isSafeInteger(amount) || amount < 0) return null;
    if (amount >= 7000) return '02후원a';
    if (amount >= 5000) return '01후원a';
    return null;
}

module.exports = { donationGroup, isValidMinecraftName, isValidTitle };
