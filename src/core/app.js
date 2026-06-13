import {
    characters,
    eventSource,
    event_types,
    generateRaw,
    getCharacterAvatar,
    getThumbnailUrl,
    printCharactersDebounced,
    saveSettingsDebounced,
    selectCharacterById,
} from "/script.js";
import { extension_settings, getContext } from "/scripts/extensions.js";
import { loadWorldInfo, updateWorldInfoList, world_names } from "/scripts/world-info.js";
import { applyI18n, initializeI18n, t } from '../i18n.js';
import { clampNumber, notify } from '../utils.js';
import { SETTINGS_KEY } from '../constants.js';

const promptPresetKeys = [
    'memoryFlashback',
    'signatureScene',
    'oldChatEcho',
    'worldFragment',
    'emotionalHook',
];

const retentionPromptPresetKeys = [
    'lastWhisper',
    'unfinishedPromise',
    'softRefusal',
    'jealousThread',
    'storyCliffhanger',
];

const angerPromptPresetKeys = [
    'coldBack',
    'monoReply',
    'soreSpot',
    'mockDistance',
    'silentExit',
    'pressuredOutburst',
    'silentGlare',
    'directWarning',
];

const jealousyPromptPresetKeys = [
    'teasingJealousy',
    'coldProbe',
    'possessiveThread',
    'hurtSilence',
    'rivalCallback',
];

const birthdayPromptPresetKeys = [
    'warmBirthday',
    'privateAnniversary',
    'surpriseInvite',
    'bittersweetMemory',
    'ritualPromise',
];

const reunionPromptPresetKeys = [
    'quietReturn',
    'goldenSummon',
    'forgottenRoom',
    'longWait',
    'extremeReunion',
];

const angerIntensityKeys = ['restrained', 'direct', 'outburst'];
const invitationModeKeys = ['primary', 'retention', 'anger', 'jealousy', 'birthday', 'reunion'];
const contextualAiModeKeys = ['jealousy', 'birthday', 'reunion'];
const reunionNoChatPolicyKeys = ['skip', 'trigger'];

const builtinDateEvents = [
    { key: 'holiday:01-01', date: '01-01', nameKey: 'invitation.event.newYear' },
    { key: 'holiday:02-14', date: '02-14', nameKey: 'invitation.event.valentine' },
    { key: 'holiday:12-24', date: '12-24', nameKey: 'invitation.event.christmasEve' },
    { key: 'holiday:12-25', date: '12-25', nameKey: 'invitation.event.christmas' },
    { key: 'holiday:12-31', date: '12-31', nameKey: 'invitation.event.newYearEve' },
];

const homepageTriggerModes = [
    'session',
    'cooldown',
    'everyHome',
    'manual',
];

const panelThemeKeys = [
    'midnight',
    'parchment',
    'ember',
    'jade',
    'st',
];

const CUSTOM_TEMPLATE_PREFIX = 'custom:';
const maxContextChars = 16000;
const homepageStableDelayMs = 1500;
const homepageRetryDelayMs = 700;
const homepageAppReadyGraceMs = 2500;
const coverPreloadTimeoutMs = 2500;

function isCustomTemplateKey(value) {
    return typeof value === 'string' && value.startsWith(CUSTOM_TEMPLATE_PREFIX);
}

function getCustomTemplateName(value) {
    return isCustomTemplateKey(value) ? value.slice(CUSTOM_TEMPLATE_PREFIX.length) : '';
}

function makeCustomTemplateKey(name) {
    return `${CUSTOM_TEMPLATE_PREFIX}${String(name || '').trim()}`;
}

function sanitizeTemplateMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const result = {};
    for (const [name, body] of Object.entries(value)) {
        const trimmedName = String(name || '').trim();
        const trimmedBody = String(body || '').trim();
        if (trimmedName && trimmedBody) {
            result[trimmedName] = trimmedBody;
        }
    }
    return result;
}

function sanitizeStringRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = String(key || '').trim();
        const normalizedValue = String(entry || '').trim();
        if (normalizedKey && normalizedValue) {
            result[normalizedKey] = normalizedValue;
        }
    }
    return result;
}

function sanitizeChanceRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = String(key || '').trim();
        const number = Number(entry);
        if (normalizedKey && Number.isFinite(number)) {
            result[normalizedKey] = clampNumber(number, 0, 100, defaultSettings.jealousyChance);
        }
    }
    return result;
}

function sanitizeMonthDayRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = String(key || '').trim();
        const normalizedValue = normalizeMonthDay(entry);
        if (normalizedKey && normalizedValue) {
            result[normalizedKey] = normalizedValue;
        }
    }
    return result;
}

function parseFilterTagList(value) {
    return String(value || '')
        .split(/[\r\n,，;；\s]+/)
        .map((entry) => entry.trim().replace(/^<|>$/g, ''))
        .filter(Boolean);
}

function extractTaggedContent(text, tags) {
    if (!tags.length) {
        return String(text || '');
    }
    const source = String(text || '');
    const collected = [];
    for (const tag of tags) {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<\\s*${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\s*/\\s*${escaped}\\s*>`, 'gi');
        let match;
        while ((match = regex.exec(source)) !== null) {
            const inner = match[1].trim();
            if (inner) {
                collected.push(inner);
            }
        }
    }
    return collected.join('\n');
}

function getTagListFromSettings(kind) {
    const settings = ensureSettings();
    const raw = kind === 'filter' ? settings.chatFilterTags : settings.chatExcludeTags;
    return parseFilterTagList(raw);
}

function setTagListToSettings(kind, list) {
    const settings = ensureSettings();
    const value = list.join(', ');
    if (kind === 'filter') {
        settings.chatFilterTags = value;
    } else {
        settings.chatExcludeTags = value;
    }
    saveSettingsDebounced();
}

function addTagsFromText(kind, text) {
    const incoming = parseFilterTagList(text);
    if (!incoming.length) return false;
    const existing = getTagListFromSettings(kind);
    const existingLower = new Set(existing.map((t) => t.toLowerCase()));
    let changed = false;
    for (const tag of incoming) {
        const key = tag.toLowerCase();
        if (!existingLower.has(key)) {
            existing.push(tag);
            existingLower.add(key);
            changed = true;
        }
    }
    if (changed) {
        setTagListToSettings(kind, existing);
    }
    return changed;
}

function removeTagByValue(kind, tag) {
    const list = getTagListFromSettings(kind);
    const filtered = list.filter((t) => t !== tag);
    if (filtered.length === list.length) return false;
    setTagListToSettings(kind, filtered);
    return true;
}

function renderTagChips(root, kind) {
    const scope = root || state.overlay || document;
    const pool = scope.querySelector?.(`[data-pi-tag-pool="${kind}"]`);
    if (!pool) return;
    const input = pool.querySelector('.pi-tag-chip-pool__input');
    pool.querySelectorAll('.pi-chip').forEach((el) => el.remove());
    const list = getTagListFromSettings(kind);
    for (const tag of list) {
        const chip = document.createElement('span');
        chip.className = `pi-chip pi-chip--${kind}`;
        chip.dataset.piTag = tag;

        const textEl = document.createElement('span');
        textEl.className = 'pi-chip-text';
        textEl.textContent = tag;
        chip.appendChild(textEl);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'pi-chip-remove';
        removeBtn.textContent = '×';
        removeBtn.dataset.piTagRemove = tag;
        chip.appendChild(removeBtn);

        if (input) {
            pool.insertBefore(chip, input);
        } else {
            pool.appendChild(chip);
        }
    }
}

function bindTagChipPool(root, kind) {
    const scope = root || state.overlay || document;
    const pool = scope.querySelector?.(`[data-pi-tag-pool="${kind}"]`);
    if (!pool) return;
    const input = pool.querySelector('.pi-tag-chip-pool__input');
    if (!input) return;

    const commit = () => {
        const text = input.value;
        if (!text) return false;
        const added = addTagsFromText(kind, text);
        input.value = '';
        if (added) {
            renderTagChips(scope, kind);
        }
        return added;
    };

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',' || event.key === '，' || event.key === ';' || event.key === '；') {
            event.preventDefault();
            commit();
        } else if (event.key === 'Backspace' && input.value === '') {
            const list = getTagListFromSettings(kind);
            if (list.length > 0) {
                list.pop();
                setTagListToSettings(kind, list);
                renderTagChips(scope, kind);
            }
        }
    });

    input.addEventListener('blur', () => {
        if (input.value.trim()) commit();
    });

    input.addEventListener('paste', (event) => {
        const pasted = event.clipboardData?.getData?.('text');
        if (!pasted) return;
        if (/[,;\n\r，；]/.test(pasted)) {
            event.preventDefault();
            const combined = input.value + pasted;
            input.value = '';
            if (addTagsFromText(kind, combined)) {
                renderTagChips(scope, kind);
            }
        }
    });

    pool.addEventListener('click', (event) => {
        const removeBtn = event.target?.closest?.('.pi-chip-remove');
        if (removeBtn) {
            const tag = removeBtn.dataset.piTagRemove;
            if (tag !== undefined && removeTagByValue(kind, tag)) {
                renderTagChips(scope, kind);
            }
            return;
        }
        if (event.target === pool) {
            input.focus();
        }
    });
}

function applyCustomCss() {
    const settings = ensureSettings();
    let styleEl = document.querySelector('#pi-custom-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'pi-custom-style';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = String(settings.customCss || '');
}


function stripTaggedContent(text, tags) {
    if (!tags.length) {
        return String(text || '');
    }
    let result = String(text || '');
    for (const tag of tags) {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<\\s*${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\s*/\\s*${escaped}\\s*>`, 'gi');
        result = result.replace(regex, '');
    }
    return result;
}

function rebuildPromptPresetOptions(selectEl, customTemplates, kind) {
    if (!selectEl) {
        return;
    }
    const customGroupSelector = `${promptElementPrefixFor(kind)}_prompt_custom_group`;
    const customGroup = selectEl.querySelector(customGroupSelector);
    if (!customGroup) {
        return;
    }
    customGroup.innerHTML = '';
    const names = Object.keys(customTemplates || {}).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    for (const name of names) {
        const option = document.createElement('option');
        option.value = makeCustomTemplateKey(name);
        option.textContent = name;
        customGroup.appendChild(option);
    }
    customGroup.style.display = names.length ? '' : 'none';
}

function rebuildCssTemplateOptions(selectEl) {
    if (!selectEl) {
        return;
    }
    const customGroup = selectEl.querySelector('#pi_css_template_custom_group');
    if (!customGroup) {
        return;
    }
    const settings = ensureSettings();
    customGroup.innerHTML = '';
    const names = Object.keys(settings.customCssTemplates || {}).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    for (const name of names) {
        const option = document.createElement('option');
        option.value = makeCustomTemplateKey(name);
        option.textContent = name;
        customGroup.appendChild(option);
    }
    customGroup.style.display = names.length ? '' : 'none';
}

async function loadTemplate(templateName) {
    const url = new URL(`../../${templateName}.html`, import.meta.url);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${templateName}.html: ${response.status} ${response.statusText}`);
    }
    return response.text();
}

const defaultSettings = {
    enabled: true,
    showMenuEntry: true,
    autoOpenOnHome: false,
    presentationMode: 'barrage',
    textFontSize: 24,
    textColor: '#ffffff',
    textOpacity: 100,
    textStrokeWidth: 1.5,
    textStrokeColor: '#000000',
    autoAdaptColor: true,
    frameWidth: 420,
    frameHeight: 80,
    frameColor: '#1f2937',
    frameOpacity: 78,
    bubblePosition: 'top-right',
    bubbleOffsetX: 0,
    bubbleOffsetY: 0,
    bubbleShape: 'pill',
    barrageDuration: 22,
    barrageLineCount: 3,
    poolCharacterKeys: [],
    selectedCharacterKey: '',
    characterMessages: {},
    characterDrafts: {},
    retentionMessages: {},
    retentionDrafts: {},
    angerMessages: {},
    angerDrafts: {},
    jealousyMessages: {},
    birthdayMessages: {},
    reunionMessages: {},
    jealousyDrafts: {},
    birthdayDrafts: {},
    reunionDrafts: {},
    characterJealousyLabels: {},
    characterJealousyChances: {},
    characterBirthdays: {},
    characterUserBirthdays: {},
    characterDateEvents: {},
    dateEventConsumed: {},
    rejectCounts: {},
    angerThreshold: 5,
    angerResetOnAccept: true,
    angerAccentColor: '#c2415a',
    angerCountdownSeconds: 6,
    angerIntensity: 'restrained',
    angerPromptPreset: 'coldBack',
    angerPromptBody: '',
    angerCustomTemplates: {},
    angerAiPrompt: '',
    angerBatchCount: 8,
    angerGeneratedText: '',
    jealousyEnabled: false,
    jealousyChance: 45,
    jealousyWindowMinutes: 10,
    jealousyPromptPreset: 'teasingJealousy',
    jealousyPromptBody: '',
    jealousyCustomTemplates: {},
    jealousyAiPrompt: '',
    jealousyBatchCount: 8,
    jealousyGeneratedText: '',
    birthdayEnabled: true,
    userBirthday: '',
    customDateEvents: '',
    builtinDateEventsEnabled: false,
    birthdayPromptPreset: 'warmBirthday',
    birthdayPromptBody: '',
    birthdayCustomTemplates: {},
    birthdayAiPrompt: '',
    birthdayBatchCount: 8,
    birthdayGeneratedText: '',
    reunionEnabled: false,
    reunionThresholdDays: 30,
    reunionExtremeThresholdDays: 180,
    reunionNoChatPolicy: 'skip',
    reunionVisualIntensity: 70,
    reunionPromptPreset: 'quietReturn',
    reunionPromptBody: '',
    reunionCustomTemplates: {},
    reunionAiPrompt: '',
    reunionBatchCount: 8,
    reunionGeneratedText: '',
    characterChatFiles: {},
    selectedWorldNames: [],
    characterWorldNames: {},
    characterWorldEntries: {},
    poolText: '',
    homepageTriggerMode: 'session',
    homepageCooldownMinutes: 120,
    lastHomepageInviteAt: 0,
    aiPromptPreset: 'memoryFlashback',
    aiPromptBody: '',
    aiPrompt: '',
    aiBatchCount: 8,
    aiMaxTokens: 2400,
    aiGeneratedText: '',
    aiCustomTemplates: {},
    retentionPromptPreset: 'lastWhisper',
    retentionPromptBody: '',
    retentionAiPrompt: '',
    retentionBatchCount: 8,
    retentionGeneratedText: '',
    retentionCustomTemplates: {},
    aiUseChatContext: false,
    aiUseWorldInfo: false,
    chatFloorStart: 0,
    chatFloorEnd: 80,
    chatChunkSize: 40,
    chatBatchDelayMs: 500,
    stripHtmlNoise: true,
    chatFilterTags: '',
    chatExcludeTags: '',
    worldEntryLimit: 40,
    retentionChance: 35,
    continueOnDismiss: false,
    continuePickLimit: 3,
    coverEffect: 'breath',
    coverFit: 'contain',
    customCss: '',
    customCssTemplates: {},
    characterStyles: {},
    apiMode: 'shared',
    independentApiConfig: { apiUrl: '', apiKey: '', model: '' },
    apiProfiles: [],
    currentApiProfileId: '',
    panelTheme: 'midnight',
    debug: false,
};

const coverEffectKeys = ['breath', 'float', 'glow', 'parallax', 'static'];
const coverFitKeys = ['contain', 'cover', 'cover-zoom'];
const bubblePositionKeys = ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const bubbleShapeKeys = ['pill', 'cloud', 'sticker', 'note', 'frameless'];

const builtinCssTemplates = {
    blackWhite: `/* 黑白胶片 — 低饱和、加颗粒感 */
.pi-invitation-card .pi-invitation-cover,
.pi-invitation-card .pi-invitation-cover-backdrop {
    filter: grayscale(0.85) contrast(1.08) brightness(0.96);
}
.pi-invitation-card .pi-invitation-frame {
    border-color: rgba(255, 255, 255, 0.32);
}
.pi-invitation-card .pi-invitation-message {
    color: #f5f3ee;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.78);
}`,
    neonBorder: `/* 霓虹光边 — 紫色描边 + 发光 */
.pi-invitation-card {
    box-shadow: 0 0 0 1px rgba(186, 85, 255, 0.6), 0 0 36px rgba(140, 80, 255, 0.45), 0 30px 80px rgba(0, 0, 0, 0.6);
}
.pi-invitation-card .pi-invitation-frame {
    border-color: rgba(186, 85, 255, 0.85);
    box-shadow: inset 0 0 18px rgba(160, 80, 255, 0.5);
}
.pi-invitation-card .pi-invitation-name {
    text-shadow: 0 0 12px rgba(186, 85, 255, 0.8), 0 0 28px rgba(120, 60, 255, 0.55);
}
.pi-invitation-card .pi-invitation-message--bubble {
    border-color: rgba(186, 85, 255, 0.7);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 0 24px rgba(140, 80, 255, 0.45);
}`,
    vintage: `/* 复古暗调 — 棕调老照片 */
.pi-invitation-card .pi-invitation-cover,
.pi-invitation-card .pi-invitation-cover-backdrop {
    filter: sepia(0.55) contrast(1.08) saturate(0.9) brightness(0.94);
}
.pi-invitation-card .pi-invitation-cover-shade {
    background:
        radial-gradient(circle at 50% 30%, transparent 28%, rgba(60, 32, 18, 0.55)),
        linear-gradient(180deg, transparent 32%, rgba(40, 22, 12, 0.78));
}
.pi-invitation-card .pi-invitation-message {
    color: #f4e6c8;
    text-shadow: 0 3px 14px rgba(0, 0, 0, 0.85);
}`,
    palace: `/* 宫廷金边 — 金色细描边 + 暗紫底色 */
.pi-invitation-card {
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(212, 175, 55, 0.55);
}
.pi-invitation-card .pi-invitation-frame {
    inset: 10px;
    border-color: rgba(212, 175, 55, 0.7);
    border-width: 1.5px;
}
.pi-invitation-card .pi-invitation-frame::before,
.pi-invitation-card .pi-invitation-frame::after {
    width: 36px;
    height: 36px;
    border-color: rgba(220, 188, 90, 0.9);
}
.pi-invitation-card .pi-invitation-kicker {
    border-color: rgba(212, 175, 55, 0.7);
    color: #f5e6a8;
    letter-spacing: 0.18em;
}
.pi-invitation-card .pi-invitation-name {
    color: #f5e6a8;
    text-shadow: 0 0 18px rgba(120, 80, 20, 0.6);
}`,
    gothicShadow: `/* 暗黑哥特 — 深红 + 浓阴影 */
.pi-invitation-card .pi-invitation-cover-shade {
    background:
        radial-gradient(circle at 50% 20%, rgba(60, 0, 0, 0.55), transparent 42%),
        linear-gradient(180deg, transparent 22%, rgba(8, 0, 0, 0.92));
}
.pi-invitation-card .pi-invitation-frame {
    border-color: rgba(180, 30, 30, 0.55);
}
.pi-invitation-card .pi-invitation-name {
    color: #f1d8d8;
    text-shadow: 0 0 18px rgba(140, 18, 18, 0.78), 0 2px 4px rgba(0, 0, 0, 0.9);
}
.pi-invitation-card .pi-invitation-message--bubble {
    background: rgba(20, 4, 8, 0.78);
    border-color: rgba(180, 30, 30, 0.55);
}`,
    softGlow: `/* 柔光晕染 — 粉雾光晕 */
.pi-invitation-card .pi-invitation-cover {
    filter: brightness(1.06) contrast(0.96) saturate(1.05) drop-shadow(0 0 32px rgba(255, 192, 220, 0.42));
}
.pi-invitation-card .pi-invitation-cover-shade {
    background:
        radial-gradient(circle at 50% 30%, rgba(255, 200, 220, 0.18), transparent 45%),
        linear-gradient(180deg, transparent 40%, rgba(60, 20, 40, 0.62));
}
.pi-invitation-card .pi-invitation-name {
    color: #fff3f6;
    text-shadow: 0 0 18px rgba(255, 180, 210, 0.78);
}`,
    comicPanel: `/* 漫画分镜 — 粗黑边 + 半色调 */
.pi-invitation-card {
    border: 3px solid #050505;
    box-shadow: 8px 8px 0 0 rgba(0, 0, 0, 0.8);
}
.pi-invitation-card .pi-invitation-frame {
    border-color: rgba(0, 0, 0, 0.8);
    border-width: 2px;
}
.pi-invitation-card .pi-invitation-message--bubble {
    border: 2px solid #050505;
    border-radius: 28px 28px 28px 6px;
    background: rgba(255, 255, 255, 0.92);
    color: #050505;
    text-shadow: none;
}
.pi-invitation-card .pi-invitation-message--bubble::before {
    background: rgba(255, 255, 255, 0.92);
    border-color: #050505;
}`,
    cyberDream: `/* 赛博梦境 — 青蓝渐变 + 扫描线 */
.pi-invitation-card .pi-invitation-cover {
    filter: saturate(1.1) brightness(0.96) hue-rotate(-12deg);
}
.pi-invitation-card .pi-invitation-cover-shade {
    background:
        repeating-linear-gradient(0deg, rgba(120, 200, 255, 0.05) 0 2px, transparent 2px 5px),
        linear-gradient(180deg, transparent 32%, rgba(8, 12, 30, 0.82));
}
.pi-invitation-card .pi-invitation-frame {
    border-color: rgba(120, 220, 255, 0.55);
    box-shadow: inset 0 0 22px rgba(80, 180, 255, 0.42);
}
.pi-invitation-card .pi-invitation-name {
    color: #aef3ff;
    text-shadow: 0 0 12px rgba(80, 200, 255, 0.78);
}
.pi-invitation-card .pi-invitation-message--bubble {
    background: rgba(8, 18, 30, 0.7);
    border-color: rgba(80, 180, 255, 0.55);
    color: #d8f4ff;
}`,
};

const state = {
    initialized: false,
    settings: null,
    menuItem: null,
    settingsPanel: null,
    overlay: null,
    activeInvitation: null,
    activeTab: 'characters',
    activeScope: { ai: 'dialogue' },
    homepageInviteShown: false,
    sessionInvitationShown: false,
    wasHomepage: false,
    homepageCheckTimer: null,
    homepageRetryTimer: null,
    homepageStableSince: 0,
    homepageInvitePending: false,
    homepageInviteLoading: false,
    appReady: false,
    appReadyAt: 0,
    chatFileCache: new Map(),
    lastChatTimeCache: new Map(),
    activeChatCharacter: null,
    lastChatCharacter: null,
    lastChatJealousyAttemptToken: '',
    invitationFromConsoleTest: false,
    aiBatchAbortRequested: false,
    aiBatchActiveKind: null,
    shownThisRound: new Set(),
    continueCount: 0,
};

function cloneDefaults() {
    return JSON.parse(JSON.stringify(defaultSettings));
}

function normalizeColor(value, fallback) {
    const color = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(color) || /^#[0-9a-f]{3}$/i.test(color)) {
        return color;
    }
    return fallback;
}

function sanitizeIndependentApiConfig(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        apiUrl: String(source.apiUrl || '').trim(),
        apiKey: String(source.apiKey || '').trim(),
        model: String(source.model || '').trim(),
    };
}

function sanitizeApiProfileList(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seenIds = new Set();
    const profiles = [];
    raw.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
            return;
        }
        const id = String(entry.id || '').trim() || `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        if (seenIds.has(id)) {
            return;
        }
        seenIds.add(id);
        profiles.push({
            id,
            name: String(entry.name || '').trim() || id,
            apiUrl: String(entry.apiUrl || '').trim(),
            apiKey: String(entry.apiKey || '').trim(),
            model: String(entry.model || '').trim(),
            apiMode: entry.apiMode === 'shared' ? 'shared' : 'independent',
        });
    });
    return profiles;
}

