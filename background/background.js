'use strict';

import {
  getPromiseWithResolve,
} from '../common/utilities.js';

import {
  delay,
} from '../common/delays.js';

import {
  settings,
  settingsTracker,
  trackedDelay,
  cancelAllTrackedDelays,
  kWINDOW_DATA_KEY_DOCKING_INFO,
  messageTypes,
} from '../common/common.js';

import {
  kTST_ID,
  pingTST,
  unregisterFromTST,
} from '../tree-style-tab/utilities.js';

import {
  getInternalTSTId,
} from '../tree-style-tab/internal-id.js';

import {
  getSidebarURL,
} from '../tree-style-tab/sidebar-tab.js';

import {
  addTrackedWindow,
  isDockedWindow,
  isParentWindow,
  checkSimulateDocking,
  findSidebarWindows,
  setIsStoringSessionData,
} from '../background/simulate-docking.js';

import {
  SettingsTracker
} from '../common/settings.js';

import {
  showBasicNotification,
  Notification,
} from '../common/notifications.js';

import {
  EventManager,
} from '../common/events.js';

import {
  ToolbarPermissionRequest,
} from '../common/permissions.js';

import {
  PortManager,
} from '../common/connections.js';

import {
  DisposableCollection,
} from '../common/disposables.js';


/**
 * @typedef { import('../common/utilities.js').BrowserTab } BrowserTab
 */
/**
 * @typedef { import('../common/utilities.js').BrowserWindow } BrowserWindow
 */
/**
 * @typedef { import('../tree-style-tab/utilities.js').TSTTab } TSTTab
 */


// #region Context Menu

function getDefaultAction() {
  if (settings.browserAction_OpenInNewWindow) {
    if (settings.browserAction_OpenInNewWindow_Docked) {
      return 'openSidebarInDockedWindow';
    } else {
      return 'openSidebarInWindow';
    }
  } else {
    return 'openSidebarInTab';
  }
}

let lastContextMenuItems = [];
async function updateDefaultActionContextMenuItems() {
  try {
    const defaultAction = getDefaultAction();
    const radioItems = lastContextMenuItems.filter(item => item.id.startsWith('setDefault-'));
    const selectedItem = radioItems.find(item => item.id.startsWith('setDefault-' + defaultAction));
    for (let item of radioItems) {
      if (item.id !== selectedItem.id) {
        await browser.menus.update(item.id, { checked: false });
      }
    }
    if (selectedItem) {
      await browser.menus.update(selectedItem.id, { checked: true });
    }
  } catch (error) {
    console.error('Failed to update context menus checked default action!\nError: ', error);
  }
}

