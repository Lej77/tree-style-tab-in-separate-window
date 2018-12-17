


async function pingTST() {
  try {
    await browser.runtime.sendMessage(kTST_ID, { type: 'ping' });
  } catch (error) { return false; }
  return true;
}


async function updateContextMenu() {
  try {
    await browser.contextMenus.removeAll();

    let creationDetails = [];

    const getUniqueId = (prefix = '') => {
      if (!prefix || typeof prefix !== 'string') {
        prefix = '';
      }
      let uniqueId = 0;
      let ids = creationDetails.map(item => item.id);
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
          title,
          contexts,
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
        if (typeof id === 'string' && id.startsWith('-')) {
          Object.assign(details, {
            id: getUniqueId(),
            type: 'separator',
          });
        } else {
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
          { isDefault: true, idPrefix: 'setDefault-' },
          'openSidebarInTab',
          'openSidebarInWindow',
          'openSidebarInDockedWindow'
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
      await browser.contextMenus.create(details);
    }
  } catch (error) {
    console.error('Failed to register context menu items!\nError: ', error);
    return false;
  }
  return true;
}


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

    if (!settings.fixSidebarStyle) {
      return true;  // No need to register.
    }

    let registrationDetails = {
      type: 'register-self',
      name: browser.runtime.getManifest().name,
      listeningTypes: ['ready'],
    };


    // #region Style

    const style = getTSTStyle();
    if (style)
      registrationDetails.style = style;

    // #endregion Style


    await browser.runtime.sendMessage(kTST_ID, registrationDetails);
  } catch (error) { return false; }
  return true;
}

async function unregisterFromTST() {
  try {
    await browser.runtime.sendMessage(kTST_ID, {
      type: 'unregister-self'
    });
  }
  catch (e) {
    // TST is not available
    return false;
  }
  return true;
}