function normalizeOpenAiBaseUrl(apiUrl) {
    let value = String(apiUrl || '').trim();
    if (!value) {
        return value;
    }

    value = value.replace(/[?#].*$/, '');
    const lowerValue = value.toLowerCase();
    for (const endpointPath of ['/chat/completions', '/models']) {
        const endpointIndex = lowerValue.indexOf(endpointPath);
        if (endpointIndex !== -1) {
            value = value.slice(0, endpointIndex);
            break;
        }
    }

    value = value.replace(/\/+$/, '');
    if (!/\/v1$/i.test(value)) {
        value = `${value}/v1`;
    }
    return value;
}

function getSillyTavernApiUrl(path) {
    return new URL(path, globalThis.location?.origin || globalThis.location?.href).toString();
}

function getSillyTavernRequestHeaders() {
    return {
        'Content-Type': 'application/json',
        ...(getContext?.()?.getRequestHeaders?.() || {}),
    };
}

function isIndependentApiConfigured(settings = ensureSettings()) {
    const cfg = settings.independentApiConfig || {};
    return Boolean(String(cfg.apiUrl || '').trim() && String(cfg.model || '').trim());
}

function buildIndependentApiPayload({ prompt, responseLength }) {
    const settings = ensureSettings();
    const { apiUrl, apiKey, model } = settings.independentApiConfig || {};
    if (!apiUrl || !model) {
        throw new Error('Independent API: missing apiUrl or model.');
    }

    const maxTokens = Number(responseLength);
    return {
        chat_completion_source: 'openai',
        reverse_proxy: normalizeOpenAiBaseUrl(apiUrl),
        proxy_password: String(apiKey || ''),
        model: String(model),
        messages: [
            { role: 'user', content: String(prompt || '') },
        ],
        stream: false,
        ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { max_tokens: Math.floor(maxTokens) } : {}),
    };
}

async function fetchAvailableModels(apiUrl, apiKey) {
    const baseUrl = normalizeOpenAiBaseUrl(apiUrl);
    if (!baseUrl) {
        throw new Error('API URL is required.');
    }

    const response = await fetch(getSillyTavernApiUrl('/api/backends/chat-completions/status'), {
        method: 'POST',
        headers: getSillyTavernRequestHeaders(),
        body: JSON.stringify({
            chat_completion_source: 'openai',
            reverse_proxy: baseUrl,
            proxy_password: String(apiKey || ''),
        }),
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}: ${errText.slice(0, 200)}`);
    }
    const data = await response.json();
    const models = [];
    if (Array.isArray(data?.data)) {
        for (const item of data.data) {
            if (item?.id) models.push(String(item.id));
        }
    } else if (Array.isArray(data)) {
        for (const item of data) {
            if (typeof item === 'string') models.push(item);
            else if (item?.id) models.push(String(item.id));
        }
    }
    return [...new Set(models)].sort((a, b) => a.localeCompare(b));
}

async function runIndependentGenerate({ prompt, responseLength, signal }) {
    const controller = signal ? null : new AbortController();
    const timeoutId = controller ? setTimeout(() => controller.abort(), 180_000) : null;
    try {
        const response = await fetch(getSillyTavernApiUrl('/api/backends/chat-completions/generate'), {
            method: 'POST',
            headers: getSillyTavernRequestHeaders(),
            body: JSON.stringify(buildIndependentApiPayload({ prompt, responseLength })),
            signal: signal || controller?.signal,
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Independent API ${response.status} ${response.statusText}: ${errorText.slice(0, 240)}`);
        }
        const data = await response.json();
        if (data?.error) {
            const message = data.error?.message || data.error || 'Independent API returned an error.';
            throw new Error(String(message));
        }
        const text = data?.choices?.[0]?.message?.content
            ?? data?.choices?.[0]?.text
            ?? data?.content
            ?? '';
        return String(text || '');
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function routeGenerate({ prompt, responseLength, trimNames = false }) {
    const settings = ensureSettings();
    if (settings.apiMode === 'independent' && isIndependentApiConfigured(settings)) {
        return runIndependentGenerate({ prompt, responseLength });
    }
    return generateRaw({ prompt, responseLength, trimNames });
}

function getCurrentApiProfile(settings = ensureSettings()) {
    if (!settings.currentApiProfileId) {
        return null;
    }
    return (settings.apiProfiles || []).find((profile) => profile.id === settings.currentApiProfileId) || null;
}

function saveCurrentApiProfileAs(name) {
    const settings = ensureSettings();
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
        throw new Error('Profile name is required.');
    }
    settings.apiProfiles = Array.isArray(settings.apiProfiles) ? settings.apiProfiles : [];
    const snapshot = {
        apiUrl: settings.independentApiConfig?.apiUrl || '',
        apiKey: settings.independentApiConfig?.apiKey || '',
        model: settings.independentApiConfig?.model || '',
        apiMode: settings.apiMode === 'independent' ? 'independent' : 'shared',
    };
    const existing = settings.apiProfiles.find((profile) => profile.name === trimmedName);
    if (existing) {
        existing.apiUrl = snapshot.apiUrl;
        existing.apiKey = snapshot.apiKey;
        existing.model = snapshot.model;
        existing.apiMode = snapshot.apiMode;
        settings.currentApiProfileId = existing.id;
        saveSettingsDebounced();
        return existing;
    }
    const profile = {
        id: `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmedName,
        ...snapshot,
    };
    settings.apiProfiles.push(profile);
    settings.currentApiProfileId = profile.id;
    saveSettingsDebounced();
    return profile;
}

function saveActiveApiProfile() {
    const settings = ensureSettings();
    const profile = getCurrentApiProfile(settings);
    if (!profile) {
        saveSettingsDebounced();
        return null;
    }
    profile.apiUrl = settings.independentApiConfig?.apiUrl || '';
    profile.apiKey = settings.independentApiConfig?.apiKey || '';
    profile.model = settings.independentApiConfig?.model || '';
    profile.apiMode = settings.apiMode === 'independent' ? 'independent' : 'shared';
    saveSettingsDebounced();
    return profile;
}

function applyApiProfile(profileId) {
    const settings = ensureSettings();
    const id = String(profileId || '');
    settings.currentApiProfileId = id;
    if (!id) {
        saveSettingsDebounced();
        return null;
    }
    const profile = (settings.apiProfiles || []).find((item) => item.id === id);
    if (!profile) {
        settings.currentApiProfileId = '';
        saveSettingsDebounced();
        return null;
    }
    settings.independentApiConfig = {
        apiUrl: profile.apiUrl || '',
        apiKey: profile.apiKey || '',
        model: profile.model || '',
    };
    settings.apiMode = profile.apiMode === 'independent' ? 'independent' : 'shared';
    saveSettingsDebounced();
    return profile;
}

function deleteCurrentApiProfile() {
    const settings = ensureSettings();
    if (!settings.currentApiProfileId) {
        return null;
    }
    const profile = (settings.apiProfiles || []).find((item) => item.id === settings.currentApiProfileId) || null;
    settings.apiProfiles = (settings.apiProfiles || []).filter((item) => item.id !== settings.currentApiProfileId);
    settings.currentApiProfileId = '';
    saveSettingsDebounced();
    return profile;
}

function ensureSettings() {
    if (!extension_settings[SETTINGS_KEY] || typeof extension_settings[SETTINGS_KEY] !== 'object') {
        extension_settings[SETTINGS_KEY] = cloneDefaults();
    }

    const settings = extension_settings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = Array.isArray(value) ? [...value] : value;
        }
    }

    settings.retentionChance = clampNumber(settings.retentionChance, 0, 100, defaultSettings.retentionChance);
    settings.continueOnDismiss = Boolean(settings.continueOnDismiss);
    settings.continuePickLimit = clampNumber(settings.continuePickLimit, 1, 10, defaultSettings.continuePickLimit);
    settings.presentationMode = ['barrage', 'bubble', 'banner'].includes(settings.presentationMode) ? settings.presentationMode : defaultSettings.presentationMode;
    settings.textFontSize = clampNumber(settings.textFontSize, 10, 72, defaultSettings.textFontSize);
    settings.textColor = normalizeColor(settings.textColor, defaultSettings.textColor);
    settings.textOpacity = clampNumber(settings.textOpacity, 0, 100, defaultSettings.textOpacity);
    settings.textStrokeWidth = clampNumber(settings.textStrokeWidth, 0, 4, defaultSettings.textStrokeWidth);
    settings.textStrokeColor = normalizeColor(settings.textStrokeColor, defaultSettings.textStrokeColor);
    settings.autoAdaptColor = Boolean(settings.autoAdaptColor);
    settings.frameWidth = clampNumber(settings.frameWidth, 120, 1200, defaultSettings.frameWidth);
    settings.frameHeight = clampNumber(settings.frameHeight, 40, 600, defaultSettings.frameHeight);
    settings.frameColor = normalizeColor(settings.frameColor, defaultSettings.frameColor);
    settings.frameOpacity = clampNumber(settings.frameOpacity, 0, 100, defaultSettings.frameOpacity);
    settings.bubblePosition = bubblePositionKeys.includes(settings.bubblePosition) ? settings.bubblePosition : defaultSettings.bubblePosition;
    settings.bubbleOffsetX = clampNumber(settings.bubbleOffsetX, -50, 50, defaultSettings.bubbleOffsetX);
    settings.bubbleOffsetY = clampNumber(settings.bubbleOffsetY, -50, 50, defaultSettings.bubbleOffsetY);
    settings.bubbleShape = bubbleShapeKeys.includes(settings.bubbleShape) ? settings.bubbleShape : defaultSettings.bubbleShape;
    settings.barrageDuration = clampNumber(settings.barrageDuration, 6, 60, defaultSettings.barrageDuration);
    settings.barrageLineCount = clampNumber(settings.barrageLineCount, 2, 8, defaultSettings.barrageLineCount);
    settings.poolCharacterKeys = Array.isArray(settings.poolCharacterKeys)
        ? [...new Set(settings.poolCharacterKeys.map(String))]
        : [];
    settings.selectedCharacterKey = String(settings.selectedCharacterKey || '');
    settings.characterMessages = settings.characterMessages && typeof settings.characterMessages === 'object' && !Array.isArray(settings.characterMessages)
        ? settings.characterMessages
        : {};
    settings.characterDrafts = settings.characterDrafts && typeof settings.characterDrafts === 'object' && !Array.isArray(settings.characterDrafts)
        ? settings.characterDrafts
        : {};
    settings.retentionMessages = settings.retentionMessages && typeof settings.retentionMessages === 'object' && !Array.isArray(settings.retentionMessages)
        ? settings.retentionMessages
        : {};
    settings.retentionDrafts = settings.retentionDrafts && typeof settings.retentionDrafts === 'object' && !Array.isArray(settings.retentionDrafts)
        ? settings.retentionDrafts
        : {};
    settings.angerMessages = settings.angerMessages && typeof settings.angerMessages === 'object' && !Array.isArray(settings.angerMessages)
        ? settings.angerMessages
        : {};
    settings.angerDrafts = settings.angerDrafts && typeof settings.angerDrafts === 'object' && !Array.isArray(settings.angerDrafts)
        ? settings.angerDrafts
        : {};
    settings.jealousyMessages = settings.jealousyMessages && typeof settings.jealousyMessages === 'object' && !Array.isArray(settings.jealousyMessages)
        ? settings.jealousyMessages
        : {};
    settings.birthdayMessages = settings.birthdayMessages && typeof settings.birthdayMessages === 'object' && !Array.isArray(settings.birthdayMessages)
        ? settings.birthdayMessages
        : {};
    settings.reunionMessages = settings.reunionMessages && typeof settings.reunionMessages === 'object' && !Array.isArray(settings.reunionMessages)
        ? settings.reunionMessages
        : {};
    settings.jealousyDrafts = settings.jealousyDrafts && typeof settings.jealousyDrafts === 'object' && !Array.isArray(settings.jealousyDrafts)
        ? settings.jealousyDrafts
        : {};
    settings.birthdayDrafts = settings.birthdayDrafts && typeof settings.birthdayDrafts === 'object' && !Array.isArray(settings.birthdayDrafts)
        ? settings.birthdayDrafts
        : {};
    settings.reunionDrafts = settings.reunionDrafts && typeof settings.reunionDrafts === 'object' && !Array.isArray(settings.reunionDrafts)
        ? settings.reunionDrafts
        : {};
    settings.characterJealousyLabels = settings.characterJealousyLabels && typeof settings.characterJealousyLabels === 'object' && !Array.isArray(settings.characterJealousyLabels)
        ? settings.characterJealousyLabels
        : {};
    settings.characterJealousyChances = sanitizeChanceRecord(settings.characterJealousyChances);
    settings.characterBirthdays = sanitizeMonthDayRecord(settings.characterBirthdays);
    settings.characterUserBirthdays = sanitizeMonthDayRecord(settings.characterUserBirthdays);
    settings.characterDateEvents = sanitizeStringRecord(settings.characterDateEvents);
    settings.dateEventConsumed = settings.dateEventConsumed && typeof settings.dateEventConsumed === 'object' && !Array.isArray(settings.dateEventConsumed)
        ? settings.dateEventConsumed
        : {};
    settings.rejectCounts = settings.rejectCounts && typeof settings.rejectCounts === 'object' && !Array.isArray(settings.rejectCounts)
        ? settings.rejectCounts
        : {};
    settings.angerThreshold = clampNumber(settings.angerThreshold, 2, 50, defaultSettings.angerThreshold);
    settings.angerResetOnAccept = Boolean(settings.angerResetOnAccept);
    settings.angerAccentColor = normalizeColor(settings.angerAccentColor, defaultSettings.angerAccentColor);
    settings.angerCountdownSeconds = clampNumber(settings.angerCountdownSeconds, 3, 20, defaultSettings.angerCountdownSeconds);
    settings.angerIntensity = angerIntensityKeys.includes(settings.angerIntensity) ? settings.angerIntensity : defaultSettings.angerIntensity;
    settings.angerPromptPreset = angerPromptPresetKeys.includes(settings.angerPromptPreset) || isCustomTemplateKey(settings.angerPromptPreset)
        ? settings.angerPromptPreset
        : defaultSettings.angerPromptPreset;
    settings.angerPromptBody = String(settings.angerPromptBody || '');
    settings.angerCustomTemplates = sanitizeTemplateMap(settings.angerCustomTemplates);
    settings.angerAiPrompt = String(settings.angerAiPrompt || '');
    settings.angerBatchCount = clampNumber(settings.angerBatchCount, 3, 30, defaultSettings.angerBatchCount);
    settings.angerGeneratedText = String(settings.angerGeneratedText || '');
    settings.jealousyEnabled = Boolean(settings.jealousyEnabled);
    settings.jealousyChance = clampNumber(settings.jealousyChance, 0, 100, defaultSettings.jealousyChance);
    settings.jealousyWindowMinutes = clampNumber(settings.jealousyWindowMinutes, 1, 1440, defaultSettings.jealousyWindowMinutes);
    settings.jealousyPromptPreset = jealousyPromptPresetKeys.includes(settings.jealousyPromptPreset) || isCustomTemplateKey(settings.jealousyPromptPreset)
        ? settings.jealousyPromptPreset
        : defaultSettings.jealousyPromptPreset;
    settings.jealousyPromptBody = String(settings.jealousyPromptBody || '');
    settings.jealousyCustomTemplates = sanitizeTemplateMap(settings.jealousyCustomTemplates);
    settings.jealousyAiPrompt = String(settings.jealousyAiPrompt || '');
    settings.jealousyBatchCount = clampNumber(settings.jealousyBatchCount, 3, 30, defaultSettings.jealousyBatchCount);
    settings.jealousyGeneratedText = String(settings.jealousyGeneratedText || '');
    settings.birthdayEnabled = settings.birthdayEnabled !== false;
    settings.userBirthday = String(settings.userBirthday || '');
    settings.customDateEvents = String(settings.customDateEvents || '');
    settings.builtinDateEventsEnabled = Boolean(settings.builtinDateEventsEnabled);
    settings.birthdayPromptPreset = birthdayPromptPresetKeys.includes(settings.birthdayPromptPreset) || isCustomTemplateKey(settings.birthdayPromptPreset)
        ? settings.birthdayPromptPreset
        : defaultSettings.birthdayPromptPreset;
    settings.birthdayPromptBody = String(settings.birthdayPromptBody || '');
    settings.birthdayCustomTemplates = sanitizeTemplateMap(settings.birthdayCustomTemplates);
    settings.birthdayAiPrompt = String(settings.birthdayAiPrompt || '');
    settings.birthdayBatchCount = clampNumber(settings.birthdayBatchCount, 3, 30, defaultSettings.birthdayBatchCount);
    settings.birthdayGeneratedText = String(settings.birthdayGeneratedText || '');
    settings.reunionEnabled = Boolean(settings.reunionEnabled);
    settings.reunionThresholdDays = clampNumber(settings.reunionThresholdDays, 1, 3650, defaultSettings.reunionThresholdDays);
    settings.reunionExtremeThresholdDays = clampNumber(settings.reunionExtremeThresholdDays, settings.reunionThresholdDays, 3650, defaultSettings.reunionExtremeThresholdDays);
    settings.reunionNoChatPolicy = reunionNoChatPolicyKeys.includes(settings.reunionNoChatPolicy) ? settings.reunionNoChatPolicy : defaultSettings.reunionNoChatPolicy;
    settings.reunionVisualIntensity = clampNumber(settings.reunionVisualIntensity, 0, 100, defaultSettings.reunionVisualIntensity);
    settings.reunionPromptPreset = reunionPromptPresetKeys.includes(settings.reunionPromptPreset) || isCustomTemplateKey(settings.reunionPromptPreset)
        ? settings.reunionPromptPreset
        : defaultSettings.reunionPromptPreset;
    settings.reunionPromptBody = String(settings.reunionPromptBody || '');
    settings.reunionCustomTemplates = sanitizeTemplateMap(settings.reunionCustomTemplates);
    settings.reunionAiPrompt = String(settings.reunionAiPrompt || '');
    settings.reunionBatchCount = clampNumber(settings.reunionBatchCount, 3, 30, defaultSettings.reunionBatchCount);
    settings.reunionGeneratedText = String(settings.reunionGeneratedText || '');
    settings.characterChatFiles = settings.characterChatFiles && typeof settings.characterChatFiles === 'object' && !Array.isArray(settings.characterChatFiles)
        ? settings.characterChatFiles
        : {};
    settings.selectedWorldNames = Array.isArray(settings.selectedWorldNames)
        ? [...new Set(settings.selectedWorldNames.map(String))]
        : [];
    settings.characterWorldNames = settings.characterWorldNames && typeof settings.characterWorldNames === 'object' && !Array.isArray(settings.characterWorldNames)
        ? settings.characterWorldNames
        : {};
    settings.characterWorldEntries = settings.characterWorldEntries && typeof settings.characterWorldEntries === 'object' && !Array.isArray(settings.characterWorldEntries)
        ? settings.characterWorldEntries
        : {};
    settings.homepageTriggerMode = homepageTriggerModes.includes(settings.homepageTriggerMode) ? settings.homepageTriggerMode : defaultSettings.homepageTriggerMode;
    settings.homepageCooldownMinutes = clampNumber(settings.homepageCooldownMinutes, 1, 10080, defaultSettings.homepageCooldownMinutes);
    settings.lastHomepageInviteAt = clampNumber(settings.lastHomepageInviteAt, 0, Number.MAX_SAFE_INTEGER, 0);
    settings.aiPromptPreset = promptPresetKeys.includes(settings.aiPromptPreset) || isCustomTemplateKey(settings.aiPromptPreset)
        ? settings.aiPromptPreset
        : defaultSettings.aiPromptPreset;
    settings.aiBatchCount = clampNumber(settings.aiBatchCount, 3, 30, defaultSettings.aiBatchCount);
    settings.aiMaxTokens = clampNumber(settings.aiMaxTokens, 800, 16000, defaultSettings.aiMaxTokens);
    settings.aiPromptBody = String(settings.aiPromptBody || '');
    settings.aiCustomTemplates = sanitizeTemplateMap(settings.aiCustomTemplates);
    settings.aiGeneratedText = String(settings.aiGeneratedText || '');
    settings.retentionPromptPreset = retentionPromptPresetKeys.includes(settings.retentionPromptPreset) || isCustomTemplateKey(settings.retentionPromptPreset)
        ? settings.retentionPromptPreset
        : defaultSettings.retentionPromptPreset;
    settings.retentionPromptBody = String(settings.retentionPromptBody || '');
    settings.retentionCustomTemplates = sanitizeTemplateMap(settings.retentionCustomTemplates);
    settings.retentionAiPrompt = String(settings.retentionAiPrompt || '');
    settings.retentionBatchCount = clampNumber(settings.retentionBatchCount, 3, 30, defaultSettings.retentionBatchCount);
    settings.retentionGeneratedText = String(settings.retentionGeneratedText || '');
    settings.aiUseChatContext = Boolean(settings.aiUseChatContext);
    settings.aiUseWorldInfo = Boolean(settings.aiUseWorldInfo);
    settings.chatFloorStart = clampNumber(settings.chatFloorStart, 0, 999999, defaultSettings.chatFloorStart);
    settings.chatFloorEnd = clampNumber(settings.chatFloorEnd, 0, 999999, defaultSettings.chatFloorEnd);
    if (settings.chatFloorEnd < settings.chatFloorStart) {
        settings.chatFloorEnd = settings.chatFloorStart;
    }
    settings.chatChunkSize = clampNumber(settings.chatChunkSize, 1, 500, defaultSettings.chatChunkSize);
    settings.chatBatchDelayMs = clampNumber(settings.chatBatchDelayMs, 0, 5000, defaultSettings.chatBatchDelayMs);
    settings.stripHtmlNoise = settings.stripHtmlNoise !== false;
    settings.chatFilterTags = String(settings.chatFilterTags || '');
    settings.chatExcludeTags = String(settings.chatExcludeTags || '');
    settings.worldEntryLimit = clampNumber(settings.worldEntryLimit, 1, 300, defaultSettings.worldEntryLimit);
    settings.coverEffect = coverEffectKeys.includes(settings.coverEffect) ? settings.coverEffect : defaultSettings.coverEffect;
    settings.coverFit = coverFitKeys.includes(settings.coverFit) ? settings.coverFit : defaultSettings.coverFit;
    settings.customCss = String(settings.customCss || '');
    settings.customCssTemplates = sanitizeTemplateMap(settings.customCssTemplates);
    settings.characterStyles = settings.characterStyles && typeof settings.characterStyles === 'object' && !Array.isArray(settings.characterStyles)
        ? settings.characterStyles
        : {};
    settings.apiMode = settings.apiMode === 'independent' ? 'independent' : 'shared';
    settings.independentApiConfig = sanitizeIndependentApiConfig(settings.independentApiConfig);
    settings.apiProfiles = sanitizeApiProfileList(settings.apiProfiles);
    settings.currentApiProfileId = String(settings.currentApiProfileId || '');
    if (settings.currentApiProfileId && !settings.apiProfiles.some((p) => p.id === settings.currentApiProfileId)) {
        settings.currentApiProfileId = '';
    }
    settings.panelTheme = panelThemeKeys.includes(settings.panelTheme) ? settings.panelTheme : defaultSettings.panelTheme;
    settings.enabled = Boolean(settings.enabled);
    settings.showMenuEntry = Boolean(settings.showMenuEntry);
    settings.autoOpenOnHome = Boolean(settings.autoOpenOnHome);
    settings.debug = Boolean(settings.debug);

    state.settings = settings;
    return settings;
}

function parsePoolList(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatLocalDateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatMonthDay(date = new Date()) {
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function normalizeMonthDay(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    const match = text.match(/^(\d{1,2})[-/.月](\d{1,2})(?:日)?$/);
    if (!match) {
        return '';
    }
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
        return '';
    }
    const test = new Date(2024, month - 1, day);
    if (test.getMonth() !== month - 1 || test.getDate() !== day) {
        return '';
    }
    return `${pad2(month)}-${pad2(day)}`;
}

function getPeriodLabel(date = new Date()) {
    const hour = date.getHours();
    if (hour < 5) return t('invitation.period.deepNight');
    if (hour < 9) return t('invitation.period.morning');
    if (hour < 12) return t('invitation.period.forenoon');
    if (hour < 14) return t('invitation.period.noon');
    if (hour < 18) return t('invitation.period.afternoon');
    if (hour < 22) return t('invitation.period.evening');
    return t('invitation.period.night');
}

function parseTimestamp(value) {
    if (value === undefined || value === null || value === '') {
        return 0;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatDisplayDate(timestamp) {
    const time = parseTimestamp(timestamp);
    if (!time) {
        return '';
    }
    const date = new Date(time);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getDaysBetween(fromMs, toMs = Date.now()) {
    const start = parseTimestamp(fromMs);
    const end = parseTimestamp(toMs);
    if (!start || !end || end < start) {
        return 0;
    }
    return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function getDaysUntilMonthDay(monthDay, now = new Date()) {
    const normalized = normalizeMonthDay(monthDay);
    if (!normalized) {
        return '';
    }
    const [month, day] = normalized.split('-').map(Number);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let target = new Date(now.getFullYear(), month - 1, day);
    if (target < today) {
        target = new Date(now.getFullYear() + 1, month - 1, day);
    }
    return Math.round((target - today) / (24 * 60 * 60 * 1000));
}

function parseCustomDateEvents(value, keyPrefix = 'custom') {
    return String(value || '')
        .split(/\r?\n/)
        .map((line, index) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return null;
            }
            const match = trimmed.match(/^(\S+)\s+(.+)$/);
            const date = normalizeMonthDay(match ? match[1] : trimmed);
            const name = String(match ? match[2] : '').trim();
            if (!date || !name) {
                return null;
            }
            return {
                key: `${keyPrefix}:${index}:${date}:${name}`,
                date,
                name,
            };
        })
        .filter(Boolean);
}

function getCharacterKey(character, id) {
    return String(character?.avatar || character?.name || id);
}

function getAvailableCharacters() {
    return (characters || [])
        .map((character, id) => {
            if (!character || typeof character !== 'object') {
                return null;
            }

            const name = String(character.name || '').trim();
            const avatar = character.avatar && character.avatar !== 'none' ? character.avatar : '';
            return {
                id,
                key: getCharacterKey(character, id),
                name: name || t('invitation.unknownCharacter'),
                avatar,
                character,
            };
        })
        .filter(Boolean);
}

function getCharacterAvatarUrl(characterInfo) {
    if (!characterInfo) {
        return '';
    }

    if (characterInfo.avatar) {
        return getThumbnailUrl('avatar', characterInfo.avatar);
    }

    return getCharacterAvatar(characterInfo.id);
}

function findCharacterByKey(key) {
    const normalizedKey = String(key || '');
    return getAvailableCharacters().find((characterInfo) => String(characterInfo.key) === normalizedKey) || null;
}

function findCharacterById(id) {
    const normalizedId = String(id ?? '');
    return getAvailableCharacters().find((characterInfo) => String(characterInfo.id) === normalizedId) || null;
}

function getSelectedCharacter() {
    const settings = ensureSettings();
    const current = findCharacterByKey(settings.selectedCharacterKey);
    if (current) {
        return current;
    }

    const firstPoolCharacter = resolvePoolCharacters()[0] || getAvailableCharacters()[0] || null;
    if (firstPoolCharacter) {
        settings.selectedCharacterKey = firstPoolCharacter.key;
    }
    return firstPoolCharacter;
}

function resolvePoolCharacters() {
    const settings = ensureSettings();
    const selectedKeys = new Set(settings.poolCharacterKeys || []);
    const manualEntries = parsePoolList(settings.poolText).map((entry) => entry.toLowerCase());
    const hasExplicitPool = selectedKeys.size > 0 || manualEntries.length > 0;
    const available = getAvailableCharacters();

    if (!hasExplicitPool) {
        return available;
    }

    return available.filter((characterInfo) => {
        const id = String(characterInfo.id);
        const key = String(characterInfo.key);
        const name = String(characterInfo.name).toLowerCase();
        const avatar = String(characterInfo.avatar || '').toLowerCase();

        if (selectedKeys.has(key) || selectedKeys.has(id)) {
            return true;
        }

        return manualEntries.some((entry) => entry === id || entry === name || entry === avatar || entry === key.toLowerCase());
    });
}

function syncPoolSelectionFromDom(root = document) {
    const settings = ensureSettings();
    const list = root.querySelector?.('#pi_character_list');
    if (list && list.dataset.rendering === 'true') {
        return;
    }

    const checkboxes = Array.from(root.querySelectorAll('input[data-pi-character-key]'));
    if (!checkboxes.length) {
        return;
    }

    const renderedKeys = new Set(checkboxes.map((checkbox) => checkbox.dataset.piCharacterKey).filter(Boolean));
    const selectedKeys = new Set(settings.poolCharacterKeys || []);
    renderedKeys.forEach((key) => selectedKeys.delete(key));
    checkboxes.forEach((checkbox) => {
        if (checkbox.checked && checkbox.dataset.piCharacterKey) {
            selectedKeys.add(checkbox.dataset.piCharacterKey);
        }
    });

    settings.poolCharacterKeys = Array.from(selectedKeys);
}

function renderCharacterPool(root = state.overlay || document) {
    const list = root?.querySelector?.('#pi_character_list');
    if (!list) {
        return;
    }

    const settings = ensureSettings();
    const search = String(root.querySelector('#pi_pool_search')?.value || '').trim().toLowerCase();
    const selectedKeys = new Set(settings.poolCharacterKeys || []);
    const available = getAvailableCharacters();
    const filtered = available.filter((characterInfo) => {
        if (!search) {
            return true;
        }
        return characterInfo.name.toLowerCase().includes(search)
            || String(characterInfo.avatar || '').toLowerCase().includes(search)
            || String(characterInfo.id).includes(search);
    }).sort((a, b) => {
        const aSelected = selectedKeys.has(a.key);
        const bSelected = selectedKeys.has(b.key);
        if (aSelected !== bSelected) {
            return aSelected ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    const count = root.querySelector('#pi_pool_count');
    if (count) {
        count.textContent = t('console.pool.selectedCount', {
            selected: selectedKeys.size,
            total: available.length,
        });
    }

    if (!available.length) {
        list.dataset.rendering = 'true';
        list.innerHTML = `<div class="pi-empty">${t('console.pool.noCharacters')}</div>`;
        list.dataset.rendering = 'false';
        return;
    }

    if (!filtered.length) {
        list.dataset.rendering = 'true';
        list.innerHTML = `<div class="pi-empty">${t('console.pool.noMatches')}</div>`;
        list.dataset.rendering = 'false';
        return;
    }

    list.dataset.rendering = 'true';
    list.innerHTML = filtered.map((characterInfo) => {
        const checked = selectedKeys.has(characterInfo.key) ? 'checked' : '';
        const avatarUrl = getCharacterAvatarUrl(characterInfo);
        return `
            <label class="pi-character-row">
                <input type="checkbox" data-pi-character-key="${escapeHtml(characterInfo.key)}" ${checked}>
                <img class="pi-character-avatar" src="${escapeHtml(avatarUrl)}" alt="">
                <span class="pi-character-info">
                    <strong>${escapeHtml(characterInfo.name)}</strong>
                    <small>${escapeHtml(characterInfo.avatar || `#${characterInfo.id}`)}</small>
                </span>
            </label>
        `;
    }).join('');
    list.dataset.rendering = 'false';
}

function renderCharacterSelect(root = state.overlay || document) {
    const select = root?.querySelector?.('#pi_copy_character');
    const list = root?.querySelector?.('#pi_copy_character_list');
    const searchInput = root?.querySelector?.('#pi_copy_character_search');
    if (!select) {
        return;
    }

    const settings = ensureSettings();
    const available = getAvailableCharacters();
    if (!available.length) {
        select.innerHTML = `<option value="">${escapeHtml(t('console.dialogue.noCharacters'))}</option>`;
        if (list) {
            list.innerHTML = `<div class="pi-empty">${t('console.dialogue.noCharacters')}</div>`;
        }
        return;
    }

    const selected = getSelectedCharacter();
    select.innerHTML = available.map((characterInfo) => `
        <option value="${escapeHtml(characterInfo.key)}">${escapeHtml(characterInfo.name)}</option>
    `).join('');
    const targetKey = selected?.key || available[0].key;
    select.value = targetKey;
    if (settings.selectedCharacterKey !== targetKey) {
        settings.selectedCharacterKey = targetKey;
    }

    if (!list) {
        return;
    }

    const search = String(searchInput?.value || '').trim().toLowerCase();
    const poolKeys = new Set((settings.poolCharacterKeys || []).map(String));
    const filtered = available.filter((characterInfo) => {
        if (!search) {
            return true;
        }
        return characterInfo.name.toLowerCase().includes(search)
            || String(characterInfo.avatar || '').toLowerCase().includes(search)
            || String(characterInfo.id).includes(search);
    }).sort((a, b) => {
        const aSelected = a.key === settings.selectedCharacterKey;
        const bSelected = b.key === settings.selectedCharacterKey;
        if (aSelected !== bSelected) {
            return aSelected ? -1 : 1;
        }
        const aPool = poolKeys.has(a.key);
        const bPool = poolKeys.has(b.key);
        if (aPool !== bPool) {
            return aPool ? -1 : 1;
        }
        const aTotal = parsePoolList(settings.characterMessages?.[a.key] || '').length
            + parsePoolList(settings.retentionMessages?.[a.key] || '').length;
        const bTotal = parsePoolList(settings.characterMessages?.[b.key] || '').length
            + parsePoolList(settings.retentionMessages?.[b.key] || '').length;
        if (aTotal !== bTotal) {
            return bTotal - aTotal;
        }
        return a.name.localeCompare(b.name);
    });

    if (!filtered.length) {
        list.innerHTML = `<div class="pi-empty">${t('console.pool.noMatches')}</div>`;
        return;
    }

    list.innerHTML = filtered.map((characterInfo) => {
        const checked = characterInfo.key === settings.selectedCharacterKey ? 'checked' : '';
        const avatarUrl = getCharacterAvatarUrl(characterInfo);
        const dialogueCount = parsePoolList(settings.characterMessages?.[characterInfo.key] || '').length;
        const retentionCount = parsePoolList(settings.retentionMessages?.[characterInfo.key] || '').length;
        const hasStyle = settings.characterStyles?.[characterInfo.key]?.enabled;
        const inPool = poolKeys.has(characterInfo.key);
        const badges = [];
        if (inPool) {
            badges.push(`<span class="pi-badge-mini pi-badge-mini--pool" title="${escapeHtml(t('console.dialogue.badgePool'))}">★</span>`);
        }
        if (dialogueCount > 0 || retentionCount > 0) {
            const text = retentionCount > 0 ? `📝${dialogueCount}+${retentionCount}` : `📝${dialogueCount}`;
            const title = retentionCount > 0
                ? t('console.dialogue.badgeCombined', { dialogue: dialogueCount, retention: retentionCount })
                : t('console.dialogue.badgeCopy', { count: dialogueCount });
            badges.push(`<span class="pi-badge-mini pi-badge-mini--copy" title="${escapeHtml(title)}">${text}</span>`);
        }
        if (hasStyle) {
            badges.push(`<span class="pi-badge-mini pi-badge-mini--style" title="${escapeHtml(t('console.dialogue.badgeStyle'))}">🎨</span>`);
        }
        return `
            <label class="pi-picker-row">
                <input type="radio" name="pi_copy_character_picker" data-pi-copy-character-key="${escapeHtml(characterInfo.key)}" ${checked}>
                <img class="pi-character-avatar" src="${escapeHtml(avatarUrl)}" alt="">
                <span class="pi-character-info">
                    <strong>${escapeHtml(characterInfo.name)}</strong>
                    <small>${escapeHtml(characterInfo.avatar || `#${characterInfo.id}`)}</small>
                </span>
                <span class="pi-picker-badges">${badges.join('')}</span>
            </label>
        `;
    }).join('');
}

function renderCurrentCharacterBanner(root = state.overlay || document) {
    const banner = root?.querySelector?.('#pi_current_character_banner');
    if (!banner) {
        return;
    }
    const characterInfo = getSelectedCharacter();
    const nameEl = banner.querySelector('[data-pi-current-character-name]');
    const avatarEl = banner.querySelector('[data-pi-current-character-avatar]');
    if (characterInfo) {
        banner.removeAttribute('data-pi-empty');
        if (nameEl) {
            nameEl.textContent = characterInfo.name || t('invitation.unknownCharacter');
        }
        if (avatarEl) {
            avatarEl.src = getCharacterAvatarUrl(characterInfo);
            avatarEl.alt = characterInfo.name || '';
        }
    } else {
        banner.setAttribute('data-pi-empty', 'true');
        if (nameEl) {
            nameEl.textContent = t('console.ai.currentCharacterNone');
        }
        if (avatarEl) {
            avatarEl.removeAttribute('src');
            avatarEl.alt = '';
        }
    }
}

function updateDialogueCount(root = state.overlay || document) {
    const count = root?.querySelector?.('#pi_dialogue_count');
    if (!count) {
        return;
    }

    const characterInfo = getSelectedCharacter();
    if (!characterInfo) {
        count.textContent = '';
        return;
    }

    const settings = ensureSettings();
    const lines = parsePoolList(settings.characterMessages[characterInfo.key] || '');
    count.textContent = t('console.dialogue.savedCount', {
        char: characterInfo.name || t('invitation.unknownCharacter'),
        count: lines.length,
    });
}

function updateRetentionCount(root = state.overlay || document) {
    const count = root?.querySelector?.('#pi_retention_count');
    if (!count) {
        return;
    }

    const characterInfo = getSelectedCharacter();
    if (!characterInfo) {
        count.textContent = '';
        return;
    }

    const settings = ensureSettings();
    const lines = parsePoolList(settings.retentionMessages[characterInfo.key] || '');
    count.textContent = t('console.retention.savedCount', {
        char: characterInfo.name || t('invitation.unknownCharacter'),
        count: lines.length,
    });
}

function migrateLegacyDraftToSelectedCharacter(characterInfo) {
    const settings = ensureSettings();
    const hasDrafts = Object.values(settings.characterDrafts).some((value) => String(value || '').trim());
    if (!characterInfo?.key || hasDrafts || !settings.aiGeneratedText || settings.characterDrafts[characterInfo.key]) {
        return;
    }

    settings.characterDrafts[characterInfo.key] = settings.aiGeneratedText;
    settings.aiGeneratedText = '';
}

function getDialogueDraftText(characterInfo) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return '';
    }

    migrateLegacyDraftToSelectedCharacter(characterInfo);
    return String(settings.characterDrafts[characterInfo.key] || '');
}

function setDialogueDraftText(characterInfo, text) {
    const settings = ensureSettings();
    const value = String(text || '');
    if (characterInfo?.key) {
        settings.characterDrafts[characterInfo.key] = value;
    }
    settings.aiGeneratedText = '';
}

function getRetentionDraftText(characterInfo) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return '';
    }

    return String(settings.retentionDrafts[characterInfo.key] || '');
}

function setRetentionDraftText(characterInfo, text) {
    const settings = ensureSettings();
    const value = String(text || '');
    if (characterInfo?.key) {
        settings.retentionDrafts[characterInfo.key] = value;
    }
    settings.retentionGeneratedText = '';
}

function getAngerDraftText(characterInfo) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return '';
    }
    return String(settings.angerDrafts[characterInfo.key] || '');
}

function setAngerDraftText(characterInfo, text) {
    const settings = ensureSettings();
    const value = String(text || '');
    if (characterInfo?.key) {
        settings.angerDrafts[characterInfo.key] = value;
    }
    settings.angerGeneratedText = '';
}

function getDraftLines(characterInfo, kind) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return [];
    }
    if (kind === 'dialogue' || !kind) {
        migrateLegacyDraftToSelectedCharacter(characterInfo);
    }
    const field = draftFieldFor(kind);
    const text = String(settings[field]?.[characterInfo.key] || '');
    return parseGeneratedLines(text);
}

function setDraftLines(characterInfo, kind, lines) {
    const settings = ensureSettings();
    const text = (lines || []).filter(Boolean).join('\n');
    if (characterInfo?.key) {
        const field = draftFieldFor(kind);
        if (!settings[field] || typeof settings[field] !== 'object') {
            settings[field] = {};
        }
        settings[field][characterInfo.key] = text;
    }
    settings[generatedTextFieldFor(kind)] = '';
}

function appendDraftLines(characterInfo, kind, newLines) {
    if (!characterInfo || !newLines?.length) {
        return;
    }
    const existing = getDraftLines(characterInfo, kind);
    setDraftLines(characterInfo, kind, [...existing, ...newLines.filter(Boolean)]);
}

function removeDraftLineAt(characterInfo, kind, index) {
    const lines = getDraftLines(characterInfo, kind);
    if (index < 0 || index >= lines.length) {
        return;
    }
    lines.splice(index, 1);
    setDraftLines(characterInfo, kind, lines);
}

function clearDraft(characterInfo, kind) {
    setDraftLines(characterInfo, kind, []);
}

function poolFieldFor(kind) {
    if (kind === 'retention') return 'retentionMessages';
    if (kind === 'anger') return 'angerMessages';
    if (kind === 'jealousy') return 'jealousyMessages';
    if (kind === 'birthday') return 'birthdayMessages';
    if (kind === 'reunion') return 'reunionMessages';
    return 'characterMessages';
}

function draftFieldFor(kind) {
    if (kind === 'retention') return 'retentionDrafts';
    if (kind === 'anger') return 'angerDrafts';
    if (kind === 'jealousy') return 'jealousyDrafts';
    if (kind === 'birthday') return 'birthdayDrafts';
    if (kind === 'reunion') return 'reunionDrafts';
    return 'characterDrafts';
}

function generatedTextFieldFor(kind) {
    if (kind === 'retention') return 'retentionGeneratedText';
    if (kind === 'anger') return 'angerGeneratedText';
    if (kind === 'jealousy') return 'jealousyGeneratedText';
    if (kind === 'birthday') return 'birthdayGeneratedText';
    if (kind === 'reunion') return 'reunionGeneratedText';
    return 'aiGeneratedText';
}

function modeI18nScopeFor(kind) {
    if (kind === 'retention') return 'retention';
    if (kind === 'anger') return 'anger';
    if (kind === 'jealousy') return 'jealousy';
    if (kind === 'birthday') return 'birthday';
    if (kind === 'reunion') return 'reunion';
    return 'dialogue';
}

function promptElementPrefixFor(kind) {
    return kind === 'dialogue' || !kind ? '#pi_ai' : `#pi_${kind}`;
}

function aiDraftElementPrefixFor(kind) {
    return kind === 'dialogue' || !kind ? '#pi_ai' : `#pi_${kind}_ai`;
}

function getPoolLines(characterInfo, kind) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return [];
    }
    const target = settings[poolFieldFor(kind)];
    return parsePoolList(target?.[characterInfo.key] || '');
}

function setPoolLines(characterInfo, kind, lines) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return;
    }
    const field = poolFieldFor(kind);
    if (!settings[field] || typeof settings[field] !== 'object') {
        settings[field] = {};
    }
    settings[field][characterInfo.key] = (lines || []).map((line) => String(line || '').trim()).filter(Boolean).join('\n');
}

function appendPoolLines(characterInfo, kind, newLines) {
    const lines = getPoolLines(characterInfo, kind);
    const incoming = (newLines || []).map((line) => String(line || '').trim()).filter(Boolean);
    if (!incoming.length) {
        return;
    }
    setPoolLines(characterInfo, kind, [...lines, ...incoming]);
}

function getModePoolLabel(kind) {
    if (kind === 'retention') return t('console.retention.poolName');
    if (kind === 'anger') return t('console.anger.poolName');
    if (kind === 'jealousy') return t('console.jealousy.poolName');
    if (kind === 'birthday') return t('console.birthday.poolName');
    if (kind === 'reunion') return t('console.reunion.poolName');
    return t('console.dialogue.poolName');
}

function removePoolLineAt(characterInfo, kind, index) {
    const lines = getPoolLines(characterInfo, kind);
    if (index < 0 || index >= lines.length) {
        return;
    }
    lines.splice(index, 1);
    setPoolLines(characterInfo, kind, lines);
}

function moveDraftLineToPool(characterInfo, kind, index) {
    const lines = getDraftLines(characterInfo, kind);
    if (index < 0 || index >= lines.length) {
        return;
    }
    const [line] = lines.splice(index, 1);
    appendPoolLines(characterInfo, kind, [line]);
    setDraftLines(characterInfo, kind, lines);
}

function moveAllDraftToPool(characterInfo, kind) {
    const lines = getDraftLines(characterInfo, kind);
    if (!lines.length) {
        return false;
    }
    appendPoolLines(characterInfo, kind, lines);
    setDraftLines(characterInfo, kind, []);
    return true;
}

function getSelectedChatFiles(characterInfo) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return [];
    }

    return Array.isArray(settings.characterChatFiles[characterInfo.key])
        ? settings.characterChatFiles[characterInfo.key].map(String)
        : [];
}

function setSelectedChatFiles(characterInfo, files) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return;
    }

    settings.characterChatFiles[characterInfo.key] = [...new Set((files || []).map(String).filter(Boolean))];
}

async function getPastChatsForCharacter(characterInfo) {
    if (!characterInfo) {
        return [];
    }

    try {
        const response = await fetch(getSillyTavernApiUrl('/api/characters/chats'), {
            method: 'POST',
            body: JSON.stringify({ avatar_url: characterInfo.avatar || characterInfo.character?.avatar }),
            headers: getSillyTavernRequestHeaders(),
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        if (!data || data.error === true) {
            return [];
        }

        return Object.values(data)
            .filter((chatInfo) => chatInfo && chatInfo.file_name)
            .sort((a, b) => String(b.file_name).localeCompare(String(a.file_name)));
    } catch (error) {
        if (ensureSettings().debug) {
            console.warn('[Private Invitation] Failed to list character chats:', error);
        }
        return [];
    }
}

async function renderChatFileList(root = state.overlay || document) {
    const list = root?.querySelector?.('#pi_chat_file_list');
    const count = root?.querySelector?.('#pi_chat_file_count');
    const search = String(root?.querySelector?.('#pi_chat_file_search')?.value || '').trim().toLowerCase();
    if (!list) {
        return;
    }

    const characterInfo = getSelectedCharacter();
    if (!characterInfo) {
        list.innerHTML = `<div class="pi-empty">${t('console.context.noChatFiles')}</div>`;
        if (count) {
            count.textContent = '';
        }
        return;
    }

    const renderKey = characterInfo.key;
    let chats = state.chatFileCache.get(renderKey);
    if (!chats) {
        list.innerHTML = `<div class="pi-empty">${t('console.context.loadingChatFiles')}</div>`;
        chats = await getPastChatsForCharacter(characterInfo);
        state.chatFileCache.set(renderKey, chats);
    }
    if (getSelectedCharacter()?.key !== renderKey) {
        return;
    }
    const selectedFiles = new Set(getSelectedChatFiles(characterInfo));
    const visibleChats = chats.filter((chatInfo) => {
        if (!search) {
            return true;
        }
        return String(chatInfo.file_name || '').toLowerCase().includes(search);
    });

    if (count) {
        count.textContent = t('console.context.chatFileCount', { count: chats.length });
    }

    if (!chats.length) {
        list.innerHTML = `<div class="pi-empty">${t('console.context.noChatFiles')}</div>`;
        return;
    }

    if (!visibleChats.length) {
        list.innerHTML = `<div class="pi-empty">${t('console.pool.noMatches')}</div>`;
        return;
    }

    list.innerHTML = visibleChats.map((chatInfo) => {
        const fileName = String(chatInfo.file_name || '');
        const checked = selectedFiles.has(fileName) ? 'checked' : '';
        const label = fileName.replace(/\.jsonl$/i, '');
        return `
            <label class="pi-context-row">
                <input type="checkbox" data-pi-chat-file="${escapeHtml(fileName)}" ${checked}>
                <span>
                    <strong>${escapeHtml(label)}</strong>
                    <small>${escapeHtml(fileName)}</small>
                </span>
            </label>
        `;
    }).join('');
}

function getCharacterDefaultWorlds(characterInfo) {
    if (!characterInfo?.character) {
        return [];
    }
    const character = characterInfo.character;
    const out = new Set();
    const direct = character.data?.extensions?.world;
    if (direct && typeof direct === 'string') {
        out.add(String(direct));
    }
    const bookName = character.data?.character_book?.name;
    if (bookName && typeof bookName === 'string') {
        out.add(String(bookName));
    }
    return Array.from(out);
}

function getCharacterWorldNames(characterInfo) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return settings.selectedWorldNames || [];
    }
    const stored = settings.characterWorldNames?.[characterInfo.key];
    if (Array.isArray(stored)) {
        return stored;
    }
    const defaults = getCharacterDefaultWorlds(characterInfo);
    if (defaults.length) {
        return defaults.filter((name) => (Array.isArray(world_names) ? world_names : []).includes(name));
    }
    return settings.selectedWorldNames || [];
}

