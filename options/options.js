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
    messageTypes,
    quickLoadSetting,
} from '../common/common.js';

import {
    getInternalTSTId,
} from '../tree-style-tab/internal-id.js';

import {
    delay,
    PromiseWrapper,
} from '../common/delays.js';

import {
    createOptionalPermissionArea,
} from '../ui/permissions.js';

import {
    createStatusIndicator,
} from '../ui/status-indicator.js';

import {
    EventManager,
} from '../common/events.js';

import {
    PortConnection,
} from '../common/connections.js';


setMessagePrefix('message-');
setRequiresPrefix('requires-');


quickLoadSetting('optionsPage_disableDarkTheme')
    .then(disableDarkTheme => {
        if (disableDarkTheme) {
            document.documentElement.classList.remove('support-dark-theme');
        }
    })
    .catch(error => console.error('Failed to disable dark theme support on options page.', error));


{
    let embedded = true;
    try {
        embedded = new URLSearchParams(window.location.search).get('embedded') != 'false';
    } catch (error) {
        console.error('Failed to get page query params.\nError: ', error);
    }
    if (embedded) {
        document.documentElement.classList.add('embeddedInExtensionPage');
    }
}


async function initiatePage() {

    // Link to separate option page:
    (/** @type{HTMLAnchorElement} */(document.getElementById('topLinkToOptionsPage'))).href =
        browser.runtime.getURL(browser.runtime.getManifest().options_ui.page + '?embedded=false');


    const pagePort = new PortConnection();

    const onPermissionChange = new EventManager();
    const permissionControllers = [];

    const collapsableInfo = bindCollapsableAreas(
        {
            enabledCheck: [
                {
                    element: document.getElementById('permissionsArea'),
                    check: () => {
                        const hasAnyPermission = permissionControllers.filter(controller => controller.hasPermission).length > 0;
                        return hasAnyPermission;
                    },
                },
                {
                    element: document.getElementById('temporaryTabArea'),
                    check: () => settings.useTemporaryTabWhenOpeningNewWindow,
                },
                {
                    element: document.getElementById('simulateDockingArea'),
                    check: () => settings.newWindow_besideCurrentWindow && settings.newWindow_besideCurrentWindow_simulateDocking_slowInterval >= 0,
                },
                {
                    element: document.getElementById('tstInternalIdArea'),
                    check: () => !settings.useModernSidebarUrl,
                },
            ],
        }
    );
    onPermissionChange.addListener(() => collapsableInfo.checkAll());

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
        let style = await browser.runtime.sendMessage({ type: messageTypes.getTstStyle });
        styleElement.textContent = style;
        toggleClass(styleHeader.parentElement, 'enabled', style);
    };


    // #region Optional Permissions

    {
        const optionalPermissionsArea = document.getElementById('permissionsArea');
        const pagePermissionChanged = pagePort.getEvent('permissionChanged');

        const permissionChangedCallback = (obj, internalChange) => {
            if (internalChange) {
                browser.runtime.sendMessage({ type: messageTypes.permissionsChanged, permission: obj.permission, value: obj.hasPermission });
            }
            onPermissionChange.fire(obj);
        };

        const tabsPermissionArea = createOptionalPermissionArea({
            permission: { permissions: ['tabs'] },
            titleMessage: 'options_OptionalPermissions_Tabs_Title',
            explanationMessage: 'options_OptionalPermissions_Tabs_Explanation',

            requestViaBrowserActionCallback: async (permission) => {
                await pagePort.sendMessageBoundToPort({ type: messageTypes.requestPermission, permission: permission });
            },
            browserActionPromptMessage: 'optionalPermissions_BrowserActionPrompt',

            permissionChangedCallback,
            onPermissionChanged: pagePermissionChanged,
        });
        permissionControllers.push(tabsPermissionArea);
        optionalPermissionsArea.appendChild(tabsPermissionArea.area);


        let requestOp = new PromiseWrapper();
        const sessionPermissionArea = createOptionalPermissionArea({
            permission: { permissions: ['sessions'] },
            titleMessage: 'options_OptionalPermissions_Sessions_Title',
            explanationMessage: 'options_OptionalPermissions_Sessions_Explanation',

            requestViaBrowserActionCallback: (permission) => {
                if (permission) {
                    return requestOp.getValue();
                } else {
                    requestOp.resolve(null);
                    requestOp = new PromiseWrapper();
                }
            },
            browserActionPromptMessage: 'options_OptionalPermissions_Sessions_LegacyWarning',

            permissionChangedCallback,
            onPermissionChanged: pagePermissionChanged,
        });
        permissionControllers.push(sessionPermissionArea);
        optionalPermissionsArea.appendChild(sessionPermissionArea.area);
        {
            const permissionAvailableStatusIndicator = createStatusIndicator({
                headerMessage: 'options_OptionalPermissions_Sessions_PermissionAvailable',
                enabledMessage: 'options_OptionalPermissions_Sessions_PermissionAvailable_True',
                disabledMessage: 'options_OptionalPermissions_Sessions_PermissionAvailable_False',
            });
            sessionPermissionArea.section.content.appendChild(document.createElement('br'));
            sessionPermissionArea.section.content.appendChild(permissionAvailableStatusIndicator.area);
            (async () => {
                let isAvailable = false;
                try {
                    const browserInfo = await browser.runtime.getBrowserInfo();
                    const [majorVersion,] = (await browserInfo).version.split('.');
                    if (majorVersion >= 77) {
                        isAvailable = true;
                    }
                } catch (error) {
                    console.error('Failed to determine if "sessions" permission is available', error);
                }
                if (isAvailable) {
                    permissionAvailableStatusIndicator.isEnabled = true;
                } else {
                    permissionAvailableStatusIndicator.isEnabled = false;
                    sessionPermissionArea.hasError = true;
                }
            })();
        }
    }

    // #endregion Optional Permissions


    setTextMessages();
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

    const handleLoad = () => {
        shortcuts.update(); // Keyboard Commands
        boundSettings.skipCurrentInputIgnore();
        checkRequired();
        updateStyle();
        collapsableInfo.checkAll();
    };
    handleLoad();

    settingsTracker.onChange.addListener((changes) => {
        collapsableInfo.checkAll();

        if (changes.fixSidebarStyle) {
            updateStyle();
        }
        // Might have been changed from context menu:
        if (changes.browserAction_OpenInNewWindow || changes.browserAction_OpenInNewWindow_Docked) {
            checkRequired();
        }
        if (changes.optionsPage_disableDarkTheme) {
            toggleClass(document.documentElement, 'support-dark-theme', !settings.optionsPage_disableDarkTheme);
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
                await browser.runtime.sendMessage({ type: messageTypes.handleFailedToGetInternalId });
            }
        }
    });
}
initiatePage();