let openSidebarWindows = [];
let simulateDockingIntervalId = null;
let simulateDockingInterval = 0;
let hasWindowsFocusListener = false;
let fastSimulatedDocking = false;
let fastSimulatedDocking_TimeoutId = null;
async function checkSimulateDocking({ reset = false, checkCachedWindowIds = true, checkListeners = true } = {}) {

  // Should we simulate docking:
  const shouldSimulate =
    // Setting enabled:
    settings.newWindow_besideCurrentWindow &&
    (settings.newWindow_besideCurrentWindow_simulateDocking_slowInterval || settings.newWindow_besideCurrentWindow_simulateDocking_slowInterval === 0) &&
    settings.newWindow_besideCurrentWindow_simulateDocking_slowInterval >= 0 &&
    // Any sidebar windows to check:
    openSidebarWindows.length > 0;


  if (
    // Not clearing interval:
    !reset &&
    // Should simulate:
    shouldSimulate
  ) {
    // Ensure we are simulating docking:
    const wantedInterval = (+settings.newWindow_besideCurrentWindow_simulateDocking_slowInterval);
    if (simulateDockingInterval !== wantedInterval) {
      // Window check interval changed (clear current interval):
      checkSimulateDocking({ reset: true, checkCachedWindowIds: false, checkListeners: false });
    }
    if (simulateDockingIntervalId === null) {
      // Start new interval check:
      fastSimulatedDocking = true;
      simulateDockingIntervalId = setInterval(simulateDockingBackground, wantedInterval);
      simulateDockingInterval = wantedInterval;
    }
  } else {
    if (simulateDockingIntervalId !== null) {
      // Stop simulating docking:
      if (fastSimulatedDocking_TimeoutId !== null) {
        clearInterval(fastSimulatedDocking_TimeoutId);
        fastSimulatedDocking_TimeoutId = null;
      }


      clearInterval(simulateDockingIntervalId);
      simulateDockingIntervalId = null;
      simulateDockingInterval = 0;
    }
  }

  if (checkListeners) {
    // Listen to window focus events:
    if (
      shouldSimulate &&
      (
        settings.newWindow_besideCurrentWindow_simulateDocking_autoFocus ||
        settings.newWindow_besideCurrentWindow_simulateDocking_refocusParent
      )
    ) {
      if (!hasWindowsFocusListener) {
        browser.windows.onFocusChanged.addListener(onWindowFocusChanged);
        hasWindowsFocusListener = true;
      }
    } else {
      if (hasWindowsFocusListener) {
        browser.windows.onFocusChanged.removeListener(onWindowFocusChanged);
        hasWindowsFocusListener = false;
      }
    }
  }

  // Check of any cached windows are closed (to avoid leaking to much memory):
  if (checkCachedWindowIds && openSidebarWindows.length > 0) {
    const openWindows = await browser.windows.getAll();
    const openWindowIds = openWindows.map(window => window.id);
    openSidebarWindows = openSidebarWindows.filter(info => openWindowIds.includes(info.windowId) && openWindowIds.includes(info.parentWindowId));
    if (openSidebarWindows.length === 0) {
      checkSimulateDocking({ checkCachedWindowIds: false });
    }
  }
}
let changingFocus = false;
async function onWindowFocusChanged(windowId) {
  if (
    windowId === browser.windows.WINDOW_ID_NONE ||
    changingFocus
  ) {
    return;
  }

  changingFocus = true;
  try {
    let dockedSidebar = settings.newWindow_besideCurrentWindow_simulateDocking_autoFocus ? openSidebarWindows.filter(info => info.parentWindowId === windowId) : [];
    if (dockedSidebar.length === 0) {
      if (settings.newWindow_besideCurrentWindow_simulateDocking_refocusParent) {
        // See if focused window was a docked sidebar and in that case focus its parent window:
        let sidebarWindow = openSidebarWindows.find(info => info.windowId === windowId);
        if (sidebarWindow) {
          const parentWindow = await browser.windows.get(sidebarWindow.parentWindowId);
          if (parentWindow.state !== 'minimized') {
            await browser.windows.update(sidebarWindow.parentWindowId, { focused: true });
          } else if (settings.newWindow_besideCurrentWindow_simulateDocking_minimize) {
            await browser.windows.update(sidebarWindow.windowId, { state: 'minimized' });
          }
        }
      }
      return;
    }
    dockedSidebar.push({ windowId });

    await Promise.all(dockedSidebar.map(info => browser.windows.update(info.windowId, { focused: true }).catch(error => null)));
  } catch (error) {
    // Can happen if the window that should be focused was closed.
    console.error('Failed to change window focus!\n Window Focused: ', windowId, '\nError: ', error);
  } finally {
    changingFocus = false;
  }
}
function simulateDocking() {
  if (openSidebarWindows.length === 0) {
    checkSimulateDocking();
    return;
  }

  const count = {};
  return openSidebarWindows.map(async function (info, index, array) {
    try {
      let sidebarWindows = [];
      let sidebarIndex = 0;
      if (settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight) {
        sidebarIndex = count[info.parentWindowId] || 0;
        count[info.parentWindowId] = sidebarIndex + 1;
        sidebarWindows = array.filter(info2 => info2.parentWindowId === info.parentWindowId);
      }

      let [sidebarWindow, parentWindow] = await Promise.all(
        [info.windowId, info.parentWindowId]
          .map(id =>
            browser.windows.get(id, { populate: false }).catch(error => null)
          )
      );
      if (settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight) {
        info.window = sidebarWindow;
      }

      // Auto close sidebar if parent window is closed:
      if (sidebarWindow && !parentWindow && settings.newWindow_besideCurrentWindow_simulateDocking_autoClose) {
        sidebarWindow = await browser.windows.get(sidebarWindow.id, { populate: true }).catch(error => null);
        if (sidebarWindow && sidebarWindow.tabs.length <= 1) {
          await browser.windows.remove(sidebarWindow.id);
        }
      }

      // Stop tracking this window:
      if (!sidebarWindow || !parentWindow) {
        checkSimulateDocking();
        return;
      }

      // Check Fullscreen / Minimized:
      if (parentWindow.state === 'minimized') {
        if (settings.newWindow_besideCurrentWindow_simulateDocking_minimize && sidebarWindow.state !== 'minimized') {
          fastSimulatedDocking = true;
          await browser.windows.update(sidebarWindow.id, { state: 'minimized' });
        }
        return;
      } else if (parentWindow.state !== 'normal') {
        // Parent window maximized or in fullscreen.
        return;
      }

      if (sidebarWindow.state === 'minimized') {
        if (settings.newWindow_besideCurrentWindow_simulateDocking_minimize) {
          fastSimulatedDocking = true;
          await browser.windows.update(sidebarWindow.id, { state: 'normal' });
          sidebarWindow = await browser.windows.get(sidebarWindow.id, { populate: false });
        } else {
          // Sidebar window is minimized:
          return;
        }
      }

      const offset = sidebarWindow.width + (+settings.newWindow_besideCurrentWindow_spaceBetween);
      let x = parentWindow.left - offset;
      if (x < 0) {
        x = 0;
      }

      let height = sidebarWindow.height;
      if (settings.newWindow_besideCurrentWindow_simulateDocking_syncHeight) {
        if (settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight) {
          height = Math.round(parentWindow.height / sidebarWindows.length);
        } else {
          height = parentWindow.height;
        }
      }

      let y = parentWindow.top;
      if (sidebarIndex !== 0) {
        if (settings.newWindow_besideCurrentWindow_simulateDocking_syncHeight) {
          y += height * sidebarIndex;
        } else {
          for (let iii = 0; iii < sidebarIndex && iii < sidebarWindows.length; iii++) {
            y += sidebarWindows[iii].window.height;
          }
        }
      }

      if (settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight && (sidebarIndex + 1) < sidebarWindows.length) {
        height -= settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight_heightMargin;
      }

      const wantedPos = { top: y, left: x };
      if (sidebarWindow.height !== height) {
        wantedPos.height = height;
      }
      if (
        sidebarWindow.top !== wantedPos.top ||
        sidebarWindow.left !== wantedPos.left ||
        (wantedPos.height && sidebarWindow.height !== wantedPos.height)
      ) {
        fastSimulatedDocking = true;
        await browser.windows.update(sidebarWindow.id, wantedPos);
      }
    } catch (error) {
      console.error('Failed to simulate docking!\nWindow Info:', info, '\nError:', error);
    }
  });
}
async function simulateDockingBackground() {
  let wasFast = fastSimulatedDocking;
  fastSimulatedDocking = false;

  if (
    wasFast &&
    // Setting enabled:
    (settings.newWindow_besideCurrentWindow_simulateDocking_fastInterval || settings.newWindow_besideCurrentWindow_simulateDocking_fastInterval === 0) &&
    settings.newWindow_besideCurrentWindow_simulateDocking_fastInterval >= 0 &&
    // Setting is faster than slow mode:
    settings.newWindow_besideCurrentWindow_simulateDocking_fastInterval < simulateDockingInterval &&
    // Slow mode isn't disabled:
    simulateDockingIntervalId !== null
  ) {
    if (fastSimulatedDocking_TimeoutId === null) {
      fastSimulatedDocking_TimeoutId = setInterval(simulateDocking, (+settings.newWindow_besideCurrentWindow_simulateDocking_fastInterval));
    } else {
      return; // Let fast mode handle the docking simulation logic.
    }
  } else {
    if (fastSimulatedDocking_TimeoutId !== null) {
      clearInterval(fastSimulatedDocking_TimeoutId);
      fastSimulatedDocking_TimeoutId = null;
    }
  }
  await Promise.all(simulateDocking());
  if (fastSimulatedDocking && !wasFast && fastSimulatedDocking_TimeoutId === null) {
    // Enable fast mode quickly:
    simulateDockingBackground();
  }
}