function setCharacterWorldNames(characterInfo, names) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return;
    }
    settings.characterWorldNames[characterInfo.key] = Array.isArray(names) ? [...new Set(names.map(String))] : [];
}

function getCharacterWorldEntries(characterInfo, worldName) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return 'all';
    }
    const bucket = settings.characterWorldEntries?.[characterInfo.key];
    const stored = bucket?.[worldName];
    if (stored === 'all' || stored === undefined || stored === null) {
        return 'all';
    }
    if (Array.isArray(stored)) {
        return stored.map(Number).filter((v) => Number.isFinite(v));
    }
    return 'all';
}

function setCharacterWorldEntries(characterInfo, worldName, value) {
    const settings = ensureSettings();
    if (!characterInfo?.key || !worldName) {
        return;
    }
    if (!settings.characterWorldEntries[characterInfo.key]) {
        settings.characterWorldEntries[characterInfo.key] = {};
    }
    if (value === 'all') {
        delete settings.characterWorldEntries[characterInfo.key][worldName];
        return;
    }
    settings.characterWorldEntries[characterInfo.key][worldName] = Array.isArray(value) ? Array.from(new Set(value.map(Number).filter((v) => Number.isFinite(v)))) : 'all';
}

const worldEntriesCache = new Map();
async function getWorldEntriesCached(worldName) {
    if (worldEntriesCache.has(worldName)) {
        return worldEntriesCache.get(worldName);
    }
    const world = await loadWorldInfo(worldName);
    const entries = Object.values(world?.entries || {})
        .filter((entry) => entry && !entry.disable)
        .map((entry) => ({
            uid: Number(entry.uid),
            comment: String(entry.comment || '').trim(),
            keys: Array.isArray(entry.key) ? entry.key.join(', ') : String(entry.key || ''),
            content: String(entry.content || ''),
            raw: entry,
        }))
        .filter((e) => Number.isFinite(e.uid));
    worldEntriesCache.set(worldName, entries);
    return entries;
}

function entryMatchesSearch(entry, search) {
    if (!search) {
        return true;
    }
    const haystack = [
        entry.uid,
        entry.comment,
        entry.keys,
        entry.content,
    ].join('\n').toLowerCase();
    return haystack.includes(search);
}

function updateWorldEntrySelectionMeta(detailsEl, worldName, characterInfo, entries) {
    const stored = getCharacterWorldEntries(characterInfo, worldName);
    const total = entries.length;
    const selectedCount = stored === 'all' ? total : (Array.isArray(stored) ? stored.length : 0);
    const allInput = detailsEl?.querySelector?.('input[data-pi-world-all]');
    const meta = detailsEl?.querySelector?.('.pi-world-book-meta');
    const headerCount = detailsEl?.querySelector?.('.pi-world-entries-header .pi-muted');

    if (allInput) {
        allInput.checked = total > 0 && selectedCount === total;
    }
    if (meta) {
        meta.textContent = selectedCount === total
            ? t('console.context.worldEntriesAllShort')
            : t('console.context.worldEntriesCountShort', { count: selectedCount });
    }
    if (headerCount) {
        headerCount.textContent = t('console.context.worldEntriesCount', { selected: selectedCount, total });
    }
}

async function renderWorldEntryList(detailsEl, worldName, characterInfo) {
    const list = detailsEl.querySelector('.pi-world-entries-list');
    if (!list) return;
    const activeSearch = list.querySelector?.('[data-pi-world-entry-search]');
    const shouldRefocus = document.activeElement === activeSearch;
    const previousSearch = detailsEl.dataset.piWorldEntrySearch || activeSearch?.value || '';
    list.innerHTML = `<div class="pi-muted">${t('console.context.worldEntriesLoading')}</div>`;
    try {
        const entries = await getWorldEntriesCached(worldName);
        const stored = getCharacterWorldEntries(characterInfo, worldName);
        const isAll = stored === 'all';
        const selectedSet = isAll ? null : new Set(stored);
        if (!entries.length) {
            list.innerHTML = `<div class="pi-muted">${t('console.context.worldEntriesEmpty')}</div>`;
            return;
        }
        const search = String(previousSearch || '').trim().toLowerCase();
        const filteredEntries = entries.filter((entry) => entryMatchesSearch(entry, search));
        const header = `
            <div class="pi-world-entries-header">
                <label class="pi-switch">
                    <input type="checkbox" data-pi-world-all="${escapeHtml(worldName)}" ${isAll ? 'checked' : ''}>
                    <span>${t('console.context.worldEntriesAll')}</span>
                </label>
                <span class="pi-muted">${t('console.context.worldEntriesCount', { selected: isAll ? entries.length : selectedSet.size, total: entries.length })}</span>
            </div>
            <input class="text_pole pi-world-entry-search" type="search" data-pi-world-entry-search="${escapeHtml(worldName)}" value="${escapeHtml(previousSearch)}" placeholder="${escapeHtml(t('console.context.worldEntrySearch'))}">
        `;
        if (!filteredEntries.length) {
            list.innerHTML = header + `<div class="pi-empty">${t('console.pool.noMatches')}</div>`;
            if (shouldRefocus) {
                const nextSearch = list.querySelector('[data-pi-world-entry-search]');
                nextSearch?.focus?.();
                nextSearch?.setSelectionRange?.(nextSearch.value.length, nextSearch.value.length);
            }
            return;
        }
        const rows = filteredEntries.map((entry) => {
            const checked = isAll || selectedSet.has(entry.uid);
            const label = entry.comment || entry.keys || `#${entry.uid}`;
            const sub = entry.comment && entry.keys ? entry.keys : '';
            return `
                <label class="pi-world-entry-row">
                    <input type="checkbox" data-pi-world-entry-uid="${entry.uid}" data-pi-world-entry-world="${escapeHtml(worldName)}" ${checked ? 'checked' : ''}>
                    <span class="pi-world-entry-label">
                        <strong>${escapeHtml(label)}</strong>
                        ${sub ? `<small>${escapeHtml(sub)}</small>` : ''}
                    </span>
                </label>
            `;
        }).join('');
        list.innerHTML = header + `<div class="pi-world-entries-filter">${t('console.context.worldEntriesFilteredCount', { shown: filteredEntries.length, total: entries.length })}</div><div class="pi-world-entries-rows">${rows}</div>`;
        if (shouldRefocus) {
            const nextSearch = list.querySelector('[data-pi-world-entry-search]');
            nextSearch?.focus?.();
            nextSearch?.setSelectionRange?.(nextSearch.value.length, nextSearch.value.length);
        }
    } catch (error) {
        list.innerHTML = `<div class="pi-muted">${escapeHtml(t('console.context.worldEntriesError'))}</div>`;
    }
}

function renderWorldInfoList(root = state.overlay || document) {
    const list = root?.querySelector?.('#pi_world_info_list');
    const count = root?.querySelector?.('#pi_world_info_count');
    if (!list) {
        return;
    }

    const settings = ensureSettings();
    const names = Array.isArray(world_names) ? world_names : [];
    const characterInfo = getSelectedCharacter();
    const selected = new Set(getCharacterWorldNames(characterInfo));
    const defaults = new Set(characterInfo ? getCharacterDefaultWorlds(characterInfo) : []);
    const search = String(root?.querySelector?.('#pi_world_search')?.value || '').trim().toLowerCase();
    const visibleNames = names
        .filter((name) => !search || String(name).toLowerCase().includes(search))
        .sort((a, b) => {
            const aDefault = defaults.has(a);
            const bDefault = defaults.has(b);
            if (aDefault !== bDefault) {
                return aDefault ? -1 : 1;
            }
            const aSelected = selected.has(a);
            const bSelected = selected.has(b);
            if (aSelected !== bSelected) {
                return aSelected ? -1 : 1;
            }
            return String(a).localeCompare(String(b));
        });

    if (count) {
        count.textContent = t('console.context.worldCount', { count: names.length });
    }

    if (!names.length) {
        list.innerHTML = `<div class="pi-empty">${t('console.context.noWorldInfo')}</div>`;
        return;
    }

    if (!visibleNames.length) {
        list.innerHTML = `<div class="pi-empty">${t('console.pool.noMatches')}</div>`;
        return;
    }

    list.innerHTML = visibleNames.map((name) => {
        const isDefault = defaults.has(name);
        const isChecked = selected.has(name);
        const stored = characterInfo ? getCharacterWorldEntries(characterInfo, name) : 'all';
        const entryHint = stored === 'all' ? t('console.context.worldEntriesAllShort') : t('console.context.worldEntriesCountShort', { count: Array.isArray(stored) ? stored.length : 0 });
        const badge = isDefault ? `<span class="pi-badge-mini pi-badge-mini--pool" title="${escapeHtml(t('console.context.worldDefaultHint'))}">★ ${escapeHtml(t('console.context.worldDefault'))}</span>` : '';
        return `
        <details class="pi-world-book${isDefault ? ' pi-world-book--default' : ''}" data-pi-world-name="${escapeHtml(name)}">
            <summary class="pi-world-book-summary">
                <input type="checkbox" data-pi-world-name="${escapeHtml(name)}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation()">
                <span class="pi-world-book-title"><strong>${escapeHtml(name)}</strong> ${badge}</span>
                <span class="pi-muted pi-world-book-meta">${escapeHtml(entryHint)}</span>
            </summary>
            <div class="pi-world-entries-list"></div>
        </details>
    `;
    }).join('');
}

function renderDialogueEditor(root = state.overlay || document) {
    renderCharacterSelect(root);

    const settings = ensureSettings();
    const promptPreset = root?.querySelector?.('#pi_ai_prompt_preset');
    const promptBody = root?.querySelector?.('#pi_ai_prompt_body');
    const useChatContext = root?.querySelector?.('#pi_ai_use_chat_context');
    const stripHtmlNoiseEl = root?.querySelector?.('#pi_strip_html_noise');
    const useWorldInfo = root?.querySelector?.('#pi_ai_use_world_info');
    const chatFloorStart = root?.querySelector?.('#pi_chat_floor_start');
    const chatFloorEnd = root?.querySelector?.('#pi_chat_floor_end');
    const chatChunkSize = root?.querySelector?.('#pi_chat_chunk_size');
    const chatBatchDelay = root?.querySelector?.('#pi_chat_batch_delay');
    const worldEntryLimit = root?.querySelector?.('#pi_world_entry_limit');
    const batchCount = root?.querySelector?.('#pi_ai_batch_count');
    const maxTokens = root?.querySelector?.('#pi_ai_max_tokens');
    const count = root?.querySelector?.('#pi_dialogue_count');
    const poolInput = root?.querySelector?.('#pi_dialogue_pool_input');

    if (promptPreset) {
        rebuildPromptPresetOptions(promptPreset, settings.aiCustomTemplates, 'dialogue');
        promptPreset.value = settings.aiPromptPreset;
    }
    if (promptBody) {
        promptBody.value = settings.aiPromptBody || getDefaultPromptBody(settings.aiPromptPreset, 'dialogue', settings.aiBatchCount);
    }
    if (useChatContext) {
        useChatContext.checked = settings.aiUseChatContext;
    }
    if (stripHtmlNoiseEl) {
        stripHtmlNoiseEl.checked = settings.stripHtmlNoise;
    }
    if (useWorldInfo) {
        useWorldInfo.checked = settings.aiUseWorldInfo;
    }
    if (chatFloorStart) {
        chatFloorStart.value = String(settings.chatFloorStart);
    }
    if (chatFloorEnd) {
        chatFloorEnd.value = String(settings.chatFloorEnd);
    }
    if (chatChunkSize) {
        chatChunkSize.value = String(settings.chatChunkSize);
    }
    if (chatBatchDelay) {
        chatBatchDelay.value = String(settings.chatBatchDelayMs);
    }
    renderTagChips(root, 'filter');
    renderTagChips(root, 'exclude');
    if (worldEntryLimit) {
        worldEntryLimit.value = String(settings.worldEntryLimit);
    }
    if (batchCount) {
        batchCount.value = String(settings.aiBatchCount);
    }
    if (maxTokens) {
        maxTokens.value = String(settings.aiMaxTokens);
    }
    if (poolInput) {
        poolInput.value = '';
    }
    if (count) {
        updateDialogueCount(root);
    }
    renderPoolList(root, 'dialogue');
    renderDraftList(root, 'dialogue');
    renderWorldInfoList(root);
    renderCharacterStyleEditor(root);
}

function renderCharacterStyleEditor(root = state.overlay || document) {
    const enabledEl = root.querySelector('#pi_char_style_enabled');
    if (!enabledEl) {
        return;
    }
    const settings = ensureSettings();
    const characterInfo = getSelectedCharacter();
    const style = (characterInfo?.key && settings.characterStyles?.[characterInfo.key]) || {};

    const autoAdaptEl = root.querySelector('#pi_char_auto_adapt_color');
    const shapeEl = root.querySelector('#pi_char_bubble_shape');
    const positionEl = root.querySelector('#pi_char_bubble_position');
    const textColorEl = root.querySelector('#pi_char_text_color');
    const strokeColorEl = root.querySelector('#pi_char_text_stroke_color');
    const frameColorEl = root.querySelector('#pi_char_frame_color');

    enabledEl.checked = Boolean(style.enabled);
    if (autoAdaptEl) {
        autoAdaptEl.checked = style.autoAdaptColor !== undefined ? Boolean(style.autoAdaptColor) : Boolean(settings.autoAdaptColor);
    }
    if (shapeEl) {
        shapeEl.value = bubbleShapeKeys.includes(style.bubbleShape) ? style.bubbleShape : '';
    }
    if (positionEl) {
        positionEl.value = bubblePositionKeys.includes(style.bubblePosition) ? style.bubblePosition : '';
    }
    if (textColorEl) {
        textColorEl.value = style.textColor || settings.textColor || defaultSettings.textColor;
    }
    if (strokeColorEl) {
        strokeColorEl.value = style.textStrokeColor || settings.textStrokeColor || defaultSettings.textStrokeColor;
    }
    if (frameColorEl) {
        frameColorEl.value = style.frameColor || settings.frameColor || defaultSettings.frameColor;
    }
}

function persistCharacterStyleEditor(root = state.overlay || document) {
    const settings = ensureSettings();
    const characterInfo = getSelectedCharacter();
    if (!characterInfo?.key) {
        return;
    }
    const key = characterInfo.key;
    const enabledEl = root.querySelector('#pi_char_style_enabled');
    if (!enabledEl) {
        return;
    }
    const autoAdaptEl = root.querySelector('#pi_char_auto_adapt_color');
    const shapeEl = root.querySelector('#pi_char_bubble_shape');
    const positionEl = root.querySelector('#pi_char_bubble_position');
    const textColorEl = root.querySelector('#pi_char_text_color');
    const strokeColorEl = root.querySelector('#pi_char_text_stroke_color');
    const frameColorEl = root.querySelector('#pi_char_frame_color');

    const next = { ...(settings.characterStyles[key] || {}) };
    next.enabled = enabledEl.checked;
    if (autoAdaptEl) {
        next.autoAdaptColor = autoAdaptEl.checked;
    }
    if (shapeEl) {
        next.bubbleShape = bubbleShapeKeys.includes(shapeEl.value) ? shapeEl.value : undefined;
    }
    if (positionEl) {
        next.bubblePosition = bubblePositionKeys.includes(positionEl.value) ? positionEl.value : undefined;
    }
    if (textColorEl) {
        next.textColor = normalizeColor(textColorEl.value, '');
    }
    if (strokeColorEl) {
        next.textStrokeColor = normalizeColor(strokeColorEl.value, '');
    }
    if (frameColorEl) {
        next.frameColor = normalizeColor(frameColorEl.value, '');
    }
    settings.characterStyles[key] = next;
    saveSettingsDebounced();
    renderPreview(root);
}

function bindCharacterStyleControls(root) {
    const ids = [
        '#pi_char_style_enabled',
        '#pi_char_auto_adapt_color',
        '#pi_char_bubble_shape',
        '#pi_char_bubble_position',
        '#pi_char_text_color',
        '#pi_char_text_stroke_color',
        '#pi_char_frame_color',
    ];
    for (const id of ids) {
        const el = root.querySelector(id);
        if (!el) continue;
        el.addEventListener('input', () => persistCharacterStyleEditor(root));
        el.addEventListener('change', () => persistCharacterStyleEditor(root));
    }

    const copyBtn = root.querySelector('#pi_char_style_copy_global');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const settings = ensureSettings();
            const characterInfo = getSelectedCharacter();
            if (!characterInfo?.key) {
                notify('warning', t('console.dialogue.noCharacters'));
                return;
            }
            settings.characterStyles[characterInfo.key] = {
                enabled: true,
                autoAdaptColor: settings.autoAdaptColor,
                bubbleShape: settings.bubbleShape,
                bubblePosition: settings.bubblePosition,
                textColor: settings.textColor,
                textStrokeColor: settings.textStrokeColor,
                frameColor: settings.frameColor,
            };
            saveSettingsDebounced();
            renderCharacterStyleEditor(root);
            renderPreview(root);
            notify('success', t('console.charStyle.copied'));
        });
    }

    const resetBtn = root.querySelector('#pi_char_style_reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const settings = ensureSettings();
            const characterInfo = getSelectedCharacter();
            if (!characterInfo?.key) {
                return;
            }
            delete settings.characterStyles[characterInfo.key];
            saveSettingsDebounced();
            renderCharacterStyleEditor(root);
            renderPreview(root);
            notify('success', t('console.charStyle.cleared'));
        });
    }
}

function renderRetentionEditor(root = state.overlay || document) {
    const settings = ensureSettings();
    const promptPreset = root?.querySelector?.('#pi_retention_prompt_preset');
    const promptBody = root?.querySelector?.('#pi_retention_prompt_body');
    const aiPrompt = root?.querySelector?.('#pi_retention_ai_prompt');
    const batchCount = root?.querySelector?.('#pi_retention_batch_count');
    const count = root?.querySelector?.('#pi_retention_count');
    const poolInput = root?.querySelector?.('#pi_retention_pool_input');

    if (promptPreset) {
        rebuildPromptPresetOptions(promptPreset, settings.retentionCustomTemplates, 'retention');
        promptPreset.value = settings.retentionPromptPreset;
    }
    if (promptBody) {
        promptBody.value = settings.retentionPromptBody || getDefaultPromptBody(settings.retentionPromptPreset, 'retention', settings.retentionBatchCount);
    }
    if (aiPrompt) {
        aiPrompt.value = settings.retentionAiPrompt;
    }
    if (batchCount) {
        batchCount.value = String(settings.retentionBatchCount);
    }
    if (poolInput) {
        poolInput.value = '';
    }
    if (count) {
        updateRetentionCount(root);
    }
    renderPoolList(root, 'retention');
    renderDraftList(root, 'retention');
}

function renderAngerEditor(root = state.overlay || document) {
    const settings = ensureSettings();
    const promptPreset = root?.querySelector?.('#pi_anger_prompt_preset');
    const promptBody = root?.querySelector?.('#pi_anger_prompt_body');
    const aiPrompt = root?.querySelector?.('#pi_anger_ai_prompt');
    const batchCount = root?.querySelector?.('#pi_anger_batch_count');
    const count = root?.querySelector?.('#pi_anger_count');
    const poolInput = root?.querySelector?.('#pi_anger_pool_input');
    const threshold = root?.querySelector?.('#pi_anger_threshold');
    const countdown = root?.querySelector?.('#pi_anger_countdown_seconds');
    const intensity = root?.querySelector?.('#pi_anger_intensity');
    const resetOnAccept = root?.querySelector?.('#pi_anger_reset_on_accept');
    const accentColor = root?.querySelector?.('#pi_anger_accent_color');
    const currentCount = root?.querySelector?.('#pi_anger_current_count');

    if (promptPreset) {
        rebuildPromptPresetOptions(promptPreset, settings.angerCustomTemplates, 'anger');
        promptPreset.value = settings.angerPromptPreset;
    }
    if (promptBody) {
        promptBody.value = settings.angerPromptBody || getDefaultPromptBody(settings.angerPromptPreset, 'anger', settings.angerBatchCount);
    }
    if (aiPrompt) {
        aiPrompt.value = settings.angerAiPrompt;
    }
    if (batchCount) {
        batchCount.value = String(settings.angerBatchCount);
    }
    if (threshold) {
        threshold.value = String(settings.angerThreshold);
    }
    if (countdown) {
        countdown.value = String(settings.angerCountdownSeconds);
    }
    if (intensity) {
        intensity.value = angerIntensityKeys.includes(settings.angerIntensity) ? settings.angerIntensity : defaultSettings.angerIntensity;
    }
    if (resetOnAccept) {
        resetOnAccept.checked = Boolean(settings.angerResetOnAccept);
    }
    if (accentColor) {
        accentColor.value = settings.angerAccentColor || defaultSettings.angerAccentColor;
    }
    if (poolInput) {
        poolInput.value = '';
    }
    if (currentCount) {
        const characterInfo = getSelectedCharacter();
        currentCount.textContent = String(getRejectCount(characterInfo));
    }
    if (count) {
        const characterInfo = getSelectedCharacter();
        const lines = characterInfo ? getPoolLines(characterInfo, 'anger') : [];
        count.textContent = t('console.anger.savedCount', { count: lines.length });
    }
    renderPoolList(root, 'anger');
    renderDraftList(root, 'anger');
}

function renderContextualAiEditor(root = state.overlay || document, kind = 'jealousy') {
    if (!contextualAiModeKeys.includes(kind)) {
        return;
    }
    const settings = ensureSettings();
    const prefix = promptElementPrefixFor(kind);
    const promptPreset = root?.querySelector?.(`${prefix}_prompt_preset`);
    const promptBody = root?.querySelector?.(`${prefix}_prompt_body`);
    const aiPrompt = root?.querySelector?.(`${prefix}_ai_prompt`);
    const batchCount = root?.querySelector?.(`${prefix}_batch_count`);

    if (promptPreset) {
        rebuildPromptPresetOptions(promptPreset, settings[customTemplatesFieldFor(kind)], kind);
        promptPreset.value = settings[presetFieldFor(kind)];
    }
    if (promptBody) {
        promptBody.value = settings[promptBodyFieldFor(kind)] || getDefaultPromptBody(settings[presetFieldFor(kind)], kind, settings[batchCountFieldFor(kind)]);
    }
    if (aiPrompt) {
        aiPrompt.value = settings[aiPromptFieldFor(kind)];
    }
    if (batchCount) {
        batchCount.value = String(settings[batchCountFieldFor(kind)]);
    }
    renderDraftList(root, kind);
}

function renderContextualAiEditors(root = state.overlay || document) {
    contextualAiModeKeys.forEach((kind) => renderContextualAiEditor(root, kind));
}

function persistAiModeEditor(root = state.overlay || document, kind = 'dialogue') {
    const settings = ensureSettings();
    const prefix = promptElementPrefixFor(kind);
    const presetSelect = root?.querySelector?.(`${prefix}_prompt_preset`);
    const promptBody = root?.querySelector?.(`${prefix}_prompt_body`);
    const aiPrompt = root?.querySelector?.(kind === 'dialogue' || !kind ? '#pi_ai_prompt' : `${prefix}_ai_prompt`);
    const batchCount = root?.querySelector?.(kind === 'dialogue' || !kind ? '#pi_ai_batch_count' : `${prefix}_batch_count`);

    if (presetSelect) {
        const value = presetSelect.value;
        const templates = settings[customTemplatesFieldFor(kind)] || {};
        if (isCustomTemplateKey(value)) {
            settings[presetFieldFor(kind)] = templates[getCustomTemplateName(value)] ? value : defaultSettings[presetFieldFor(kind)];
        } else {
            const allowed = promptPresetKeysFor(kind);
            settings[presetFieldFor(kind)] = allowed.includes(value) ? value : defaultSettings[presetFieldFor(kind)];
        }
    }
    if (promptBody) {
        settings[promptBodyFieldFor(kind)] = String(promptBody.value || '');
    }
    if (aiPrompt) {
        settings[aiPromptFieldFor(kind)] = String(aiPrompt.value || '');
    }
    if (batchCount) {
        settings[batchCountFieldFor(kind)] = clampNumber(batchCount.value, 3, 30, defaultSettings[batchCountFieldFor(kind)]);
        batchCount.value = String(settings[batchCountFieldFor(kind)]);
    }
}

function updateModePoolCount(root = state.overlay || document, kind = 'dialogue') {
    if (kind === 'dialogue') {
        updateDialogueCount(root);
        return;
    }
    if (kind === 'retention') {
        updateRetentionCount(root);
        return;
    }
    const count = root?.querySelector?.(`#pi_${kind}_count`);
    if (!count) {
        return;
    }
    const characterInfo = getSelectedCharacter();
    const lines = characterInfo ? getPoolLines(characterInfo, kind) : [];
    count.textContent = t('console.mode.savedCount', {
        mode: getModePoolLabel(kind),
        count: lines.length,
    });
}

function refreshPoolEditor(root = state.overlay || document, kind = 'dialogue') {
    renderPoolList(root, kind);
    updateModePoolCount(root, kind);
}

function persistCharacterContextualSettings(root = state.overlay || document) {
    const settings = ensureSettings();
    const characterInfo = getSelectedCharacter();
    if (!characterInfo?.key) {
        return;
    }

    const jealousyLabel = root?.querySelector?.('#pi_character_jealousy_label');
    if (jealousyLabel) {
        const value = String(jealousyLabel.value || '').trim();
        if (value) {
            settings.characterJealousyLabels[characterInfo.key] = value;
        } else {
            delete settings.characterJealousyLabels[characterInfo.key];
        }
    }

    const jealousyChance = root?.querySelector?.('#pi_character_jealousy_chance');
    if (jealousyChance) {
        const rawValue = String(jealousyChance.value || '').trim();
        if (rawValue) {
            const value = clampNumber(rawValue, 0, 100, settings.jealousyChance);
            settings.characterJealousyChances[characterInfo.key] = value;
            jealousyChance.value = String(value);
        } else {
            delete settings.characterJealousyChances[characterInfo.key];
        }
    }

    const birthday = root?.querySelector?.('#pi_character_birthday');
    if (birthday) {
        const value = normalizeMonthDay(birthday.value);
        if (value) {
            settings.characterBirthdays[characterInfo.key] = value;
            birthday.value = value;
        } else if (!String(birthday.value || '').trim()) {
            delete settings.characterBirthdays[characterInfo.key];
        }
    }

    const userBirthday = root?.querySelector?.('#pi_character_user_birthday');
    if (userBirthday) {
        const value = normalizeMonthDay(userBirthday.value);
        if (value) {
            settings.characterUserBirthdays[characterInfo.key] = value;
            userBirthday.value = value;
        } else if (!String(userBirthday.value || '').trim()) {
            delete settings.characterUserBirthdays[characterInfo.key];
        }
    }

    const dateEvents = root?.querySelector?.('#pi_character_date_events');
    if (dateEvents) {
        const value = String(dateEvents.value || '').trim();
        if (value) {
            settings.characterDateEvents[characterInfo.key] = value;
        } else {
            delete settings.characterDateEvents[characterInfo.key];
        }
    }
}

function renderContextualModeEditors(root = state.overlay || document) {
    const settings = ensureSettings();
    const characterInfo = getSelectedCharacter();
    const jealousyLabel = root?.querySelector?.('#pi_character_jealousy_label');
    const jealousyChance = root?.querySelector?.('#pi_character_jealousy_chance');
    const birthday = root?.querySelector?.('#pi_character_birthday');
    const userBirthday = root?.querySelector?.('#pi_character_user_birthday');
    const dateEvents = root?.querySelector?.('#pi_character_date_events');

    if (jealousyLabel) {
        jealousyLabel.value = characterInfo?.key ? String(settings.characterJealousyLabels?.[characterInfo.key] || '') : '';
    }
    if (jealousyChance) {
        const value = characterInfo?.key && Number.isFinite(Number(settings.characterJealousyChances?.[characterInfo.key]))
            ? String(settings.characterJealousyChances[characterInfo.key])
            : '';
        jealousyChance.value = value;
    }
    if (birthday) {
        birthday.value = characterInfo?.key ? String(settings.characterBirthdays?.[characterInfo.key] || '') : '';
    }
    if (userBirthday) {
        userBirthday.value = characterInfo?.key ? String(settings.characterUserBirthdays?.[characterInfo.key] || '') : '';
    }
    if (dateEvents) {
        dateEvents.value = characterInfo?.key ? String(settings.characterDateEvents?.[characterInfo.key] || '') : '';
    }

    ['jealousy', 'birthday', 'reunion'].forEach((kind) => {
        const input = root?.querySelector?.(`${poolElementPrefixFor(kind)}_input`);
        if (input) {
            input.value = '';
        }
        refreshPoolEditor(root, kind);
    });
}

function isConsoleOpen() {
    const overlay = state.overlay || document.querySelector('#pi_overlay');
    return Boolean(overlay?.open);
}

function closeActiveInvitation() {
    if (!state.activeInvitation) {
        return;
    }

    const dialog = state.activeInvitation;
    state.activeInvitation = null;
    if (dialog.open && typeof dialog.close === 'function') {
        dialog.close();
    } else {
        dialog.remove();
    }
}

function preloadImage(url, timeoutMs = coverPreloadTimeoutMs) {
    return new Promise((resolve) => {
        if (!url) {
            resolve(false);
            return;
        }
        let done = false;
        const img = new Image();
        const finish = (loaded) => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            resolve(Boolean(loaded));
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = url;
    });
}

function buildInvitationStyleVars(settings) {
    return [
        `--pi-invite-font-size:${settings.textFontSize}px`,
        `--pi-invite-text-color:${settings.textColor}`,
        `--pi-invite-text-opacity:${(settings.textOpacity ?? 100) / 100}`,
        `--pi-invite-text-stroke-width:${settings.textStrokeWidth ?? 0}px`,
        `--pi-invite-text-stroke-color:${settings.textStrokeColor ?? '#000000'}`,
        `--pi-invite-frame-width:${settings.frameWidth}px`,
        `--pi-invite-frame-height:${settings.frameHeight}px`,
        `--pi-invite-frame-color:${settings.frameColor}`,
        `--pi-invite-frame-opacity:${(settings.frameOpacity ?? 78) / 100}`,
        `--pi-bubble-offset-x:${settings.bubbleOffsetX ?? 0}%`,
        `--pi-bubble-offset-y:${settings.bubbleOffsetY ?? 0}%`,
        `--pi-barrage-duration:${settings.barrageDuration ?? 22}s`,
        `--pi-barrage-count:${settings.barrageLineCount ?? 3}`,
    ].join(';');
}

function buildPreviewStyleVars(settings) {
    return [
        `--pi-preview-font-size:${settings.textFontSize}px`,
        `--pi-preview-text-color:${settings.textColor}`,
        `--pi-preview-text-opacity:${(settings.textOpacity ?? 100) / 100}`,
        `--pi-preview-text-stroke-width:${settings.textStrokeWidth ?? 0}px`,
        `--pi-preview-text-stroke-color:${settings.textStrokeColor ?? '#000000'}`,
        `--pi-preview-frame-width:${settings.frameWidth}px`,
        `--pi-preview-frame-height:${settings.frameHeight}px`,
        `--pi-preview-frame-color:${settings.frameColor}`,
        `--pi-preview-frame-opacity:${(settings.frameOpacity ?? 78) / 100}`,
        `--pi-bubble-offset-x:${settings.bubbleOffsetX ?? 0}%`,
        `--pi-bubble-offset-y:${settings.bubbleOffsetY ?? 0}%`,
        `--pi-barrage-duration:${settings.barrageDuration ?? 22}s`,
        `--pi-barrage-count:${settings.barrageLineCount ?? 3}`,
    ].join(';');
}

function buildPreviewMessageHtml(mode) {
    const settings = ensureSettings();
    const barrageCount = settings.barrageLineCount ?? 3;
    const lines = [
        t('console.preview.sampleText'),
        t('console.preview.sampleTextAlt1'),
        t('console.preview.sampleTextAlt2'),
        t('console.preview.sampleTextAlt3'),
        t('console.preview.sampleTextAlt4'),
        t('console.preview.sampleText'),
        t('console.preview.sampleTextAlt1'),
        t('console.preview.sampleTextAlt2'),
    ];
    const picked = mode === 'barrage' ? lines.slice(0, barrageCount) : lines.slice(0, 1);
    return picked.map((message, index) => {
        const barrageTop = `${((index + 0.5) / picked.length) * 100}%`;
        return `<span style="--pi-barrage-index:${index}; --pi-barrage-top:${barrageTop};">${escapeHtml(message)}</span>`;
    }).join('');
}

function normalizeInvitationMode(modeOrRetention) {
    if (modeOrRetention === true) return 'retention';
    if (modeOrRetention === false || modeOrRetention === undefined || modeOrRetention === null) return 'primary';
    if (typeof modeOrRetention === 'string' && invitationModeKeys.includes(modeOrRetention)) {
        return modeOrRetention;
    }
    return 'primary';
}

function buildInvitationMessageHtml(characterInfo, modeOrRetention = false, templateContext = {}) {
    const settings = ensureSettings();
    const mode = normalizeInvitationMode(modeOrRetention);
    const lineCount = settings.presentationMode === 'barrage' ? (settings.barrageLineCount ?? 3) : 1;
    const savedMessages = getMessagesForMode(characterInfo, mode, templateContext);
    const fallback = getFallbackMessageForMode(characterInfo, mode, templateContext);
    const source = savedMessages.length ? savedMessages : [fallback];
    const picked = getSampledLines(source, lineCount);

    if (!picked.length) {
        picked.push(fallback);
    }

    return picked.map((message, index) => {
        const barrageTop = `${((index + 0.5) / picked.length) * 100}%`;
        return `<span style="--pi-barrage-index:${index}; --pi-barrage-top:${barrageTop};">${escapeHtml(message)}</span>`;
    }).join('');
}

function resolveCharacterStyle(characterInfo) {
    const settings = ensureSettings();
    const override = characterInfo?.key ? settings.characterStyles?.[characterInfo.key] : null;
    if (!override || typeof override !== 'object' || !override.enabled) {
        return settings;
    }
    const merged = { ...settings };
    const fields = [
        'textColor', 'textOpacity', 'textStrokeWidth', 'textStrokeColor', 'autoAdaptColor',
        'frameColor', 'frameOpacity', 'frameWidth', 'frameHeight',
        'bubblePosition', 'bubbleShape', 'coverEffect', 'presentationMode',
    ];
    for (const field of fields) {
        if (override[field] !== undefined && override[field] !== null && override[field] !== '') {
            merged[field] = override[field];
        }
    }
    return merged;
}

