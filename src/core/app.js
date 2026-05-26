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

const homepageTriggerModes = [
    'session',
    'cooldown',
    'everyHome',
    'manual',
];

const CUSTOM_TEMPLATE_PREFIX = 'custom:';
const maxContextChars = 16000;

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
        const regex = new RegExp(`<\\s*${escaped}\\s*>([\\s\\S]*?)<\\s*/\\s*${escaped}\\s*>`, 'gi');
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
        const regex = new RegExp(`<\\s*${escaped}\\s*>[\\s\\S]*?<\\s*/\\s*${escaped}\\s*>`, 'gi');
        result = result.replace(regex, '');
    }
    return result;
}

function rebuildPromptPresetOptions(selectEl, customTemplates, kind) {
    if (!selectEl) {
        return;
    }
    const customGroup = selectEl.querySelector(kind === 'retention' ? '#pi_retention_prompt_custom_group' : '#pi_ai_prompt_custom_group');
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
    poolCharacterKeys: [],
    selectedCharacterKey: '',
    characterMessages: {},
    characterDrafts: {},
    retentionMessages: {},
    retentionDrafts: {},
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
    chatFileCache: new Map(),
    invitationFromConsoleTest: false,
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

function getDraftLines(characterInfo, kind) {
    const text = kind === 'retention' ? getRetentionDraftText(characterInfo) : getDialogueDraftText(characterInfo);
    return parseGeneratedLines(text);
}

function setDraftLines(characterInfo, kind, lines) {
    const text = (lines || []).filter(Boolean).join('\n');
    if (kind === 'retention') {
        setRetentionDraftText(characterInfo, text);
    } else {
        setDialogueDraftText(characterInfo, text);
    }
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

function getPoolLines(characterInfo, kind) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return [];
    }
    const target = kind === 'retention' ? settings.retentionMessages : settings.characterMessages;
    return parsePoolList(target[characterInfo.key] || '');
}

function setPoolLines(characterInfo, kind, lines) {
    const settings = ensureSettings();
    if (!characterInfo?.key) {
        return;
    }
    const target = kind === 'retention' ? settings.retentionMessages : settings.characterMessages;
    target[characterInfo.key] = (lines || []).map((line) => String(line || '').trim()).filter(Boolean).join('\n');
}

