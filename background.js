

async function pingTST() {
  try {
    await browser.runtime.sendMessage(kTST_ID, { type: 'ping' });
  } catch (error) { return false; }
  return true;
}


async function updateContextMenu() {
  try {
    await browser.contextMenus.removeAll();

    for (let contextMenuId of [
      'openSidebarInTab',
      'openSidebarInWindow',
      '---------------------',
      'openSettings',
    ]) {
      let details = {
        contexts: ['browser_action']
      };
      if (settings.tab_ContextMenu) {
        details = {
          contexts: ['browser_action', 'tab']
        };
      }
      
      if (contextMenuId.startsWith('-')) {
        Object.assign(details, {
          type: 'separator',
        });
      } else {
        Object.assign(details, {
          id: contextMenuId,
          title: browser.i18n.getMessage(`contextMenu_${contextMenuId}`),
        });
      }
      await browser.contextMenus.create(details);
    }
  } catch (error) {
    return false;
  }
  return true;
}


async function registerToTST() {
  try {
    await unregisterFromTST();  // Remove any style currently present.

    let registrationDetails = {
      type: 'register-self',
      name: browser.runtime.getManifest().name,
      listeningTypes: ['ready'],
    };


    // #region Style

    if (settings.fixSidebarStyle) {

      registrationDetails.style = `
/* Fix sidebar page in separate tab */
body {
  -moz-user-select: none;
}
.tab {
  box-sizing: border-box;
}
`;

    }

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

  let internalId = settings.treeStyleTabInternalId;
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

  if (!internalId) {

    // #region Search for open Group Tab

    let allWindows = await browser.windows.getAll();

    for (let window of allWindows) {
      if (internalId) {
        break;
      }
      try {
        let tstTabs = await getTabsFromTST(window.id, true);
        for (let tstTab of tstTabs) {
          if (tstTab.states.includes('group-tab')) {
            let groupURLInfo = getGroupTabInfo(tstTab.url);
            if (groupURLInfo) {
              internalId = groupURLInfo.internalId;
              break;
            }
          }
        }
      } catch (error) { }
    }

    // #endregion Search for open Group Tab


    // #region Open a new Group Tab

    if (!internalId) {
      let tempTab;
      try {
        tempTab = await browser.tabs.create(Object.assign(openAfterActiveDetails(), { active: false }));
        try {
          let groupTab = await browser.runtime.sendMessage(kTST_ID, {
            type: 'group-tabs',
            tabs: [tempTab.id]
          });
          let groupURLInfo = getGroupTabInfo(groupTab.url);
          if (groupURLInfo) {
            internalId = groupURLInfo.internalId;
          }
        } catch (error) { }
      } finally {
        if (tempTab) {
          await browser.tabs.remove(tempTab.id);
        }
      }
    }

    // #endregion Open a new Group Tab


    if (!internalId) {
      return null;
    }
    browser.storage.local.set({ treeStyleTabInternalId: internalId });
    settings.treeStyleTabInternalId = internalId;
  }

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
        let createDetails = { url: sidebarURL, active: !createNewWindow };

        if (createNewWindow || openAfterCurrent) {
          createDetails = Object.assign(openAfterActiveDetails(), createDetails);
        } else {
          createDetails = Object.assign({ windowId: activeTab.windowId }, createDetails);
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
    let moveToNewWindow = () => browser.windows.create({ incognito: activeTab.incognito, tabId: tab.id, });
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
    if (changes.tab_ContextMenu) {
      updateContextMenu();
    }
  };

  // #endregion Settings


  // #region Tree Stlye Tab

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

  // #endregion Tree Stlye Tab


  // #region Context Menu

  updateContextMenu();
  browser.contextMenus.onClicked.addListener((info, tab) => {

    switch (info.menuItemId) {
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

});