function computeAdaptiveColors(imgUrl) {
    return new Promise((resolve) => {
        if (!imgUrl) {
            resolve(null);
            return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, 32, 32);
                const data = ctx.getImageData(0, 0, 32, 32).data;
                let r = 0;
                let g = 0;
                let b = 0;
                let count = 0;
                for (let i = 0; i < data.length; i += 4) {
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count += 1;
                }
                r /= count;
                g /= count;
                b /= count;
                const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
                if (brightness > 0.55) {
                    resolve({
                        textColor: '#16181d',
                        strokeColor: '#ffffff',
                        brightness,
                    });
                } else {
                    resolve({
                        textColor: '#ffffff',
                        strokeColor: '#0a0a0a',
                        brightness,
                    });
                }
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = imgUrl;
    });
}

function applyAdaptiveColorsToDialog(dialog, characterInfo) {
    const effective = resolveCharacterStyle(characterInfo);
    if (!effective.autoAdaptColor || !dialog || !characterInfo) {
        return;
    }
    const url = getCharacterAvatarUrl(characterInfo);
    computeAdaptiveColors(url).then((colors) => {
        if (!colors || !dialog.isConnected) {
            return;
        }
        dialog.style.setProperty('--pi-invite-text-color', colors.textColor);
        dialog.style.setProperty('--pi-invite-text-stroke-color', colors.strokeColor);
        if ((effective.textStrokeWidth ?? 1.5) < 0.5) {
            dialog.style.setProperty('--pi-invite-text-stroke-width', '1.5px');
        }
    });
}

function getInvitationKicker(mode) {
    if (mode === 'anger') return t('invitation.angerKicker');
    if (mode === 'retention') return t('invitation.retentionKicker');
    if (mode === 'jealousy') return t('invitation.jealousyKicker');
    if (mode === 'birthday') return t('invitation.birthdayKicker');
    if (mode === 'reunion') return t('invitation.reunionKicker');
    return t('invitation.kicker');
}

function createInvitationDialog(characterInfo, modeOrRetention = false, templateContext = {}) {
    const mode = normalizeInvitationMode(modeOrRetention);
    const retention = mode === 'retention';
    const anger = mode === 'anger';
    const specialMode = mode !== 'primary' ? ` pi-invitation-dialog--${mode}` : '';
    const settings = resolveCharacterStyle(characterInfo);
    const globalSettings = ensureSettings();
    const dialog = document.createElement('dialog');
    dialog.className = `pi-invitation-dialog pi-invitation-dialog--${settings.presentationMode}${specialMode}`;
    let styleVars = buildInvitationStyleVars(settings);
    if (anger) {
        styleVars += `;--pi-anger-accent:${globalSettings.angerAccentColor || '#c2415a'}`;
    }
    if (mode === 'reunion') {
        styleVars += `;--pi-reunion-intensity:${(globalSettings.reunionVisualIntensity ?? 70) / 100}`;
    }
    dialog.style.cssText = styleVars;

    const kickerText = getInvitationKicker(mode);
    const acceptText = anger
        ? t('invitation.angerEnter')
        : (retention ? t('invitation.acceptRetention') : t('invitation.accept'));

    const angerSymbolsHtml = anger ? `
                <span class="pi-anger-symbol pi-anger-symbol--tl" aria-hidden="true">💢</span>
                <span class="pi-anger-symbol pi-anger-symbol--tr" aria-hidden="true">💢</span>
                <span class="pi-anger-symbol pi-anger-symbol--bl" aria-hidden="true">💢</span>
                <span class="pi-anger-symbol pi-anger-symbol--br" aria-hidden="true">💢</span>` : '';

    const dismissButtonsHtml = anger ? '' : `
                <button type="button" class="pi-invitation-x" data-pi-action="dismiss" aria-label="${escapeHtml(t('invitation.dismiss'))}">×</button>`;

    const countdownSeconds = anger
        ? clampNumber(globalSettings.angerCountdownSeconds, 3, 20, defaultSettings.angerCountdownSeconds)
        : 0;
    const countdownHtml = anger ? `
                    <div class="pi-anger-countdown" data-pi-anger-countdown>
                        <span class="pi-anger-countdown-text">${escapeHtml(t('invitation.angerCountdown', { seconds: countdownSeconds }))}</span>
                    </div>` : '';

    const actionsHtml = anger ? `
                <div class="pi-invitation-actions pi-invitation-actions--anger">
                    <button type="button" class="menu_button pi-invitation-accept pi-invitation-accept--anger" data-pi-action="accept">${escapeHtml(acceptText)}</button>
                </div>` : `
                <div class="pi-invitation-actions">
                    <button type="button" class="menu_button pi-invitation-accept" data-pi-action="accept">${escapeHtml(acceptText)}</button>
                    <button type="button" class="menu_button pi-invitation-dismiss" data-pi-action="dismiss">${escapeHtml(retention ? t('invitation.dismissFinal') : t('invitation.dismiss'))}</button>
                </div>`;

    dialog.innerHTML = `
        <div class="pi-invitation-card" data-pi-mode="${escapeHtml(mode)}" data-pi-cover-effect="${escapeHtml(settings.coverEffect || 'breath')}" data-pi-cover-fit="${escapeHtml(settings.coverFit || 'contain')}" data-pi-bubble-position="${escapeHtml(settings.bubblePosition || 'top-right')}" data-pi-bubble-shape="${escapeHtml(settings.bubbleShape || 'pill')}">
            <img class="pi-invitation-cover-backdrop" src="${escapeHtml(getCharacterAvatarUrl(characterInfo))}" alt="" aria-hidden="true">
            <img class="pi-invitation-cover" src="${escapeHtml(getCharacterAvatarUrl(characterInfo))}" alt="">
            <div class="pi-invitation-cover-shade"></div>
            <div class="pi-invitation-frame" aria-hidden="true"></div>${angerSymbolsHtml}${dismissButtonsHtml}
            <div class="pi-invitation-content">
                <div class="pi-invitation-kicker">${escapeHtml(kickerText)}</div>
                <div class="pi-invitation-name">${escapeHtml(characterInfo.name)}</div>
                <div class="pi-invitation-message pi-invitation-message--${settings.presentationMode}${anger ? ' pi-invitation-message--anger' : ''}">
                    ${buildInvitationMessageHtml(characterInfo, mode, templateContext)}
                </div>${countdownHtml}${actionsHtml}
            </div>
        </div>
    `;

    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
            if (anger) {
                return;
            }
            handleInvitationDismiss(characterInfo, retention);
            return;
        }

        const action = event.target?.closest?.('[data-pi-action]')?.dataset?.piAction;
        if (action === 'accept') {
            acceptInvitation(characterInfo, mode);
        } else if (action === 'dismiss' && !anger) {
            handleInvitationDismiss(characterInfo, retention);
        }
    });

    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (anger) {
            if (state.invitationFromConsoleTest) {
                state.invitationFromConsoleTest = false;
                stopAngerCountdown(dialog);
                closeActiveInvitation();
                notify('success', t('invitation.testDone'));
                openConsole(state.activeTab || 'copy');
            }
            return;
        }
        handleInvitationDismiss(characterInfo, retention);
    });

    dialog.addEventListener('close', () => {
        if (state.activeInvitation === dialog) {
            state.activeInvitation = null;
        }
        stopAngerCountdown(dialog);
        setTimeout(() => dialog.remove(), 0);
    });

    if (anger) {
        startAngerCountdown(dialog, characterInfo, countdownSeconds);
    }

    return dialog;
}

async function showInvitation(characterInfo = pickRandom(resolvePoolCharacters()), modeOrRetention = false, options = {}) {
    const settings = ensureSettings();
    if (!settings.enabled || !characterInfo) {
        return false;
    }
    const mode = normalizeInvitationMode(modeOrRetention);

    closeActiveInvitation();
    await preloadImage(getCharacterAvatarUrl(characterInfo));
    if (typeof options.shouldShow === 'function' && !options.shouldShow()) {
        return false;
    }
    const templateContext = options.templateContext || {};
    const dialog = createInvitationDialog(characterInfo, mode, templateContext);
    document.body.append(dialog);
    state.activeInvitation = dialog;
    applyAdaptiveColorsToDialog(dialog, characterInfo);

    if (typeof dialog.showModal === 'function') {
        try {
            dialog.showModal();
        } catch {
            dialog.setAttribute('open', '');
        }
    } else {
        dialog.setAttribute('open', '');
    }

    if (mode === 'birthday' && templateContext.dateEvent && !state.invitationFromConsoleTest) {
        consumeDateEvent(templateContext.dateEvent);
    }

    return true;
}

async function acceptInvitation(characterInfo, modeOrRetention = 'primary') {
    if (state.invitationFromConsoleTest) {
        state.invitationFromConsoleTest = false;
        stopAngerCountdown(state.activeInvitation);
        closeActiveInvitation();
        notify('success', t('invitation.testDone'));
        openConsole(state.activeTab || 'copy');
        return false;
    }
    if (!isSillyTavernReadyForChatSwitch()) {
        notify('warning', t('invitation.notReady'));
        return false;
    }
    const mode = normalizeInvitationMode(modeOrRetention);
    const settings = ensureSettings();
    state.invitationFromConsoleTest = false;
    state.shownThisRound.clear();
    state.continueCount = 0;
    closeActiveInvitation();
    if (mode === 'anger' || settings.angerResetOnAccept) {
        setRejectCount(characterInfo, 0);
    }
    await selectCharacterById(Number(characterInfo.id), { switchMenu: true });
    setTimeout(() => printCharactersDebounced?.(), 250);
    return true;
}

function startAngerCountdown(dialog, characterInfo, seconds) {
    let remaining = seconds;
    let waitingForReady = false;
    const el = dialog.querySelector('[data-pi-anger-countdown]');
    const update = () => {
        if (!el) return;
        if (waitingForReady) {
            el.innerHTML = `<span class="pi-anger-countdown-text">${escapeHtml(t('invitation.angerWaiting'))}</span>`;
        } else {
            el.innerHTML = `<span class="pi-anger-countdown-text">${escapeHtml(t('invitation.angerCountdown', { seconds: Math.max(0, remaining) }))}</span>`;
        }
    };
    update();
    const tick = async () => {
        if (!dialog.isConnected) {
            stopAngerCountdown(dialog);
            return;
        }
        if (remaining > 0) {
            remaining -= 1;
            update();
            return;
        }
        if (!isSillyTavernReadyForChatSwitch()) {
            if (!waitingForReady) {
                waitingForReady = true;
                update();
            }
            return;
        }
        stopAngerCountdown(dialog);
        await acceptInvitation(characterInfo, 'anger');
    };
    dialog._piAngerTimer = setInterval(tick, 1000);
}

function stopAngerCountdown(dialog) {
    if (dialog?._piAngerTimer) {
        clearInterval(dialog._piAngerTimer);
        dialog._piAngerTimer = null;
    }
}

function handleInvitationDismiss(characterInfo, retention = false) {
    const settings = ensureSettings();
    if (!retention && Math.random() * 100 < settings.retentionChance) {
        showInvitation(characterInfo, 'retention');
        return;
    }

    if (!state.invitationFromConsoleTest) {
        incrementRejectCount(characterInfo);
    }

    if (characterInfo?.key) {
        state.shownThisRound.add(characterInfo.key);
    }

    if (settings.continueOnDismiss && state.continueCount < settings.continuePickLimit) {
        const pool = resolvePoolCharacters().filter((c) => !state.shownThisRound.has(c.key));
        if (pool.length) {
            state.continueCount += 1;
            showInvitation(pickRandom(pool));
            return;
        }
    }

    const wasTest = state.invitationFromConsoleTest;
    state.invitationFromConsoleTest = false;
    state.shownThisRound.clear();
    state.continueCount = 0;
    closeActiveInvitation();
    if (wasTest) {
        openConsole('control');
    }
}

function shouldShowHomepageInvitation(force = false) {
    const settings = ensureSettings();
    if (force) {
        return true;
    }

    if (settings.homepageTriggerMode === 'manual') {
        return false;
    }

    if (settings.homepageTriggerMode === 'session') {
        return !state.sessionInvitationShown;
    }

    if (settings.homepageTriggerMode === 'cooldown') {
        const cooldownMs = settings.homepageCooldownMinutes * 60 * 1000;
        return Date.now() - Number(settings.lastHomepageInviteAt || 0) >= cooldownMs;
    }

    return true;
}

function markHomepageInvitationShown(force = false) {
    const settings = ensureSettings();
    state.homepageInviteShown = true;
    if (force) {
        return;
    }

    state.sessionInvitationShown = true;
    settings.lastHomepageInviteAt = Date.now();
    saveSettingsDebounced();
}

function clearHomepageRetryTimer() {
    if (state.homepageRetryTimer) {
        clearTimeout(state.homepageRetryTimer);
        state.homepageRetryTimer = null;
    }
}

function scheduleHomepageInvitationRetry() {
    if (state.homepageRetryTimer) {
        return;
    }
    state.homepageRetryTimer = setTimeout(() => {
        state.homepageRetryTimer = null;
        maybeShowHomepageInvitation();
    }, homepageRetryDelayMs);
}

function isHomepageReadyForInvitation() {
    if (!state.appReady) {
        state.homepageStableSince = 0;
        return false;
    }
    if (state.appReadyAt && Date.now() - state.appReadyAt < homepageAppReadyGraceMs) {
        state.homepageStableSince = 0;
        return false;
    }
    const homepage = isHomepage();
    if (!homepage) {
        state.homepageStableSince = 0;
        return false;
    }

    if (!state.homepageStableSince) {
        state.homepageStableSince = Date.now();
        return false;
    }

    return Date.now() - state.homepageStableSince >= homepageStableDelayMs;
}

function isSillyTavernReadyForChatSwitch() {
    if (!state.appReady) {
        return false;
    }
    if (state.appReadyAt && Date.now() - state.appReadyAt < homepageAppReadyGraceMs) {
        return false;
    }
    return true;
}

async function maybeShowHomepageInvitation(force = false) {
    const settings = ensureSettings();
    if (!settings.enabled || (!settings.autoOpenOnHome && !force)) {
        clearHomepageRetryTimer();
        state.homepageInvitePending = false;
        return;
    }

    if (force) {
        clearHomepageRetryTimer();
        state.homepageInvitePending = false;
        state.homepageInviteShown = false;
    }

    if (!force && (state.homepageInviteShown || state.homepageInviteLoading || !isHomepage() || isConsoleOpen() || state.activeInvitation || !shouldShowHomepageInvitation())) {
        state.homepageInvitePending = false;
        return;
    }

    if (!force && !isHomepageReadyForInvitation()) {
        state.homepageInvitePending = true;
        scheduleHomepageInvitationRetry();
        return;
    }

    const pool = resolvePoolCharacters();
    if (!pool.length) {
        if (force) {
            notify('warning', t('invitation.noPool'));
        } else {
            state.homepageInvitePending = true;
            scheduleHomepageInvitationRetry();
        }
        return;
    }

    clearHomepageRetryTimer();
    state.homepageInvitePending = false;
    state.homepageInviteLoading = true;
    const angerCandidates = pool.filter((c) => shouldShowAngerMode(c));
    let characterInfo;
    let mode;
    let templateContext = {};
    if (angerCandidates.length > 0) {
        characterInfo = pickRandom(angerCandidates);
        mode = 'anger';
    } else {
        const jealousyDispatch = resolveJealousyDispatch(pool, { consumeAttempt: !force });
        if (jealousyDispatch) {
            characterInfo = jealousyDispatch.characterInfo;
            mode = 'jealousy';
            templateContext = jealousyDispatch.templateContext;
        } else {
            characterInfo = pickRandom(pool);
            const resolved = await resolveInvitationModeAfterAnger(characterInfo);
            mode = resolved.mode;
            templateContext = resolved.templateContext;
        }
    }
    showInvitation(characterInfo, mode, {
        templateContext,
        shouldShow: () => force || (isHomepage() && !isConsoleOpen() && !state.activeInvitation && !state.homepageInviteShown),
    }).then((shown) => {
        if (shown) {
            markHomepageInvitationShown(force);
        } else if (!force && isHomepage()) {
            state.homepageInvitePending = true;
            scheduleHomepageInvitationRetry();
        }
    }).finally(() => {
        state.homepageInviteLoading = false;
    });
}

function handleHomepageStateChanged() {
    clearHomepageRetryTimer();
    clearTimeout(state.homepageCheckTimer);
    state.homepageCheckTimer = setTimeout(() => {
        const homepage = isHomepage();
        if (!homepage) {
            state.homepageInviteShown = false;
            state.wasHomepage = false;
            state.homepageStableSince = 0;
            state.homepageInvitePending = false;
            state.homepageInviteLoading = false;
            closeActiveInvitation();
            return;
        }

        if (!state.wasHomepage) {
            state.homepageInviteShown = false;
            state.homepageStableSince = Date.now();
        }
        state.wasHomepage = true;
        maybeShowHomepageInvitation();
    }, homepageRetryDelayMs);
}

function pickRandom(list) {
    if (!Array.isArray(list) || list.length === 0) {
        return null;
    }
    return list[Math.floor(Math.random() * list.length)];
}

function pickWeightedRandom(list, getWeight) {
    const weighted = (Array.isArray(list) ? list : [])
        .map((entry) => ({
            entry,
            weight: Math.max(0, Number(getWeight(entry)) || 0),
        }))
        .filter((item) => item.weight > 0);
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) {
        return null;
    }
    let cursor = Math.random() * total;
    for (const item of weighted) {
        cursor -= item.weight;
        if (cursor <= 0) {
            return item.entry;
        }
    }
    return weighted[weighted.length - 1]?.entry || null;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function applyPanelTheme(root = state.overlay || document) {
    const settings = ensureSettings();
    const theme = panelThemeKeys.includes(settings.panelTheme) ? settings.panelTheme : defaultSettings.panelTheme;
    const overlay = root?.id === 'pi_overlay' ? root : state.overlay || document.querySelector('#pi_overlay');
    const modal = overlay?.querySelector?.('#pi_modal') || document.querySelector('#pi_modal');
    overlay?.setAttribute?.('data-pi-panel-theme', theme);
    modal?.setAttribute?.('data-pi-panel-theme', theme);
}

function buildBaseTemplateContext(characterInfo, extra = {}) {
    const now = extra.now instanceof Date ? extra.now : new Date();
    const hour = now.getHours();
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now);
    const characterBirthday = getCharacterBirthday(characterInfo);
    const birthday = characterBirthday || getCharacterUserBirthday(characterInfo);
    const base = {
        char: characterInfo?.name || '',
        charLabel: characterInfo ? getCharacterJealousyLabel(characterInfo) : '',
        time: `${pad2(hour)}:${pad2(now.getMinutes())}`,
        hour: String(hour),
        weekday,
        date: formatLocalDateKey(now),
        period: getPeriodLabel(now),
        todayEvent: '',
        daysUntilBirthday: getDaysUntilMonthDay(birthday, now),
        lastChar: '',
        lastChat: '',
        minutesSinceLastChat: '',
        daysSinceLastChat: '',
        lastChatDate: '',
        reunionTier: '',
        ...extra,
    };
    delete base.now;
    return base;
}

function applyTemplate(text, characterInfo, templateContext = {}) {
    const values = buildBaseTemplateContext(characterInfo, templateContext);
    let output = String(text || '');
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined || value === null || typeof value === 'object') {
            continue;
        }
        output = output
            .replaceAll(`{${key}}`, String(value))
            .replaceAll(`{{${key}}}`, String(value));
    }
    return output;
}

function getCharacterJealousyLabel(characterInfo) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return characterInfo?.name || '';
    }
    return String(settings.characterJealousyLabels?.[characterInfo.key] || characterInfo.name || '');
}

function getCharacterJealousyChance(characterInfo) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return settings.jealousyChance;
    }
    const value = settings.characterJealousyChances?.[characterInfo.key];
    return Number.isFinite(Number(value))
        ? clampNumber(value, 0, 100, settings.jealousyChance)
        : settings.jealousyChance;
}

function getCharacterBirthday(characterInfo) {
    const settings = ensureSettings();
    return characterInfo?.key ? normalizeMonthDay(settings.characterBirthdays?.[characterInfo.key]) : '';
}

function getCharacterUserBirthday(characterInfo) {
    const settings = ensureSettings();
    const characterValue = characterInfo?.key ? normalizeMonthDay(settings.characterUserBirthdays?.[characterInfo.key]) : '';
    return characterValue || normalizeMonthDay(settings.userBirthday);
}

function getCharacterDateEventText(characterInfo) {
    const settings = ensureSettings();
    return characterInfo?.key ? String(settings.characterDateEvents?.[characterInfo.key] || '') : '';
}

function getManualMessages(characterInfo, templateContext = {}) {
    return getPoolLines(characterInfo, 'dialogue')
        .map((line) => applyTemplate(line, characterInfo, templateContext))
        .filter(Boolean);
}

function getRetentionMessages(characterInfo, templateContext = {}) {
    return getPoolLines(characterInfo, 'retention')
        .map((line) => applyTemplate(line, characterInfo, templateContext))
        .filter(Boolean);
}

function getAngerMessages(characterInfo, templateContext = {}) {
    return getPoolLines(characterInfo, 'anger')
        .map((line) => applyTemplate(line, characterInfo, templateContext))
        .filter(Boolean);
}

function getJealousyMessages(characterInfo, templateContext = {}) {
    return getPoolLines(characterInfo, 'jealousy')
        .map((line) => applyTemplate(line, characterInfo, templateContext))
        .filter(Boolean);
}

function getBirthdayMessages(characterInfo, templateContext = {}) {
    return getPoolLines(characterInfo, 'birthday')
        .map((line) => applyTemplate(line, characterInfo, templateContext))
        .filter(Boolean);
}

function getReunionMessages(characterInfo, templateContext = {}) {
    return getPoolLines(characterInfo, 'reunion')
        .map((line) => applyTemplate(line, characterInfo, templateContext))
        .filter(Boolean);
}

function getMessagesForMode(characterInfo, mode, templateContext = {}) {
    if (mode === 'anger') {
        return getAngerMessages(characterInfo, templateContext);
    }
    if (mode === 'retention') {
        return getRetentionMessages(characterInfo, templateContext);
    }
    if (mode === 'jealousy') {
        return getJealousyMessages(characterInfo, templateContext);
    }
    if (mode === 'birthday') {
        const birthdayMessages = getBirthdayMessages(characterInfo, templateContext);
        return birthdayMessages.length ? birthdayMessages : getManualMessages(characterInfo, templateContext);
    }
    if (mode === 'reunion') {
        return getReunionMessages(characterInfo, templateContext);
    }
    return getManualMessages(characterInfo, templateContext);
}

function getRejectCount(characterInfo) {
    if (!characterInfo?.key) {
        return 0;
    }
    const settings = ensureSettings();
    return Number(settings.rejectCounts?.[characterInfo.key] || 0);
}

function setRejectCount(characterInfo, value) {
    if (!characterInfo?.key) {
        return;
    }
    const settings = ensureSettings();
    if (!settings.rejectCounts || typeof settings.rejectCounts !== 'object') {
        settings.rejectCounts = {};
    }
    const next = Math.max(0, Math.floor(Number(value) || 0));
    if (next <= 0) {
        delete settings.rejectCounts[characterInfo.key];
    } else {
        settings.rejectCounts[characterInfo.key] = next;
    }
    saveSettingsDebounced();
}

function incrementRejectCount(characterInfo) {
    setRejectCount(characterInfo, getRejectCount(characterInfo) + 1);
}

function shouldShowAngerMode(characterInfo) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return false;
    }
    const threshold = clampNumber(settings.angerThreshold, 2, 50, defaultSettings.angerThreshold);
    if (getRejectCount(characterInfo) < threshold) {
        return false;
    }
    return getAngerMessages(characterInfo).length > 0;
}

function isDateEventConsumed(event) {
    if (!event?.key || !event?.dateKey) {
        return false;
    }
    const settings = ensureSettings();
    if (settings.dateEventConsumed?.birthdayMode === event.dateKey) {
        return true;
    }
    return settings.dateEventConsumed?.[event.key] === event.dateKey;
}

function consumeDateEvent(event) {
    if (!event?.key || !event?.dateKey) {
        return;
    }
    const settings = ensureSettings();
    settings.dateEventConsumed.birthdayMode = event.dateKey;
    settings.dateEventConsumed[event.key] = event.dateKey;
    saveSettingsDebounced();
}

function getTodayDateEvents(characterInfo, now = new Date()) {
    const settings = ensureSettings();
    if (!settings.birthdayEnabled) {
        return [];
    }

    const today = formatMonthDay(now);
    const dateKey = formatLocalDateKey(now);
    const events = [];
    const characterUserBirthday = characterInfo?.key ? normalizeMonthDay(settings.characterUserBirthdays?.[characterInfo.key]) : '';
    const userBirthday = characterUserBirthday || normalizeMonthDay(settings.userBirthday);
    if (userBirthday && userBirthday === today) {
        events.push({
            key: characterUserBirthday && characterInfo?.key ? `userBirthday:${characterInfo.key}` : 'userBirthday',
            dateKey,
            name: t('invitation.event.userBirthday'),
        });
    }

    const characterBirthday = getCharacterBirthday(characterInfo);
    if (characterBirthday && characterBirthday === today) {
        events.push({
            key: `characterBirthday:${characterInfo.key}`,
            dateKey,
            name: t('invitation.event.characterBirthday', { char: characterInfo.name || t('invitation.unknownCharacter') }),
        });
    }

    const characterDateEvents = characterInfo?.key
        ? parseCustomDateEvents(getCharacterDateEventText(characterInfo), `characterCustom:${characterInfo.key}`)
        : [];
    for (const event of characterDateEvents) {
        if (event.date === today) {
            events.push({ ...event, dateKey });
        }
    }

    for (const event of parseCustomDateEvents(settings.customDateEvents, 'custom')) {
        if (event.date === today) {
            events.push({ ...event, dateKey });
        }
    }

    if (settings.builtinDateEventsEnabled) {
        for (const event of builtinDateEvents) {
            if (event.date === today) {
                events.push({
                    ...event,
                    dateKey,
                    name: event.nameKey ? t(event.nameKey) : event.name,
                });
            }
        }
    }

    return events.filter((event) => !isDateEventConsumed(event));
}

function getJealousyDepartureContext(now = new Date()) {
    const settings = ensureSettings();
    if (!settings.jealousyEnabled || !state.lastChatCharacter?.key) {
        return null;
    }
    const last = state.lastChatCharacter;
    const leftAt = parseTimestamp(last.leftAt);
    if (!leftAt) {
        return null;
    }
    const elapsedMs = now.getTime() - leftAt;
    const windowMs = settings.jealousyWindowMinutes * 60 * 1000;
    if (elapsedMs < 0 || elapsedMs > windowMs) {
        return null;
    }
    return {
        last,
        token: last.jealousyToken || `${last.key}:${last.chatId || ''}:${leftAt}`,
        context: {
            lastChar: last.label || last.name || '',
            lastChat: last.chatId || '',
            minutesSinceLastChat: String(Math.max(0, Math.floor(elapsedMs / 60000))),
        },
    };
}

function resolveJealousyDispatch(pool, options = {}) {
    const settings = ensureSettings();
    const now = options.now instanceof Date ? options.now : new Date();
    const departure = getJealousyDepartureContext(now);
    if (!departure || state.lastChatJealousyAttemptToken === departure.token) {
        return null;
    }

    const candidates = (Array.isArray(pool) ? pool : []).filter((characterInfo) => {
        if (!characterInfo?.key || characterInfo.key === departure.last.key) {
            return false;
        }
        if (getCharacterJealousyChance(characterInfo) <= 0) {
            return false;
        }
        return getPoolLines(characterInfo, 'jealousy').length > 0;
    });
    if (!candidates.length) {
        return null;
    }

    if (options.consumeAttempt !== false) {
        state.lastChatJealousyAttemptToken = departure.token;
    }

    if (settings.jealousyChance <= 0 || Math.random() * 100 >= settings.jealousyChance) {
        return null;
    }
    const characterInfo = pickWeightedRandom(candidates, getCharacterJealousyChance);
    if (!characterInfo) {
        return null;
    }
    const base = buildBaseTemplateContext(characterInfo, { now });
    return {
        characterInfo,
        templateContext: { ...base, ...departure.context },
    };
}

async function getCharacterLastChatInfo(characterInfo) {
    if (!characterInfo?.key) {
        return { timestamp: 0, never: true };
    }

    const direct = parseTimestamp(characterInfo.character?.date_last_chat);
    if (direct) {
        return { timestamp: direct, never: false };
    }

    const cache = state.lastChatTimeCache.get(characterInfo.key);
    if (cache && Date.now() - cache.checkedAt < 5 * 60 * 1000) {
        return cache;
    }

    const chats = await getPastChatsForCharacter(characterInfo);
    const maxTime = chats.reduce((max, chatInfo) => Math.max(max, parseTimestamp(chatInfo.last_mes)), 0);
    const result = {
        timestamp: maxTime,
        never: !chats.length || !maxTime,
        checkedAt: Date.now(),
    };
    state.lastChatTimeCache.set(characterInfo.key, result);
    return result;
}

async function getReunionContext(characterInfo, now = new Date()) {
    const settings = ensureSettings();
    if (!settings.reunionEnabled || !characterInfo?.key) {
        return null;
    }

    const lastChat = await getCharacterLastChatInfo(characterInfo);
    if (lastChat.never) {
        if (settings.reunionNoChatPolicy !== 'trigger') {
            return null;
        }
        return {
            daysSinceLastChat: t('invitation.neverChattedShort'),
            lastChatDate: t('invitation.neverChatted'),
            reunionTier: 'EX',
        };
    }

    const days = getDaysBetween(lastChat.timestamp, now.getTime());
    if (days < settings.reunionThresholdDays) {
        return null;
    }
    return {
        daysSinceLastChat: String(days),
        lastChatDate: formatDisplayDate(lastChat.timestamp),
        reunionTier: days >= settings.reunionExtremeThresholdDays ? 'EX' : 'SSR',
    };
}

async function resolveInvitationModeAfterAnger(characterInfo) {
    const now = new Date();
    const base = buildBaseTemplateContext(characterInfo, { now });
    const [dateEvent] = getTodayDateEvents(characterInfo, now);
    if (dateEvent) {
        return {
            mode: 'birthday',
            templateContext: {
                ...base,
                todayEvent: dateEvent.name,
                daysUntilBirthday: '0',
                dateEvent,
            },
        };
    }

    const reunion = await getReunionContext(characterInfo, now);
    if (reunion) {
        return {
            mode: 'reunion',
            templateContext: { ...base, ...reunion },
        };
    }

    return {
        mode: 'primary',
        templateContext: base,
    };
}

function getFallbackMessage(characterInfo) {
    return t('invitation.defaultLine', { char: characterInfo?.name || t('invitation.unknownCharacter') });
}

function getFallbackRetentionMessage(characterInfo) {
    return t('invitation.defaultRetentionLine', { char: characterInfo?.name || t('invitation.unknownCharacter') });
}

function getFallbackAngerMessage(characterInfo) {
    return t('invitation.defaultAngerLine', { char: characterInfo?.name || t('invitation.unknownCharacter') });
}

function getFallbackJealousyMessage(characterInfo, templateContext = {}) {
    const values = buildBaseTemplateContext(characterInfo, templateContext);
    return t('invitation.defaultJealousyLine', {
        char: values.char || t('invitation.unknownCharacter'),
        lastChar: values.lastChar || t('invitation.unknownCharacter'),
    });
}

function getFallbackBirthdayMessage(characterInfo, templateContext = {}) {
    const values = buildBaseTemplateContext(characterInfo, templateContext);
    return t('invitation.defaultBirthdayLine', {
        char: values.char || t('invitation.unknownCharacter'),
        event: values.todayEvent || t('invitation.todayEventFallback'),
    });
}

function getFallbackReunionMessage(characterInfo, templateContext = {}) {
    const values = buildBaseTemplateContext(characterInfo, templateContext);
    return t('invitation.defaultReunionLine', {
        char: values.char || t('invitation.unknownCharacter'),
        days: values.daysSinceLastChat || t('invitation.reunionManyDays'),
    });
}

function getFallbackMessageForMode(characterInfo, mode, templateContext = {}) {
    if (mode === 'anger') return getFallbackAngerMessage(characterInfo);
    if (mode === 'retention') return getFallbackRetentionMessage(characterInfo);
    if (mode === 'jealousy') return getFallbackJealousyMessage(characterInfo, templateContext);
    if (mode === 'birthday') return getFallbackBirthdayMessage(characterInfo, templateContext);
    if (mode === 'reunion') return getFallbackReunionMessage(characterInfo, templateContext);
    return getFallbackMessage(characterInfo);
}

function extractGeneratedText(value) {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(extractGeneratedText).filter(Boolean).join('\n');
    }

    if (!value || typeof value !== 'object') {
        return String(value || '');
    }

    const directKeys = ['response', 'message', 'content', 'text', 'mes', 'output', 'generated_text'];
    for (const key of directKeys) {
        if (typeof value[key] === 'string') {
            return value[key];
        }
    }

    const choice = value.choices?.[0];
    if (choice) {
        return extractGeneratedText(choice.message || choice.text || choice.delta || choice);
    }

    return JSON.stringify(value);
}

function unwrapJsonCodeFence(text) {
    return String(text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function parseGeneratedLines(value) {
    const text = extractGeneratedText(value);
    const trimmed = unwrapJsonCodeFence(text);
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed.map(extractGeneratedText)
                .flatMap((item) => parsePoolList(item))
                .map((line) => line.trim())
                .filter(Boolean);
        }
        if (parsed && typeof parsed === 'object') {
            const candidate = parsed.lines || parsed.items || parsed.results || parsed.data || parsed.text || parsed.content;
            if (candidate !== undefined) {
                return parseGeneratedLines(candidate);
            }
        }
    } catch {
        // Plain text output is the normal path.
    }

    return String(text || '')
        .split(/\r?\n|(?=\d+[.)、]\s+)/)
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
        .map((line) => line.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim())
        .filter(Boolean);
}