async function updateContextMenu() {
  try {
    await browser.menus.removeAll();

    let creationDetails = [];

    const getUniqueId = (prefix = '') => {
      if (!prefix || typeof prefix !== 'string') {
        prefix = '';
      }
      let uniqueId = 0;
      const ids = creationDetails.map(item => item.id);
      while (ids.includes(prefix + uniqueId)) {
        uniqueId++;
      }
      return prefix + uniqueId;
    };

    const makeCreationDetails = (items) => {
      const defaultValues = {};

      for (let contextMenuItem of items) {
        let {
          id,
          title = null,
          contexts = null,
          checked = null,
          type = defaultValues.type || null,
          enabled = true,
          isDefault = false,
          isRootItem = false,
          idPrefix = defaultValues.idPrefix || '',
          children = [],
          parentId = defaultValues.parentId || null,
        } = typeof contextMenuItem === 'string' ? { id: contextMenuItem } : contextMenuItem;

        if (!enabled || (typeof enabled === 'function' && !enabled())) {
          continue;
        }
        if (isDefault) {
          Object.assign(defaultValues, contextMenuItem);
          continue;
        }

        let details = {
          contexts: contexts || defaultValues.contexts,
        };
        if (parentId) {
          details.parentId = parentId;
        }
        if (
          (typeof id === 'string' && id.startsWith('-')) ||
          type === 'separator'
        ) {
          Object.assign(details, {
            id: getUniqueId(),
            type: 'separator',
          });
        } else {
          if (
            checked === false ||
            checked === true ||
            (type && type !== 'normal')
          ) {
            details.type = type;
            details.checked = checked;
          }
          Object.assign(details, {
            id: idPrefix + (defaultValues.alwaysUniqueIds ? getUniqueId(id ? id + '-' : id) : (!id && id !== 0 ? getUniqueId() : id)) + '',
            title: title || browser.i18n.getMessage(`contextMenu_${id}`),
          });
        }
        if (isRootItem) {
          const rootItems = creationDetails.filter(item => item.contexts.every(c => details.contexts.includes(c)) && !item.parentId && item.id != details.id);
          if (rootItems.length <= 1) {
            continue;
          }
          for (let item of rootItems) {
            item.parentId = details.id;
          }
        }
        creationDetails = creationDetails.filter(item => item.id !== details.id);

        if (isRootItem) {
          // Parent items must be added first:
          creationDetails.unshift(details);
        } else {
          creationDetails.push(details);
        }

        if (children.length > 0) {
          makeCreationDetails([Object.assign({}, defaultValues, { isDefault: true, parentId: details.id }), ...children]);
        }
      }
    };

    let allEnabled = true;
    const items = [
      { id: 'openSidebarInTab', enabled: () => allEnabled || settings.contextMenu_OpenSidebarInTab_ShowOnTabs, title: settings.contextMenu_OpenSidebarInTab_CustomLabel },
      { id: 'openSidebarInWindow', enabled: () => allEnabled || settings.contextMenu_OpenSidebarInWindow_ShowOnTabs, title: settings.contextMenu_OpenSidebarInWindow_CustomLabel },
      { id: 'openSidebarInDockedWindow', enabled: () => allEnabled || settings.contextMenu_OpenSidebarInDockedWindow_ShowOnTabs, title: settings.contextMenu_OpenSidebarInDockedWindow_CustomLabel },

      { id: '---------------------', enabled: () => allEnabled },
      {
        id: 'setDefaultBrowserAction', enabled: () => allEnabled,
        children: [
          { isDefault: true, idPrefix: 'setDefault-', type: 'radio' },
          { id: 'openSidebarInTab', },
          { id: 'openSidebarInWindow' },
          { id: 'openSidebarInDockedWindow' }
        ]
      },

      { id: '---------------------', enabled: () => !allEnabled && (settings.contextMenu_OpenSettings_ShowOnTabs && (settings.contextMenu_OpenSidebarInTab_ShowOnTabs || settings.contextMenu_OpenSidebarInWindow_ShowOnTabs || settings.contextMenu_OpenSidebarInDockedWindow_ShowOnTabs)), },
      { id: 'openSettings', enabled: () => allEnabled || settings.contextMenu_OpenSettings_ShowOnTabs, title: settings.contextMenu_OpenSettings_CustomLabel },
    ];

    {
      makeCreationDetails([
        { isDefault: true, contexts: ['browser_action'], alwaysUniqueIds: true },
        ...items
      ]);
    }

    if (settings.contextMenu_ShowOnTabs) {
      allEnabled = false;
      makeCreationDetails([
        { isDefault: true, contexts: ['tab'], alwaysUniqueIds: true },
        ...items,
        { enabled: settings.contextMenu_Root_CustomLabel, title: settings.contextMenu_Root_CustomLabel, isRootItem: true }
      ]);
    }

    for (let details of creationDetails) {
      await browser.menus.create(details);
    }

    lastContextMenuItems = creationDetails;
    updateDefaultActionContextMenuItems();
  } catch (error) {
    console.error('Failed to register context menu items!\nError: ', error);
    return false;
  }
  return true;
}

// #endregion Context Menu


// #region Tree Style Tab

function getTSTStyle() {
  let style = '';
  if (settings.fixSidebarStyle) {

    style += `
/* Fix sidebar page in separate tab */
body {
  -moz-user-select: none;
}
.tab {
  box-sizing: border-box;
}
.tab.pinned {
  z-index: 1000;
}
`;

  }

  return style;
}


async function registerToTST() {
  try {
    await unregisterFromTST();  // Remove any style currently present.

    const registrationDetails = {
      type: 'register-self',
      name: browser.runtime.getManifest().name,
      listeningTypes: ['ready'],
    };

    if (settings.requestTreeStyleTabPermission_tabs) {
      registrationDetails.permissions = ["tabs"];
    }


    // #region Style

    const style = getTSTStyle();
    if (style)
      registrationDetails.style = style;

    // #endregion Style


    await browser.runtime.sendMessage(kTST_ID, registrationDetails);
  } catch (error) { return false; }
  return true;
}

// #endregion Tree Style Tab


/**
 * Show a notification that Tree Style Tab's internal id couldn't be determined.
 *
 * @export
 * @returns {Promise<string>} The id of the notification or `null` if no notification was shown.
 */
