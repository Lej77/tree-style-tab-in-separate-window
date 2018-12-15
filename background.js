


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
        let { id, title, contexts, enabled = true, isDefault = false, isRootItem = false } = typeof contextMenuItem === 'string' ? { id: contextMenuItem } : contextMenuItem;
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
        if (typeof id === 'string' && id.startsWith('-')) {
          Object.assign(details, {
            id: getUniqueId(),
            type: 'separator',
          });
        } else {
          Object.assign(details, {
            id: (defaultValues.alwaysUniqueIds ? getUniqueId(id ? id + '-' : id) : (!id && id !== 0 ? getUniqueId() : id)) + '',
            title: title || browser.i18n.getMessage(`contextMenu_${id}`),
          });
        }
        if (isRootItem) {
          const rootItems = creationDetails.filter(item => item.contexts.every(c => details.contexts.includes(c)) && !item.parentId && item.id != details.id);
          console.log(rootItems);
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
      }
    };

    let allEnabled = true;
    const items = [
      { id: 'openSidebarInTab', enabled: () => allEnabled || settings.contextMenu_OpenSidebarInTab_ShowOnTabs, title: settings.contextMenu_OpenSidebarInTab_CustomLabel },
      { id: 'openSidebarInWindow', enabled: () => allEnabled || settings.contextMenu_OpenSidebarInWindow_ShowOnTabs, title: settings.contextMenu_OpenSidebarInWindow_CustomLabel },
      { id: '---------------------', enabled: () => allEnabled || settings.contextMenu_OpenSettings_ShowOnTabs, },
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


let windowMoveTimeoutIds = [];
async function openTreeStyleTabSidebarInTab({ createNewWindow = false, openAfterCurrent = false, childOfCurrent = false } = {}) {
  if (!await pingTST()) {
    return false;
  }

  // #region Info

  let [activeTab,] = await browser.tabs.query({ currentWindow: true, active: true });
  let openAfterActiveDetails = () => {
    let details = { windowId: activeTab.windowId, index: activeTab.index + 1 };
    if (!createNewWindow && openAfterCurrent && childOfCurrent) {
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
          createDetails = Object.assign(openAfterActiveDetails(), createDetails);
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
    let moveToNewWindow = async () => {
      await browser.windows.create({ incognito: activeTab.incognito, tabId: tab.id, });
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


function getDefaultMoveDetails(overrides = {}) {
  return Object.assign({
    openAfterCurrent: settings.openAfterCurrentTab,
    childOfCurrent: settings.openAsChildOfCurrentTab,
  }, overrides);
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


  // #region Context Menu

  updateContextMenu();
  browser.contextMenus.onClicked.addListener((info, tab) => {
    let itemId = info.menuItemId;
    let index = itemId.indexOf('-');
    if (index >= 0) {
      itemId = itemId.slice(0, index);
    }

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
    }
  });
  browser.browserAction.onClicked.addListener((tab) => {
    openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: settings.browserAction_OpenInNewWindow }));
  });

  // #endregion Context Menu


  // #region Keyboard Commands

  browser.commands.onCommand.addListener(function (command) {
    switch (command) {
      case 'open-tst-sidebar-in-tab': {
        openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: false }));
      } break;

      case 'open-tst-sidebar-in-window': {
        openTreeStyleTabSidebarInTab(getDefaultMoveDetails({ createNewWindow: true }));
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