function shuffleLines(lines) {
    const result = [...lines];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function getSampledLines(lines, count) {
    const uniqueLines = [...new Set(lines.filter(Boolean))];
    if (!uniqueLines.length) {
        return [];
    }

    return shuffleLines(uniqueLines).slice(0, Math.max(1, Math.min(count, uniqueLines.length)));
}

function limitText(text, maxLength = maxContextChars) {
    const value = String(text || '');
    if (value.length <= maxLength) {
        return value;
    }

    return value.slice(value.length - maxLength);
}

function stripHtmlNoise(text) {
    return String(text || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\s*(img|br|hr|input|meta|source|track|wbr|area|base|col|embed|link|param)\b[^>]*\/?>/gi, '');
}

function formatChatMessage(message, index, filterTags = [], excludeTags = [], stripHtml = false) {
    if (!message || typeof message !== 'object') {
        return '';
    }

    const name = String(message.name || (message.is_user ? getContext?.()?.name1 : getContext?.()?.name2) || '').trim();
    const raw = String(message.mes || '');
    const cleaned = stripHtml ? stripHtmlNoise(raw) : raw;
    const stripped = excludeTags.length ? stripTaggedContent(cleaned, excludeTags) : cleaned;
    const filtered = filterTags.length ? extractTaggedContent(stripped, filterTags) : stripped;
    const text = String(filtered || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return '';
    }

    return `#${index} ${name ? `${name}: ` : ''}${text}`;
}

function sliceChatMessages(messages, settings, override) {
    if (!Array.isArray(messages) || !messages.length) {
        return [];
    }

    let start;
    let chunkEnd;
    if (override && typeof override.rangeStart === 'number' && typeof override.rangeEnd === 'number') {
        if (override.rangeStart > messages.length - 1) {
            return [];
        }
        start = clampNumber(override.rangeStart, 0, messages.length - 1, 0);
        chunkEnd = clampNumber(override.rangeEnd, start, messages.length - 1, start);
    } else {
        start = clampNumber(settings.chatFloorStart, 0, messages.length - 1, 0);
        const requestedEnd = clampNumber(settings.chatFloorEnd, start, messages.length - 1, Math.min(messages.length - 1, start + settings.chatChunkSize - 1));
        chunkEnd = Math.min(requestedEnd, start + settings.chatChunkSize - 1);
    }
    const filterTags = parseFilterTagList(settings.chatFilterTags);
    const excludeTags = parseFilterTagList(settings.chatExcludeTags);
    return messages
        .slice(start, chunkEnd + 1)
        .map((message, offset) => formatChatMessage(message, start + offset, filterTags, excludeTags, settings.stripHtmlNoise))
        .filter(Boolean);
}

function computeBatchRanges(settings) {
    const start = Math.max(0, Number(settings.chatFloorStart) | 0);
    const end = Math.max(start, Number(settings.chatFloorEnd) | 0);
    const chunkSize = Math.max(1, Number(settings.chatChunkSize) | 0);
    const ranges = [];
    for (let cursor = start; cursor <= end; cursor += chunkSize) {
        ranges.push({ rangeStart: cursor, rangeEnd: Math.min(cursor + chunkSize - 1, end) });
    }
    return ranges;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchChatFileMessages(characterInfo, fileName) {
    if (!characterInfo || !fileName) {
        return [];
    }

    try {
        const response = await fetch(getSillyTavernApiUrl('/api/chats/get'), {
            method: 'POST',
            headers: getSillyTavernRequestHeaders(),
            body: JSON.stringify({
                ch_name: characterInfo.name,
                file_name: String(fileName).replace(/\.jsonl$/i, ''),
                avatar_url: characterInfo.avatar || characterInfo.character?.avatar,
            }),
            cache: 'no-cache',
        });

        if (!response.ok) {
            return [];
        }

        const messages = await response.json();
        if (Array.isArray(messages) && messages[0]?.chat_metadata !== undefined) {
            return messages.slice(1);
        }
        return Array.isArray(messages) ? messages : [];
    } catch (error) {
        if (ensureSettings().debug) {
            console.warn('[Private Invitation] Failed to read chat file:', fileName, error);
        }
        return [];
    }
}

async function collectChatContextSources(characterInfo) {
    const settings = ensureSettings();
    if (!settings.aiUseChatContext) {
        return [];
    }

    const selectedFiles = getSelectedChatFiles(characterInfo);
    const sources = [];
    const currentChat = getContext?.()?.chat;

    if (!selectedFiles.length && Array.isArray(currentChat) && currentChat.length) {
        sources.push({ label: 'current chat', messages: currentChat });
    }

    for (const fileName of selectedFiles) {
        const messages = await fetchChatFileMessages(characterInfo, fileName);
        if (Array.isArray(messages) && messages.length) {
            sources.push({ label: fileName, messages });
        }
    }
    return sources;
}

function renderSourcesForRange(sources, settings, range) {
    const sections = [];
    for (const source of sources) {
        const lines = sliceChatMessages(source.messages, settings, range);
        if (lines.length) {
            sections.push(`${source.label}\n${lines.join('\n')}`);
        }
    }
    return limitText(sections.join('\n\n'), maxContextChars);
}

async function buildChatContext(characterInfo, range) {
    const sources = await collectChatContextSources(characterInfo);
    if (!sources.length) {
        return '';
    }
    const settings = ensureSettings();
    return renderSourcesForRange(sources, settings, range);
}

function formatWorldEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const keys = Array.isArray(entry.key) ? entry.key.join(', ') : String(entry.key || '');
    const secondary = Array.isArray(entry.keysecondary) ? entry.keysecondary.join(', ') : String(entry.keysecondary || '');
    const comment = String(entry.comment || '').trim();
    const content = String(entry.content || '').trim();
    return [
        comment ? `title: ${comment}` : '',
        keys ? `keys: ${keys}` : '',
        secondary ? `secondary: ${secondary}` : '',
        content,
    ].filter(Boolean).join('\n');
}

async function buildWorldInfoContext(characterInfo) {
    const settings = ensureSettings();
    if (!settings.aiUseWorldInfo) {
        return '';
    }
    const names = characterInfo
        ? getCharacterWorldNames(characterInfo)
        : (settings.selectedWorldNames || []);
    if (!names.length) {
        return '';
    }

    const sections = [];
    for (const worldName of names) {
        const world = await loadWorldInfo(worldName);
        const selection = characterInfo ? getCharacterWorldEntries(characterInfo, worldName) : 'all';
        const selectedSet = selection === 'all' ? null : new Set(selection);
        const entries = Object.values(world?.entries || {})
            .filter((entry) => entry && !entry.disable)
            .filter((entry) => !selectedSet || selectedSet.has(Number(entry.uid)))
            .slice(0, settings.worldEntryLimit)
            .map(formatWorldEntry)
            .filter(Boolean);

        if (entries.length) {
            sections.push(`${worldName}\n${entries.join('\n---\n')}`);
        }
    }

    return limitText(sections.join('\n\n'), maxContextChars);
}

function buildCharacterPersonaContext(characterInfo) {
    const character = characterInfo?.character || {};
    const fields = [
        ['name', character.name],
        ['description', character.description],
        ['personality', character.personality],
        ['scenario', character.scenario],
        ['first greeting', character.first_mes],
        ['example dialogue', character.mes_example],
        ['creator notes', character.creatorcomment || character.data?.creator_notes],
        ['system prompt', character.data?.system_prompt],
        ['post history instructions', character.data?.post_history_instructions],
        ['tags', Array.isArray(character.data?.tags) ? character.data.tags.join(', ') : ''],
        ['world', character.data?.extensions?.world],
        ['alternate greetings', Array.isArray(character.data?.alternate_greetings) ? character.data.alternate_greetings.join('\n') : ''],
    ];

    return fields
        .map(([label, value]) => String(value || '').trim() ? `${label}: ${String(value).trim()}` : '')
        .filter(Boolean)
        .join('\n');
}

function getPresetBuiltinText(preset, kind, count, charName) {
    if (!preset) {
        return '';
    }
    let keyPrefix;
    if (kind === 'retention') keyPrefix = 'invitation.retentionPromptPreset';
    else if (kind === 'anger') keyPrefix = 'invitation.angerPromptPreset';
    else if (kind === 'jealousy') keyPrefix = 'invitation.jealousyPromptPreset';
    else if (kind === 'birthday') keyPrefix = 'invitation.birthdayPromptPreset';
    else if (kind === 'reunion') keyPrefix = 'invitation.reunionPromptPreset';
    else keyPrefix = 'invitation.promptPreset';
    return t(`${keyPrefix}.${preset}`, {
        char: charName || t('invitation.unknownCharacter'),
        count,
    });
}

function customTemplatesFieldFor(kind) {
    if (kind === 'retention') return 'retentionCustomTemplates';
    if (kind === 'anger') return 'angerCustomTemplates';
    if (kind === 'jealousy') return 'jealousyCustomTemplates';
    if (kind === 'birthday') return 'birthdayCustomTemplates';
    if (kind === 'reunion') return 'reunionCustomTemplates';
    return 'aiCustomTemplates';
}

function presetFieldFor(kind) {
    if (kind === 'retention') return 'retentionPromptPreset';
    if (kind === 'anger') return 'angerPromptPreset';
    if (kind === 'jealousy') return 'jealousyPromptPreset';
    if (kind === 'birthday') return 'birthdayPromptPreset';
    if (kind === 'reunion') return 'reunionPromptPreset';
    return 'aiPromptPreset';
}

function promptBodyFieldFor(kind) {
    if (kind === 'retention') return 'retentionPromptBody';
    if (kind === 'anger') return 'angerPromptBody';
    if (kind === 'jealousy') return 'jealousyPromptBody';
    if (kind === 'birthday') return 'birthdayPromptBody';
    if (kind === 'reunion') return 'reunionPromptBody';
    return 'aiPromptBody';
}

function batchCountFieldFor(kind) {
    if (kind === 'retention') return 'retentionBatchCount';
    if (kind === 'anger') return 'angerBatchCount';
    if (kind === 'jealousy') return 'jealousyBatchCount';
    if (kind === 'birthday') return 'birthdayBatchCount';
    if (kind === 'reunion') return 'reunionBatchCount';
    return 'aiBatchCount';
}

function aiPromptFieldFor(kind) {
    if (kind === 'retention') return 'retentionAiPrompt';
    if (kind === 'anger') return 'angerAiPrompt';
    if (kind === 'jealousy') return 'jealousyAiPrompt';
    if (kind === 'birthday') return 'birthdayAiPrompt';
    if (kind === 'reunion') return 'reunionAiPrompt';
    return 'aiPrompt';
}

function instructionKeyFor(kind) {
    if (kind === 'retention') return 'invitation.retentionAiBatchInstruction';
    if (kind === 'anger') return 'invitation.angerAiBatchInstruction';
    if (kind === 'jealousy') return 'invitation.jealousyAiBatchInstruction';
    if (kind === 'birthday') return 'invitation.birthdayAiBatchInstruction';
    if (kind === 'reunion') return 'invitation.reunionAiBatchInstruction';
    return 'invitation.aiBatchInstruction';
}

function rulesKeyFor(kind) {
    if (kind === 'retention') return 'invitation.retentionAiOutputRules';
    if (kind === 'anger') return 'invitation.angerAiOutputRules';
    if (kind === 'jealousy') return 'invitation.jealousyAiOutputRules';
    if (kind === 'birthday') return 'invitation.birthdayAiOutputRules';
    if (kind === 'reunion') return 'invitation.reunionAiOutputRules';
    return 'invitation.aiOutputRules';
}

function promptPresetKeysFor(kind) {
    if (kind === 'retention') return retentionPromptPresetKeys;
    if (kind === 'anger') return angerPromptPresetKeys;
    if (kind === 'jealousy') return jealousyPromptPresetKeys;
    if (kind === 'birthday') return birthdayPromptPresetKeys;
    if (kind === 'reunion') return reunionPromptPresetKeys;
    return promptPresetKeys;
}

function getDefaultPromptBody(preset, kind, count) {
    if (isCustomTemplateKey(preset)) {
        const settings = ensureSettings();
        const templates = settings[customTemplatesFieldFor(kind)];
        const name = getCustomTemplateName(preset);
        return String(templates?.[name] || '');
    }
    return getPresetBuiltinText(preset, kind, count, '{char}');
}

function getPromptPresetText(characterInfo, kind = 'dialogue') {
    const settings = ensureSettings();
    const preset = settings[presetFieldFor(kind)];
    const editedBody = settings[promptBodyFieldFor(kind)];
    const count = settings[batchCountFieldFor(kind)];
    const charName = characterInfo?.name || t('invitation.unknownCharacter');

    const rawBody = (editedBody && editedBody.trim())
        ? editedBody
        : getDefaultPromptBody(preset, kind, count);

    return String(rawBody || '')
        .replace(/\{char\}/g, charName)
        .replace(/\{count\}/g, String(count));
}

async function runSingleGenerate(characterInfo, kind, chatContext) {
    const settings = ensureSettings();
    const batchCount = settings[batchCountFieldFor(kind)];
    const persona = buildCharacterPersonaContext(characterInfo);
    const worldContext = await buildWorldInfoContext(characterInfo);
    const selectedPrompt = getPromptPresetText(characterInfo, kind);
    const customPrompt = applyTemplate(String(settings[aiPromptFieldFor(kind)] || '').trim(), characterInfo);
    const instructionKey = instructionKeyFor(kind);
    const rulesKey = rulesKeyFor(kind);
    const intensityLine = kind === 'anger'
        ? t(`invitation.angerIntensity.${angerIntensityKeys.includes(settings.angerIntensity) ? settings.angerIntensity : 'restrained'}`)
        : '';
    const prompt = [
        t(instructionKey, { char: characterInfo.name, count: batchCount }),
        selectedPrompt,
        intensityLine,
        customPrompt ? `${t('invitation.customPromptLabel')}\n${customPrompt}` : '',
        persona ? `${t('invitation.characterCardLabel')}\n${persona}` : '',
        chatContext ? `${t('invitation.chatContextLabel')}\n${chatContext}` : '',
        worldContext ? `${t('invitation.worldInfoContextLabel')}\n${worldContext}` : '',
        t(rulesKey, { count: batchCount }),
    ].filter(Boolean).join('\n');

    const baseBudget = Math.max(1200, batchCount * 220);
    const maxTokens = clampNumber(settings.aiMaxTokens, 800, 16000, baseBudget);
    const reply = await routeGenerate({
        prompt,
        responseLength: maxTokens,
        trimNames: false,
    });
    return parseGeneratedLines(reply).slice(0, batchCount);
}

async function generateAiMessages(characterInfo, kind = 'dialogue', options = {}) {
    const { onProgress, shouldAbort } = options;
    const settings = ensureSettings();

    if (!settings.aiUseChatContext) {
        return runSingleGenerate(characterInfo, kind, '');
    }
    const sources = await collectChatContextSources(characterInfo);
    if (!sources.length) {
        return runSingleGenerate(characterInfo, kind, '');
    }

    const ranges = computeBatchRanges(settings);
    if (ranges.length === 0) {
        return runSingleGenerate(characterInfo, kind, '');
    }
    if (ranges.length === 1) {
        const chatContext = renderSourcesForRange(sources, settings, ranges[0]);
        return runSingleGenerate(characterInfo, kind, chatContext);
    }

    const collected = [];
    for (let i = 0; i < ranges.length; i++) {
        if (shouldAbort?.()) break;
        const chatContext = renderSourcesForRange(sources, settings, ranges[i]);
        if (!chatContext.trim()) {
            onProgress?.({ current: i + 1, total: ranges.length, phase: 'skip' });
            continue;
        }
        onProgress?.({ current: i + 1, total: ranges.length, phase: 'sending' });
        try {
            const lines = await runSingleGenerate(characterInfo, kind, chatContext);
            collected.push(...lines);
            onProgress?.({ current: i + 1, total: ranges.length, phase: 'done' });
        } catch (err) {
            onProgress?.({ current: i + 1, total: ranges.length, phase: 'error', error: err });
            break;
        }
        if (i < ranges.length - 1 && settings.chatBatchDelayMs > 0 && !shouldAbort?.()) {
            await sleep(settings.chatBatchDelayMs);
        }
    }
    return collected;
}

function aiButtonIdFor(kind) {
    return `${aiDraftElementPrefixFor(kind)}_generate_batch`;
}

function aiAppendButtonIdFor(kind) {
    if (kind === 'dialogue' || !kind) return '#pi_ai_append_generated';
    if (kind === 'retention') return '#pi_retention_ai_append_generated';
    if (kind === 'anger') return '#pi_anger_ai_append_all';
    return `#pi_${kind}_ai_append_all`;
}

function generateBatchLabelFor(kind) {
    return t(`console.${modeI18nScopeFor(kind)}.generateBatch`);
}

function generateEmptyLabelFor(kind) {
    return t(`console.${modeI18nScopeFor(kind)}.generateEmpty`);
}

function generateFailedLabelFor(kind) {
    return t(`console.${modeI18nScopeFor(kind)}.generateFailed`);
}

function batchI18n(kind, suffix, params) {
    const scope = modeI18nScopeFor(kind);
    return t(`console.${scope}.${suffix}`, params);
}

async function handleGenerateAiBatch(root = state.overlay || document, kind = 'dialogue') {
    if (state.aiBatchActiveKind === kind) {
        if (!state.aiBatchAbortRequested) {
            state.aiBatchAbortRequested = true;
            const cancelBtn = root.querySelector(aiButtonIdFor(kind));
            if (cancelBtn) {
                cancelBtn.disabled = true;
                const progress = state.aiBatchProgress || { current: 0, total: 0 };
                cancelBtn.textContent = batchI18n(kind, 'cancelling', progress);
            }
        }
        return;
    }
    if (state.aiBatchActiveKind) {
        notify('warning', t('console.context.batchBusy'));
        return;
    }

    const characterInfo = getSelectedCharacter();
    if (!characterInfo) {
        notify('warning', t('console.dialogue.noCharacters'));
        return;
    }

    const button = root.querySelector(aiButtonIdFor(kind));
    const defaultLabel = generateBatchLabelFor(kind);
    const defaultTitle = button?.getAttribute('title') || '';
    state.aiBatchAbortRequested = false;
    state.aiBatchActiveKind = kind;
    state.aiBatchProgress = { current: 0, total: 0 };

    if (button) {
        button.disabled = false;
        button.textContent = batchI18n(kind, 'cancelStart');
        button.setAttribute('title', batchI18n(kind, 'cancelTooltip'));
    }

    let lastProgress = { current: 0, total: 0 };
    const onProgress = (info) => {
        lastProgress = info;
        state.aiBatchProgress = info;
        if (info.phase === 'sending' && button && !state.aiBatchAbortRequested) {
            button.textContent = batchI18n(kind, 'cancelInProgress', { current: info.current, total: info.total });
        }
        if (info.phase === 'done') {
            notify('info', batchI18n(kind, 'batchDone', { current: info.current, total: info.total }));
        }
    };
    const shouldAbort = () => state.aiBatchAbortRequested;

    try {
        const lines = await generateAiMessages(characterInfo, kind, { onProgress, shouldAbort });
        const aborted = state.aiBatchAbortRequested;
        if (!lines.length) {
            notify('warning', generateEmptyLabelFor(kind));
            return;
        }
        appendDraftLines(characterInfo, kind, lines);
        renderDraftList(root, kind);
        saveSettingsDebounced();

        if (aborted && lastProgress.total > 1) {
            notify('warning', batchI18n(kind, 'partialResult', {
                current: lastProgress.current,
                total: lastProgress.total,
                count: lines.length,
            }));
        }
    } catch (error) {
        if (ensureSettings().debug) {
            console.warn('[Private Invitation] AI batch generation failed:', error);
        }
        notify('error', generateFailedLabelFor(kind));
    } finally {
        state.aiBatchAbortRequested = false;
        state.aiBatchActiveKind = null;
        state.aiBatchProgress = null;
        if (button) {
            button.disabled = false;
            button.textContent = defaultLabel;
            if (defaultTitle) {
                button.setAttribute('title', defaultTitle);
            } else {
                button.removeAttribute('title');
            }
        }
    }
}

function draftListIdFor(kind) {
    return `${aiDraftElementPrefixFor(kind)}_draft_list`;
}

function draftCountIdFor(kind) {
    return `${aiDraftElementPrefixFor(kind)}_draft_count`;
}

function renderDraftList(root = state.overlay || document, kind = 'dialogue') {
    const listEl = root.querySelector(draftListIdFor(kind));
    const countEl = root.querySelector(draftCountIdFor(kind));
    if (!listEl) {
        return;
    }
    const characterInfo = getSelectedCharacter();
    const lines = characterInfo ? getDraftLines(characterInfo, kind) : [];
    const scope = modeI18nScopeFor(kind);

    listEl.innerHTML = '';
    if (!lines.length) {
        const empty = document.createElement('div');
        empty.className = 'pi-draft-empty';
        empty.textContent = t(`console.${scope}.draftEmpty`);
        listEl.appendChild(empty);
    } else {
        lines.forEach((line, index) => {
            const card = document.createElement('div');
            card.className = 'pi-draft-card';
            card.setAttribute('role', 'listitem');
            card.dataset.piDraftIndex = String(index);

            const textEl = document.createElement('div');
            textEl.className = 'pi-draft-card-text';
            textEl.textContent = line;

            const actions = document.createElement('div');
            actions.className = 'pi-draft-card-actions';

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'pi-icon-btn pi-icon-btn--add';
            addBtn.dataset.piDraftAction = 'add';
            addBtn.dataset.piDraftIndex = String(index);
            addBtn.title = t(`console.${scope}.draftAddSingle`);
            addBtn.setAttribute('aria-label', t(`console.${scope}.draftAddSingle`));
            addBtn.textContent = '+';

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'pi-icon-btn pi-icon-btn--remove';
            removeBtn.dataset.piDraftAction = 'remove';
            removeBtn.dataset.piDraftIndex = String(index);
            removeBtn.title = t(`console.${scope}.draftRemoveSingle`);
            removeBtn.setAttribute('aria-label', t(`console.${scope}.draftRemoveSingle`));
            removeBtn.textContent = '×';

            actions.appendChild(addBtn);
            actions.appendChild(removeBtn);
            card.appendChild(textEl);
            card.appendChild(actions);
            listEl.appendChild(card);
        });
    }

    if (countEl) {
        countEl.textContent = t(`console.${scope}.draftCount`, { total: lines.length });
    }
}

function poolElementPrefixFor(kind) {
    if (kind === 'retention') return '#pi_retention_pool';
    if (kind === 'anger') return '#pi_anger_pool';
    if (kind === 'jealousy') return '#pi_jealousy_pool';
    if (kind === 'birthday') return '#pi_birthday_pool';
    if (kind === 'reunion') return '#pi_reunion_pool';
    return '#pi_dialogue_pool';
}

function renderPoolList(root = state.overlay || document, kind = 'dialogue') {
    const prefix = poolElementPrefixFor(kind);
    const listEl = root.querySelector(`${prefix}_list`);
    if (!listEl) {
        return;
    }
    const characterInfo = getSelectedCharacter();
    const lines = characterInfo ? getPoolLines(characterInfo, kind) : [];
    const searchEl = root.querySelector(`${prefix}_search`);
    const search = String(searchEl?.value || '').trim().toLowerCase();

    listEl.innerHTML = '';
    if (!lines.length) {
        const empty = document.createElement('div');
        empty.className = 'pi-pool-empty';
        empty.textContent = t('console.mode.poolEmpty', { mode: getModePoolLabel(kind) });
        listEl.appendChild(empty);
        return;
    }

    const indexed = lines.map((line, index) => ({ line, index }));
    const filtered = search
        ? indexed.filter((entry) => entry.line.toLowerCase().includes(search))
        : indexed;

    if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'pi-pool-empty';
        empty.textContent = t('console.pool.noMatches');
        listEl.appendChild(empty);
        return;
    }

    filtered.forEach(({ line, index }) => {
        const chip = document.createElement('span');
        chip.className = 'pi-chip';
        chip.dataset.piPoolIndex = String(index);

        const textEl = document.createElement('span');
        textEl.className = 'pi-chip-text';
        textEl.dataset.piPoolIndex = String(index);
        textEl.textContent = line;
        textEl.title = t('console.dialogue.poolEditHint');

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'pi-chip-remove';
        removeBtn.dataset.piPoolIndex = String(index);
        removeBtn.title = t('console.dialogue.poolRemoveSingle');
        removeBtn.setAttribute('aria-label', t('console.dialogue.poolRemoveSingle'));
        removeBtn.textContent = '×';

        chip.appendChild(textEl);
        chip.appendChild(removeBtn);
        listEl.appendChild(chip);
    });
}

function appendGeneratedLinesToSaved(root = state.overlay || document, kind = 'dialogue') {
    const characterInfo = getSelectedCharacter();
    if (!characterInfo) {
        notify('warning', t('console.dialogue.noCharacters'));
        return;
    }
    if (!moveAllDraftToPool(characterInfo, kind)) {
        notify('warning', t(`console.${modeI18nScopeFor(kind)}.draftEmptyWarn`));
        return;
    }
    saveSettingsDebounced();
    if (kind === 'retention') {
        renderRetentionEditor(root);
    } else if (kind === 'anger') {
        renderAngerEditor(root);
    } else if (contextualAiModeKeys.includes(kind)) {
        renderContextualModeEditors(root);
        renderContextualAiEditor(root, kind);
    } else {
        renderDialogueEditor(root);
    }
    renderPreview(root);
}

function handleClearDraft(root = state.overlay || document, kind = 'dialogue') {
    const characterInfo = getSelectedCharacter();
    if (!characterInfo) {
        return;
    }
    clearDraft(characterInfo, kind);
    saveSettingsDebounced();
    renderDraftList(root, kind);
}

function updateLastChatCharacterSnapshot() {
    const context = getContext?.();
    if (!context || context.groupId) {
        return;
    }

    const characterId = context.characterId;
    if (characterId !== undefined && characterId !== null && characterId !== '') {
        const characterInfo = findCharacterById(characterId);
        if (!characterInfo?.key) {
            return;
        }
        const snapshot = {
            key: characterInfo.key,
            id: characterInfo.id,
            name: characterInfo.name,
            label: getCharacterJealousyLabel(characterInfo),
            avatar: characterInfo.avatar,
            chatId: context.getCurrentChatId?.() ?? context.chatId ?? '',
            seenAt: Date.now(),
            leftAt: 0,
            jealousyToken: '',
        };
        state.activeChatCharacter = snapshot;
        state.lastChatCharacter = snapshot;
        return;
    }

    if (state.activeChatCharacter?.key) {
        const leftAt = Date.now();
        state.lastChatCharacter = {
            ...state.activeChatCharacter,
            leftAt,
            jealousyToken: `${state.activeChatCharacter.key}:${state.activeChatCharacter.chatId || ''}:${leftAt}`,
        };
        state.activeChatCharacter = null;
    }
}

function handleNavigationStateChanged() {
    updateLastChatCharacterSnapshot();
    handleHomepageStateChanged();
}

function isHomepage() {
    const context = getContext?.();
    const characterId = context?.characterId;
    return !context?.groupId
        && (characterId === undefined || characterId === null || characterId === '')
        && context?.getCurrentChatId?.() === undefined;
}

function syncSettingsFromDom(root = document) {
    const settings = ensureSettings();
    const isOverlayRoot = root === state.overlay || root?.id === 'pi_overlay';
    const enabled = root.querySelector('#pi_enabled') || root.querySelector('#pi_control_enabled');
    const showMenuEntry = root.querySelector('#pi_show_menu_entry') || root.querySelector('#pi_control_show_menu_entry');
    const autoOpenOnHome = root.querySelector('#pi_auto_open_home') || root.querySelector('#pi_control_auto_open_home');
    const panelTheme = root.querySelector('#pi_panel_theme');
    const poolText = root.querySelector('#pi_pool_text');
    const homepageTriggerMode = root.querySelector('#pi_homepage_trigger_mode');
    const homepageCooldownMinutes = root.querySelector('#pi_homepage_cooldown_minutes');
    const aiPromptPreset = root.querySelector('#pi_ai_prompt_preset');
    const aiPromptBody = root.querySelector('#pi_ai_prompt_body');
    const aiPrompt = root.querySelector('#pi_ai_prompt');
    const aiBatchCount = root.querySelector('#pi_ai_batch_count');
    const aiMaxTokens = root.querySelector('#pi_ai_max_tokens');
    const retentionPromptPreset = root.querySelector('#pi_retention_prompt_preset');
    const retentionPromptBody = root.querySelector('#pi_retention_prompt_body');
    const retentionAiPrompt = root.querySelector('#pi_retention_ai_prompt');
    const retentionBatchCount = root.querySelector('#pi_retention_batch_count');
    const useChatContext = root.querySelector('#pi_ai_use_chat_context');
    const stripHtmlNoiseEl = root.querySelector('#pi_strip_html_noise');
    const useWorldInfo = root.querySelector('#pi_ai_use_world_info');
    const chatFloorStart = root.querySelector('#pi_chat_floor_start');
    const chatFloorEnd = root.querySelector('#pi_chat_floor_end');
    const chatChunkSize = root.querySelector('#pi_chat_chunk_size');
    const chatBatchDelay = root.querySelector('#pi_chat_batch_delay');
    const worldEntryLimit = root.querySelector('#pi_world_entry_limit');
    const copyCharacter = root.querySelector('#pi_copy_character');
    const presentationMode = root.querySelector('#pi_presentation_mode');
    const coverEffect = root.querySelector('#pi_cover_effect');
    const coverFit = root.querySelector('#pi_cover_fit');
    const bubblePosition = root.querySelector('#pi_bubble_position');
    const bubbleShape = root.querySelector('#pi_bubble_shape');
    const autoAdaptColor = root.querySelector('#pi_auto_adapt_color');
    const customCss = root.querySelector('#pi_custom_css');
    const textFontSize = root.querySelector('#pi_text_font_size_value') || root.querySelector('#pi_text_font_size');
    const textFontSizeSlider = root.querySelector('#pi_text_font_size');
    const textColor = root.querySelector('#pi_text_color');
    const textOpacity = root.querySelector('#pi_text_opacity_value') || root.querySelector('#pi_text_opacity');
    const textOpacitySlider = root.querySelector('#pi_text_opacity');
    const textStrokeWidth = root.querySelector('#pi_text_stroke_width_value') || root.querySelector('#pi_text_stroke_width');
    const textStrokeWidthSlider = root.querySelector('#pi_text_stroke_width');
    const textStrokeColor = root.querySelector('#pi_text_stroke_color');
    const frameWidth = root.querySelector('#pi_frame_width_value') || root.querySelector('#pi_frame_width');
    const frameWidthSlider = root.querySelector('#pi_frame_width');
    const frameHeight = root.querySelector('#pi_frame_height_value') || root.querySelector('#pi_frame_height');
    const frameHeightSlider = root.querySelector('#pi_frame_height');
    const frameColor = root.querySelector('#pi_frame_color');
    const frameOpacity = root.querySelector('#pi_frame_opacity_value') || root.querySelector('#pi_frame_opacity');
    const frameOpacitySlider = root.querySelector('#pi_frame_opacity');
    const barrageDuration = root.querySelector('#pi_barrage_duration_value') || root.querySelector('#pi_barrage_duration');
    const barrageDurationSlider = root.querySelector('#pi_barrage_duration');
    const barrageLineCount = root.querySelector('#pi_barrage_line_count_value') || root.querySelector('#pi_barrage_line_count');
    const barrageLineCountSlider = root.querySelector('#pi_barrage_line_count');
    const retentionChance = root.querySelector('#pi_retention_chance');
    const continueOnDismiss = root.querySelector('#pi_continue_on_dismiss');
    const continuePickLimit = root.querySelector('#pi_continue_pick_limit');
    const retentionChanceValue = root.querySelector('#pi_retention_chance_value');
    const jealousyEnabled = root.querySelector('#pi_jealousy_enabled');
    const jealousyChance = root.querySelector('#pi_jealousy_chance');
    const jealousyWindowMinutes = root.querySelector('#pi_jealousy_window_minutes');
    const birthdayEnabled = root.querySelector('#pi_birthday_enabled');
    const userBirthday = root.querySelector('#pi_user_birthday');
    const customDateEvents = root.querySelector('#pi_custom_date_events');
    const builtinDateEventsEnabled = root.querySelector('#pi_builtin_date_events_enabled');
    const reunionEnabled = root.querySelector('#pi_reunion_enabled');
    const reunionThresholdDays = root.querySelector('#pi_reunion_threshold_days');
    const reunionExtremeThresholdDays = root.querySelector('#pi_reunion_extreme_threshold_days');
    const reunionNoChatPolicy = root.querySelector('#pi_reunion_no_chat_policy');
    const reunionVisualIntensity = root.querySelector('#pi_reunion_visual_intensity');
    if (isOverlayRoot) {
        syncPoolSelectionFromDom(root);
    }

    if (enabled) {
        settings.enabled = enabled.checked;
    }
    if (showMenuEntry) {
        settings.showMenuEntry = showMenuEntry.checked;
    }
    if (autoOpenOnHome) {
        settings.autoOpenOnHome = autoOpenOnHome.checked;
    }
    if (panelTheme) {
        settings.panelTheme = panelThemeKeys.includes(panelTheme.value) ? panelTheme.value : defaultSettings.panelTheme;
    }
    if (poolText) {
        settings.poolText = poolText.value;
    }
    if (homepageTriggerMode) {
        settings.homepageTriggerMode = homepageTriggerModes.includes(homepageTriggerMode.value) ? homepageTriggerMode.value : defaultSettings.homepageTriggerMode;
    }
    if (homepageCooldownMinutes) {
        settings.homepageCooldownMinutes = clampNumber(homepageCooldownMinutes.value, 1, 10080, defaultSettings.homepageCooldownMinutes);
        homepageCooldownMinutes.value = String(settings.homepageCooldownMinutes);
    }
    if (aiPromptPreset) {
        const value = aiPromptPreset.value;
        if (isCustomTemplateKey(value)) {
            settings.aiPromptPreset = settings.aiCustomTemplates[getCustomTemplateName(value)] ? value : defaultSettings.aiPromptPreset;
        } else {
            settings.aiPromptPreset = promptPresetKeys.includes(value) ? value : defaultSettings.aiPromptPreset;
        }
    }
    if (aiPromptBody) {
        settings.aiPromptBody = String(aiPromptBody.value || '');
    }
    if (aiPrompt) {
        settings.aiPrompt = aiPrompt.value;
    }
    if (aiBatchCount) {
        settings.aiBatchCount = clampNumber(aiBatchCount.value, 3, 30, defaultSettings.aiBatchCount);
        aiBatchCount.value = String(settings.aiBatchCount);
    }
    if (aiMaxTokens) {
        settings.aiMaxTokens = clampNumber(aiMaxTokens.value, 800, 16000, defaultSettings.aiMaxTokens);
        aiMaxTokens.value = String(settings.aiMaxTokens);
    }
    let characterChangedInDom = false;
    if (copyCharacter) {
        const nextCharacterKey = copyCharacter.value;
        characterChangedInDom = nextCharacterKey !== settings.selectedCharacterKey;
        if (characterChangedInDom) {
            persistCharacterContextualSettings(root);
        }
        settings.selectedCharacterKey = nextCharacterKey;
    }
    if (!characterChangedInDom) {
        persistCharacterContextualSettings(root);
    }
    if (retentionPromptPreset) {
        const value = retentionPromptPreset.value;
        if (isCustomTemplateKey(value)) {
            settings.retentionPromptPreset = settings.retentionCustomTemplates[getCustomTemplateName(value)] ? value : defaultSettings.retentionPromptPreset;
        } else {
            settings.retentionPromptPreset = retentionPromptPresetKeys.includes(value) ? value : defaultSettings.retentionPromptPreset;
        }
    }
    if (retentionPromptBody) {
        settings.retentionPromptBody = String(retentionPromptBody.value || '');
    }
    if (retentionAiPrompt) {
        settings.retentionAiPrompt = retentionAiPrompt.value;
    }
    if (retentionBatchCount) {
        settings.retentionBatchCount = clampNumber(retentionBatchCount.value, 3, 30, defaultSettings.retentionBatchCount);
        retentionBatchCount.value = String(settings.retentionBatchCount);
    }
    if (useChatContext) {
        settings.aiUseChatContext = useChatContext.checked;
    }
    if (stripHtmlNoiseEl) {
        settings.stripHtmlNoise = stripHtmlNoiseEl.checked;
    }
    if (useWorldInfo) {
        settings.aiUseWorldInfo = useWorldInfo.checked;
    }
    if (chatFloorStart) {
        settings.chatFloorStart = clampNumber(chatFloorStart.value, 0, 999999, defaultSettings.chatFloorStart);
        chatFloorStart.value = String(settings.chatFloorStart);
    }
    if (chatFloorEnd) {
        settings.chatFloorEnd = clampNumber(chatFloorEnd.value, settings.chatFloorStart, 999999, defaultSettings.chatFloorEnd);
        chatFloorEnd.value = String(settings.chatFloorEnd);
    }
    if (chatChunkSize) {
        settings.chatChunkSize = clampNumber(chatChunkSize.value, 1, 500, defaultSettings.chatChunkSize);
        chatChunkSize.value = String(settings.chatChunkSize);
    }
    if (chatBatchDelay) {
        settings.chatBatchDelayMs = clampNumber(chatBatchDelay.value, 0, 5000, defaultSettings.chatBatchDelayMs);
        chatBatchDelay.value = String(settings.chatBatchDelayMs);
    }
    if (worldEntryLimit) {
        settings.worldEntryLimit = clampNumber(worldEntryLimit.value, 1, 300, defaultSettings.worldEntryLimit);
        worldEntryLimit.value = String(settings.worldEntryLimit);
    }
    if (presentationMode) {
        settings.presentationMode = presentationMode.value;
    }
    if (coverEffect) {
        settings.coverEffect = coverEffectKeys.includes(coverEffect.value) ? coverEffect.value : defaultSettings.coverEffect;
    }
    if (coverFit) {
        settings.coverFit = coverFitKeys.includes(coverFit.value) ? coverFit.value : defaultSettings.coverFit;
    }
    if (bubblePosition) {
        settings.bubblePosition = bubblePositionKeys.includes(bubblePosition.value) ? bubblePosition.value : defaultSettings.bubblePosition;
    }
    if (bubbleShape) {
        settings.bubbleShape = bubbleShapeKeys.includes(bubbleShape.value) ? bubbleShape.value : defaultSettings.bubbleShape;
    }
    if (autoAdaptColor) {
        settings.autoAdaptColor = autoAdaptColor.checked;
    }
    if (customCss) {
        settings.customCss = String(customCss.value || '');
    }
    if (textFontSize) {
        settings.textFontSize = clampNumber(textFontSize.value, 10, 72, defaultSettings.textFontSize);
        textFontSize.value = String(settings.textFontSize);
    }
    if (textFontSizeSlider) {
        textFontSizeSlider.value = String(settings.textFontSize);
    }
    if (textColor) {
        settings.textColor = normalizeColor(textColor.value, defaultSettings.textColor);
    }
    if (textOpacity) {
        settings.textOpacity = clampNumber(textOpacity.value, 0, 100, defaultSettings.textOpacity);
        textOpacity.value = String(settings.textOpacity);
    }
    if (textOpacitySlider) {
        textOpacitySlider.value = String(settings.textOpacity);
    }
    if (textStrokeWidth) {
        settings.textStrokeWidth = clampNumber(textStrokeWidth.value, 0, 4, defaultSettings.textStrokeWidth);
        textStrokeWidth.value = String(settings.textStrokeWidth);
    }
    if (textStrokeWidthSlider) {
        textStrokeWidthSlider.value = String(settings.textStrokeWidth);
    }
    if (textStrokeColor) {
        settings.textStrokeColor = normalizeColor(textStrokeColor.value, defaultSettings.textStrokeColor);
    }
    if (frameWidth) {
        settings.frameWidth = clampNumber(frameWidth.value, 120, 1200, defaultSettings.frameWidth);
        frameWidth.value = String(settings.frameWidth);
    }
    if (frameWidthSlider) {
        frameWidthSlider.value = String(settings.frameWidth);
    }
    if (frameHeight) {
        settings.frameHeight = clampNumber(frameHeight.value, 40, 600, defaultSettings.frameHeight);
        frameHeight.value = String(settings.frameHeight);
    }
    if (frameHeightSlider) {
        frameHeightSlider.value = String(settings.frameHeight);
    }
    if (frameColor) {
        settings.frameColor = normalizeColor(frameColor.value, defaultSettings.frameColor);
    }
    if (frameOpacity) {
        settings.frameOpacity = clampNumber(frameOpacity.value, 0, 100, defaultSettings.frameOpacity);
        frameOpacity.value = String(settings.frameOpacity);
    }
    if (frameOpacitySlider) {
        frameOpacitySlider.value = String(settings.frameOpacity);
    }
    if (barrageDuration) {
        settings.barrageDuration = clampNumber(barrageDuration.value, 6, 60, defaultSettings.barrageDuration);
        barrageDuration.value = String(settings.barrageDuration);
    }
    if (barrageDurationSlider) {
        barrageDurationSlider.value = String(settings.barrageDuration);
    }
    if (barrageLineCount) {
        settings.barrageLineCount = clampNumber(barrageLineCount.value, 2, 8, defaultSettings.barrageLineCount);
        barrageLineCount.value = String(settings.barrageLineCount);
    }
    if (barrageLineCountSlider) {
        barrageLineCountSlider.value = String(settings.barrageLineCount);
    }
    const bubbleOffsetX = root.querySelector('#pi_bubble_offset_x_value') || root.querySelector('#pi_bubble_offset_x');
    const bubbleOffsetXSlider = root.querySelector('#pi_bubble_offset_x');
    const bubbleOffsetY = root.querySelector('#pi_bubble_offset_y_value') || root.querySelector('#pi_bubble_offset_y');
    const bubbleOffsetYSlider = root.querySelector('#pi_bubble_offset_y');
    if (bubbleOffsetX) {
        settings.bubbleOffsetX = clampNumber(bubbleOffsetX.value, -50, 50, defaultSettings.bubbleOffsetX);
        bubbleOffsetX.value = String(settings.bubbleOffsetX);
    }
    if (bubbleOffsetXSlider) {
        bubbleOffsetXSlider.value = String(settings.bubbleOffsetX);
    }
    if (bubbleOffsetY) {
        settings.bubbleOffsetY = clampNumber(bubbleOffsetY.value, -50, 50, defaultSettings.bubbleOffsetY);
        bubbleOffsetY.value = String(settings.bubbleOffsetY);
    }
    if (bubbleOffsetYSlider) {
        bubbleOffsetYSlider.value = String(settings.bubbleOffsetY);
    }
    if (retentionChance) {
        settings.retentionChance = clampNumber(retentionChance.value, 0, 100, defaultSettings.retentionChance);
        retentionChance.value = String(settings.retentionChance);
    }
    if (continueOnDismiss) {
        settings.continueOnDismiss = continueOnDismiss.checked;
    }
    if (continuePickLimit) {
        settings.continuePickLimit = clampNumber(continuePickLimit.value, 1, 10, defaultSettings.continuePickLimit);
        continuePickLimit.value = String(settings.continuePickLimit);
    }
    if (jealousyEnabled) {
        settings.jealousyEnabled = jealousyEnabled.checked;
    }
    if (jealousyChance) {
        settings.jealousyChance = clampNumber(jealousyChance.value, 0, 100, defaultSettings.jealousyChance);
        jealousyChance.value = String(settings.jealousyChance);
    }
    if (jealousyWindowMinutes) {
        settings.jealousyWindowMinutes = clampNumber(jealousyWindowMinutes.value, 1, 1440, defaultSettings.jealousyWindowMinutes);
        jealousyWindowMinutes.value = String(settings.jealousyWindowMinutes);
    }
    if (birthdayEnabled) {
        settings.birthdayEnabled = birthdayEnabled.checked;
    }
    if (userBirthday) {
        const normalized = normalizeMonthDay(userBirthday.value);
        settings.userBirthday = normalized || String(userBirthday.value || '').trim();
        if (normalized) userBirthday.value = normalized;
    }
    if (customDateEvents) {
        settings.customDateEvents = String(customDateEvents.value || '');
    }
    if (builtinDateEventsEnabled) {
        settings.builtinDateEventsEnabled = builtinDateEventsEnabled.checked;
    }
    if (reunionEnabled) {
        settings.reunionEnabled = reunionEnabled.checked;
    }
    if (reunionThresholdDays) {
        settings.reunionThresholdDays = clampNumber(reunionThresholdDays.value, 1, 3650, defaultSettings.reunionThresholdDays);
        reunionThresholdDays.value = String(settings.reunionThresholdDays);
    }
    if (reunionExtremeThresholdDays) {
        settings.reunionExtremeThresholdDays = clampNumber(reunionExtremeThresholdDays.value, settings.reunionThresholdDays, 3650, defaultSettings.reunionExtremeThresholdDays);
        reunionExtremeThresholdDays.value = String(settings.reunionExtremeThresholdDays);
    }
    if (reunionNoChatPolicy) {
        settings.reunionNoChatPolicy = reunionNoChatPolicyKeys.includes(reunionNoChatPolicy.value) ? reunionNoChatPolicy.value : defaultSettings.reunionNoChatPolicy;
    }
    if (reunionVisualIntensity) {
        settings.reunionVisualIntensity = clampNumber(reunionVisualIntensity.value, 0, 100, defaultSettings.reunionVisualIntensity);
        reunionVisualIntensity.value = String(settings.reunionVisualIntensity);
    }
    if (retentionChanceValue) {
        retentionChanceValue.value = String(settings.retentionChance);
    }

    saveSettingsDebounced();
    refreshUi();
}