async function handleFailedToDetermineTreeStyleTabInternalId() {
  try {
    if (!await pingTST()) return null;
    // TST is active but couldn't determine its internal id => Operation requires the "tabs" permission from Tree Style Tab.

    const notificationOptions = {
      title: browser.i18n.getMessage('permissions_required_notification_title'),
      message: browser.i18n.getMessage('permissions_required_notification_message'),
      iconUrl: 'icons/popup-32-light.png',
    };

    const notification = new Notification(Object.assign({ trackShown: false }, notificationOptions));
    try {
      // Change setting so that the permission is requested:
      await SettingsTracker.set('requestTreeStyleTabPermission_tabs', true);

      // Wait for Tree Style Tab to show its permission notification:
      await Promise.race([delay(500), notification.waitUntilClosed()]);

      if (notification.isClosed && !notification.wasClicked) {
        // Tree Style Tab's notification prevented our first notification from being shown:
        return showBasicNotification(notificationOptions);
      }
      return notification.getId();
    } finally {
      notification.dispose();
    }
  } catch (error) {
    console.error('Failed to show notification with information about how to determine Tree Style Tab\'s internal id.\nError:\n', error);
  }
}


/**
 * Create a new window that can optionally be docked with a parent window.
 *
 * @param {Object} Info Specifies how a new window is created.
 * @param {boolean} [Info.popup] Indicates that the window should be of a popup type. This kind of window won't have most of the items that a normal window has such as a URL bar.
 * @param {boolean} [Info.popup_hidden] If `popup` is `true` then this should ensure that the window can't be observed by other extensions.
 * @param {number} [Info.width] The width of the window. `-1` or unspecified to use default width.
 * @param {number} [Info.height] The height of the window. `-1` or unspecified to use default height.
 * @param {boolean} [Info.besideCurrentWindow] Create the window next to the current window. This will also ensure that the window is tracked via the "simulate docking" feature.
 * @param {number} [Info.besideCurrentWindow_spaceBetween] Space between the created window and the window that it is placed next to.
 * @param {string} [Info.besideCurrentWindow_titlePreface] Title preface to set for created window.
 * @param {boolean} [Info.besideCurrentWindow_simulateDocking_refocusParent] Refocus the current window after the new window has been created.
 * @param {number | null} [Info.tabId] The id of a tab that should be moved to the newly created window.
 * @param {string | string[]} [Info.url] A URL or array of URLs to open as tabs in the window.
 * @param {boolean} [Info.incognito] Determines if the newly created window is a private window.
 * @param {number} [Info.parentWindowId] The id of the parent window. Used for docking windows. Required when `besideCurrentWindow` is `true`.
 * @param {null | function(BrowserWindow): any} [Info.handleNewWindow] Gain quick access to the opened window.
 * @returns {Promise<BrowserWindow>} The created window.
 */
async function createDockedWindow({
  popup = false,
  popup_hidden = false,
  width = -1,
  height = -1,
  besideCurrentWindow = false,
  besideCurrentWindow_spaceBetween = -1,
  besideCurrentWindow_titlePreface = '',
  besideCurrentWindow_simulateDocking_refocusParent = false,
  tabId = null,
  url = null,
  incognito = false,
  parentWindowId = null,
  handleNewWindow = null,
}) {
  // Configure new window:
  const details = {
    incognito,
  };
  if (tabId || tabId === 0) {
    details.tabId = tabId;
  }
  if (url) {
    details.url = url;
  }

  if (popup) {
    details.type = popup_hidden ? 'panel' : 'popup';
  }
  if (besideCurrentWindow_titlePreface) {
    details.titlePreface = besideCurrentWindow_titlePreface;
  }
  if (width && width > 0) {
    details.width = +width;
  }
  if (height && height > 0) {
    details.height = +height;
  }
  let currentWindow = null;
  if (besideCurrentWindow) {
    if (!details.width) {
      details.width = 235;
    }
    currentWindow = await browser.windows.get(parentWindowId);
    if (currentWindow.state !== 'normal') {
      currentWindow = await browser.windows.update(currentWindow.id, { state: 'normal' });
    }

    const offset = details.width + (+besideCurrentWindow_spaceBetween);
    let x = currentWindow.left - offset;
    if (x < 0) {
      x = 0;
      // Move window to the right to leave more space:
      currentWindow = await browser.windows.update(currentWindow.id, { left: offset });
    }

    Object.assign(details, {
      top: currentWindow.top,
      left: x,
    });
    if (!details.height) {
      details.height = currentWindow.height;
    }
  }

  // Create window:
  const window = await browser.windows.create(details);

  let customOp;
  if (handleNewWindow) {
    customOp = handleNewWindow(window);
  }

  if (besideCurrentWindow) {
    // Track window to simulate docking:
    const trackedSidebarInfo = { window: window, windowId: window.id, parentWindowId: parentWindowId };

    browser.windows.get(trackedSidebarInfo.parentWindowId)
      .then(window => (trackedSidebarInfo.parentWindow = window, true))
      .catch(error => (console.error('Failed to cache parentWindow for opened sidebar window\nError: ', error), false));

    addTrackedWindow(trackedSidebarInfo);

    if (besideCurrentWindow_simulateDocking_refocusParent) {
      browser.windows.update(parentWindowId, { focused: true }).catch(error => console.error('Failed to re-focus parent window after creating docked sidebar window!\nError:', error));
    }
  }

  let changedPos = false;
  if (besideCurrentWindow && currentWindow !== null) {
    // Double check offset (window width/height might be different than specified):

    const offset = window.width + (+besideCurrentWindow_spaceBetween);
    let x = currentWindow.left - offset;
    if (x < 0) {
      x = 0;
      // Move window to the right to leave more space:
      currentWindow = await browser.windows.update(currentWindow.id, { left: offset });
    }

    if (details.top !== currentWindow.top) {
      details.top = currentWindow.top;
      changedPos = true;
    }
    if (details.left !== x) {
      details.left = x;
      changedPos = true;
    }
  }

  // Apply position after creation if the window isn't of the normal type or if window width/height is different then expected:
  if (details.type || changedPos) {
    const posDetails = {};
    if (details.left || details.left === 0) {
      posDetails.left = details.left;
    }
    if (details.top || details.top === 0) {
      posDetails.top = details.top;
    }
    if (Object.keys(posDetails).length > 0) {
      await browser.windows.update(window.id, posDetails).catch(error => console.error('Failed to move sidebar window after it was created!\nError: ', error));
    }
  }

  await customOp;

  return window;
}


