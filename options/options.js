'use strict';

import {
    bindElementIdsToSettings,
} from '../ui/bind-settings.js';

import {
    setTextMessages,
    setMessagePrefix,
    toggleClass,
} from '../ui/utilities.js';

import {
    setRequiresPrefix,
    bindDependantSettings,
} from '../ui/requires.js';

import {
    bindCollapsableAreas,
} from '../ui/collapsable.js';

import {
    createShortcutsArea,
} from '../ui/shortcuts.js';

import {
    settings,
    settingsTracker,
} from '../common/common.js';

import {
    getInternalTSTId,
} from '../tree-style-tab/internal-id.js';

import {
    delay,
} from '../common/delays.js';

import {
    pingTST,
} from '../tree-style-tab/utilities.js';


setMessagePrefix('message-');
setRequiresPrefix('requires-');


async function initiatePage() {
    setTextMessages();


    bindCollapsableAreas();
    const checkRequired = bindDependantSettings();

    const shortcuts = createShortcutsArea({
        commandInfos: {
            'open-tst-sidebar-in-tab': {
                description: 'contextMenu_openSidebarInTab',
            },
            'open-tst-sidebar-in-window': {
                description: 'contextMenu_openSidebarInWindow',
            },
            'open-tst-sidebar-in-docked-window': {
                description: 'contextMenu_openSidebarInDockedWindow',
            }
        },
        headerMessage: 'options_Commands_Title',
        infoMessage: 'options_Commands_Info',
        resetButtonMessage: 'options_Commands_ResetButton',
        promptButtonMessage: 'options_Commands_PromptButton',
    });
    document.getElementById('commandsArea').appendChild(shortcuts.area);

    const styleHeader = document.getElementById('styleHeader');
    styleHeader.parentElement.classList.add('enablable');
    const styleElement = document.getElementById('currentTreeStyleTabStyle');
    const updateStyle = async () => {
        let style = await browser.runtime.sendMessage({ type: 'get-tst-style' });
        styleElement.textContent = style;
        toggleClass(styleHeader.parentElement, 'enabled', style);
    };

    await settingsTracker.start;

    const boundSettings = bindElementIdsToSettings(settings, {
        handleInputEvent: ({ key, value, element }) => {
            if (element.type === 'number') {
                value = parseInt(value);
                if (isNaN(value))
                    return;
            }
            browser.storage.local.set({ [key]: value });
        },
        onSettingsChanged: settingsTracker.onChange,
        newValuePattern: true,
    });

    let handleLoad = () => {
        shortcuts.update(); // Keyboard Commands
        boundSettings.skipCurrentInputIgnore();
        checkRequired();
        updateStyle();
    };
    handleLoad();

    settingsTracker.onChange.addListener((changes) => {
        if (changes.fixSidebarStyle) {
            updateStyle();
        }
        // Might have been changed from context menu:
        if (changes.browserAction_OpenInNewWindow || changes.browserAction_OpenInNewWindow_Docked) {
            checkRequired();
        }
    });

    document.getElementById('resetSettingsButton').addEventListener('click', async (e) => {
        let ok = confirm(browser.i18n.getMessage('options_resetSettings_Prompt'));
        if (!ok) {
            return;
        }

        // Reset commands:
        await Promise.all((await browser.commands.getAll()).map(command => browser.commands.reset(command.name)));

        // Clear settings:
        await browser.storage.local.clear();

        // Wait for settings change to be applied:
        await delay(100);

        // Reload settings:
        handleLoad();
    });

    document.getElementById('TST_InternalId_ResetButton').addEventListener('click', (e) => {
        browser.storage.local.remove('treeStyleTabInternalId');
    });
    document.getElementById('TST_InternalId_UpdateButton').addEventListener('click', async (e) => {
        const fromGroupTab = await getInternalTSTId(
            {
                allowCached: false,
                searchOpenTabs: false,
                openGroupTab: true,
            });
        if (!fromGroupTab) {
            const fromOpenTabs = await getInternalTSTId({
                allowCached: false,
                searchOpenTabs: true,
                openGroupTab: false,
            });
            if (!fromOpenTabs) {
                // Show a notification about how to determine Tree Style Tab's internal id.
                await browser.runtime.sendMessage({ type: 'handle-failed-get-internal-id' });
            }
        }
    });
}
initiatePage();