function persistDialogueEditor(root = document, options = {}) {
    const settings = ensureSettings();
    const skipCharacterContext = Boolean(options.skipCharacterContext);
    const enabled = root.querySelector('#pi_enabled') || root.querySelector('#pi_control_enabled');
    const showMenuEntry = root.querySelector('#pi_show_menu_entry') || root.querySelector('#pi_control_show_menu_entry');
    const autoOpenOnHome = root.querySelector('#pi_auto_open_home') || root.querySelector('#pi_control_auto_open_home');
    const panelTheme = root.querySelector('#pi_panel_theme');
    const poolText = root.querySelector('#pi_pool_text');
    const homepageTriggerMode = root.querySelector('#pi_homepage_trigger_mode');
    const homepageCooldownMinutes = root.querySelector('#pi_homepage_cooldown_minutes');
    const copyCharacter = root.querySelector('#pi_copy_character');
    const aiPromptPreset = root.querySelector('#pi_ai_prompt_preset');
    const aiPromptBody = root.querySelector('#pi_ai_prompt_body');
    const aiPrompt = root.querySelector('#pi_ai_prompt');
    const aiBatchCount = root.querySelector('#pi_ai_batch_count');
    const aiMaxTokens = root.querySelector('#pi_ai_max_tokens');
    const retentionPromptPreset = root.querySelector('#pi_retention_prompt_preset');
    const retentionPromptBody = root.querySelector('#pi_retention_prompt_body');
    const retentionAiPrompt = root.querySelector('#pi_retention_ai_prompt');
    const retentionBatchCount = root.querySelector('#pi_retention_batch_count');
    const useChatContext = root.querySelector('#pi_ai_use_chat_context');
    const stripHtmlNoiseEl = root.querySelector('#pi_strip_html_noise');
    const useWorldInfo = root.querySelector('#pi_ai_use_world_info');
    const chatFloorStart = root.querySelector('#pi_chat_floor_start');
    const chatFloorEnd = root.querySelector('#pi_chat_floor_end');
    const chatChunkSize = root.querySelector('#pi_chat_chunk_size');
    const chatBatchDelay = root.querySelector('#pi_chat_batch_delay');
    const worldEntryLimit = root.querySelector('#pi_world_entry_limit');
    const presentationMode = root.querySelector('#pi_presentation_mode');
    const coverEffect = root.querySelector('#pi_cover_effect');
    const coverFit = root.querySelector('#pi_cover_fit');
    const bubblePosition = root.querySelector('#pi_bubble_position');
    const bubbleShape = root.querySelector('#pi_bubble_shape');
    const autoAdaptColor = root.querySelector('#pi_auto_adapt_color');
    const customCss = root.querySelector('#pi_custom_css');
    const textColor = root.querySelector('#pi_text_color');
    const textOpacity = root.querySelector('#pi_text_opacity_value') || root.querySelector('#pi_text_opacity');
    const textStrokeWidth = root.querySelector('#pi_text_stroke_width_value') || root.querySelector('#pi_text_stroke_width');
    const textStrokeColor = root.querySelector('#pi_text_stroke_color');
    const frameColor = root.querySelector('#pi_frame_color');
    const frameOpacity = root.querySelector('#pi_frame_opacity_value') || root.querySelector('#pi_frame_opacity');
    const barrageDuration = root.querySelector('#pi_barrage_duration_value') || root.querySelector('#pi_barrage_duration');
    const barrageLineCount = root.querySelector('#pi_barrage_line_count_value') || root.querySelector('#pi_barrage_line_count');
    const jealousyEnabled = root.querySelector('#pi_jealousy_enabled');
    const jealousyChance = root.querySelector('#pi_jealousy_chance');
    const jealousyWindowMinutes = root.querySelector('#pi_jealousy_window_minutes');
    const birthdayEnabled = root.querySelector('#pi_birthday_enabled');
    const userBirthday = root.querySelector('#pi_user_birthday');
    const customDateEvents = root.querySelector('#pi_custom_date_events');
    const builtinDateEventsEnabled = root.querySelector('#pi_builtin_date_events_enabled');
    const reunionEnabled = root.querySelector('#pi_reunion_enabled');
    const reunionThresholdDays = root.querySelector('#pi_reunion_threshold_days');
    const reunionExtremeThresholdDays = root.querySelector('#pi_reunion_extreme_threshold_days');
    const reunionNoChatPolicy = root.querySelector('#pi_reunion_no_chat_policy');
    const reunionVisualIntensity = root.querySelector('#pi_reunion_visual_intensity');

    if (enabled) {
        settings.enabled = enabled.checked;
    }
    if (showMenuEntry) {
        settings.showMenuEntry = showMenuEntry.checked;
    }
    if (autoOpenOnHome) {
        settings.autoOpenOnHome = autoOpenOnHome.checked;
    }
    if (panelTheme) {
        settings.panelTheme = panelThemeKeys.includes(panelTheme.value) ? panelTheme.value : defaultSettings.panelTheme;
    }
    if (poolText) {
        settings.poolText = poolText.value;
    }
    if (homepageTriggerMode) {
        settings.homepageTriggerMode = homepageTriggerModes.includes(homepageTriggerMode.value) ? homepageTriggerMode.value : defaultSettings.homepageTriggerMode;
    }
    if (homepageCooldownMinutes) {
        settings.homepageCooldownMinutes = clampNumber(homepageCooldownMinutes.value, 1, 10080, defaultSettings.homepageCooldownMinutes);
    }
    let characterChangedInDom = false;
    if (copyCharacter) {
        const nextCharacterKey = copyCharacter.value;
        characterChangedInDom = nextCharacterKey !== settings.selectedCharacterKey;
        if (characterChangedInDom && !skipCharacterContext) {
            persistCharacterContextualSettings(root);
        }
        settings.selectedCharacterKey = nextCharacterKey;
    }
    if (!skipCharacterContext && !characterChangedInDom) {
        persistCharacterContextualSettings(root);
    }
    if (aiPromptPreset) {
        const value = aiPromptPreset.value;
        if (isCustomTemplateKey(value)) {
            settings.aiPromptPreset = settings.aiCustomTemplates[getCustomTemplateName(value)] ? value : defaultSettings.aiPromptPreset;
        } else {
            settings.aiPromptPreset = promptPresetKeys.includes(value) ? value : defaultSettings.aiPromptPreset;
        }
    }
    if (aiPromptBody) {
        settings.aiPromptBody = String(aiPromptBody.value || '');
    }
    if (aiPrompt) {
        settings.aiPrompt = aiPrompt.value;
    }
    if (aiBatchCount) {
        settings.aiBatchCount = clampNumber(aiBatchCount.value, 3, 30, defaultSettings.aiBatchCount);
    }
    if (aiMaxTokens) {
        settings.aiMaxTokens = clampNumber(aiMaxTokens.value, 800, 16000, defaultSettings.aiMaxTokens);
    }
    if (retentionPromptPreset) {
        const value = retentionPromptPreset.value;
        if (isCustomTemplateKey(value)) {
            settings.retentionPromptPreset = settings.retentionCustomTemplates[getCustomTemplateName(value)] ? value : defaultSettings.retentionPromptPreset;
        } else {
            settings.retentionPromptPreset = retentionPromptPresetKeys.includes(value) ? value : defaultSettings.retentionPromptPreset;
        }
    }
    if (retentionPromptBody) {
        settings.retentionPromptBody = String(retentionPromptBody.value || '');
    }
    if (retentionAiPrompt) {
        settings.retentionAiPrompt = retentionAiPrompt.value;
    }
    if (retentionBatchCount) {
        settings.retentionBatchCount = clampNumber(retentionBatchCount.value, 3, 30, defaultSettings.retentionBatchCount);
    }
    if (useChatContext) {
        settings.aiUseChatContext = useChatContext.checked;
    }
    if (stripHtmlNoiseEl) {
        settings.stripHtmlNoise = stripHtmlNoiseEl.checked;
    }
    if (useWorldInfo) {
        settings.aiUseWorldInfo = useWorldInfo.checked;
    }
    if (chatFloorStart) {
        settings.chatFloorStart = clampNumber(chatFloorStart.value, 0, 999999, defaultSettings.chatFloorStart);
    }
    if (chatFloorEnd) {
        settings.chatFloorEnd = clampNumber(chatFloorEnd.value, settings.chatFloorStart, 999999, defaultSettings.chatFloorEnd);
    }
    if (chatChunkSize) {
        settings.chatChunkSize = clampNumber(chatChunkSize.value, 1, 500, defaultSettings.chatChunkSize);
    }
    if (chatBatchDelay) {
        settings.chatBatchDelayMs = clampNumber(chatBatchDelay.value, 0, 5000, defaultSettings.chatBatchDelayMs);
    }
    if (worldEntryLimit) {
        settings.worldEntryLimit = clampNumber(worldEntryLimit.value, 1, 300, defaultSettings.worldEntryLimit);
    }
    if (presentationMode) {
        settings.presentationMode = presentationMode.value;
    }
    if (coverEffect) {
        settings.coverEffect = coverEffectKeys.includes(coverEffect.value) ? coverEffect.value : defaultSettings.coverEffect;
    }
    if (coverFit) {
        settings.coverFit = coverFitKeys.includes(coverFit.value) ? coverFit.value : defaultSettings.coverFit;
    }
    if (bubblePosition) {
        settings.bubblePosition = bubblePositionKeys.includes(bubblePosition.value) ? bubblePosition.value : defaultSettings.bubblePosition;
    }
    if (bubbleShape) {
        settings.bubbleShape = bubbleShapeKeys.includes(bubbleShape.value) ? bubbleShape.value : defaultSettings.bubbleShape;
    }
    if (autoAdaptColor) {
        settings.autoAdaptColor = autoAdaptColor.checked;
    }
    if (customCss) {
        settings.customCss = String(customCss.value || '');
    }
    if (textColor) {
        settings.textColor = normalizeColor(textColor.value, defaultSettings.textColor);
    }
    if (textOpacity) {
        settings.textOpacity = clampNumber(textOpacity.value, 0, 100, defaultSettings.textOpacity);
    }
    if (textStrokeWidth) {
        settings.textStrokeWidth = clampNumber(textStrokeWidth.value, 0, 4, defaultSettings.textStrokeWidth);
    }
    if (textStrokeColor) {
        settings.textStrokeColor = normalizeColor(textStrokeColor.value, defaultSettings.textStrokeColor);
    }
    if (frameColor) {
        settings.frameColor = normalizeColor(frameColor.value, defaultSettings.frameColor);
    }
    if (frameOpacity) {
        settings.frameOpacity = clampNumber(frameOpacity.value, 0, 100, defaultSettings.frameOpacity);
    }
    if (barrageDuration) {
        settings.barrageDuration = clampNumber(barrageDuration.value, 6, 60, defaultSettings.barrageDuration);
    }
    if (barrageLineCount) {
        settings.barrageLineCount = clampNumber(barrageLineCount.value, 2, 8, defaultSettings.barrageLineCount);
    }
    if (jealousyEnabled) {
        settings.jealousyEnabled = jealousyEnabled.checked;
    }
    if (jealousyChance) {
        settings.jealousyChance = clampNumber(jealousyChance.value, 0, 100, defaultSettings.jealousyChance);
    }
    if (jealousyWindowMinutes) {
        settings.jealousyWindowMinutes = clampNumber(jealousyWindowMinutes.value, 1, 1440, defaultSettings.jealousyWindowMinutes);
    }
    if (birthdayEnabled) {
        settings.birthdayEnabled = birthdayEnabled.checked;
    }
    if (userBirthday) {
        const normalized = normalizeMonthDay(userBirthday.value);
        settings.userBirthday = normalized || String(userBirthday.value || '').trim();
    }
    if (customDateEvents) {
        settings.customDateEvents = String(customDateEvents.value || '');
    }
    if (builtinDateEventsEnabled) {
        settings.builtinDateEventsEnabled = builtinDateEventsEnabled.checked;
    }
    if (reunionEnabled) {
        settings.reunionEnabled = reunionEnabled.checked;
    }
    if (reunionThresholdDays) {
        settings.reunionThresholdDays = clampNumber(reunionThresholdDays.value, 1, 3650, defaultSettings.reunionThresholdDays);
    }
    if (reunionExtremeThresholdDays) {
        settings.reunionExtremeThresholdDays = clampNumber(reunionExtremeThresholdDays.value, settings.reunionThresholdDays, 3650, defaultSettings.reunionExtremeThresholdDays);
    }
    if (reunionNoChatPolicy) {
        settings.reunionNoChatPolicy = reunionNoChatPolicyKeys.includes(reunionNoChatPolicy.value) ? reunionNoChatPolicy.value : defaultSettings.reunionNoChatPolicy;
    }
    if (reunionVisualIntensity) {
        settings.reunionVisualIntensity = clampNumber(reunionVisualIntensity.value, 0, 100, defaultSettings.reunionVisualIntensity);
    }
    const bubbleOffsetXEl = root.querySelector('#pi_bubble_offset_x_value') || root.querySelector('#pi_bubble_offset_x');
    const bubbleOffsetYEl = root.querySelector('#pi_bubble_offset_y_value') || root.querySelector('#pi_bubble_offset_y');
    if (bubbleOffsetXEl) {
        settings.bubbleOffsetX = clampNumber(bubbleOffsetXEl.value, -50, 50, defaultSettings.bubbleOffsetX);
    }
    if (bubbleOffsetYEl) {
        settings.bubbleOffsetY = clampNumber(bubbleOffsetYEl.value, -50, 50, defaultSettings.bubbleOffsetY);
    }

    const continueOnDismiss = root.querySelector('#pi_continue_on_dismiss');
    const continuePickLimit = root.querySelector('#pi_continue_pick_limit');
    if (continueOnDismiss) {
        settings.continueOnDismiss = continueOnDismiss.checked;
    }
    if (continuePickLimit) {
        settings.continuePickLimit = clampNumber(continuePickLimit.value, 1, 10, defaultSettings.continuePickLimit);
    }

    saveSettingsDebounced();
    applyCustomCss();
    applyPanelTheme(root);
    updateMenuVisibility(document);
    updateStatusBadge(state.settingsPanel || root);
    updateDialogueCount(root);
    updateRetentionCount(root);
    renderPreview(root);
    renderMiniPreview(root);
    renderTokenEstimate(root);
}

function syncDomFromSettings(root = document) {
    const settings = ensureSettings();
    const enabled = root.querySelector('#pi_enabled') || root.querySelector('#pi_control_enabled');
    const showMenuEntry = root.querySelector('#pi_show_menu_entry') || root.querySelector('#pi_control_show_menu_entry');
    const autoOpenOnHome = root.querySelector('#pi_auto_open_home') || root.querySelector('#pi_control_auto_open_home');
    const panelTheme = root.querySelector('#pi_panel_theme');
    const poolText = root.querySelector('#pi_pool_text');
    const homepageTriggerMode = root.querySelector('#pi_homepage_trigger_mode');
    const homepageCooldownMinutes = root.querySelector('#pi_homepage_cooldown_minutes');
    const aiPromptPreset = root.querySelector('#pi_ai_prompt_preset');
    const aiPromptBody = root.querySelector('#pi_ai_prompt_body');
    const aiPrompt = root.querySelector('#pi_ai_prompt');
    const aiBatchCount = root.querySelector('#pi_ai_batch_count');
    const aiMaxTokens = root.querySelector('#pi_ai_max_tokens');
    const retentionPromptPreset = root.querySelector('#pi_retention_prompt_preset');
    const retentionPromptBody = root.querySelector('#pi_retention_prompt_body');
    const retentionAiPrompt = root.querySelector('#pi_retention_ai_prompt');
    const retentionBatchCount = root.querySelector('#pi_retention_batch_count');
    const useChatContext = root.querySelector('#pi_ai_use_chat_context');
    const stripHtmlNoiseEl = root.querySelector('#pi_strip_html_noise');
    const useWorldInfo = root.querySelector('#pi_ai_use_world_info');
    const chatFloorStart = root.querySelector('#pi_chat_floor_start');
    const chatFloorEnd = root.querySelector('#pi_chat_floor_end');
    const chatChunkSize = root.querySelector('#pi_chat_chunk_size');
    const chatBatchDelay = root.querySelector('#pi_chat_batch_delay');
    const worldEntryLimit = root.querySelector('#pi_world_entry_limit');
    const copyCharacter = root.querySelector('#pi_copy_character');
    const presentationMode = root.querySelector('#pi_presentation_mode');
    const coverEffect = root.querySelector('#pi_cover_effect');
    const coverFit = root.querySelector('#pi_cover_fit');
    const bubblePosition = root.querySelector('#pi_bubble_position');
    const bubbleShape = root.querySelector('#pi_bubble_shape');
    const autoAdaptColor = root.querySelector('#pi_auto_adapt_color');
    const customCss = root.querySelector('#pi_custom_css');
    const textFontSize = root.querySelector('#pi_text_font_size');
    const textFontSizeValue = root.querySelector('#pi_text_font_size_value');
    const textColor = root.querySelector('#pi_text_color');
    const textOpacity = root.querySelector('#pi_text_opacity');
    const textOpacityValue = root.querySelector('#pi_text_opacity_value');
    const textStrokeWidth = root.querySelector('#pi_text_stroke_width');
    const textStrokeWidthValue = root.querySelector('#pi_text_stroke_width_value');
    const textStrokeColor = root.querySelector('#pi_text_stroke_color');
    const frameWidth = root.querySelector('#pi_frame_width');
    const frameWidthValue = root.querySelector('#pi_frame_width_value');
    const frameHeight = root.querySelector('#pi_frame_height');
    const frameHeightValue = root.querySelector('#pi_frame_height_value');
    const frameColor = root.querySelector('#pi_frame_color');
    const frameOpacity = root.querySelector('#pi_frame_opacity');
    const frameOpacityValue = root.querySelector('#pi_frame_opacity_value');
    const barrageDuration = root.querySelector('#pi_barrage_duration');
    const barrageDurationValue = root.querySelector('#pi_barrage_duration_value');
    const barrageLineCount = root.querySelector('#pi_barrage_line_count');
    const barrageLineCountValue = root.querySelector('#pi_barrage_line_count_value');
    const retentionChance = root.querySelector('#pi_retention_chance');
    const continueOnDismiss = root.querySelector('#pi_continue_on_dismiss');
    const continuePickLimit = root.querySelector('#pi_continue_pick_limit');
    const retentionChanceValue = root.querySelector('#pi_retention_chance_value');
    const jealousyEnabled = root.querySelector('#pi_jealousy_enabled');
    const jealousyChance = root.querySelector('#pi_jealousy_chance');
    const jealousyWindowMinutes = root.querySelector('#pi_jealousy_window_minutes');
    const birthdayEnabled = root.querySelector('#pi_birthday_enabled');
    const userBirthday = root.querySelector('#pi_user_birthday');
    const customDateEvents = root.querySelector('#pi_custom_date_events');
    const builtinDateEventsEnabled = root.querySelector('#pi_builtin_date_events_enabled');
    const reunionEnabled = root.querySelector('#pi_reunion_enabled');
    const reunionThresholdDays = root.querySelector('#pi_reunion_threshold_days');
    const reunionExtremeThresholdDays = root.querySelector('#pi_reunion_extreme_threshold_days');
    const reunionNoChatPolicy = root.querySelector('#pi_reunion_no_chat_policy');
    const reunionVisualIntensity = root.querySelector('#pi_reunion_visual_intensity');

    if (enabled) {
        enabled.checked = settings.enabled;
    }
    if (showMenuEntry) {
        showMenuEntry.checked = settings.showMenuEntry;
    }
    if (autoOpenOnHome) {
        autoOpenOnHome.checked = settings.autoOpenOnHome;
    }
    if (panelTheme) {
        panelTheme.value = settings.panelTheme;
    }
    if (poolText) {
        poolText.value = settings.poolText;
    }
    if (homepageTriggerMode) {
        homepageTriggerMode.value = settings.homepageTriggerMode;
    }
    if (homepageCooldownMinutes) {
        homepageCooldownMinutes.value = String(settings.homepageCooldownMinutes);
    }
    if (aiPromptPreset) {
        rebuildPromptPresetOptions(aiPromptPreset, settings.aiCustomTemplates, 'dialogue');
        aiPromptPreset.value = settings.aiPromptPreset;
    }
    if (aiPromptBody) {
        aiPromptBody.value = settings.aiPromptBody || getDefaultPromptBody(settings.aiPromptPreset, 'dialogue', settings.aiBatchCount);
    }
    if (aiPrompt) {
        aiPrompt.value = settings.aiPrompt;
    }
    if (aiBatchCount) {
        aiBatchCount.value = String(settings.aiBatchCount);
    }
    if (aiMaxTokens) {
        aiMaxTokens.value = String(settings.aiMaxTokens);
    }
    if (retentionPromptPreset) {
        rebuildPromptPresetOptions(retentionPromptPreset, settings.retentionCustomTemplates, 'retention');
        retentionPromptPreset.value = settings.retentionPromptPreset;
    }
    if (retentionPromptBody) {
        retentionPromptBody.value = settings.retentionPromptBody || getDefaultPromptBody(settings.retentionPromptPreset, 'retention', settings.retentionBatchCount);
    }
    if (retentionAiPrompt) {
        retentionAiPrompt.value = settings.retentionAiPrompt;
    }
    if (retentionBatchCount) {
        retentionBatchCount.value = String(settings.retentionBatchCount);
    }
    if (useChatContext) {
        useChatContext.checked = settings.aiUseChatContext;
    }
    if (stripHtmlNoiseEl) {
        stripHtmlNoiseEl.checked = settings.stripHtmlNoise;
    }
    if (useWorldInfo) {
        useWorldInfo.checked = settings.aiUseWorldInfo;
    }
    if (chatFloorStart) {
        chatFloorStart.value = String(settings.chatFloorStart);
    }
    if (chatFloorEnd) {
        chatFloorEnd.value = String(settings.chatFloorEnd);
    }
    if (chatChunkSize) {
        chatChunkSize.value = String(settings.chatChunkSize);
    }
    if (chatBatchDelay) {
        chatBatchDelay.value = String(settings.chatBatchDelayMs);
    }
    renderTagChips(root, 'filter');
    renderTagChips(root, 'exclude');
    if (worldEntryLimit) {
        worldEntryLimit.value = String(settings.worldEntryLimit);
    }
    if (copyCharacter) {
        copyCharacter.value = getSelectedCharacter()?.key || '';
    }
    if (presentationMode) {
        presentationMode.value = settings.presentationMode;
    }
    if (coverEffect) {
        coverEffect.value = settings.coverEffect;
    }
    if (coverFit) {
        coverFit.value = settings.coverFit;
    }
    if (bubblePosition) {
        bubblePosition.value = settings.bubblePosition;
    }
    if (bubbleShape) {
        bubbleShape.value = settings.bubbleShape;
    }
    if (autoAdaptColor) {
        autoAdaptColor.checked = Boolean(settings.autoAdaptColor);
    }
    if (customCss) {
        customCss.value = settings.customCss || '';
    }
    if (textFontSize) {
        textFontSize.value = String(settings.textFontSize);
    }
    if (textFontSizeValue) {
        textFontSizeValue.value = String(settings.textFontSize);
    }
    if (textColor) {
        textColor.value = settings.textColor;
    }
    if (textOpacity) {
        textOpacity.value = String(settings.textOpacity);
    }
    if (textOpacityValue) {
        textOpacityValue.value = String(settings.textOpacity);
    }
    if (textStrokeWidth) {
        textStrokeWidth.value = String(settings.textStrokeWidth);
    }
    if (textStrokeWidthValue) {
        textStrokeWidthValue.value = String(settings.textStrokeWidth);
    }
    if (textStrokeColor) {
        textStrokeColor.value = settings.textStrokeColor;
    }
    if (frameWidth) {
        frameWidth.value = String(settings.frameWidth);
    }
    if (frameWidthValue) {
        frameWidthValue.value = String(settings.frameWidth);
    }
    if (frameHeight) {
        frameHeight.value = String(settings.frameHeight);
    }
    if (frameHeightValue) {
        frameHeightValue.value = String(settings.frameHeight);
    }
    if (frameColor) {
        frameColor.value = settings.frameColor;
    }
    if (frameOpacity) {
        frameOpacity.value = String(settings.frameOpacity);
    }
    if (frameOpacityValue) {
        frameOpacityValue.value = String(settings.frameOpacity);
    }
    if (barrageDuration) {
        barrageDuration.value = String(settings.barrageDuration);
    }
    if (barrageDurationValue) {
        barrageDurationValue.value = String(settings.barrageDuration);
    }
    if (barrageLineCount) {
        barrageLineCount.value = String(settings.barrageLineCount);
    }
    if (barrageLineCountValue) {
        barrageLineCountValue.value = String(settings.barrageLineCount);
    }
    const bubbleOffsetXSyncEl = root.querySelector('#pi_bubble_offset_x');
    const bubbleOffsetXSyncValue = root.querySelector('#pi_bubble_offset_x_value');
    const bubbleOffsetYSyncEl = root.querySelector('#pi_bubble_offset_y');
    const bubbleOffsetYSyncValue = root.querySelector('#pi_bubble_offset_y_value');
    if (bubbleOffsetXSyncEl) bubbleOffsetXSyncEl.value = String(settings.bubbleOffsetX);
    if (bubbleOffsetXSyncValue) bubbleOffsetXSyncValue.value = String(settings.bubbleOffsetX);
    if (bubbleOffsetYSyncEl) bubbleOffsetYSyncEl.value = String(settings.bubbleOffsetY);
    if (bubbleOffsetYSyncValue) bubbleOffsetYSyncValue.value = String(settings.bubbleOffsetY);
    const bubblePosGrid = root.querySelector('#pi_bubble_position_grid');
    if (bubblePosGrid) {
        bubblePosGrid.querySelectorAll('.pi-pos-cell').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.piPos === settings.bubblePosition);
        });
    }
    if (retentionChance) {
        retentionChance.value = String(settings.retentionChance);
    }
    if (retentionChanceValue) {
        retentionChanceValue.value = String(settings.retentionChance);
    }
    if (jealousyEnabled) {
        jealousyEnabled.checked = Boolean(settings.jealousyEnabled);
    }
    if (jealousyChance) {
        jealousyChance.value = String(settings.jealousyChance);
    }
    if (jealousyWindowMinutes) {
        jealousyWindowMinutes.value = String(settings.jealousyWindowMinutes);
    }
    if (birthdayEnabled) {
        birthdayEnabled.checked = Boolean(settings.birthdayEnabled);
    }
    if (userBirthday) {
        userBirthday.value = String(settings.userBirthday || '');
    }
    if (customDateEvents) {
        customDateEvents.value = String(settings.customDateEvents || '');
    }
    if (builtinDateEventsEnabled) {
        builtinDateEventsEnabled.checked = Boolean(settings.builtinDateEventsEnabled);
    }
    if (reunionEnabled) {
        reunionEnabled.checked = Boolean(settings.reunionEnabled);
    }
    if (reunionThresholdDays) {
        reunionThresholdDays.value = String(settings.reunionThresholdDays);
    }
    if (reunionExtremeThresholdDays) {
        reunionExtremeThresholdDays.value = String(settings.reunionExtremeThresholdDays);
    }
    if (reunionNoChatPolicy) {
        reunionNoChatPolicy.value = reunionNoChatPolicyKeys.includes(settings.reunionNoChatPolicy) ? settings.reunionNoChatPolicy : defaultSettings.reunionNoChatPolicy;
    }
    if (reunionVisualIntensity) {
        reunionVisualIntensity.value = String(settings.reunionVisualIntensity);
    }
    const continueOnDismissEl = root.querySelector('#pi_continue_on_dismiss');
    const continuePickLimitEl = root.querySelector('#pi_continue_pick_limit');
    if (continueOnDismissEl) {
        continueOnDismissEl.checked = Boolean(settings.continueOnDismiss);
    }
    if (continuePickLimitEl) {
        continuePickLimitEl.value = String(settings.continuePickLimit);
    }
    renderCharacterPool(root);
    renderDialogueEditor(root);
    renderRetentionEditor(root);
    renderAngerEditor(root);
    renderContextualModeEditors(root);
    renderContextualAiEditors(root);
    renderWorldInfoList(root);
    renderCurrentCharacterBanner(root);
}