// eslint-disable-next-line valid-jsdoc
/**
 * Open Tree Style Tab's sidebar page in a tab.
 *
 * @param {Object} Params Determines how the sidebar page is opened.
 * @param {number | null} [Params.windowId] The window id that the tab should be opened in. `null` or unspecified to use the currently selected window.
 * @param {boolean} [Params.createNewWindow] Move the tab to a new window after it has been created.
 * @param {boolean} [Params.openAfterCurrent] Open the tab after the currently active tab.
 * @param {boolean} [Params.childOfCurrent] Open the new tab as a child of the current tab.
 * @param {boolean} [Params.openDirectlyInNewWindow] Don't open the new tab in the current window at all, instead open it directly in the new window. To track the current window correctly this requires Tree Style Tab v3.5.6 or later.
 * @param {Parameters<typeof createDockedWindow>[0]} [Params.windowSettings] Specify how the new window should be created.
 * @param {null | number} [Params.delayBeforeWindowSeperationInMilliseconds] Delay in milliseconds before moving the created tab to a new window.
 * @param {string | null} [Params.pageTitle] The title of the opened "sidebar" page.
 * @returns {Promise<BrowserTab | null | false>} The opened tab. `false` if Tree Style Tab wasn't found. `null` for other issues.
 */
async function openTreeStyleTabSidebarInTab({
  windowId = null,
  createNewWindow = false,
  openAfterCurrent = false,
  childOfCurrent = false,
  openDirectlyInNewWindow = false,
  windowSettings = null,
  delayBeforeWindowSeperationInMilliseconds = null,
  pageTitle = null,
} = {}) {


  // #region Info

  const [internalId, activeTab] = await Promise.all([
    (async () => {
      if (!await pingTST()) {
        return false;
      }

      if (settings.useModernSidebarUrl) {
        return null;
      }


      // #region Determine Tree Style Tab's internal id

      const internalId = await getInternalTSTId();
      if (!internalId) {
        await handleFailedToDetermineTreeStyleTabInternalId();
        return null;
      }

      // #endregion Determine Tree Style Tab's internal id


      return internalId;
    })(),
    (async () => {
      const queryDetails = { active: true };
      if (windowId || windowId === 0) {
        queryDetails.windowId = windowId;
      } else {
        queryDetails.currentWindow = true;
      }
      /** @type {BrowserTab[]} */
      const [activeTab,] = await browser.tabs.query(queryDetails);
      return activeTab;
    })(),
  ]);

  if (internalId === false) {
    // TST not found/installed/enabled:
    return false;
  }
  if ((!internalId && !settings.useModernSidebarUrl) || !activeTab) {
    // Failed in someway to find necessary information:
    return null;
  }

  const sidebarURL = getSidebarURL({ internalId, windowId: activeTab.windowId, title: pageTitle });

  // #endregion Info


  if (openDirectlyInNewWindow) {
    const window = await createDockedWindow(Object.assign({
      url: sidebarURL,
      incognito: activeTab.incognito,
      parentWindowId: activeTab.windowId,
    }, windowSettings));
    return window.tabs[0];
  }


  const openAfterActiveDetails = ({ pinned = false } = {}) => {
    const details = { windowId: activeTab.windowId, index: activeTab.index + 1 };
    if (pinned) {
      details.pinned = pinned;
    }
    if (!details.pinned && !createNewWindow && openAfterCurrent && childOfCurrent) {
      details.openerTabId = activeTab.id;
    }
    return details;
  };


  // #region Open Sidebar Page

  /** @type {BrowserTab} */
  let tab;
  /** @type {BrowserTab} */
  let sidebarTab;

  // @ts-ignore
  /** @type { ReturnType<typeof getPromiseWithResolve> extends Promise<infer R> ? R : never} */
  let promiseInfo;

  try {
    promiseInfo = await getPromiseWithResolve();

    // Listener for loading complete:
    /**
     * Listener for update events.
     *
     * @param {number} tabId Changed tab id.
     * @param {Object} changeInfo Info about change.
     * @param {BrowserTab} tab The changed tab.
     */
    const loadListener = (tabId, changeInfo, tab) => {
      if (!sidebarTab || sidebarTab.id !== tabId) {
        return;
      }
      if (changeInfo.status === 'complete') {
        promiseInfo.resolve(true);
      }
    };
    try {
      browser.tabs.onUpdated.addListener(loadListener);

      // Open Sidebar Page:
      if (tab) {
        await browser.tabs.update(tab.id, { url: sidebarURL });
      } else {
        let createDetails = { url: sidebarURL, active: !createNewWindow, windowId: activeTab.windowId };


        if (createNewWindow && settings.pinTabsBeforeMove && (!settings.pinTabsBeforeMove_OnlyAfterCurrent || activeTab.pinned)) {
          Object.assign(createDetails, { pinned: true });
        } else if (createNewWindow || openAfterCurrent) {
          createDetails = Object.assign(openAfterActiveDetails({ pinned: !createNewWindow && activeTab.pinned }), createDetails);
        }

        tab = await browser.tabs.create(createDetails);
      }

      // Wait for sidebar tab to load:
      sidebarTab = tab;
      await Promise.race([delay(3000), promiseInfo.promise]);
    } finally {
      browser.tabs.onUpdated.removeListener(loadListener);
    }
  } finally {
    if (promiseInfo) {
      promiseInfo.resolve(false);
    }
  }

  // #endregion Open Sidebar Page


  // #region Move to new window

  if (createNewWindow) {
    const moveToNewWindow = async () => {
      await createDockedWindow(Object.assign({
        tabId: tab.id,
        incognito: activeTab.incognito,
        parentWindowId: activeTab.windowId,
      }, windowSettings));
    };
    if (delayBeforeWindowSeperationInMilliseconds && delayBeforeWindowSeperationInMilliseconds > 0) {
      trackedDelay(delayBeforeWindowSeperationInMilliseconds).then(() => moveToNewWindow());
    } else {
      await moveToNewWindow();
    }
  }

  // #endregion Move to new window


  return tab;
}