let windowMoveTimeoutIds = [];
async function openTreeStyleTabSidebarInTab({ createNewWindow = false, openAfterCurrent = false, childOfCurrent = false, windowSettings = {} } = {}) {
  if (!await pingTST()) {
    return false;
  }

  // #region Info

  let [activeTab,] = await browser.tabs.query({ currentWindow: true, active: true });
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
  let tab;

  // #endregion Info


  // #region Determine Tree Style Tab's internal id

  let internalId = await getInternalTSTId();

  // #endregion Determine Tree Style Tab's internal id


  // #region Open Sidebar Page

  let sidebarTab;
  let sidebarURL = getSidebarURL(internalId);

  let promiseInfo;
  try {
    promiseInfo = await getPromiseWithResolve();

    // Listener for loading complete:
    let loadListener = (tabId, changeInfo, tab) => {
      if (!sidebarTab || sidebarTab.id !== tabId) {
        return;
      }
      if (changeInfo.status === 'complete') {
        promiseInfo.resolve(changeInfo.url);
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
      internalId = await Promise.race([delay(3000), promiseInfo.promise]);
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
      // Passed settings:
      const {
        popup = false,
        width = -1,
        height = -1,
        besideCurrentWindow = false,
        besideCurrentWindow_spaceBetween = -1,
        besideCurrentWindow_simulateDocking_refocusParent = false,
      } = windowSettings || {};

      // Configure new window:
      const details = {
        incognito: activeTab.incognito,
        tabId: tab.id,
      };
      if (popup) {
        details.type = 'popup';
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
        currentWindow = await browser.windows.get(activeTab.windowId);
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

      if (besideCurrentWindow) {
        // Track window to simulate docking:
        openSidebarWindows.push({ window: window, windowId: window.id, parentWindowId: activeTab.windowId });
        fastSimulatedDocking = true;
        checkSimulateDocking();

        if (besideCurrentWindow_simulateDocking_refocusParent) {
          browser.windows.update(activeTab.windowId, { focused: true }).catch(error => console.error('Failed to re-focus parent window after creating docked sidebar window!\nError:', error));
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
    };
    if (settings.delayBeforeWindowSeperationInMilliseconds && settings.delayBeforeWindowSeperationInMilliseconds > 0) {
      let timeoutId = setTimeout(() => {
        windowMoveTimeoutIds = windowMoveTimeoutIds.filter(aId => aId !== timeoutId);
        moveToNewWindow();
      }, settings.delayBeforeWindowSeperationInMilliseconds);
      windowMoveTimeoutIds.push(timeoutId);
    } else {
      await moveToNewWindow();
    }
  }

  // #endregion Move to new window


  return tab;
}


function getDefaultMoveDetails(overrides = {}, { dockedWindow = false } = {}) {
  // Define global settings:
  const info = {
    openAfterCurrent: settings.openAfterCurrentTab,
    childOfCurrent: settings.openAsChildOfCurrentTab,
  };
  // Pass new window settings:
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
  // Apply override and return:
  return Object.assign(info, overrides);
}


settingsLoaded.finally(async () => {

  // #region Settings

  handleSettingChanges = (changes, areaName) => {
    if (changes.fixSidebarStyle) {
      registerToTST();
    }
    if (changes.delayBeforeWindowSeperationInMilliseconds) {
      for (let id of windowMoveTimeoutIds) {
        clearTimeout(id);
      }
      windowMoveTimeoutIds = [];
    }
    if (Object.keys(changes).some(change => change.startsWith('contextMenu'))) {
      updateContextMenu();
    }
    checkSimulateDocking();
  };

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
  browser.contextMenus.onClicked.addListener((info, tab) => {
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

  browser.runtime.onMessage.addListener(async (message) => {
    if (!message.type)
      return;
    switch (message.type) {
      case 'get-tst-style': {
        return getTSTStyle();
      } break;
    }
  });

  // #endregion Message
});