function appendPoolLines(characterInfo, kind, newLines) {
    const lines = getPoolLines(characterInfo, kind);
    const incoming = (newLines || []).map((line) => String(line || '').trim()).filter(Boolean);
    if (!incoming.length) {
        return;
    }
    setPoolLines(characterInfo, kind, [...lines, ...incoming]);
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

async function renderWorldEntryList(detailsEl, worldName, characterInfo) {
    const list = detailsEl.querySelector('.pi-world-entries-list');
    if (!list) return;
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
        const header = `
            <div class="pi-world-entries-header">
                <label class="pi-switch">
                    <input type="checkbox" data-pi-world-all="${escapeHtml(worldName)}" ${isAll ? 'checked' : ''}>
                    <span>${t('console.context.worldEntriesAll')}</span>
                </label>
                <span class="pi-muted">${t('console.context.worldEntriesCount', { selected: isAll ? entries.length : selectedSet.size, total: entries.length })}</span>
            </div>
        `;
        const rows = entries.map((entry) => {
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
        list.innerHTML = header + `<div class="pi-world-entries-rows">${rows}</div>`;
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
    const useWorldInfo = root?.querySelector?.('#pi_ai_use_world_info');
    const chatFloorStart = root?.querySelector?.('#pi_chat_floor_start');
    const chatFloorEnd = root?.querySelector?.('#pi_chat_floor_end');
    const chatChunkSize = root?.querySelector?.('#pi_chat_chunk_size');
    const chatFilterTags = root?.querySelector?.('#pi_chat_filter_tags');
    const chatExcludeTags = root?.querySelector?.('#pi_chat_exclude_tags');
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
    if (chatFilterTags) {
        chatFilterTags.value = settings.chatFilterTags || '';
    }
    if (chatExcludeTags) {
        chatExcludeTags.value = settings.chatExcludeTags || '';
    }
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
    ].join(';');
}

function buildPreviewMessageHtml(mode) {
    const lines = [
        t('console.preview.sampleText'),
        t('console.preview.sampleTextAlt1'),
        t('console.preview.sampleTextAlt2'),
        t('console.preview.sampleTextAlt3'),
        t('console.preview.sampleTextAlt4'),
    ];
    const picked = mode === 'barrage' ? lines.slice(0, 3) : lines.slice(0, 1);
    return picked.map((message, index) => {
        const barrageTop = `${((index + 0.5) / picked.length) * 100}%`;
        return `<span style="--pi-barrage-index:${index}; --pi-barrage-top:${barrageTop};">${escapeHtml(message)}</span>`;
    }).join('');
}

function buildInvitationMessageHtml(characterInfo, retention = false) {
    const settings = ensureSettings();
    const lineCount = settings.presentationMode === 'barrage' ? 3 : 1;
    const savedMessages = retention ? getRetentionMessages(characterInfo) : getManualMessages(characterInfo);
    const source = savedMessages.length ? savedMessages : [retention ? getFallbackRetentionMessage(characterInfo) : getFallbackMessage(characterInfo)];
    const picked = getSampledLines(source, lineCount);

    if (!picked.length) {
        picked.push(retention ? getFallbackRetentionMessage(characterInfo) : getFallbackMessage(characterInfo));
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

function createInvitationDialog(characterInfo, retention = false) {
    const settings = resolveCharacterStyle(characterInfo);
    const dialog = document.createElement('dialog');
    dialog.className = `pi-invitation-dialog pi-invitation-dialog--${settings.presentationMode}`;
    dialog.style.cssText = buildInvitationStyleVars(settings);
    dialog.innerHTML = `
        <div class="pi-invitation-card" data-pi-cover-effect="${escapeHtml(settings.coverEffect || 'breath')}" data-pi-cover-fit="${escapeHtml(settings.coverFit || 'contain')}" data-pi-bubble-position="${escapeHtml(settings.bubblePosition || 'top-right')}" data-pi-bubble-shape="${escapeHtml(settings.bubbleShape || 'pill')}">
            <img class="pi-invitation-cover-backdrop" src="${escapeHtml(getCharacterAvatarUrl(characterInfo))}" alt="" aria-hidden="true">
            <img class="pi-invitation-cover" src="${escapeHtml(getCharacterAvatarUrl(characterInfo))}" alt="">
            <div class="pi-invitation-cover-shade"></div>
            <div class="pi-invitation-frame" aria-hidden="true"></div>
            <button type="button" class="pi-invitation-x" data-pi-action="dismiss" aria-label="${escapeHtml(t('invitation.dismiss'))}">×</button>
            <div class="pi-invitation-content">
                <div class="pi-invitation-kicker">${escapeHtml(retention ? t('invitation.retentionKicker') : t('invitation.kicker'))}</div>
                <div class="pi-invitation-name">${escapeHtml(characterInfo.name)}</div>
                <div class="pi-invitation-message pi-invitation-message--${settings.presentationMode}">
                    ${buildInvitationMessageHtml(characterInfo, retention)}
                </div>
                <div class="pi-invitation-actions">
                    <button type="button" class="menu_button pi-invitation-accept" data-pi-action="accept">${escapeHtml(retention ? t('invitation.acceptRetention') : t('invitation.accept'))}</button>
                    <button type="button" class="menu_button pi-invitation-dismiss" data-pi-action="dismiss">${escapeHtml(retention ? t('invitation.dismissFinal') : t('invitation.dismiss'))}</button>
                </div>
            </div>
        </div>
    `;

    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
            handleInvitationDismiss(characterInfo, retention);
            return;
        }

        const action = event.target?.closest?.('[data-pi-action]')?.dataset?.piAction;
        if (action === 'accept') {
            acceptInvitation(characterInfo);
        } else if (action === 'dismiss') {
            handleInvitationDismiss(characterInfo, retention);
        }
    });

    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        handleInvitationDismiss(characterInfo, retention);
    });

    dialog.addEventListener('close', () => {
        if (state.activeInvitation === dialog) {
            state.activeInvitation = null;
        }
        setTimeout(() => dialog.remove(), 0);
    });

    return dialog;
}