function renderPreview(root = document) {
    const summary = root.querySelector('#pi_preview_summary');
    if (!summary) {
        return;
    }

    const settings = ensureSettings();
    const pool = resolvePoolCharacters();
    const sampleChar = pool[0] || getAvailableCharacters()[0] || null;
    const avatarUrl = sampleChar ? getCharacterAvatarUrl(sampleChar) : '';
    const sampleName = sampleChar?.name || t('invitation.unknownCharacter');
    const presentationLabel = {
        barrage: t('console.style.mode.barrage'),
        bubble: t('console.style.mode.bubble'),
        banner: t('console.style.mode.banner'),
    }[settings.presentationMode] ?? settings.presentationMode;

    summary.innerHTML = `
        <div class="pi-preview-frame pi-preview-frame--full" style="${buildInvitationStyleVars(settings)}">
            <div class="pi-invitation-card pi-invitation-card--preview" data-pi-cover-effect="${escapeHtml(settings.coverEffect || 'breath')}" data-pi-cover-fit="${escapeHtml(settings.coverFit || 'contain')}" data-pi-bubble-position="${escapeHtml(settings.bubblePosition || 'top-right')}" data-pi-bubble-shape="${escapeHtml(settings.bubbleShape || 'pill')}" data-pi-presentation-mode="${escapeHtml(settings.presentationMode)}">
                ${avatarUrl ? `<img class="pi-invitation-cover-backdrop" src="${escapeHtml(avatarUrl)}" alt="" aria-hidden="true">` : ''}
                ${avatarUrl ? `<img class="pi-invitation-cover" src="${escapeHtml(avatarUrl)}" alt="">` : ''}
                <div class="pi-invitation-cover-shade"></div>
                <div class="pi-invitation-frame" aria-hidden="true"></div>
                <div class="pi-invitation-content">
                    <div class="pi-invitation-kicker">${escapeHtml(t('invitation.kicker'))}</div>
                    <div class="pi-invitation-name">${escapeHtml(sampleName)}</div>
                    <div class="pi-invitation-message pi-invitation-message--${settings.presentationMode}">
                        ${buildPreviewMessageHtml(settings.presentationMode)}
                    </div>
                    <div class="pi-invitation-actions">
                        <button type="button" class="menu_button pi-invitation-accept">${escapeHtml(t('invitation.accept'))}</button>
                        <button type="button" class="menu_button pi-invitation-dismiss">${escapeHtml(t('invitation.dismiss'))}</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="pi-preview-meta">
            <span class="pi-preview-chip">${t('console.preview.poolCount', { count: pool.length })}</span>
            <span>${t('console.preview.modeLabel', { mode: presentationLabel })}</span>
            <span>${t('console.preview.textSize', { size: settings.textFontSize })}</span>
            <span>${t('console.preview.frameSize', { width: settings.frameWidth, height: settings.frameHeight })}</span>
            <span>${t('console.preview.retention', { chance: settings.retentionChance })}</span>
        </div>
    `;
}

function updateStatusBadge(root = document) {
    const badge = root.querySelector('#pi_status_badge');
    if (!badge) {
        return;
    }

    const settings = ensureSettings();
    const key = settings.enabled ? 'settings.status.ready' : 'settings.status.off';
    badge.textContent = t(key);
    badge.dataset.state = settings.enabled ? 'ready' : 'off';
}

function updateMenuVisibility(root = document) {
    const menuItem = root.querySelector?.('#private_invitation_menu_item') || document.querySelector('#private_invitation_menu_item');
    if (!menuItem) {
        return;
    }

    const settings = ensureSettings();
    menuItem.style.display = settings.showMenuEntry ? '' : 'none';
}

function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 2.5);
}

let tokenEstimateTimer = null;
const tokenEstimateCache = { dialogue: null, retention: null };

function scheduleTokenEstimate(root = state.overlay || document) {
    if (tokenEstimateTimer) {
        clearTimeout(tokenEstimateTimer);
    }
    renderTokenEstimateImmediate(root, { contextEst: { dialogue: null, retention: null }, pending: true });
    tokenEstimateTimer = setTimeout(async () => {
        tokenEstimateTimer = null;
        const settings = ensureSettings();
        const result = { dialogue: 0, retention: 0 };
        if (settings.aiUseChatContext || settings.aiUseWorldInfo) {
            try {
                const charInfo = getSelectedCharacter();
                if (charInfo) {
                    const [chat, world] = await Promise.all([
                        buildChatContext(charInfo),
                        buildWorldInfoContext(charInfo),
                    ]);
                    const ctxLen = String(chat || '').length + String(world || '').length;
                    const est = estimateTokens('x'.repeat(ctxLen));
                    result.dialogue = est;
                    result.retention = est;
                }
            } catch {
                // 忽略，按 0 算
            }
        }
        tokenEstimateCache.dialogue = result.dialogue;
        tokenEstimateCache.retention = result.retention;
        renderTokenEstimateImmediate(root, { contextEst: result, pending: false });
    }, 500);
}

function renderTokenEstimateImmediate(root, { contextEst, pending } = { contextEst: { dialogue: 0, retention: 0 }, pending: false }) {
    const settings = ensureSettings();
    const renderOne = (kind) => {
        const isRetention = kind === 'retention';
        const span = root.querySelector(isRetention ? '#pi_retention_ai_token_estimate' : '#pi_ai_token_estimate');
        if (!span) return;
        const characterInfo = getSelectedCharacter();
        if (!characterInfo) {
            span.textContent = '';
            return;
        }
        const persona = buildCharacterPersonaContext(characterInfo);
        const body = isRetention ? settings.retentionPromptBody : settings.aiPromptBody;
        const customPrompt = isRetention ? settings.retentionAiPrompt : settings.aiPrompt;
        const batchCount = isRetention ? settings.retentionBatchCount : settings.aiBatchCount;
        const promptText = String(persona || '') + String(body || '') + String(customPrompt || '') + 'count:' + batchCount;
        const promptEst = estimateTokens(promptText);
        const ctxEst = contextEst?.[kind] ?? tokenEstimateCache[kind] ?? 0;
        const total = promptEst + ctxEst;
        const max = settings.aiMaxTokens || 2400;
        let cls = 'ok';
        if (total > max) cls = 'danger';
        else if (total > max / 2) cls = 'warn';
        span.className = `pi-token-estimate pi-token-estimate--${cls}`;
        const ctxLabel = pending && (settings.aiUseChatContext || settings.aiUseWorldInfo)
            ? t('console.ai.tokenEstimatePending', { prompt: promptEst, max })
            : t('console.ai.tokenEstimateFull', { prompt: promptEst, ctx: ctxEst, total, max });
        span.textContent = ctxLabel;
    };
    renderOne('dialogue');
    renderOne('retention');
}

function renderTokenEstimate(root = state.overlay || document) {
    renderTokenEstimateImmediate(root, { contextEst: tokenEstimateCache, pending: false });
    scheduleTokenEstimate(root);
}

function refreshUi() {
    updateMenuVisibility(document);
    updateStatusBadge(state.settingsPanel || document);
    applyPanelTheme(state.overlay || document);
    renderCharacterPool(state.overlay || document);
    renderDialogueEditor(state.overlay || document);
    renderRetentionEditor(state.overlay || document);
    renderAngerEditor(state.overlay || document);
    renderContextualModeEditors(state.overlay || document);
    renderWorldInfoList(state.overlay || document);
    renderPreview(state.overlay || document);
    renderMiniPreview(state.overlay || document);
    renderTokenEstimate(state.overlay || document);
    applyCustomCss();
}

function renderMiniPreview(root = state.overlay || document) {
    const container = root.querySelector('#pi_mini_preview');
    if (!container) {
        return;
    }
    const modeSelect = root.querySelector('#pi_mini_preview_mode');
    const settings = ensureSettings();
    const mode = (modeSelect?.value) || 'bubble';
    const pool = resolvePoolCharacters();
    const sampleChar = pool[0] || getAvailableCharacters()[0] || null;
    const avatarUrl = sampleChar ? getCharacterAvatarUrl(sampleChar) : '';
    const sampleName = sampleChar?.name || t('invitation.unknownCharacter');
    container.innerHTML = `
        <div class="pi-preview-frame pi-preview-frame--mini" style="${buildInvitationStyleVars(settings)}">
            <div class="pi-invitation-card pi-invitation-card--preview pi-invitation-card--mini" data-pi-cover-effect="${escapeHtml(settings.coverEffect || 'breath')}" data-pi-cover-fit="${escapeHtml(settings.coverFit || 'contain')}" data-pi-bubble-position="${escapeHtml(settings.bubblePosition || 'top-right')}" data-pi-bubble-shape="${escapeHtml(settings.bubbleShape || 'pill')}" data-pi-presentation-mode="${escapeHtml(mode)}">
                ${avatarUrl ? `<img class="pi-invitation-cover-backdrop" src="${escapeHtml(avatarUrl)}" alt="" aria-hidden="true">` : ''}
                ${avatarUrl ? `<img class="pi-invitation-cover" src="${escapeHtml(avatarUrl)}" alt="">` : ''}
                <div class="pi-invitation-cover-shade"></div>
                <div class="pi-invitation-frame" aria-hidden="true"></div>
                <div class="pi-invitation-content">
                    <div class="pi-invitation-kicker">${escapeHtml(t('invitation.kicker'))}</div>
                    <div class="pi-invitation-name">${escapeHtml(sampleName)}</div>
                    <div class="pi-invitation-message pi-invitation-message--${mode}">
                        ${buildPreviewMessageHtml(mode)}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function openConsole(tab = 'pool') {
    const overlay = state.overlay || document.querySelector('#pi_overlay');
    if (!overlay) {
        return;
    }

    state.activeTab = tab;
    overlay.style.display = '';
    syncDomFromSettings(overlay);
    applyPanelTheme(overlay);
    setActiveTab(tab, overlay);
    renderCharacterPool(overlay);
    renderDialogueEditor(overlay);
    renderRetentionEditor(overlay);
    renderAngerEditor(overlay);
    renderContextualModeEditors(overlay);
    renderChatFileList(overlay);
    renderWorldInfoList(overlay);
    renderPreview(overlay);
    renderCurrentCharacterBanner(overlay);
    if (typeof overlay.showModal === 'function') {
        try {
            overlay.showModal();
        } catch {
            overlay.setAttribute('open', '');
        }
    } else {
        overlay.setAttribute('open', '');
    }
}

function closeConsole() {
    const overlay = state.overlay || document.querySelector('#pi_overlay');
    if (!overlay) {
        return;
    }
    if (overlay.open && typeof overlay.close === 'function') {
        overlay.close();
    } else {
        overlay.removeAttribute('open');
        overlay.style.display = 'none';
    }
}

function syncNumberPair(source, target, root) {
    if (target) {
        target.value = source.value;
    }
    syncSettingsFromDom(root);
}

function setActiveTab(tab, root = document) {
    const validTabs = Array.from(root.querySelectorAll('.pi-tab')).map((b) => b.dataset.piTab);
    const legacyMap = { pool: 'characters', dialogue: 'copy', retention: 'copy', style: 'appearance', preview: 'control' };
    let target = tab;
    if (!validTabs.includes(target)) {
        target = legacyMap[target] || validTabs[0] || 'characters';
    }
    const tabs = root.querySelectorAll('.pi-tab');
    const pages = root.querySelectorAll('.pi-page');
    tabs.forEach((button) => {
        button.classList.toggle('active', button.dataset.piTab === target);
    });
    pages.forEach((page) => {
        page.classList.toggle('active', page.dataset.piPage === target);
    });
    state.activeTab = target;
}

function setActiveScope(host, scope, root = state.overlay || document) {
    if (!host || !scope) {
        return;
    }
    root.querySelectorAll(`.pi-scope-tab[data-pi-scope-host="${host}"]`).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.piScope === scope);
    });
    root.querySelectorAll(`.pi-scope-pane[data-pi-scope-host="${host}"]`).forEach((pane) => {
        if (pane.dataset.piScopePane === scope) {
            pane.removeAttribute('hidden');
        } else {
            pane.setAttribute('hidden', '');
        }
    });
    state.activeScope = state.activeScope || {};
    state.activeScope[host] = scope;
}

function rebuildApiProfileOptions(selectEl) {
    if (!selectEl) {
        return;
    }
    const settings = ensureSettings();
    selectEl.innerHTML = '';
    const manual = document.createElement('option');
    manual.value = '';
    manual.textContent = t('console.api.profileManual');
    selectEl.appendChild(manual);
    (settings.apiProfiles || []).forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name || profile.id;
        selectEl.appendChild(option);
    });
    selectEl.value = settings.currentApiProfileId || '';
}

function syncApiCardFromSettings(root = document) {
    const settings = ensureSettings();
    const radios = root.querySelectorAll('input[name="pi_api_mode"]');
    radios.forEach((radio) => {
        radio.checked = radio.value === settings.apiMode;
    });
    const cfg = settings.independentApiConfig || {};
    const urlEl = root.querySelector('#pi_api_url');
    const keyEl = root.querySelector('#pi_api_key');
    const modelEl = root.querySelector('#pi_api_model');
    if (urlEl) urlEl.value = cfg.apiUrl || '';
    if (keyEl) keyEl.value = cfg.apiKey || '';
    if (modelEl) modelEl.value = cfg.model || '';
    const modelSelect = root.querySelector('#pi_api_model_select');
    if (modelSelect && modelSelect.options.length > 0) {
        modelSelect.value = cfg.model || '';
    }
    const fieldsEl = root.querySelector('[data-pi-api-fields]');
    if (fieldsEl) {
        fieldsEl.classList.toggle('pi-api-fields--disabled', settings.apiMode !== 'independent');
    }
    const tagEl = root.querySelector('[data-pi-api-mode-tag]');
    if (tagEl) {
        const isIndep = settings.apiMode === 'independent';
        tagEl.textContent = isIndep
            ? t('console.api.modeTagIndependent', { model: cfg.model || t('console.api.modeTagNoModel') })
            : t('console.api.modeTagShared');
        tagEl.classList.toggle('pi-api-mode-tag--indep', isIndep);
    }
    rebuildApiProfileOptions(root.querySelector('#pi_api_profile_select'));
}

function persistApiCardInputs(root = document) {
    const settings = ensureSettings();
    const urlEl = root.querySelector('#pi_api_url');
    const keyEl = root.querySelector('#pi_api_key');
    const modelEl = root.querySelector('#pi_api_model');
    settings.independentApiConfig = {
        apiUrl: urlEl ? String(urlEl.value || '').trim() : (settings.independentApiConfig?.apiUrl || ''),
        apiKey: keyEl ? String(keyEl.value || '').trim() : (settings.independentApiConfig?.apiKey || ''),
        model: modelEl ? String(modelEl.value || '').trim() : (settings.independentApiConfig?.model || ''),
    };
    saveSettingsDebounced();
}

function bindApiCardControls(root) {
    const card = root.querySelector('.pi-api-card');
    if (!card) {
        return;
    }
    const profileSelect = card.querySelector('#pi_api_profile_select');
    syncApiCardFromSettings(root);

    card.querySelectorAll('input[name="pi_api_mode"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            if (!radio.checked) {
                return;
            }
            const settings = ensureSettings();
            settings.apiMode = radio.value === 'independent' ? 'independent' : 'shared';
            saveSettingsDebounced();
            syncApiCardFromSettings(root);
        });
    });

    ['#pi_api_url', '#pi_api_key', '#pi_api_model'].forEach((selector) => {
        const el = card.querySelector(selector);
        if (!el) {
            return;
        }
        el.addEventListener('input', () => {
            persistApiCardInputs(root);
            if (selector === '#pi_api_model') {
                const tagEl = root.querySelector('[data-pi-api-mode-tag]');
                if (tagEl && ensureSettings().apiMode === 'independent') {
                    tagEl.textContent = t('console.api.modeTagIndependent', {
                        model: el.value.trim() || t('console.api.modeTagNoModel'),
                    });
                }
            }
        });
        el.addEventListener('change', () => {
            persistApiCardInputs(root);
        });
    });

    const modelInput = card.querySelector('#pi_api_model');
    const modelSelect = card.querySelector('#pi_api_model_select');
    const modelDatalist = card.querySelector('#pi_api_model_list');
    const fetchBtn = card.querySelector('#pi_api_fetch_models');
    const fetchStatus = card.querySelector('[data-pi-fetch-status]');

    const populateModelOptions = (models) => {
        if (modelDatalist) {
            modelDatalist.innerHTML = models.map((m) => `<option value="${m}"></option>`).join('');
        }
        if (modelSelect) {
            modelSelect.innerHTML = ['<option value="">' + t('console.api.modelSelectPlaceholder') + '</option>']
                .concat(models.map((m) => `<option value="${m}">${m}</option>`))
                .join('');
            modelSelect.hidden = models.length === 0;
            modelSelect.value = modelInput?.value || '';
        }
    };

    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            if (!modelInput) return;
            const value = modelSelect.value;
            if (!value) return;
            modelInput.value = value;
            persistApiCardInputs(root);
            syncApiCardFromSettings(root);
        });
    }

    if (fetchBtn) {
        fetchBtn.addEventListener('click', async () => {
            const url = (modelInput && card.querySelector('#pi_api_url')?.value) || '';
            const key = card.querySelector('#pi_api_key')?.value || '';
            if (!url.trim()) {
                notify('warning', t('console.api.fetchNeedUrl'));
                return;
            }
            const originalText = fetchBtn.textContent;
            fetchBtn.disabled = true;
            fetchBtn.textContent = '…';
            if (fetchStatus) fetchStatus.textContent = t('console.api.fetchLoading');
            try {
                const models = await fetchAvailableModels(url, key);
                if (!models.length) {
                    if (fetchStatus) fetchStatus.textContent = t('console.api.fetchEmpty');
                    notify('warning', t('console.api.fetchEmpty'));
                    return;
                }
                populateModelOptions(models);
                if (fetchStatus) fetchStatus.textContent = t('console.api.fetchDone', { count: models.length });
                notify('success', t('console.api.fetchDone', { count: models.length }));
            } catch (error) {
                if (fetchStatus) fetchStatus.textContent = t('console.api.fetchFailed', { message: error?.message || String(error) });
                notify('error', t('console.api.fetchFailed', { message: error?.message || String(error) }));
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.textContent = originalText;
            }
        });
    }

    if (profileSelect) {
        profileSelect.addEventListener('change', () => {
            applyApiProfile(profileSelect.value);
            syncApiCardFromSettings(root);
        });
    }

    card.querySelector('#pi_api_profile_save')?.addEventListener('click', () => {
        const settings = ensureSettings();
        const profile = getCurrentApiProfile(settings);
        if (!profile) {
            notify('warning', t('console.api.profileNoneSelected'));
            return;
        }
        persistApiCardInputs(root);
        const saved = saveActiveApiProfile();
        syncApiCardFromSettings(root);
        notify('success', t('console.api.profileSavedToast', { name: saved?.name || profile.name }));
    });

    card.querySelector('#pi_api_profile_save_as')?.addEventListener('click', () => {
        const name = globalThis.prompt?.(t('console.api.profileNamePrompt'));
        if (!name) {
            return;
        }
        try {
            persistApiCardInputs(root);
            const profile = saveCurrentApiProfileAs(name);
            syncApiCardFromSettings(root);
            notify('success', t('console.api.profileSavedToast', { name: profile.name }));
        } catch (error) {
            notify('error', error?.message || String(error));
        }
    });

    card.querySelector('#pi_api_profile_delete')?.addEventListener('click', () => {
        const settings = ensureSettings();
        const profile = getCurrentApiProfile(settings);
        if (!profile) {
            notify('warning', t('console.api.profileNoneSelected'));
            return;
        }
        const confirmMsg = t('console.api.profileDeleteConfirm', { name: profile.name });
        if (globalThis.confirm && !globalThis.confirm(confirmMsg)) {
            return;
        }
        const removed = deleteCurrentApiProfile();
        syncApiCardFromSettings(root);
        if (removed) {
            notify('info', t('console.api.profileDeletedToast', { name: removed.name }));
        }
    });
}

function bindScopeTabs(root) {
    root.querySelectorAll('.pi-scope-tabs').forEach((tabContainer) => {
        const host = tabContainer.dataset.piScopeHost;
        if (!host) {
            return;
        }
        tabContainer.querySelectorAll('.pi-scope-tab').forEach((btn) => {
            btn.addEventListener('click', () => setActiveScope(host, btn.dataset.piScope, root));
        });
    });
}

function bindPromptTemplateControls(root, kind) {
    const prefix = promptElementPrefixFor(kind);
    const presetSelect = root.querySelector(`${prefix}_prompt_preset`);
    const bodyTextarea = root.querySelector(`${prefix}_prompt_body`);
    const resetButton = root.querySelector(`${prefix}_reset_prompt`);
    const saveButton = root.querySelector(`${prefix}_save_template`);
    const deleteButton = root.querySelector(`${prefix}_delete_template`);

    const settingsPresetKey = presetFieldFor(kind);
    const settingsBodyKey = promptBodyFieldFor(kind);
    const settingsTemplatesKey = customTemplatesFieldFor(kind);
    const settingsCountKey = batchCountFieldFor(kind);
    const i18nNamespace = `console.${modeI18nScopeFor(kind)}`;

    function loadBodyFromPreset(presetValue) {
        const settings = ensureSettings();
        const body = getDefaultPromptBody(presetValue, kind, settings[settingsCountKey]);
        if (bodyTextarea) {
            bodyTextarea.value = body;
        }
        settings[settingsBodyKey] = '';
    }

    if (presetSelect) {
        presetSelect.addEventListener('change', () => {
            const settings = ensureSettings();
            settings[settingsPresetKey] = presetSelect.value;
            loadBodyFromPreset(presetSelect.value);
            saveSettingsDebounced();
            renderPreview(root);
        });
    }

    if (resetButton) {
        resetButton.addEventListener('click', () => {
            const settings = ensureSettings();
            if (isCustomTemplateKey(settings[settingsPresetKey])) {
                const templates = settings[settingsTemplatesKey] || {};
                const name = getCustomTemplateName(settings[settingsPresetKey]);
                if (bodyTextarea) {
                    bodyTextarea.value = String(templates[name] || '');
                }
                settings[settingsBodyKey] = '';
            } else {
                loadBodyFromPreset(settings[settingsPresetKey]);
            }
            saveSettingsDebounced();
        });
    }

    if (saveButton) {
        saveButton.addEventListener('click', () => {
            const settings = ensureSettings();
            const bodyValue = String(bodyTextarea?.value || '').trim();
            if (!bodyValue) {
                notify('warning', t(`${i18nNamespace}.templateBodyEmpty`));
                return;
            }
            const name = (window.prompt(t(`${i18nNamespace}.templateNamePrompt`), '') || '').trim();
            if (!name) {
                if (name !== '') {
                    notify('warning', t(`${i18nNamespace}.templateNameEmpty`));
                }
                return;
            }
            const templates = settings[settingsTemplatesKey] || {};
            templates[name] = bodyValue;
            settings[settingsTemplatesKey] = templates;
            const customKey = makeCustomTemplateKey(name);
            settings[settingsPresetKey] = customKey;
            settings[settingsBodyKey] = '';
            if (presetSelect) {
                rebuildPromptPresetOptions(presetSelect, templates, kind);
                presetSelect.value = customKey;
            }
            saveSettingsDebounced();
            notify('success', t(`${i18nNamespace}.templateSaved`, { name }));
        });
    }

    if (deleteButton) {
        deleteButton.addEventListener('click', () => {
            const settings = ensureSettings();
            const currentKey = settings[settingsPresetKey];
            if (!isCustomTemplateKey(currentKey)) {
                notify('warning', t(`${i18nNamespace}.deleteBuiltinDenied`));
                return;
            }
            const name = getCustomTemplateName(currentKey);
            const templates = settings[settingsTemplatesKey] || {};
            delete templates[name];
            settings[settingsTemplatesKey] = templates;
            settings[settingsPresetKey] = defaultSettings[settingsPresetKey];
            settings[settingsBodyKey] = '';
            if (presetSelect) {
                rebuildPromptPresetOptions(presetSelect, templates, kind);
                presetSelect.value = settings[settingsPresetKey];
            }
            loadBodyFromPreset(settings[settingsPresetKey]);
            saveSettingsDebounced();
            notify('success', t(`${i18nNamespace}.templateDeleted`, { name }));
        });
    }
}

function bindDraftListControls(root, kind) {
    const prefix = aiDraftElementPrefixFor(kind);
    const listEl = root.querySelector(`${prefix}_draft_list`);
    const clearButton = root.querySelector(`${prefix}_draft_clear`);

    if (listEl) {
        listEl.addEventListener('click', (event) => {
            const btn = event.target?.closest?.('[data-pi-draft-action]');
            if (!btn) {
                return;
            }
            const characterInfo = getSelectedCharacter();
            if (!characterInfo) {
                return;
            }
            const index = Number(btn.dataset.piDraftIndex);
            if (!Number.isFinite(index)) {
                return;
            }
            if (btn.dataset.piDraftAction === 'add') {
                moveDraftLineToPool(characterInfo, kind, index);
                saveSettingsDebounced();
                renderDraftList(root, kind);
                renderPoolList(root, kind);
                renderPreview(root);
            } else if (btn.dataset.piDraftAction === 'remove') {
                removeDraftLineAt(characterInfo, kind, index);
                saveSettingsDebounced();
                renderDraftList(root, kind);
            }
        });
    }

    if (clearButton) {
        clearButton.addEventListener('click', () => handleClearDraft(root, kind));
    }
}

function bindAiModeFieldControls(root, kind) {
    const prefix = promptElementPrefixFor(kind);
    const ids = [
        `${prefix}_prompt_body`,
        `${prefix}_ai_prompt`,
        `${prefix}_batch_count`,
    ];
    const persist = () => {
        persistAiModeEditor(root, kind);
        saveSettingsDebounced();
    };
    for (const id of ids) {
        const el = root.querySelector(id);
        if (!el) continue;
        el.addEventListener('change', persist);
    }
}

function bindAngerCardControls(root) {
    const threshold = root.querySelector('#pi_anger_threshold');
    const countdown = root.querySelector('#pi_anger_countdown_seconds');
    const resetOnAccept = root.querySelector('#pi_anger_reset_on_accept');
    const accentColor = root.querySelector('#pi_anger_accent_color');
    const resetCountBtn = root.querySelector('#pi_anger_reset_count');
    const testBtn = root.querySelector('#pi_anger_test');
    const batchCount = root.querySelector('#pi_anger_batch_count');

    if (threshold) {
        threshold.addEventListener('change', () => {
            const settings = ensureSettings();
            settings.angerThreshold = clampNumber(threshold.value, 2, 50, defaultSettings.angerThreshold);
            threshold.value = String(settings.angerThreshold);
            saveSettingsDebounced();
        });
    }
    if (countdown) {
        countdown.addEventListener('change', () => {
            const settings = ensureSettings();
            settings.angerCountdownSeconds = clampNumber(countdown.value, 3, 20, defaultSettings.angerCountdownSeconds);
            countdown.value = String(settings.angerCountdownSeconds);
            saveSettingsDebounced();
        });
    }
    const intensity = root.querySelector('#pi_anger_intensity');
    if (intensity) {
        intensity.addEventListener('change', () => {
            const settings = ensureSettings();
            settings.angerIntensity = angerIntensityKeys.includes(intensity.value) ? intensity.value : defaultSettings.angerIntensity;
            intensity.value = settings.angerIntensity;
            saveSettingsDebounced();
        });
    }
    if (resetOnAccept) {
        resetOnAccept.addEventListener('change', () => {
            const settings = ensureSettings();
            settings.angerResetOnAccept = Boolean(resetOnAccept.checked);
            saveSettingsDebounced();
        });
    }
    if (accentColor) {
        accentColor.addEventListener('change', () => {
            const settings = ensureSettings();
            settings.angerAccentColor = normalizeColor(accentColor.value, defaultSettings.angerAccentColor);
            saveSettingsDebounced();
        });
    }
    if (batchCount) {
        batchCount.addEventListener('change', () => {
            const settings = ensureSettings();
            settings.angerBatchCount = clampNumber(batchCount.value, 3, 30, defaultSettings.angerBatchCount);
            batchCount.value = String(settings.angerBatchCount);
            saveSettingsDebounced();
        });
    }
    if (resetCountBtn) {
        resetCountBtn.addEventListener('click', () => {
            const characterInfo = getSelectedCharacter();
            if (!characterInfo) {
                notify('warning', t('console.dialogue.noCharacters'));
                return;
            }
            setRejectCount(characterInfo, 0);
            renderAngerEditor(root);
            notify('success', t('console.anger.resetCountDone'));
        });
    }
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            const characterInfo = getSelectedCharacter();
            if (!characterInfo) {
                notify('warning', t('console.dialogue.noCharacters'));
                return;
            }
            state.invitationFromConsoleTest = true;
            closeConsole();
            showInvitation(characterInfo, 'anger');
        });
    }

    const angerAiPrompt = root.querySelector('#pi_anger_ai_prompt');
    if (angerAiPrompt) {
        angerAiPrompt.addEventListener('change', () => {
            const settings = ensureSettings();
            settings.angerAiPrompt = String(angerAiPrompt.value || '');
            saveSettingsDebounced();
        });
    }
    const angerPromptBody = root.querySelector('#pi_anger_prompt_body');
    if (angerPromptBody) {
        angerPromptBody.addEventListener('change', () => {
            const settings = ensureSettings();
            settings.angerPromptBody = String(angerPromptBody.value || '');
            saveSettingsDebounced();
        });
    }
    const angerGenerateBtn = root.querySelector('#pi_anger_ai_generate_batch');
    if (angerGenerateBtn) {
        angerGenerateBtn.addEventListener('click', () => handleGenerateAiBatch(root, 'anger'));
    }
    const angerAppendAllBtn = root.querySelector('#pi_anger_ai_append_all');
    if (angerAppendAllBtn) {
        angerAppendAllBtn.addEventListener('click', () => appendGeneratedLinesToSaved(root, 'anger'));
    }
}

function buildTestTemplateContext(mode, characterInfo) {
    const settings = ensureSettings();
    const base = buildBaseTemplateContext(characterInfo);
    if (mode === 'jealousy') {
        const other = getAvailableCharacters().find((entry) => entry.key !== characterInfo?.key);
        return {
            ...base,
            lastChar: other ? getCharacterJealousyLabel(other) : t('console.jealousy.testLastCharFallback'),
            lastChat: 'test-chat',
            minutesSinceLastChat: '3',
        };
    }
    if (mode === 'birthday') {
        return {
            ...base,
            todayEvent: t('console.birthday.testEventName'),
            daysUntilBirthday: '0',
            dateEvent: {
                key: 'test:birthday',
                dateKey: formatLocalDateKey(),
                name: t('console.birthday.testEventName'),
            },
        };
    }
    if (mode === 'reunion') {
        const days = Math.max(settings.reunionThresholdDays + 15, 45);
        return {
            ...base,
            daysSinceLastChat: String(days),
            lastChatDate: formatDisplayDate(Date.now() - days * 24 * 60 * 60 * 1000),
            reunionTier: days >= settings.reunionExtremeThresholdDays ? 'EX' : 'SSR',
        };
    }
    return base;
}

function showContextualModeTest(root, mode) {
    const characterInfo = getSelectedCharacter();
    if (!characterInfo) {
        notify('warning', t('console.dialogue.noCharacters'));
        return;
    }
    state.invitationFromConsoleTest = true;
    closeConsole();
    showInvitation(characterInfo, mode, {
        templateContext: buildTestTemplateContext(mode, characterInfo),
    });
}

function bindContextualModeControls(root) {
    const characterBirthday = root.querySelector('#pi_character_birthday');
    const characterUserBirthday = root.querySelector('#pi_character_user_birthday');
    const characterDateEvents = root.querySelector('#pi_character_date_events');
    const characterJealousyLabel = root.querySelector('#pi_character_jealousy_label');
    const characterJealousyChance = root.querySelector('#pi_character_jealousy_chance');
    const testJealousy = root.querySelector('#pi_jealousy_test');
    const testBirthday = root.querySelector('#pi_birthday_test');
    const testReunion = root.querySelector('#pi_reunion_test');

    const saveCharacterContext = () => {
        persistCharacterContextualSettings(root);
        saveSettingsDebounced();
        renderContextualModeEditors(root);
    };

    if (characterBirthday) {
        characterBirthday.addEventListener('change', saveCharacterContext);
    }
    if (characterUserBirthday) {
        characterUserBirthday.addEventListener('change', saveCharacterContext);
    }
    if (characterDateEvents) {
        characterDateEvents.addEventListener('change', saveCharacterContext);
    }
    if (characterJealousyLabel) {
        characterJealousyLabel.addEventListener('change', saveCharacterContext);
    }
    if (characterJealousyChance) {
        characterJealousyChance.addEventListener('change', saveCharacterContext);
    }
    if (testJealousy) {
        testJealousy.addEventListener('click', () => showContextualModeTest(root, 'jealousy'));
    }
    if (testBirthday) {
        testBirthday.addEventListener('click', () => showContextualModeTest(root, 'birthday'));
    }
    if (testReunion) {
        testReunion.addEventListener('click', () => showContextualModeTest(root, 'reunion'));
    }
}

function bindPoolListControls(root, kind) {
    const prefix = poolElementPrefixFor(kind);
    const listEl = root.querySelector(`${prefix}_list`);
    const input = root.querySelector(`${prefix}_input`);
    const addButton = root.querySelector(`${prefix}_add`);
    const searchEl = root.querySelector(`${prefix}_search`);

    const submitInput = () => {
        if (!input) return;
        const characterInfo = getSelectedCharacter();
        if (!characterInfo) {
            notify('warning', t('console.dialogue.noCharacters'));
            return;
        }
        const rawValue = String(input.value || '');
        const lines = rawValue.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) {
            return;
        }
        appendPoolLines(characterInfo, kind, lines);
        input.value = '';
        saveSettingsDebounced();
        refreshPoolEditor(root, kind);
        renderPreview(root);
    };

    const commitChipEdit = (textEl) => {
        if (!textEl || !textEl.isContentEditable) {
            return;
        }
        textEl.contentEditable = 'false';
        textEl.classList.remove('pi-chip-text--editing');
        const index = Number(textEl.dataset.piPoolIndex);
        if (!Number.isFinite(index)) {
            return;
        }
        const characterInfo = getSelectedCharacter();
        if (!characterInfo) {
            return;
        }
        const newText = String(textEl.textContent || '').trim();
        const lines = getPoolLines(characterInfo, kind);
        if (index < 0 || index >= lines.length) {
            return;
        }
        if (!newText) {
            lines.splice(index, 1);
        } else {
            lines[index] = newText;
        }
        setPoolLines(characterInfo, kind, lines);
        saveSettingsDebounced();
        refreshPoolEditor(root, kind);
        renderPreview(root);
    };

    if (input) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitInput();
            }
        });
    }

    if (addButton) {
        addButton.addEventListener('click', submitInput);
    }

    if (searchEl) {
        searchEl.addEventListener('input', () => renderPoolList(root, kind));
    }

    if (listEl) {
        listEl.addEventListener('click', (event) => {
            const removeBtn = event.target?.closest?.('.pi-chip-remove');
            if (removeBtn) {
                const characterInfo = getSelectedCharacter();
                if (!characterInfo) return;
                const index = Number(removeBtn.dataset.piPoolIndex);
                if (!Number.isFinite(index)) return;
                removePoolLineAt(characterInfo, kind, index);
                saveSettingsDebounced();
                refreshPoolEditor(root, kind);
                renderPreview(root);
                return;
            }
            const textEl = event.target?.closest?.('.pi-chip-text');
            if (textEl && !textEl.isContentEditable) {
                textEl.contentEditable = 'true';
                textEl.classList.add('pi-chip-text--editing');
                textEl.focus();
                const range = document.createRange();
                range.selectNodeContents(textEl);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });

        listEl.addEventListener('focusout', (event) => {
            const textEl = event.target?.closest?.('.pi-chip-text');
            if (textEl) {
                commitChipEdit(textEl);
            }
        });

        listEl.addEventListener('keydown', (event) => {
            const textEl = event.target?.closest?.('.pi-chip-text');
            if (!textEl || !textEl.isContentEditable) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                textEl.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                const characterInfo = getSelectedCharacter();
                if (characterInfo) {
                    const index = Number(textEl.dataset.piPoolIndex);
                    const lines = getPoolLines(characterInfo, kind);
                    if (Number.isFinite(index) && lines[index] !== undefined) {
                        textEl.textContent = lines[index];
                    }
                }
                textEl.contentEditable = 'false';
                textEl.classList.remove('pi-chip-text--editing');
                textEl.blur();
            }
        });
    }
}

function bindAppearanceControls(root) {
    const templateSelect = root.querySelector('#pi_css_template');
    const applyTemplateBtn = root.querySelector('#pi_css_template_apply');
    const saveTemplateBtn = root.querySelector('#pi_css_template_save');
    const deleteTemplateBtn = root.querySelector('#pi_css_template_delete');
    const customCssTextarea = root.querySelector('#pi_custom_css');
    const clearCssBtn = root.querySelector('#pi_css_clear');
    const aiBriefTextarea = root.querySelector('#pi_css_ai_brief');
    const aiGenerateBtn = root.querySelector('#pi_css_ai_generate');
    const aiStatus = root.querySelector('#pi_css_ai_status');

    rebuildCssTemplateOptions(templateSelect);

    function getTemplateBody(key) {
        if (!key) {
            return '';
        }
        if (isCustomTemplateKey(key)) {
            const settings = ensureSettings();
            return String(settings.customCssTemplates?.[getCustomTemplateName(key)] || '');
        }
        return String(builtinCssTemplates[key] || '');
    }

    function getTemplateDisplayName(key) {
        if (isCustomTemplateKey(key)) {
            return getCustomTemplateName(key);
        }
        return t(`console.appearance.template.${key}`);
    }

    if (applyTemplateBtn && customCssTextarea && templateSelect) {
        applyTemplateBtn.addEventListener('click', () => {
            const key = templateSelect.value;
            const body = getTemplateBody(key);
            if (!body) {
                return;
            }
            customCssTextarea.value = body;
            const settings = ensureSettings();
            settings.customCss = body;
            saveSettingsDebounced();
            applyCustomCss();
            notify('success', t('console.appearance.templateApplied', { name: getTemplateDisplayName(key) }));
        });
    }

    if (saveTemplateBtn && customCssTextarea && templateSelect) {
        saveTemplateBtn.addEventListener('click', () => {
            const body = String(customCssTextarea.value || '').trim();
            if (!body) {
                notify('warning', t('console.appearance.templateBodyEmpty'));
                return;
            }
            const name = (window.prompt(t('console.appearance.templateNamePrompt'), '') || '').trim();
            if (!name) {
                return;
            }
            const settings = ensureSettings();
            const templates = { ...(settings.customCssTemplates || {}) };
            templates[name] = body;
            settings.customCssTemplates = templates;
            rebuildCssTemplateOptions(templateSelect);
            templateSelect.value = makeCustomTemplateKey(name);
            saveSettingsDebounced();
            notify('success', t('console.appearance.templateSaved', { name }));
        });
    }

    if (deleteTemplateBtn && templateSelect) {
        deleteTemplateBtn.addEventListener('click', () => {
            const key = templateSelect.value;
            if (!isCustomTemplateKey(key)) {
                notify('warning', t('console.appearance.deleteBuiltinDenied'));
                return;
            }
            const name = getCustomTemplateName(key);
            const settings = ensureSettings();
            const templates = { ...(settings.customCssTemplates || {}) };
            delete templates[name];
            settings.customCssTemplates = templates;
            rebuildCssTemplateOptions(templateSelect);
            templateSelect.value = 'blackWhite';
            saveSettingsDebounced();
            notify('success', t('console.appearance.templateDeleted', { name }));
        });
    }

    if (clearCssBtn && customCssTextarea) {
        clearCssBtn.addEventListener('click', () => {
            const confirmed = window.confirm(t('console.appearance.clearCssConfirm'));
            if (!confirmed) {
                return;
            }
            customCssTextarea.value = '';
            const settings = ensureSettings();
            settings.customCss = '';
            saveSettingsDebounced();
            applyCustomCss();
            notify('success', t('console.appearance.clearCssDone'));
        });
    }

    if (aiGenerateBtn && aiBriefTextarea && customCssTextarea) {
        aiGenerateBtn.addEventListener('click', async () => {
            const brief = String(aiBriefTextarea.value || '').trim();
            if (!brief) {
                notify('warning', t('console.appearance.aiBriefEmpty'));
                return;
            }
            const settings = ensureSettings();
            aiGenerateBtn.disabled = true;
            const originalLabel = aiGenerateBtn.textContent;
            aiGenerateBtn.textContent = t('console.appearance.aiGenerating');
            if (aiStatus) {
                aiStatus.textContent = t('console.appearance.aiGenerating');
            }
            try {
                const prompt = buildAiCssPrompt(brief);
                const maxTokens = clampNumber(settings.aiMaxTokens, 1200, 16000, 3000);
                const reply = await routeGenerate({
                    prompt,
                    responseLength: maxTokens,
                    trimNames: false,
                });
                const css = extractCssFromAiReply(reply);
                if (!css) {
                    notify('warning', t('console.appearance.aiEmpty'));
                    return;
                }
                customCssTextarea.value = css;
                settings.customCss = css;
                saveSettingsDebounced();
                applyCustomCss();
                if (aiStatus) {
                    aiStatus.textContent = t('console.appearance.aiDone');
                }
                notify('success', t('console.appearance.aiDone'));
            } catch (error) {
                if (settings.debug) {
                    console.warn('[Private Invitation] AI CSS generation failed:', error);
                }
                notify('error', t('console.appearance.aiFailed'));
            } finally {
                aiGenerateBtn.disabled = false;
                aiGenerateBtn.textContent = originalLabel;
            }
        });
    }
}

function buildAiCssPrompt(userBrief) {
    return [
        '你是一个有审美的 CSS 设计师 / 视觉设计师，正在为 SillyTavern 扩展 "专属邀约 / Private Invitation" 的邀约卡片设计专属外观。',
        '目标：让这张卡片有"成品设计感"，而不是只是变个颜色。',
        '',
        '可以 hook 的关键节点（class）：',
        '- .pi-invitation-card 整张邀约卡片容器（aspect-ratio 3/4）',
        '- .pi-invitation-cover 居中显示的角色立绘 <img>',
        '- .pi-invitation-cover-backdrop 底层模糊的同图背景 <img>',
        '- .pi-invitation-cover-shade 半透明渐变遮罩层',
        '- .pi-invitation-frame 装饰相框层（绝对定位 inset:6px，可重写边框 / 装饰）',
        '- .pi-invitation-kicker "Private Invitation" 小胶囊标签',
        '- .pi-invitation-name 角色名（巨大白字）',
        '- .pi-invitation-message 文案外壳（含 --bubble / --banner / --barrage 三种 modifier）',
        '- .pi-invitation-message--bubble 对话气泡',
        '- .pi-invitation-message--banner 底部横幅条',
        '- .pi-invitation-message--barrage 弹幕容器',
        '- .pi-invitation-actions 底部按钮区',
        '- .pi-invitation-accept / .pi-invitation-dismiss / .pi-invitation-x 三种按钮',
        '',
        '用户的描述：',
        userBrief,
        '',
        '🎨 设计要求（重要 —— 必须达成至少 4 项，否则你只是在变色游戏）：',
        '1. 边框 / 描边 / 相框装饰：用 .pi-invitation-frame 的 border / box-shadow 重做边框，或在 .pi-invitation-card 上加多层 box-shadow 模拟描边 + 立体感。',
        '2. 角色名字 (.pi-invitation-name) 设计：换字体 family / 渐变文字 (background-clip:text + transparent) / 多层 text-shadow 光晕 / letter-spacing。',
        '3. 文案区 (.pi-invitation-message) 形态变化：圆角、不规则形状、贴纸、漫画对话云、霓虹边框、纸张质感等。',
        '4. 背景层 (.pi-invitation-cover-shade) 渐变：用 radial-gradient / linear-gradient 多层叠加做光晕、霓虹、暗角、噪点。',
        '5. 伪元素装饰 (::before / ::after)：在 card、kicker、frame、message 上加额外的装饰点缀 —— 角标、贴纸、星星、徽章、纹路、闪光、撕边。',
        '6. 按钮 (.pi-invitation-accept / .pi-invitation-dismiss) 重做：圆角 / 边框 / hover 效果 / 文字描边。',
        '7. 动效：用 @keyframes pi-custom-xxx 给文字、相框、装饰加缓慢的呼吸 / 闪烁 / 渐变循环（注意：禁止给 .pi-invitation-cover 加新 animation 会覆盖默认的呼吸）。',
        '',
        '建议方向（可挑组合）：',
        '霓虹赛博 / 漫画分镜 / 复古胶片 / 宫廷金箔 / 暗黑哥特 / 少女漫粉 / 报纸剪贴 / 玻璃质感 / 油画质感 / 水彩 / 蒸汽波 / 8-bit 像素 / 极简日式 / 中式古风 / 末日废土 / 透明全息。',
        '',
        '反面例子（请绝对避免）：',
        '- 只写 filter / color 这两个属性 ❌',
        '- 不加任何伪元素装饰 ❌',
        '- 输出少于 25 行 ❌',
        '- 用 !important 但只改了 1-2 个颜色 ❌',
        '',
        '输出规则：',
        '- 只输出可直接写入 <style> 的纯 CSS，不要 markdown 代码块，不要解释，不要前言。',
        '- 多写覆盖规则，每条规则简明针对一个节点。覆盖时该用 !important 就用。',
        '- 自己写的 @keyframes 名字加 pi-custom- 前缀，避免和插件默认动画撞名。',
        '- 假设是暗背景的角色立绘，保证文字可读（深底浅字或加描边）。',
        '- 长度建议 30-80 行 CSS 之间。',
        '',
        '严格尺寸约束（违反会让移动端按钮溢出屏幕，扣分项）：',
        '- 禁止修改 .pi-invitation-card 的 min-height / max-height / height / aspect-ratio / margin / transform。',
        '- 禁止修改 .pi-invitation-dialog 的 width / margin / padding / transform。',
        '- 禁止修改 .pi-invitation-content 的 height / padding 总和（背景可改，盒模型别动）。',
        '- 禁止给 .pi-invitation-card / .pi-invitation-content 加 padding-bottom > 80px；底部要留给 .pi-invitation-actions。',
        '- .pi-invitation-actions 必须保持原位、可见、可点击；不要 transform / opacity:0 / display:none。',
        '- 横幅模式（.pi-invitation-message--banner）和角色名 .pi-invitation-name 不要同时挤在底部，banner 模式下 name 已自动上移到顶部，给 banner 留出底部空间，请勿给 banner 加 margin-top 等会上推的样式。',
        '- 装饰元素（边框、纸条、贴纸等）请使用伪元素 (::before / ::after) 或 .pi-invitation-frame 层，不要外扩主卡片。',
        '- 禁止给 .pi-invitation-cover 直接加 animation（会覆盖默认呼吸 / 漂浮 / 视差 / 静止 keyframes）。要做封面效果请改 filter / box-shadow / 滤镜，不动 animation 属性。',
        '- 禁止修改 .pi-invitation-message--bubble 的 position / top / right / bottom / left / transform / margin-left / margin-top 这 7 个位置属性 — 气泡位置由用户在控制台的 9 宫格 + 微调滑块控制，CSS 改了也不会生效（已加 !important）。你可以自由改气泡的 background / border / box-shadow / color / font / border-radius / padding / filter / backdrop-filter / 伪元素装饰等所有视觉属性，但不能挪位置。',
        '',
        '⚠️ 防污染约束（违反会让用户看到莫名其妙的方块 / 遮挡角色脸 / 顶部红三角等）：',
        '- 弹幕模式 .pi-invitation-message--barrage 容器**绝对不能加 background / box-shadow / border / 大型 ::before ::after**。弹幕是飘动的文字串，message 容器要保持完全透明，只能装饰单条 span。',
        '- 各 mode 装饰要分别处理：写 .pi-invitation-message--bubble 的装饰时用这个完整选择器，**不要写到通用 .pi-invitation-message 上**（会三种模式都加，弹幕模式直接灾难）。',
        '- 禁止在卡片正中央（top 30%-70% 区域）加大型伪元素装饰 — 那是角色脸的位置。装饰只能在四个角（top 0-12% / bottom 88-100% / left 0-12% / right 88-100% 范围内）或贴边缘。',
        '- 禁止在 .pi-invitation-card::before 或 ::after 上画"角标 / 三角 / 红丝带 / 印章"等占据顶部居中位置的图案 — 那里有 X 关闭按钮和 kicker 标签，会被覆盖造成视觉污染。要做装饰请放在 .pi-invitation-frame::before / ::after 或角落。',
        '- 单个伪元素装饰最大尺寸建议不超过 card 宽度的 25%。',
        '- 角色名 .pi-invitation-name 的字效不要用 background-image 或大型 background，避免在 banner 模式下角色名移到顶部时出现奇怪背景块。',
    ].join('\n');
}

function extractCssFromAiReply(reply) {
    let text = String(reply || '').trim();
    if (!text) {
        return '';
    }
    const fenceMatch = text.match(/```(?:css)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
        text = fenceMatch[1].trim();
    }
    text = text.replace(/^(?:好的|当然|没问题|这是|here|sure|certainly)[，,：:\s]*\n?/i, '').trim();
    return text;
}