// eslint-disable-next-line valid-jsdoc
/**
 * Get default info for calling `openTreeStyleTabSidebarInTab`.
 *
 * @param { Partial<Parameters<typeof openTreeStyleTabSidebarInTab>[0]> } [overrides] Optionally override some of the default values.
 * @param {Object} [Params] Configure what default values are generated.
 * @param {boolean} [Params.dockedWindow] Indicates whether the new window will be "docked".
 * @returns {Parameters<typeof openTreeStyleTabSidebarInTab>[0]} Info that can be used when calling `openTreeStyleTabSidebarInTab`.
 */
function getDefaultMoveDetails(overrides = {}, { dockedWindow = false } = {}) {
  // Define global settings:
  /** @type {Parameters<typeof openTreeStyleTabSidebarInTab>[0]} */
  const info = {
    openAfterCurrent: settings.openAfterCurrentTab,
    childOfCurrent: settings.openAsChildOfCurrentTab,
    delayBeforeWindowSeperationInMilliseconds: settings.delayBeforeWindowSeperationInMilliseconds,
    openDirectlyInNewWindow: overrides.createNewWindow && !settings.useTemporaryTabWhenOpeningNewWindow,
    pageTitle: settings.tstSidebarPageTitle,
  };
  // Pass new ("docked") window settings:
  if (dockedWindow) {
    const windowInfo = {};
    const prefix = 'newWindow_';
    for (const [key, value] of Object.entries(settings)) {
      if (key.startsWith(prefix)) {
        windowInfo[key.slice(prefix.length)] = value;
      }
    }
    info.windowSettings = windowInfo;
  }
  // Apply overrides and return:
  return Object.assign(info, overrides);
}