async function showInvitation(characterInfo = pickRandom(resolvePoolCharacters()), retention = false) {
    const settings = ensureSettings();
    if (!settings.enabled || !characterInfo) {
        return false;
    }

    closeActiveInvitation();
    const dialog = createInvitationDialog(characterInfo, retention);
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

    return true;
}

async function acceptInvitation(characterInfo) {
    state.invitationFromConsoleTest = false;
    state.shownThisRound.clear();
    state.continueCount = 0;
    closeActiveInvitation();
    await selectCharacterById(Number(characterInfo.id), { switchMenu: true });
    setTimeout(() => printCharactersDebounced?.(), 250);
}

function handleInvitationDismiss(characterInfo, retention = false) {
    const settings = ensureSettings();
    if (!retention && Math.random() * 100 < settings.retentionChance) {
        showInvitation(characterInfo, true);
        return;
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

function maybeShowHomepageInvitation(force = false) {
    const settings = ensureSettings();
    if (!settings.enabled || (!settings.autoOpenOnHome && !force)) {
        return;
    }

    if (force) {
        state.homepageInviteShown = false;
    }

    if (!force && (state.homepageInviteShown || !isHomepage() || isConsoleOpen() || state.activeInvitation || !shouldShowHomepageInvitation())) {
        return;
    }

    const pool = resolvePoolCharacters();
    if (!pool.length) {
        if (force) {
            notify('warning', t('invitation.noPool'));
        }
        return;
    }

    markHomepageInvitationShown(force);
    showInvitation(pickRandom(pool));
}

function handleHomepageStateChanged() {
    clearTimeout(state.homepageCheckTimer);
    state.homepageCheckTimer = setTimeout(() => {
        const homepage = isHomepage();
        if (!homepage) {
            state.homepageInviteShown = false;
            state.wasHomepage = false;
            closeActiveInvitation();
            return;
        }

        if (!state.wasHomepage) {
            state.homepageInviteShown = false;
        }
        state.wasHomepage = true;
        maybeShowHomepageInvitation();
    }, 250);
}

function pickRandom(list) {
    if (!Array.isArray(list) || list.length === 0) {
        return null;
    }
    return list[Math.floor(Math.random() * list.length)];
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function applyTemplate(text, characterInfo) {
    return String(text || '')
        .replaceAll('{char}', characterInfo?.name || '')
        .replaceAll('{{char}}', characterInfo?.name || '');
}

function getSavedMessagesForCharacter(characterInfo) {
    const settings = ensureSettings();
    return parsePoolList(settings.characterMessages?.[characterInfo?.key] || '');
}

function getSavedRetentionMessagesForCharacter(characterInfo) {
    const settings = ensureSettings();
    return parsePoolList(settings.retentionMessages?.[characterInfo?.key] || '');
}

function getManualMessages(characterInfo) {
    return getSavedMessagesForCharacter(characterInfo)
        .map((line) => applyTemplate(line, characterInfo))
        .filter(Boolean);
}

function getRetentionMessages(characterInfo) {
    return getSavedRetentionMessagesForCharacter(characterInfo)
        .map((line) => applyTemplate(line, characterInfo))
        .filter(Boolean);
}

function getFallbackMessage(characterInfo) {
    return t('invitation.defaultLine', { char: characterInfo?.name || t('invitation.unknownCharacter') });
}

function getFallbackRetentionMessage(characterInfo) {
    return t('invitation.defaultRetentionLine', { char: characterInfo?.name || t('invitation.unknownCharacter') });
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

function formatChatMessage(message, index, filterTags = [], excludeTags = []) {
    if (!message || typeof message !== 'object') {
        return '';
    }

    const name = String(message.name || (message.is_user ? getContext?.()?.name1 : getContext?.()?.name2) || '').trim();
    const raw = String(message.mes || '');
    const stripped = excludeTags.length ? stripTaggedContent(raw, excludeTags) : raw;
    const filtered = filterTags.length ? extractTaggedContent(stripped, filterTags) : stripped;
    const text = String(filtered || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return '';
    }

    return `#${index} ${name ? `${name}: ` : ''}${text}`;
}

function sliceChatMessages(messages, settings) {
    if (!Array.isArray(messages) || !messages.length) {
        return [];
    }

    const start = clampNumber(settings.chatFloorStart, 0, messages.length - 1, 0);
    const requestedEnd = clampNumber(settings.chatFloorEnd, start, messages.length - 1, Math.min(messages.length - 1, start + settings.chatChunkSize - 1));
    const chunkEnd = Math.min(requestedEnd, start + settings.chatChunkSize - 1);
    const filterTags = parseFilterTagList(settings.chatFilterTags);
    const excludeTags = parseFilterTagList(settings.chatExcludeTags);
    return messages
        .slice(start, chunkEnd + 1)
        .map((message, offset) => formatChatMessage(message, start + offset, filterTags, excludeTags))
        .filter(Boolean);
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

async function buildChatContext(characterInfo) {
    const settings = ensureSettings();
    if (!settings.aiUseChatContext) {
        return '';
    }

    const selectedFiles = getSelectedChatFiles(characterInfo);
    const sections = [];
    const currentChat = getContext?.()?.chat;

    if (!selectedFiles.length && Array.isArray(currentChat) && currentChat.length) {
        const lines = sliceChatMessages(currentChat, settings);
        if (lines.length) {
            sections.push(`current chat\n${lines.join('\n')}`);
        }
    }

    for (const fileName of selectedFiles) {
        const messages = await fetchChatFileMessages(characterInfo, fileName);
        const lines = sliceChatMessages(messages, settings);
        if (lines.length) {
            sections.push(`${fileName}\n${lines.join('\n')}`);
        }
    }

    return limitText(sections.join('\n\n'), maxContextChars);
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
    const keyPrefix = kind === 'retention' ? 'invitation.retentionPromptPreset' : 'invitation.promptPreset';
    return t(`${keyPrefix}.${preset}`, {
        char: charName || t('invitation.unknownCharacter'),
        count,
    });
}

function getDefaultPromptBody(preset, kind, count) {
    if (isCustomTemplateKey(preset)) {
        const settings = ensureSettings();
        const templates = kind === 'retention' ? settings.retentionCustomTemplates : settings.aiCustomTemplates;
        const name = getCustomTemplateName(preset);
        return String(templates?.[name] || '');
    }
    return getPresetBuiltinText(preset, kind, count, '{char}');
}

function getPromptPresetText(characterInfo, kind = 'dialogue') {
    const settings = ensureSettings();
    const preset = kind === 'retention' ? settings.retentionPromptPreset : settings.aiPromptPreset;
    const editedBody = kind === 'retention' ? settings.retentionPromptBody : settings.aiPromptBody;
    const count = kind === 'retention' ? settings.retentionBatchCount : settings.aiBatchCount;
    const charName = characterInfo?.name || t('invitation.unknownCharacter');

    const rawBody = (editedBody && editedBody.trim())
        ? editedBody
        : getDefaultPromptBody(preset, kind, count);

    return String(rawBody || '')
        .replace(/\{char\}/g, charName)
        .replace(/\{count\}/g, String(count));
}

async function generateAiMessages(characterInfo, kind = 'dialogue') {
    const settings = ensureSettings();
    const batchCount = kind === 'retention' ? settings.retentionBatchCount : settings.aiBatchCount;
    const persona = buildCharacterPersonaContext(characterInfo);
    const chatContext = await buildChatContext(characterInfo);
    const worldContext = await buildWorldInfoContext(characterInfo);
    const selectedPrompt = getPromptPresetText(characterInfo, kind);
    const customPrompt = applyTemplate(String(kind === 'retention' ? settings.retentionAiPrompt : settings.aiPrompt || '').trim(), characterInfo);
    const instructionKey = kind === 'retention' ? 'invitation.retentionAiBatchInstruction' : 'invitation.aiBatchInstruction';
    const rulesKey = kind === 'retention' ? 'invitation.retentionAiOutputRules' : 'invitation.aiOutputRules';
    const prompt = [
        t(instructionKey, { char: characterInfo.name, count: batchCount }),
        selectedPrompt,
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

async function handleGenerateAiBatch(root = state.overlay || document, kind = 'dialogue') {
    const characterInfo = getSelectedCharacter();
    if (!characterInfo) {
        notify('warning', t('console.dialogue.noCharacters'));
        return;
    }

    const button = root.querySelector(kind === 'retention' ? '#pi_retention_ai_generate_batch' : '#pi_ai_generate_batch');
    const generatingLabel = kind === 'retention' ? t('console.retention.generating') : t('console.dialogue.generating');
    const defaultLabel = kind === 'retention' ? t('console.retention.generateBatch') : t('console.dialogue.generateBatch');
    if (button) {
        button.disabled = true;
        button.textContent = generatingLabel;
    }

    try {
        const lines = await generateAiMessages(characterInfo, kind);
        if (!lines.length) {
            notify('warning', kind === 'retention' ? t('console.retention.generateEmpty') : t('console.dialogue.generateEmpty'));
            return;
        }

        appendDraftLines(characterInfo, kind, lines);
        renderDraftList(root, kind);
        saveSettingsDebounced();
    } catch (error) {
        if (ensureSettings().debug) {
            console.warn('[Private Invitation] AI batch generation failed:', error);
        }
        notify('error', kind === 'retention' ? t('console.retention.generateFailed') : t('console.dialogue.generateFailed'));
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = defaultLabel;
        }
    }
}

function renderDraftList(root = state.overlay || document, kind = 'dialogue') {
    const isRetention = kind === 'retention';
    const listEl = root.querySelector(isRetention ? '#pi_retention_ai_draft_list' : '#pi_ai_draft_list');
    const countEl = root.querySelector(isRetention ? '#pi_retention_ai_draft_count' : '#pi_ai_draft_count');
    if (!listEl) {
        return;
    }
    const characterInfo = getSelectedCharacter();
    const lines = characterInfo ? getDraftLines(characterInfo, kind) : [];

    listEl.innerHTML = '';
    if (!lines.length) {
        const empty = document.createElement('div');
        empty.className = 'pi-draft-empty';
        empty.textContent = t('console.dialogue.draftEmpty');
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
            addBtn.title = t('console.dialogue.draftAddSingle');
            addBtn.setAttribute('aria-label', t('console.dialogue.draftAddSingle'));
            addBtn.textContent = '+';

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'pi-icon-btn pi-icon-btn--remove';
            removeBtn.dataset.piDraftAction = 'remove';
            removeBtn.dataset.piDraftIndex = String(index);
            removeBtn.title = t('console.dialogue.draftRemoveSingle');
            removeBtn.setAttribute('aria-label', t('console.dialogue.draftRemoveSingle'));
            removeBtn.textContent = '×';

            actions.appendChild(addBtn);
            actions.appendChild(removeBtn);
            card.appendChild(textEl);
            card.appendChild(actions);
            listEl.appendChild(card);
        });
    }

    if (countEl) {
        countEl.textContent = t('console.dialogue.draftCount', { total: lines.length });
    }
}

function renderPoolList(root = state.overlay || document, kind = 'dialogue') {
    const isRetention = kind === 'retention';
    const listEl = root.querySelector(isRetention ? '#pi_retention_pool_list' : '#pi_dialogue_pool_list');
    if (!listEl) {
        return;
    }
    const characterInfo = getSelectedCharacter();
    const lines = characterInfo ? getPoolLines(characterInfo, kind) : [];
    const searchEl = root.querySelector(isRetention ? '#pi_retention_pool_search' : '#pi_dialogue_pool_search');
    const search = String(searchEl?.value || '').trim().toLowerCase();

    listEl.innerHTML = '';
    if (!lines.length) {
        const empty = document.createElement('div');
        empty.className = 'pi-pool-empty';
        empty.textContent = t('console.dialogue.poolEmpty');
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
        notify('warning', t('console.dialogue.draftEmptyWarn'));
        return;
    }
    saveSettingsDebounced();
    if (kind === 'retention') {
        renderRetentionEditor(root);
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
    const enabled = root.querySelector('#pi_enabled');
    const showMenuEntry = root.querySelector('#pi_show_menu_entry');
    const autoOpenOnHome = root.querySelector('#pi_auto_open_home');
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
    const useWorldInfo = root.querySelector('#pi_ai_use_world_info');
    const chatFloorStart = root.querySelector('#pi_chat_floor_start');
    const chatFloorEnd = root.querySelector('#pi_chat_floor_end');
    const chatChunkSize = root.querySelector('#pi_chat_chunk_size');
    const chatFilterTags = root.querySelector('#pi_chat_filter_tags');
    const chatExcludeTags = root.querySelector('#pi_chat_exclude_tags');
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
    const retentionChance = root.querySelector('#pi_retention_chance');
    const continueOnDismiss = root.querySelector('#pi_continue_on_dismiss');
    const continuePickLimit = root.querySelector('#pi_continue_pick_limit');
    const retentionChanceValue = root.querySelector('#pi_retention_chance_value');
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
    if (copyCharacter) {
        settings.selectedCharacterKey = copyCharacter.value;
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
    if (chatFilterTags) {
        settings.chatFilterTags = String(chatFilterTags.value || '');
    }
    if (chatExcludeTags) {
        settings.chatExcludeTags = String(chatExcludeTags.value || '');
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
    if (retentionChanceValue) {
        retentionChanceValue.value = String(settings.retentionChance);
    }

    saveSettingsDebounced();
    refreshUi();
}

function persistDialogueEditor(root = document) {
    const settings = ensureSettings();
    const enabled = root.querySelector('#pi_enabled');
    const showMenuEntry = root.querySelector('#pi_show_menu_entry');
    const autoOpenOnHome = root.querySelector('#pi_auto_open_home');
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
    const useWorldInfo = root.querySelector('#pi_ai_use_world_info');
    const chatFloorStart = root.querySelector('#pi_chat_floor_start');
    const chatFloorEnd = root.querySelector('#pi_chat_floor_end');
    const chatChunkSize = root.querySelector('#pi_chat_chunk_size');
    const chatFilterTags = root.querySelector('#pi_chat_filter_tags');
    const chatExcludeTags = root.querySelector('#pi_chat_exclude_tags');
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

    if (enabled) {
        settings.enabled = enabled.checked;
    }
    if (showMenuEntry) {
        settings.showMenuEntry = showMenuEntry.checked;
    }
    if (autoOpenOnHome) {
        settings.autoOpenOnHome = autoOpenOnHome.checked;
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
    if (copyCharacter) {
        settings.selectedCharacterKey = copyCharacter.value;
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
    if (copyCharacter) {
        settings.selectedCharacterKey = copyCharacter.value;
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
    if (chatFilterTags) {
        settings.chatFilterTags = String(chatFilterTags.value || '');
    }
    if (chatExcludeTags) {
        settings.chatExcludeTags = String(chatExcludeTags.value || '');
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
    updateDialogueCount(root);
    updateRetentionCount(root);
    renderPreview(root);
    renderMiniPreview(root);
    renderTokenEstimate(root);
}

function syncDomFromSettings(root = document) {
    const settings = ensureSettings();
    const enabled = root.querySelector('#pi_enabled');
    const showMenuEntry = root.querySelector('#pi_show_menu_entry');
    const autoOpenOnHome = root.querySelector('#pi_auto_open_home');
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
    const useWorldInfo = root.querySelector('#pi_ai_use_world_info');
    const chatFloorStart = root.querySelector('#pi_chat_floor_start');
    const chatFloorEnd = root.querySelector('#pi_chat_floor_end');
    const chatChunkSize = root.querySelector('#pi_chat_chunk_size');
    const chatFilterTags = root.querySelector('#pi_chat_filter_tags');
    const chatExcludeTags = root.querySelector('#pi_chat_exclude_tags');
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
    const retentionChance = root.querySelector('#pi_retention_chance');
    const continueOnDismiss = root.querySelector('#pi_continue_on_dismiss');
    const continuePickLimit = root.querySelector('#pi_continue_pick_limit');
    const retentionChanceValue = root.querySelector('#pi_retention_chance_value');

    if (enabled) {
        enabled.checked = settings.enabled;
    }
    if (showMenuEntry) {
        showMenuEntry.checked = settings.showMenuEntry;
    }
    if (autoOpenOnHome) {
        autoOpenOnHome.checked = settings.autoOpenOnHome;
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
    if (chatFilterTags) {
        chatFilterTags.value = settings.chatFilterTags || '';
    }
    if (chatExcludeTags) {
        chatExcludeTags.value = settings.chatExcludeTags || '';
    }
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
    renderCharacterPool(state.overlay || document);
    renderDialogueEditor(state.overlay || document);
    renderRetentionEditor(state.overlay || document);
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
    setActiveTab(tab, overlay);
    renderCharacterPool(overlay);
    renderDialogueEditor(overlay);
    renderRetentionEditor(overlay);
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
    const isRetention = kind === 'retention';
    const prefix = isRetention ? '#pi_retention' : '#pi_ai';
    const presetSelect = root.querySelector(`${prefix}_prompt_preset`);
    const bodyTextarea = root.querySelector(`${prefix}_prompt_body`);
    const resetButton = root.querySelector(`${prefix}_reset_prompt`);
    const saveButton = root.querySelector(`${prefix}_save_template`);
    const deleteButton = root.querySelector(`${prefix}_delete_template`);

    const settingsPresetKey = isRetention ? 'retentionPromptPreset' : 'aiPromptPreset';
    const settingsBodyKey = isRetention ? 'retentionPromptBody' : 'aiPromptBody';
    const settingsTemplatesKey = isRetention ? 'retentionCustomTemplates' : 'aiCustomTemplates';
    const settingsCountKey = isRetention ? 'retentionBatchCount' : 'aiBatchCount';
    const i18nNamespace = isRetention ? 'console.retention' : 'console.dialogue';

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
    const isRetention = kind === 'retention';
    const prefix = isRetention ? '#pi_retention_ai' : '#pi_ai';
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

function bindPoolListControls(root, kind) {
    const isRetention = kind === 'retention';
    const prefix = isRetention ? '#pi_retention_pool' : '#pi_dialogue_pool';
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
        renderPoolList(root, kind);
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
        renderPoolList(root, kind);
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
                renderPoolList(root, kind);
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

    const closeButton = root.querySelector('#pi_close');
    if (closeButton) {
        closeButton.addEventListener('click', closeConsole);
    }

    root.addEventListener('click', (event) => {
        if (event.target === root) {
            closeConsole();
        }
    });

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
            persistDialogueEditor(root);
            renderDialogueEditor(root);
            renderRetentionEditor(root);
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
            settings.selectedCharacterKey = key;
            const select = root.querySelector('#pi_copy_character');
            if (select) {
                select.value = key;
            }
            persistDialogueEditor(root);
            saveSettingsDebounced();
            renderDialogueEditor(root);
            renderRetentionEditor(root);
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
                const allInput = detailsEl?.querySelector('input[data-pi-world-all]');
                const entryInputs = detailsEl?.querySelectorAll('input[data-pi-world-entry-uid]') || [];
                const checkedUids = Array.from(entryInputs).filter((el) => el.checked).map((el) => Number(el.dataset.piWorldEntryUid));
                const totalEntries = entryInputs.length;
                if (allInput) {
                    allInput.checked = checkedUids.length === totalEntries;
                }
                setCharacterWorldEntries(characterInfo, worldName, checkedUids.length === totalEntries ? 'all' : checkedUids);
                saveSettingsDebounced();
                const meta = detailsEl?.querySelector('.pi-world-book-meta');
                if (meta) {
                    meta.textContent = checkedUids.length === totalEntries
                        ? t('console.context.worldEntriesAllShort')
                        : t('console.context.worldEntriesCountShort', { count: checkedUids.length });
                }
                const headerCount = detailsEl?.querySelector('.pi-world-entries-header .pi-muted');
                if (headerCount) {
                    headerCount.textContent = t('console.context.worldEntriesCount', { selected: checkedUids.length, total: totalEntries });
                }
                return;
            }

            if (target.dataset.piWorldAll) {
                if (!characterInfo) return;
                const worldName = target.dataset.piWorldAll;
                const detailsEl = target.closest('.pi-world-book');
                const entryInputs = detailsEl?.querySelectorAll('input[data-pi-world-entry-uid]') || [];
                entryInputs.forEach((el) => { el.checked = target.checked; });
                if (target.checked) {
                    setCharacterWorldEntries(characterInfo, worldName, 'all');
                } else {
                    setCharacterWorldEntries(characterInfo, worldName, []);
                }
                saveSettingsDebounced();
                const meta = detailsEl?.querySelector('.pi-world-book-meta');
                if (meta) {
                    meta.textContent = target.checked
                        ? t('console.context.worldEntriesAllShort')
                        : t('console.context.worldEntriesCountShort', { count: 0 });
                }
                const headerCount = detailsEl?.querySelector('.pi-world-entries-header .pi-muted');
                if (headerCount) {
                    headerCount.textContent = t('console.context.worldEntriesCount', { selected: target.checked ? entryInputs.length : 0, total: entryInputs.length });
                }
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

    bindPromptTemplateControls(root, 'dialogue');
    bindPromptTemplateControls(root, 'retention');
    bindDraftListControls(root, 'dialogue');
    bindDraftListControls(root, 'retention');
    bindPoolListControls(root, 'dialogue');
    bindPoolListControls(root, 'retention');
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
            maybeShowHomepageInvitation(true);
        });
    }

    const liveInputs = [
        '#pi_enabled',
        '#pi_show_menu_entry',
        '#pi_auto_open_home',
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
        '#pi_bubble_offset_x',
        '#pi_bubble_offset_x_value',
        '#pi_bubble_offset_y',
        '#pi_bubble_offset_y_value',
        '#pi_continue_on_dismiss',
        '#pi_continue_pick_limit',
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
        refreshUi();
        handleHomepageStateChanged();
    });
    eventSource?.on?.(event_types.CHAT_CHANGED, handleHomepageStateChanged);
    eventSource?.on?.(event_types.CHARACTER_PAGE_LOADED, () => {
        renderCharacterPool(state.overlay || document);
        handleHomepageStateChanged();
    });
    eventSource?.on?.(event_types.CHARACTER_DELETED, () => {
        renderCharacterPool(state.overlay || document);
        handleHomepageStateChanged();
    });
    eventSource?.on?.(event_types.CHARACTER_RENAMED, () => {
        renderCharacterPool(state.overlay || document);
        handleHomepageStateChanged();
    });
}

export async function initializeApp() {
    await initializeI18n();
    await init();
}
