

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

async function pingTST() {
  try {
    await browser.runtime.sendMessage(kTST_ID, { type: 'ping' });
  } catch (error) { return false; }
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

// #endregion Tree Style Tab


// #region Simulate docked window

let openSidebarWindows = [];
let simulateDockingIntervalId = null;
let simulateDockingInterval = 0;
let hasWindowsFocusListener = false;
let hasWindowRemovedListener = false;
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
    // Listen to window focus event:
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

    // Listen to window close event:
    if (
      shouldSimulate &&
      (
        settings.newWindow_besideCurrentWindow_simulateDocking_autoClose
      )
    ) {
      if (!hasWindowRemovedListener) {
        browser.windows.onRemoved.addListener(onWindowRemoved);
        hasWindowRemovedListener = true;
      }
    } else {
      if (hasWindowRemovedListener) {
        browser.windows.onRemoved.removeListener(onWindowRemoved);
        hasWindowRemovedListener = false;
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
async function onWindowRemoved(windowId) {
  if (openSidebarWindows.some(info => info.parentWindowId === windowId || info.windowId === windowId)) {
    // At least one docked sidebar window is affected:
    fastSimulatedDocking = true;
    simulateDockingBackground();  // Enable fast mode quickly.

    // If it was a sidebar window that was closed then the change will be cached on first tick and change applied on the second tick:
    await delay(100);
    simulateDocking();
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
          const parentWindow = await browser.windows.get(sidebarWindow.parentWindowId).catch(error => null);
          if (parentWindow) {
            if (parentWindow.state !== 'minimized') {
              await browser.windows.update(sidebarWindow.parentWindowId, { focused: true });
            } else if (settings.newWindow_besideCurrentWindow_simulateDocking_minimize) {
              await browser.windows.update(sidebarWindow.windowId, { state: 'minimized' });
            }
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
      if (info.forget) {
        return;
      }

      let sidebarWindows = [];
      let sidebarIndex = 0;
      if (
        settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight ||
        settings.newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState
      ) {
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
      if (info.forget) {
        return;
      }
      if (settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight && sidebarWindow) {
        info.window = sidebarWindow;
      }
      if (settings.newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState && parentWindow) {
        info.parentWindow = parentWindow;
      }

      // Auto close sidebar if parent window is closed:
      if (sidebarWindow && !parentWindow && settings.newWindow_besideCurrentWindow_simulateDocking_autoClose) {
        // Forget about this sidebar window:
        info.forget = true;

        sidebarWindow = await browser.windows.get(sidebarWindow.id, { populate: true }).catch(error => null);
        if (sidebarWindow && sidebarWindow.tabs.length <= 1) {
          // Should close the sidebar window:
          parentWindow = info.parentWindow;
          if (settings.newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState && sidebarIndex === 0 && parentWindow) {
            // Get open windows:
            let openWindows = settings.newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState_onlyLastWindow ?
              (await browser.windows.getAll().catch(error => (console.error('Failed to check if there was any open windows except for docked sidebar windows!\nError: ', error), []))) :
              [];
            // ...that are not sidebar windows:
            openWindows = openWindows.filter(window => window.id !== info.parentWindowId && !openSidebarWindows.some(info2 => info2.windowId === window.id));

            if (openWindows.length < 1) {
              // Should first set it to last parent size:
              await browser.windows.update(info.windowId, {
                top: parentWindow.top,
                left: parentWindow.left,
                width: parentWindow.width,
                height: parentWindow.height,
              });
              if (parentWindow.state !== sidebarWindow.state) {
                await browser.windows.update(info.windowId, { state: parentWindow.state });
              }

              // Wait for other sidebar windows with same parent window to be closed first:
              if (sidebarWindows.length > 1) {
                while (openSidebarWindows.some(info2 => info2.parentWindowId === info.parentWindowId && info2.windowId !== info.windowId)) {
                  await delay(0);
                }
              }
            }
          }
          parentWindow = null;

          await browser.windows.remove(sidebarWindow.id).catch(error => (console.error('Failed to auto close docked sidebar window\nError: ', error), null));
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
      if (settings.newWindow_besideCurrentWindow_simulateDocking_syncWidth && sidebarWindow.width !== settings.newWindow_width) {
        if (info.synced_Width === settings.newWindow_width) {
          browser.storage.local.set({ newWindow_width: sidebarWindow.width });
          settings.newWindow_width = sidebarWindow.width;
          info.synced_Width = sidebarWindow.width;
        } else {
          wantedPos.width = settings.newWindow_width;
          info.synced_Width = settings.newWindow_width;
        }
      }
      if (
        sidebarWindow.top !== wantedPos.top ||
        sidebarWindow.left !== wantedPos.left ||
        (wantedPos.height && sidebarWindow.height !== wantedPos.height) ||
        (wantedPos.width && sidebarWindow.width !== wantedPos.width)
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

// #endregion Simulate docked window


async function openTreeStyleTabSidebarInTab({ windowId = null, createNewWindow = false, openAfterCurrent = false, childOfCurrent = false, windowSettings = {}, delayBeforeWindowSeperationInMilliseconds = null } = {}) {
  if (!await pingTST()) {
    return false;
  }

  // #region Info

  const queryDetails = { active: true };
  if (windowId || windowId === 0) {
    queryDetails.windowId = windowId;
  } else {
    queryDetails.currentWindow = true;
  }
  let [activeTab,] = await browser.tabs.query(queryDetails);
  if (!activeTab) {
    return;
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
        popup_hidden = false,
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
        details.type = popup_hidden ? 'panel' : 'popup';
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
        const trackedSidebarInfo = { window: window, windowId: window.id, parentWindowId: activeTab.windowId };

        browser.windows.get(trackedSidebarInfo.parentWindowId)
          .then(window => (trackedSidebarInfo.parentWindow = window, true))
          .catch(error => (console.error('Failed to cache parentWindow for opened sidebar window\nError: ', error), false));

        openSidebarWindows.push(trackedSidebarInfo);
        fastSimulatedDocking = true;
        checkSimulateDocking();
        // Enable fast mode quickly:
        if (simulateDockingIntervalId !== null) {
          simulateDockingBackground();
        }

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
    if (delayBeforeWindowSeperationInMilliseconds && delayBeforeWindowSeperationInMilliseconds > 0) {
      trackedDelay(delayBeforeWindowSeperationInMilliseconds).then(() => moveToNewWindow());
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
    delayBeforeWindowSeperationInMilliseconds: settings.delayBeforeWindowSeperationInMilliseconds,
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
    if (
      changes.delayBeforeWindowSeperationInMilliseconds ||
      changes.newWindow_besideCurrentWindow_autoDetectAtStartup_delayBeforeWindowSeparation
    ) {
      clearTrackedDelays();
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

        const [
          allWindows,
          browserStartup,
          tstInternalId,
        ] = await Promise.all([
          browser.windows.getAll({ populate: true }),
          (async function () {
            const [
              installed,
              started
            ] = [
                new Promise((resolve, reject) => {
                  browser.runtime.onInstalled.addListener(({ previousVersion, reason, temporary }) => {
                    resolve(true);
                  });
                  delay(1000).then(() => resolve(false));
                }),
                new Promise((resolve, reject) => {
                  browser.runtime.onStartup.addListener(() => {
                    resolve(true);
                  });
                  delay(1000).then(() => resolve(false));
                }),
              ];

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
          getInternalTSTId({ openGroupTab: false }),
        ]);

        if (browserStartup) {
          // Wait for all windows to be created:
          await new Promise((resolve, reject) => {
            var started = false;
            try {
              var disableMonitorsAndResolve = () => {
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

              var timeoutId = undefined;
              var tabCount = 0;
              var checkTabCount = () => {
                timeoutId = setTimeout(async () => {
                  timeoutId = undefined;

                  if (started)
                    return;

                  let newTabCount = await browser.tabs.query({}).length;

                  if (newTabCount === tabCount) {
                    disableMonitorsAndResolve();
                  } else {
                    tabCount = newTabCount;
                    if (!started) {
                      checkTabCount();
                    }
                  }
                }, 1000);
              };
              checkTabCount();


              var tabActivated = (activeInfo) => {
                disableMonitorsAndResolve();
              };
              browser.tabs.onActivated.addListener(tabActivated);
            } catch (error) {
              console.error('Failed to wait for browser startup!\nError: ', error);
              resolve();
            }
          });
        }

        // #endregion Get Startup info


        // #region Find Sidebar Windows

        const windowsWithOneTab = allWindows.filter(window => window.tabs.length === 1);
        if (windowsWithOneTab.length > 0) {
          // Wait for TST to start:
          await new Promise((resolve, reject) => {
            try {
              let intervalId = null;
              let timeoutId = null;
              const done = () => {
                try {
                  if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                  }
                  if (intervalId !== null) {
                    clearInterval(intervalId);
                    intervalId = null;
                  }
                } finally {
                  resolve();
                }
              };
              timeoutId = setTimeout(() => (timeoutId = null, done()), 30000);
              intervalId = setInterval(() => pingTST().then((available) => { if (available) done(); }), 1000);
            } catch (error) {
              reject(error);
            }
          });
        }

        const windowsWithTSTInfo = await Promise.all(
          windowsWithOneTab.map(window =>
            getTabsFromTST(window.id, true)
              .catch(error => (console.error('Failed to get TST tabs for window with id ' + window.id + '!\nError: ', error), null))
              .then(tstTabs => ([window, tstTabs]))
          ));

        let sidebarURL = tstInternalId && windowsWithTSTInfo.length > 0 ? getSidebarURL(tstInternalId) : null;

        // Determine which windows are sidebar windows:
        const sidebarWindows = await (Promise.all(windowsWithTSTInfo.map(async ([window, tstTabs]) => {
          if (tstTabs) {
            if (!sidebarURL) {
              sidebarURL = getSidebarURL(await getInternalTSTId());
            }
            if (tstTabs.some(tab => tab.url !== sidebarURL)) {
              return false;
            }
          } else {
            if (window.type !== 'panel') {
              return false;
            }
          }
          // Assume this window is a sidebar window:
          return true;
        })).then(filter => windowsWithTSTInfo.filter((value, index) => filter[index])));


        const sidebarWindowIds = sidebarWindows.map(([window, tstTabs]) => window.id);
        const possibleParentWindows = allWindows.filter(window => window.type === 'normal' && !sidebarWindowIds.includes(window.id));

        // #endregion Find Sidebar Windows


        const newWindowOverrides = { createNewWindow: true };
        if (settings.newWindow_besideCurrentWindow_autoDetectAtStartup_delayBeforeWindowSeparation >= 0) {
          newWindowOverrides.delayBeforeWindowSeperationInMilliseconds = settings.newWindow_besideCurrentWindow_autoDetectAtStartup_delayBeforeWindowSeparation;
        }


        if (settings.newWindow_besideCurrentWindow_autoDetectAtStartup && sidebarWindows.length > 0) {
          if (sidebarWindows.length > 0 && possibleParentWindows.length === 0) {
            await browser.windows.create({});
          }


          await Promise.all(sidebarWindows.map(async ([window, tstTabs]) => {
            let parentX = window.left + window.width + settings.newWindow_besideCurrentWindow_spaceBetween;
            let parentY = window.top;

            let otherPossibleParents = possibleParentWindows
              .filter(parent => parent.id !== window.id && parent.incognito === window.incognito)
              // Distance to parent from expect position:
              .map(parent => ([parent, Math.abs(parent.left - parentX), Math.abs(parent.top - parentY)]))
              // Total distance:
              .map(([parent, x, y]) => [parent, x, y, Math.sqrt(x * x + y * y)])
              // Sort based on distance:
              .sort(([, distA], [, distB]) => distA - distB);

            let [[possibleParent, xDistToParent, yDistToParent, distToPossibleParent],] = otherPossibleParents;

            if (distToPossibleParent > 3) {
              otherPossibleParents = otherPossibleParents.sort(([winA, winAX, winAY, winAD], [winB, winBX, winBY, winBD]) => winAX - winBX);
              [[possibleParent, xDistToParent, yDistToParent, distToPossibleParent],] = otherPossibleParents;
            }


            if (xDistToParent > 10) {
              // No parent found:
              possibleParent = null;
            }

            if (!possibleParent) {
              if (browserStartup) {
                await browser.windows.remove(window.id);
              }
              return;
            }

            if (browserStartup) {
              // Need to close and reopen window since the page will have targeted the wrong window id:
              const closePromise = browser.windows.remove(window.id);
              openTreeStyleTabSidebarInTab(getDefaultMoveDetails(Object.assign({ windowId: possibleParent.id }, newWindowOverrides), { dockedWindow: true }));
              await closePromise;
            } else {
              // Need to track this window's id:
              if (openSidebarWindows.some(info => info.windowId === window.id)) {
                // Already tracked:
                return;
              }

              const trackedSidebarInfo = { window: window, windowId: window.id, parentWindowId: possibleParent.id, parentWindow: possibleParent };

              openSidebarWindows.push(trackedSidebarInfo);
              fastSimulatedDocking = true;
              checkSimulateDocking();
              // Enable fast mode quickly:
              if (simulateDockingIntervalId !== null) {
                simulateDockingBackground();
              }
            }
          }));
        }

        if (settings.newWindow_besideCurrentWindow_autoOpenAtStartup && browserStartup) {
          for (const window of possibleParentWindows) {
            if (openSidebarWindows.some(sidebar => sidebar.parentWindowId === window.id)) {
              // This window already has an open sidebar window:
              continue;
            }
            openTreeStyleTabSidebarInTab(getDefaultMoveDetails(Object.assign({ windowId: window.id }, newWindowOverrides), { dockedWindow: true }));
          }
        }

      } catch (error) {
        console.error('Failed to auto detect and (re)open sidebar windows at startup!\nError: ', error);
      }
    })();
  }

  // #endregion Handle Startup Events

});