// Notifications for changes in permissions isn't provided by the extension API yet so we define our own and make sure to invoke them when we do anything that could change them:
export const onPermissionsChange = new EventManager();

// Firefox 77 have permission events!
try {
  if (browser.permissions.onAdded) {
    browser.permissions.onAdded.addListener((permissions) => {
      onPermissionsChange.fire(permissions, true);
    });
  }
  if (browser.permissions.onRemoved) {
    browser.permissions.onRemoved.addListener((permissions) => {
      onPermissionsChange.fire(permissions, false);
    });
  }
} catch (error) {
  console.error('Failed to listen to permission events.', error);
}



settingsTracker.start.finally(async () => {

  // #region Settings

  const checkIfStoreSessionsData = async () => {
    try {
      const granted = await browser.permissions.contains({ permissions: ['sessions'] });
      setIsStoringSessionData(granted && settings.newWindow_besideCurrentWindow_autoDetectAtStartup_SessionData);
      if (granted && !settings.newWindow_besideCurrentWindow_autoDetectAtStartup_SessionData) {
        // Remove session data:
        const windows = await browser.windows.getAll({ populate: false });
        await Promise.all(windows.map(async (window) => {
          if (browser.sessions) {
            try {
              await browser.sessions.removeWindowValue(window.id, kWINDOW_DATA_KEY_DOCKING_INFO);
            } catch (error) {
              console.error('Failed to remove session data from window.\nWindow:', window, '\nError: ', error);
            }
          }
        }));
      }
    } catch (error) {
      console.error('Failed to check "sessions" permission.\nError: ', error);
    }
  };

  settingsTracker.onChange.addListener((changes) => {
    if (changes.fixSidebarStyle || changes.requestTreeStyleTabPermission_tabs) {
      registerToTST();
    }

    if (
      changes.delayBeforeWindowSeperationInMilliseconds ||
      changes.newWindow_besideCurrentWindow_autoDetectAtStartup_delayBeforeWindowSeparation
    ) {
      cancelAllTrackedDelays();
    }
    if (Object.keys(changes).some(change => change.startsWith('contextMenu'))) {
      updateContextMenu();
    }
    if (changes.browserAction_OpenInNewWindow || changes.browserAction_OpenInNewWindow_Docked) {
      // Might have been updated from settings page => update context menu options:
      updateDefaultActionContextMenuItems();
    }
    if (Object.keys(changes).some(change =>
      change.startsWith('newWindow') &&
      change !== 'newWindow_width'  // Window width can be synced in which case it will change rapidly when sidebar windows are resized. This should minimize performance issues.
    )) {
      checkSimulateDocking();
    }
    if (changes.newWindow_besideCurrentWindow_autoDetectAtStartup_SessionData) {
      checkIfStoreSessionsData();
    }
  });
  checkIfStoreSessionsData();
  onPermissionsChange.addListener(() => checkIfStoreSessionsData());

  // #endregion Settings


  // #region Tree Style Tab

  browser.runtime.onMessageExternal.addListener((aMessage, aSender) => {
    if (aSender.id !== kTST_ID) {
      return;
    }
    switch (aMessage.type) {
      case 'ready': {
        // passive registration for secondary (or after) startup:
        registerToTST();
        return Promise.resolve(true);
      } break;
    }
  });
  if (!registerToTST()) {
    setTimeout(registerToTST, 5000);
  }

  // #endregion Tree Style Tab


  // #region Context Menu & Browser Action

  updateContextMenu();
  browser.menus.onClicked.addListener((info, tab) => {
    let itemId = info.menuItemId;
    const removeAfter = (original, remove) => {
      let index = original.indexOf(remove);
      if (index >= 0) {
        return original.slice(0, index);
      }
    };
    itemId = removeAfter(itemId, '-');

    switch (itemId) {
      case 'openSettings': {
        browser.runtime.openOptionsPage();
      } break;

      case 'openSidebarInTab': {
        openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: false }));
      } break;
      case 'openSidebarInWindow': {
        openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: true }));
      } break;
      case 'openSidebarInDockedWindow': {
        openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: true }, { dockedWindow: true }));
      } break;

      case 'setDefault': {
        let id = info.menuItemId.slice('setDefault-'.length);
        id = removeAfter(id, '-');

        switch (id) {
          case 'openSidebarInTab': {
            browser.storage.local.set({ 'browserAction_OpenInNewWindow': false });
          } break;
          case 'openSidebarInWindow': {
            browser.storage.local.set({ 'browserAction_OpenInNewWindow': true, 'browserAction_OpenInNewWindow_Docked': false });
          } break;
          case 'openSidebarInDockedWindow': {
            browser.storage.local.set({ 'browserAction_OpenInNewWindow': true, 'browserAction_OpenInNewWindow_Docked': true });
          } break;
        }
      } break;
    }
  });
  browser.browserAction.onClicked.addListener((tab) => {
    openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: settings.browserAction_OpenInNewWindow }, { dockedWindow: settings.browserAction_OpenInNewWindow_Docked }));
  });

  // #endregion Context Menu & Browser Action


  // #region Keyboard Commands

  browser.commands.onCommand.addListener(function (command) {
    switch (command) {
      case 'open-tst-sidebar-in-tab': {
        openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: false }));
      } break;

      case 'open-tst-sidebar-in-window': {
        openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: true }));
      } break;

      case 'open-tst-sidebar-in-docked-window': {
        openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: true }, { dockedWindow: true }));
      } break;
    }
  });

  // #endregion Keyboard Commands


  // #region Message

  const portManager = new PortManager();
  onPermissionsChange.addListener(function () {
    portManager.fireEvent('permissionChanged', Array.from(arguments));
  });
  portManager.onMessage.addListener(async (message, sender, disposables) => {
    if (!message.type)
      return;
    switch (message.type) {
      case messageTypes.getTstStyle: {
        return getTSTStyle();
      } break;
      case messageTypes.handleFailedToGetInternalId: {
        return handleFailedToDetermineTreeStyleTabInternalId();
      } break;

      case messageTypes.permissionsChanged: {
        onPermissionsChange.fire(message.permission, message.value);
      } break;

      case messageTypes.requestPermission: {
        let requester = new ToolbarPermissionRequest(message.permission);
        if (disposables && disposables instanceof DisposableCollection) {
          disposables.trackDisposables(requester);
        }
        let result = await requester.result;
        if (result) {
          onPermissionsChange.fire(message.permission, await browser.permissions.contains(message.permission));
        }
        return result;
      } break;
    }
  });

  // #endregion Message


  // #region Handle Startup Events

  if (
    settings.newWindow_besideCurrentWindow &&
    (
      settings.newWindow_besideCurrentWindow_autoOpenAtStartup ||
      settings.newWindow_besideCurrentWindow_autoDetectAtStartup
    )
  ) {
    (async function () {
      try {

        // #region Get Startup info

        /** @type {[BrowserWindow[], boolean]} */
        let [
          allWindows,
          /** `true` if the browser just started. */
          browserStartup,
        ] = await Promise.all([
          browser.windows.getAll({ populate: true }),
          (async function () {
            const installed = new Promise((resolve, reject) => {
              try {
                browser.runtime.onInstalled.addListener(({ previousVersion, reason, temporary }) => {
                  resolve(true);
                });
                delay(1000).then(() => resolve(false));
              } catch (error) {
                reject(error);
              }
            });
            const started = new Promise((resolve, reject) => {
              try {
                browser.runtime.onStartup.addListener(() => {
                  resolve(true);
                });
                delay(1000).then(() => resolve(false));
              } catch (error) {
                reject(error);
              }
            });

            if (await started) {
              // Browser started (not triggered if started into incognito mode):
              return true;
            }
            if (await installed) {
              // Installed/Updated:
              // If install event was triggered then it is probably not a browser startup (extension could be updated at browser startup but it is unlikely):
              return false;
            }
            // If no startup info and no install info then assume (will happen for extension disable/enable):
            return false;
          })(),
        ]);

        if (browserStartup) {
          // Wait for all windows to be created:
          await new Promise((resolve, reject) => {
            try {
              const disableMonitorsAndResolve = () => {
                try {
                  browser.tabs.onActivated.removeListener(tabActivated);
                  if (timeoutId !== undefined) {
                    clearTimeout(timeoutId);
                    timeoutId = undefined;
                  }
                } finally {
                  resolve();
                }
              };

              let timeoutId = undefined;
              let tabCount = 0;
              const checkTabCount = () => {
                if (timeoutId !== undefined) return;
                timeoutId = setTimeout(async () => {
                  timeoutId = undefined;

                  const newTabCount = await browser.tabs.query({}).length;

                  if (newTabCount === tabCount) {
                    disableMonitorsAndResolve();
                  } else {
                    tabCount = newTabCount;
                    // Queue the next check:
                    checkTabCount();
                  }
                }, 1000);
              };
              checkTabCount();


              const tabActivated = (activeInfo) => {
                // If the user can change tab then we are probably in a state where its possible to do more work:
                disableMonitorsAndResolve();
              };
              browser.tabs.onActivated.addListener(tabActivated);
            } catch (error) {
              console.error('Failed to wait for browser startup!\nError: ', error);
              resolve();
            }
          });

          allWindows = browser.windows.getAll({ populate: true });
        }

        // #endregion Get Startup info


        const sidebarInfo = await findSidebarWindows({ allWindows, xSpaceBetweenWindows: settings.newWindow_besideCurrentWindow_spaceBetween });

        const newWindowOverrides = { createNewWindow: true };
        if (settings.newWindow_besideCurrentWindow_autoDetectAtStartup_delayBeforeWindowSeparation >= 0) {
          newWindowOverrides.delayBeforeWindowSeperationInMilliseconds = settings.newWindow_besideCurrentWindow_autoDetectAtStartup_delayBeforeWindowSeparation;
        }


        // #region Find docked sidebar windows and start tracking them

        if (settings.newWindow_besideCurrentWindow_autoDetectAtStartup && sidebarInfo.sidebarWindows.length > 0) {
          if (sidebarInfo.sidebarWindows.length > 0 && sidebarInfo.possibleParentWindows.length === 0) {
            /** @type { Omit<BrowserWindow, 'tabs'>[] } */
            const allWindows = await browser.windows.getAll({ populate: false });
            const isSidebarWindow = allWindows.map(window => sidebarInfo.sidebarWindows.some(info => info.window.id === window.id));
            const existsNonSidebarWindow = isSidebarWindow.some(isSidebar => !isSidebar);
            if (!existsNonSidebarWindow) {
              // Ensure that even if all sidebar windows are closed there will be at least one window left:
              await browser.windows.create({});
            }
          }


          await Promise.all(sidebarInfo.sidebarWindows.map(async ({ window, parentWindow }) => {

            if (!parentWindow) {
              if (browserStartup) {
                await browser.windows.remove(window.id);
              }
              return;
            }

            if (browserStartup) {
              if (!settings.useTemporaryTabWhenOpeningNewWindow) {
                // Use Tree Style Tab's new "windowId" query parameter. Change the tab's URL to one with the parent window's id instead of closing the window.
                let sidebarUrl = null;
                if (settings.useModernSidebarUrl) {
                  sidebarUrl = getSidebarURL({ windowId: parentWindow.id, title: settings.tstSidebarPageTitle });
                } else {
                  const internalId = await getInternalTSTId();
                  if (internalId) {
                    sidebarUrl = getSidebarURL({ internalId, windowId: parentWindow.id, title: settings.tstSidebarPageTitle });
                  } else {
                    console.warn('Failed to get internal Tree Style Tab id. Can\'t update old "sidebar" page\'s URL to point to new parent windowId.\nOld sidebar window: ', window, '\nparentWindow: ', parentWindow);
                  }
                }
                if (sidebarUrl) {
                  await browser.tabs.update(window.tabs[0].id, { url: sidebarUrl });
                }
              } else {
                // Need to close and reopen window since the page will have targeted the wrong window id:
                const closePromise = browser.windows.remove(window.id);
                openTreeStyleTabSidebarInTab(getDefaultMoveDetails(Object.assign({ windowId: parentWindow.id }, newWindowOverrides), { dockedWindow: true }));
                await closePromise;
                return;
              }
            }
            // Need to track this window's id:
            if (isDockedWindow(window.id)) {
              // Already tracked:
              return;
            }

            const trackedSidebarInfo = { window: window, windowId: window.id, parentWindowId: parentWindow.id, parentWindow };

            addTrackedWindow(trackedSidebarInfo);
          }));
        }

        // #endregion Find docked sidebar windows and start tracking them


        // #region Open a docked sidebar window for each open window

        if (settings.newWindow_besideCurrentWindow_autoOpenAtStartup && browserStartup) {
          for (const window of sidebarInfo.possibleParentWindows) {
            if (isParentWindow(window.id)) {
              // This window already has an open sidebar window:
              continue;
            }
            openTreeStyleTabSidebarInTab(getDefaultMoveDetails(Object.assign({ windowId: window.id }, newWindowOverrides), { dockedWindow: true }));
          }
        }

        // #endregion Open a docked sidebar window for each open window


      } catch (error) {
        console.error('Failed to auto detect and (re)open sidebar windows at startup!\nError: ', error);
      }
    })();
  }

  // #endregion Handle Startup Events

});