function bindConsoleEvents(root) {
    root.querySelectorAll('.pi-tab').forEach((button) => {
        button.addEventListener('click', () => setActiveTab(button.dataset.piTab, root));
    });

    bindTagChipPool(root, 'filter');
    bindTagChipPool(root, 'exclude');

    const closeButton = root.querySelector('#pi_close');
    if (closeButton) {
        closeButton.addEventListener('click', closeConsole);
    }

    const retentionChance = root.querySelector('#pi_retention_chance');
    const continueOnDismiss = root.querySelector('#pi_continue_on_dismiss');
    const continuePickLimit = root.querySelector('#pi_continue_pick_limit');
    const retentionChanceValue = root.querySelector('#pi_retention_chance_value');
    if (retentionChance) {
        retentionChance.addEventListener('input', () => syncNumberPair(retentionChance, retentionChanceValue, root));
    }
    if (retentionChanceValue) {
        retentionChanceValue.addEventListener('input', () => syncNumberPair(retentionChanceValue, retentionChance, root));
    }

    const numberPairs = [
        ['#pi_text_font_size', '#pi_text_font_size_value'],
        ['#pi_text_opacity', '#pi_text_opacity_value'],
        ['#pi_text_stroke_width', '#pi_text_stroke_width_value'],
        ['#pi_frame_width', '#pi_frame_width_value'],
        ['#pi_frame_height', '#pi_frame_height_value'],
        ['#pi_frame_opacity', '#pi_frame_opacity_value'],
        ['#pi_barrage_duration', '#pi_barrage_duration_value'],
        ['#pi_barrage_line_count', '#pi_barrage_line_count_value'],
        ['#pi_bubble_offset_x', '#pi_bubble_offset_x_value'],
        ['#pi_bubble_offset_y', '#pi_bubble_offset_y_value'],
    ];
    numberPairs.forEach(([sliderSelector, valueSelector]) => {
        const slider = root.querySelector(sliderSelector);
        const value = root.querySelector(valueSelector);
        if (slider) {
            slider.addEventListener('input', () => syncNumberPair(slider, value, root));
        }
        if (value) {
            value.addEventListener('input', () => syncNumberPair(value, slider, root));
        }
    });

    const characterList = root.querySelector('#pi_character_list');
    if (characterList) {
        characterList.addEventListener('change', (event) => {
            if (event.target?.matches?.('input[data-pi-character-key]')) {
                syncPoolSelectionFromDom(root);
                saveSettingsDebounced();
                updateStatusBadge(state.settingsPanel || root);
                renderPreview(root);
                renderMiniPreview(root);
                renderCharacterPool(root);
                renderCharacterSelect(root);
            }
        });
    }

    const copyCharacter = root.querySelector('#pi_copy_character');
    if (copyCharacter) {
        copyCharacter.addEventListener('change', () => {
            persistCharacterContextualSettings(root);
            ensureSettings().selectedCharacterKey = copyCharacter.value;
            persistDialogueEditor(root, { skipCharacterContext: true });
            renderDialogueEditor(root);
            renderRetentionEditor(root);
            renderAngerEditor(root);
            renderContextualModeEditors(root);
            renderContextualAiEditors(root);
            renderChatFileList(root);
            renderCurrentCharacterBanner(root);
        });
    }

    const copyCharacterSearch = root.querySelector('#pi_copy_character_search');
    if (copyCharacterSearch) {
        copyCharacterSearch.addEventListener('input', () => renderCharacterSelect(root));
    }

    const copyCharacterList = root.querySelector('#pi_copy_character_list');
    if (copyCharacterList) {
        copyCharacterList.addEventListener('change', (event) => {
            const key = event.target?.dataset?.piCopyCharacterKey;
            if (!key) {
                return;
            }
            const settings = ensureSettings();
            persistCharacterContextualSettings(root);
            settings.selectedCharacterKey = key;
            const select = root.querySelector('#pi_copy_character');
            if (select) {
                select.value = key;
            }
            persistDialogueEditor(root, { skipCharacterContext: true });
            saveSettingsDebounced();
            renderDialogueEditor(root);
            renderRetentionEditor(root);
            renderAngerEditor(root);
            renderContextualModeEditors(root);
            renderContextualAiEditors(root);
            renderChatFileList(root);
            renderPreview(root);
            renderCurrentCharacterBanner(root);
        });
    }

    const aiBannerSwitch = root.querySelector('#pi_current_character_switch');
    if (aiBannerSwitch) {
        aiBannerSwitch.addEventListener('click', () => {
            setActiveTab('copy', root);
            const search = root.querySelector('#pi_copy_character_search');
            search?.focus?.();
        });
    }

    const refreshChats = root.querySelector('#pi_refresh_chat_files');
    if (refreshChats) {
        refreshChats.addEventListener('click', () => {
            persistDialogueEditor(root);
            state.chatFileCache.delete(getSelectedCharacter()?.key || '');
            renderChatFileList(root);
        });
    }

    const chatFileSearch = root.querySelector('#pi_chat_file_search');
    if (chatFileSearch) {
        chatFileSearch.addEventListener('input', () => renderChatFileList(root));
    }

    const refreshWorlds = root.querySelector('#pi_refresh_world_info');
    if (refreshWorlds) {
        refreshWorlds.addEventListener('click', async () => {
            persistDialogueEditor(root);
            await updateWorldInfoList?.();
            renderWorldInfoList(root);
        });
    }

    const chatFileList = root.querySelector('#pi_chat_file_list');
    if (chatFileList) {
        chatFileList.addEventListener('change', () => {
            const characterInfo = getSelectedCharacter();
            const selected = new Set(getSelectedChatFiles(characterInfo));
            root.querySelectorAll('input[data-pi-chat-file]').forEach((input) => {
                if (!input.dataset.piChatFile) {
                    return;
                }
                if (input.checked) {
                    selected.add(input.dataset.piChatFile);
                } else {
                    selected.delete(input.dataset.piChatFile);
                }
            });
            setSelectedChatFiles(characterInfo, Array.from(selected));
            saveSettingsDebounced();
        });
    }

    const worldInfoList = root.querySelector('#pi_world_info_list');
    if (worldInfoList) {
        worldInfoList.addEventListener('change', (event) => {
            const characterInfo = getSelectedCharacter();
            const target = event.target;
            if (!target?.matches?.('input[type="checkbox"]')) return;

            if (target.dataset.piWorldEntryUid && target.dataset.piWorldEntryWorld) {
                if (!characterInfo) return;
                const worldName = target.dataset.piWorldEntryWorld;
                const detailsEl = target.closest('.pi-world-book');
                getWorldEntriesCached(worldName).then((entries) => {
                    const currentStored = getCharacterWorldEntries(characterInfo, worldName);
                    const selectedUids = currentStored === 'all'
                        ? new Set(entries.map((entry) => entry.uid))
                        : new Set(Array.isArray(currentStored) ? currentStored : []);
                    const uid = Number(target.dataset.piWorldEntryUid);
                    if (target.checked) {
                        selectedUids.add(uid);
                    } else {
                        selectedUids.delete(uid);
                    }
                    const next = selectedUids.size === entries.length ? 'all' : Array.from(selectedUids);
                    setCharacterWorldEntries(characterInfo, worldName, next);
                    saveSettingsDebounced();
                    updateWorldEntrySelectionMeta(detailsEl, worldName, characterInfo, entries);
                });
                return;
            }

            if (target.dataset.piWorldAll) {
                if (!characterInfo) return;
                const worldName = target.dataset.piWorldAll;
                const detailsEl = target.closest('.pi-world-book');
                detailsEl?.querySelectorAll('input[data-pi-world-entry-uid]').forEach((el) => { el.checked = target.checked; });
                setCharacterWorldEntries(characterInfo, worldName, target.checked ? 'all' : []);
                saveSettingsDebounced();
                getWorldEntriesCached(worldName).then((entries) => updateWorldEntrySelectionMeta(detailsEl, worldName, characterInfo, entries));
                return;
            }

            if (target.dataset.piWorldName) {
                const selected = new Set(characterInfo ? getCharacterWorldNames(characterInfo) : (ensureSettings().selectedWorldNames || []));
                root.querySelectorAll('.pi-world-book > .pi-world-book-summary > input[data-pi-world-name]').forEach((input) => {
                    if (!input.dataset.piWorldName) return;
                    if (input.checked) {
                        selected.add(input.dataset.piWorldName);
                    } else {
                        selected.delete(input.dataset.piWorldName);
                    }
                });
                const list = Array.from(selected);
                if (characterInfo?.key) {
                    setCharacterWorldNames(characterInfo, list);
                } else {
                    ensureSettings().selectedWorldNames = list;
                }
                saveSettingsDebounced();
            }
        });

        worldInfoList.addEventListener('toggle', (event) => {
            const detailsEl = event.target;
            if (!detailsEl?.matches?.('details.pi-world-book') || !detailsEl.open) return;
            const worldName = detailsEl.dataset.piWorldName;
            if (!worldName) return;
            const listEl = detailsEl.querySelector('.pi-world-entries-list');
            if (!listEl || listEl.children.length > 0) return;
            const characterInfo = getSelectedCharacter();
            renderWorldEntryList(detailsEl, worldName, characterInfo);
        }, true);

        worldInfoList.addEventListener('input', (event) => {
            const search = event.target?.closest?.('[data-pi-world-entry-search]');
            if (!search) return;
            const detailsEl = search.closest('.pi-world-book');
            const worldName = search.dataset.piWorldEntrySearch || detailsEl?.dataset?.piWorldName;
            if (!detailsEl || !worldName) return;
            detailsEl.dataset.piWorldEntrySearch = String(search.value || '');
            const characterInfo = getSelectedCharacter();
            renderWorldEntryList(detailsEl, worldName, characterInfo);
        });
    }

    const worldSearch = root.querySelector('#pi_world_search');
    if (worldSearch) {
        worldSearch.addEventListener('input', () => renderWorldInfoList(root));
    }

    const generateAiBatch = root.querySelector('#pi_ai_generate_batch');
    if (generateAiBatch) {
        generateAiBatch.addEventListener('click', async () => {
            persistDialogueEditor(root);
            await handleGenerateAiBatch(root);
        });
    }

    const appendGenerated = root.querySelector('#pi_ai_append_generated');
    if (appendGenerated) {
        appendGenerated.addEventListener('click', () => {
            persistDialogueEditor(root);
            appendGeneratedLinesToSaved(root);
        });
    }

    const replaceSaved = root.querySelector('#pi_ai_replace_saved');
    if (replaceSaved) {
        replaceSaved.parentNode?.removeChild?.(replaceSaved);
    }

    const generateRetentionBatch = root.querySelector('#pi_retention_ai_generate_batch');
    if (generateRetentionBatch) {
        generateRetentionBatch.addEventListener('click', async () => {
            persistDialogueEditor(root);
            await handleGenerateAiBatch(root, 'retention');
        });
    }

    const appendRetentionGenerated = root.querySelector('#pi_retention_ai_append_generated');
    if (appendRetentionGenerated) {
        appendRetentionGenerated.addEventListener('click', () => {
            persistDialogueEditor(root);
            appendGeneratedLinesToSaved(root, 'retention');
        });
    }

    const replaceRetentionSaved = root.querySelector('#pi_retention_ai_replace_saved');
    if (replaceRetentionSaved) {
        replaceRetentionSaved.parentNode?.removeChild?.(replaceRetentionSaved);
    }

    const openRetentionContext = root.querySelector('#pi_retention_open_context');
    if (openRetentionContext) {
        openRetentionContext.addEventListener('click', () => {
            persistDialogueEditor(root);
            setActiveTab('ai', root);
            setActiveScope('ai', 'dialogue', root);
        });
    }

    for (const kind of contextualAiModeKeys) {
        const generateButton = root.querySelector(aiButtonIdFor(kind));
        if (generateButton) {
            generateButton.addEventListener('click', async () => {
                persistDialogueEditor(root);
                persistAiModeEditor(root, kind);
                await handleGenerateAiBatch(root, kind);
            });
        }

        const appendButton = root.querySelector(aiAppendButtonIdFor(kind));
        if (appendButton) {
            appendButton.addEventListener('click', () => {
                persistDialogueEditor(root);
                persistAiModeEditor(root, kind);
                appendGeneratedLinesToSaved(root, kind);
            });
        }

        const openContext = root.querySelector(`#pi_${kind}_open_context`);
        if (openContext) {
            openContext.addEventListener('click', () => {
                persistDialogueEditor(root);
                persistAiModeEditor(root, kind);
                setActiveTab('ai', root);
                setActiveScope('ai', 'dialogue', root);
            });
        }
    }

    bindPromptTemplateControls(root, 'dialogue');
    bindPromptTemplateControls(root, 'retention');
    bindPromptTemplateControls(root, 'anger');
    contextualAiModeKeys.forEach((kind) => bindPromptTemplateControls(root, kind));
    bindDraftListControls(root, 'dialogue');
    bindDraftListControls(root, 'retention');
    bindDraftListControls(root, 'anger');
    contextualAiModeKeys.forEach((kind) => bindDraftListControls(root, kind));
    contextualAiModeKeys.forEach((kind) => bindAiModeFieldControls(root, kind));
    bindPoolListControls(root, 'dialogue');
    bindPoolListControls(root, 'retention');
    bindPoolListControls(root, 'anger');
    bindPoolListControls(root, 'jealousy');
    bindPoolListControls(root, 'birthday');
    bindPoolListControls(root, 'reunion');
    bindContextualModeControls(root);
    bindAngerCardControls(root);
    bindAppearanceControls(root);
    bindCharacterStyleControls(root);
    bindApiCardControls(root);
    bindScopeTabs(root);

    const bubblePositionGrid = root.querySelector('#pi_bubble_position_grid');
    const bubblePositionSelect = root.querySelector('#pi_bubble_position');
    if (bubblePositionGrid && bubblePositionSelect) {
        const updateActive = (value) => {
            bubblePositionGrid.querySelectorAll('.pi-pos-cell').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.piPos === value);
            });
        };
        updateActive(bubblePositionSelect.value);
        bubblePositionGrid.addEventListener('click', (event) => {
            const btn = event.target?.closest?.('.pi-pos-cell');
            if (!btn) return;
            const pos = btn.dataset.piPos;
            if (!bubblePositionKeys.includes(pos)) return;
            bubblePositionSelect.value = pos;
            updateActive(pos);
            const settings = ensureSettings();
            settings.bubblePosition = pos;
            saveSettingsDebounced();
            applyCustomCss();
            renderPreview(root);
            renderMiniPreview(root);
        });
    }

    const miniPreviewMode = root.querySelector('#pi_mini_preview_mode');
    if (miniPreviewMode) {
        miniPreviewMode.addEventListener('change', () => renderMiniPreview(root));
    }

    const poolSearch = root.querySelector('#pi_pool_search');
    if (poolSearch) {
        poolSearch.addEventListener('input', () => renderCharacterPool(root));
    }

    const selectVisible = root.querySelector('#pi_pool_select_visible');
    if (selectVisible) {
        selectVisible.addEventListener('click', () => {
            root.querySelectorAll('input[data-pi-character-key]').forEach((checkbox) => {
                checkbox.checked = true;
            });
            syncSettingsFromDom(root);
        });
    }

    const clearPool = root.querySelector('#pi_pool_clear');
    if (clearPool) {
        clearPool.addEventListener('click', () => {
            root.querySelectorAll('input[data-pi-character-key]').forEach((checkbox) => {
                checkbox.checked = false;
            });
            ensureSettings().poolCharacterKeys = [];
            saveSettingsDebounced();
            refreshUi();
        });
    }

    const testInvite = root.querySelector('#pi_test_invite');
    if (testInvite) {
        testInvite.addEventListener('click', () => {
            syncSettingsFromDom(root);
            state.invitationFromConsoleTest = true;
            state.shownThisRound.clear();
            state.continueCount = 0;
            closeConsole();
            maybeShowHomepageInvitation(true).catch((error) => {
                console.error('[Private Invitation] Failed to show test invitation', error);
                state.invitationFromConsoleTest = false;
                openConsole(state.activeTab || 'control');
            });
        });
    }

    const liveInputs = [
        '#pi_enabled',
        '#pi_show_menu_entry',
        '#pi_auto_open_home',
        '#pi_control_enabled',
        '#pi_control_show_menu_entry',
        '#pi_control_auto_open_home',
        '#pi_panel_theme',
        '#pi_pool_text',
        '#pi_homepage_trigger_mode',
        '#pi_homepage_cooldown_minutes',
        '#pi_ai_prompt',
        '#pi_ai_prompt_body',
        '#pi_ai_batch_count',
        '#pi_ai_max_tokens',
        '#pi_retention_prompt_body',
        '#pi_retention_ai_prompt',
        '#pi_retention_batch_count',
        '#pi_ai_use_chat_context',
        '#pi_ai_use_world_info',
        '#pi_chat_floor_start',
        '#pi_chat_floor_end',
        '#pi_chat_chunk_size',
        '#pi_chat_filter_tags',
        '#pi_chat_exclude_tags',
        '#pi_world_entry_limit',
        '#pi_presentation_mode',
        '#pi_cover_effect',
        '#pi_cover_fit',
        '#pi_bubble_position',
        '#pi_bubble_shape',
        '#pi_auto_adapt_color',
        '#pi_custom_css',
        '#pi_text_color',
        '#pi_text_opacity',
        '#pi_text_opacity_value',
        '#pi_text_stroke_width',
        '#pi_text_stroke_width_value',
        '#pi_text_stroke_color',
        '#pi_frame_color',
        '#pi_frame_opacity',
        '#pi_frame_opacity_value',
        '#pi_barrage_duration',
        '#pi_barrage_duration_value',
        '#pi_barrage_line_count',
        '#pi_barrage_line_count_value',
        '#pi_bubble_offset_x',
        '#pi_bubble_offset_x_value',
        '#pi_bubble_offset_y',
        '#pi_bubble_offset_y_value',
        '#pi_continue_on_dismiss',
        '#pi_continue_pick_limit',
        '#pi_jealousy_enabled',
        '#pi_jealousy_chance',
        '#pi_jealousy_window_minutes',
        '#pi_birthday_enabled',
        '#pi_user_birthday',
        '#pi_custom_date_events',
        '#pi_builtin_date_events_enabled',
        '#pi_reunion_enabled',
        '#pi_reunion_threshold_days',
        '#pi_reunion_extreme_threshold_days',
        '#pi_reunion_no_chat_policy',
        '#pi_reunion_visual_intensity',
    ];
    liveInputs.forEach((selector) => {
        const input = root.querySelector(selector);
        if (!input) {
            return;
        }
        input.addEventListener('input', () => persistDialogueEditor(root));
        input.addEventListener('change', () => persistDialogueEditor(root));
    });
}

function bindSettingsEvents(root) {
    const openButton = root.querySelector('#pi_open_console');
    if (openButton) {
        openButton.addEventListener('click', () => openConsole(state.activeTab));
    }

    const refreshButton = root.querySelector('#pi_refresh_view');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            syncDomFromSettings(root);
            updateStatusBadge(root);
            updateMenuVisibility();
            renderPreview();
        });
    }

    const inputs = ['#pi_enabled', '#pi_show_menu_entry', '#pi_auto_open_home'];
    inputs.forEach((selector) => {
        const input = root.querySelector(selector);
        if (!input) {
            return;
        }
        input.addEventListener('change', () => {
            syncSettingsFromDom(root);
            updateMenuVisibility();
            updateStatusBadge(root);
        });
    });
}

async function mountTemplates() {
    const menuHost = document.querySelector('#extensionsMenu');
    const settingsHost = document.querySelector('#extensions_settings2');
    const existingMenuItem = document.querySelector('#private_invitation_menu_item');
    const existingSettings = document.querySelector('#private_invitation_settings');
    const existingOverlay = document.querySelector('#pi_overlay');

    if (!existingMenuItem && menuHost) {
        const menuHtml = await loadTemplate('menu-item');
        menuHost.append($(menuHtml).get(0));
    }
    if (!existingSettings && settingsHost) {
        const settingsHtml = await loadTemplate('settings');
        settingsHost.append($(settingsHtml).get(0));
    }
    if (!existingOverlay) {
        const consoleHtml = await loadTemplate('console');
        document.body.append($(consoleHtml).get(0));
    }

    state.menuItem = document.querySelector('#private_invitation_menu_item');
    state.settingsPanel = document.querySelector('#private_invitation_settings');
    state.overlay = document.querySelector('#pi_overlay');

    if (!state.menuItem || !state.settingsPanel || !state.overlay) {
        return;
    }

    applyI18n(state.menuItem);
    applyI18n(state.settingsPanel);
    applyI18n(state.overlay);

    bindSettingsEvents(state.settingsPanel);
    bindConsoleEvents(state.overlay);
    syncDomFromSettings(state.settingsPanel);
    syncDomFromSettings(state.overlay);
    refreshUi();
    renderPreview(state.overlay);

    if (state.menuItem) {
        state.menuItem.onclick = () => openConsole(state.activeTab);
    }

    handleHomepageStateChanged();
}

async function init() {
    if (state.initialized) {
        return;
    }

    state.initialized = true;
    ensureSettings();
    const tryMount = async () => {
        await mountTemplates();
        if (!state.menuItem || !state.settingsPanel || !state.overlay) {
            setTimeout(tryMount, 500);
        }
    };
    await tryMount();
    registerEventHandlers();
}

function registerEventHandlers() {
    eventSource?.on?.(event_types.APP_READY, () => {
        state.appReady = true;
        state.appReadyAt = Date.now();
        refreshUi();
        handleNavigationStateChanged();
    });
    eventSource?.on?.(event_types.CHAT_CHANGED, handleNavigationStateChanged);
    eventSource?.on?.(event_types.CHARACTER_PAGE_LOADED, () => {
        renderCharacterPool(state.overlay || document);
        handleNavigationStateChanged();
    });
    eventSource?.on?.(event_types.CHARACTER_DELETED, () => {
        renderCharacterPool(state.overlay || document);
        handleNavigationStateChanged();
    });
    eventSource?.on?.(event_types.CHARACTER_RENAMED, () => {
        renderCharacterPool(state.overlay || document);
        handleNavigationStateChanged();
    });
}

export async function initializeApp() {
    await initializeI18n();
    await init();
}
