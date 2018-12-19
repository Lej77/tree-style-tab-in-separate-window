
const kTST_ID = 'treestyletab@piro.sakura.ne.jp';


// #region Utilities

async function delay(timeInMilliseconds) {
  return new Promise((resolve, reject) => timeInMilliseconds < 0 ? resolve() : setTimeout(resolve, timeInMilliseconds));
}

let customWaitTimeoutIds = [];
async function trackedDelay(timeInMilliseconds) {
  if (timeInMilliseconds < 500) {
    return delay(timeInMilliseconds);
  } else {
    let timeoutId = null;
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        let index = customWaitTimeoutIds.map(item => item.timeoutId).indexOf(timeoutId);
        if (index >= 0) {
          customWaitTimeoutIds.splice(index, 1);
        }
        resolve();
      }, timeInMilliseconds);
      customWaitTimeoutIds.push({ timeoutId, resolve });
    });
  }
}
function clearTrackedDelays() {
  for (let { timeoutId, resolve } of customWaitTimeoutIds) {
    clearTimeout(timeoutId);
    resolve();
  }
  customWaitTimeoutIds = [];
}

async function getPromiseWithResolve() {
  let aPromise;
  let aReject;
  let aResolve;
  await new Promise((resolve, reject) => {
    aPromise = new Promise((resolvePromise, rejectPromise) => {
      aResolve = resolvePromise;
      aReject = rejectPromise;
      resolve();
    });
  });
  return {
    promise: aPromise,

    resolve: aResolve,
    reject: aReject,
  };
}

let defineProperty = (obj, propertyName, get, set) => {
  let getSet = {};
  if (get) {
    getSet.get = get;
  }
  if (set) {
    getSet.set = set;
  }
  Object.defineProperty(obj, propertyName, getSet);
};

// #endregion Utilities


// #region Tree Style Tab

function getSidebarURL(internalId) {
  return 'moz-extension://' + internalId + '/sidebar/sidebar.html';
}

function getGroupTabURL({ name = null, temporary = undefined, internalId = null, urlArguments = null } = {}) {
  let url = internalId ? 'moz-extension://' + internalId + '/resources/group-tab.html' : 'about:treestyletab-group';
  if (urlArguments || urlArguments === '') {
    url += urlArguments;
    return url;
  }
  let firstArg = true;
  let prepareForArg = () => {
    url += firstArg ? '?' : '&';
    firstArg = false;
  };
  if (name && typeof name === 'string') {
    prepareForArg();
    url += 'title=' + encodeURIComponent(name);
  }
  if (temporary !== undefined) {
    prepareForArg();
    url += 'temporary=' + (temporary ? 'true' : 'false');
  }
  return url;
}

function getGroupTabInfo(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  let removeLength = (string, removeLength) => {
    return string.length <= removeLength ? '' : string.substr(removeLength);
  };

  let internalId = null;

  let legacyURI = 'about:treestyletab-group';
  if (url.startsWith(legacyURI)) {
    url = removeLength(url, legacyURI.length);
  } else {
    let start = 'moz-extension://';
    if (!url.startsWith(start)) {
      return null;
    }
    url = removeLength(url, start.length);

    let separatorIndex = url.indexOf('/');
    if (separatorIndex < 0) {
      return null;
    }
    internalId = url.substr(0, separatorIndex);
    url = removeLength(url, separatorIndex + 1);

    let location = 'resources/group-tab.html';
    if (!url.startsWith(location)) {
      return null;
    }
    url = removeLength(url, location.length);
  }

  let info = {
    internalId: internalId,
    urlArguments: url,
  };


  if (url.startsWith('?')) {
    url = removeLength(url, 1);

    let getInfo = (arg, id, key, handleValue) => {
      if (arg.startsWith(id)) {
        if (!Object.keys(info).includes(key)) {
          let value = removeLength(arg, id.length);
          if (handleValue && typeof handleValue === 'function') {
            value = handleValue(value);
          }
          info[key] = value;
        }
        return true;
      } else {
        return false;
      }
    };
    let tests = [
      (arg) => {
        return getInfo(arg, 'title=', 'name', (value) => {
          return decodeURIComponent(value);
        });
      },
      (arg) => {
        return getInfo(arg, 'temporary=', 'temporary', (value) => {
          value = value.toLowerCase().trim();
          return value === 'true';
        });
      },
    ];
    for (let arg of url.split('&')) {
      for (let test of tests) {
        if (test(arg)) {
          break;
        }
      }
    }
  }

  return Object.assign({
    name: 'Group',
    temporary: false,
  }, info);
}

async function getTabsFromTST(windowId, flatArray = false) {
  // Flat array: each tab is in the original array. If the array isn't flat then only root tabs occur in the array and the other tabs are only accessible through the tabs children property.
  let message = {
    type: 'get-tree',
    window: windowId,
  };
  if (flatArray) {
    message.tabs = '*';
  }
  return await browser.runtime.sendMessage(kTST_ID, message);
}


let gInternalTSTCaching = null;
/**
 * Use Group tabs to get Tree Style Tab's internal id.
 * 
 * @param {boolean} [allowCached=true] Get id from cache if available.
 * @param {boolean} [searchOpenTabs=true] If id is not cached then search open tabs for a TST tab that contains the internal id in its URL.
 * @param {boolean} [openGroupTab=true] If id is not cached then open a TST group tab that contains the internal id in its URL.
 * @returns {string} Tree Style Tab's internal id.
 */
async function getInternalTSTId({ allowCached = true, searchOpenTabs = true, openGroupTab = true } = {}) {
  while (gInternalTSTCaching) {
    let waiting = gInternalTSTCaching;
    await waiting;
    if (waiting === gInternalTSTCaching) {
      gInternalTSTCaching = null;
    }
  }

  if (allowCached && settings && settings.treeStyleTabInternalId) {
    return settings.treeStyleTabInternalId;
  }

  gInternalTSTCaching = (async () => {

    let internalId;

    // #region Search for open Group Tab

    if (searchOpenTabs) {
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
    }

    // #endregion Search for open Group Tab


    // #region Open a new Group Tab

    if (openGroupTab && !internalId) {
      let tempTab;
      try {
        tempTab = await browser.tabs.create({ active: false });
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
    if (settings) {
      settings.treeStyleTabInternalId = internalId;
    }

    return internalId;
  })();

  return gInternalTSTCaching;
}

// #endregion Tree Style Tab


// #region Settings

function getDefaultSettings() {
  return {
    treeStyleTabInternalId: null,


    fixSidebarStyle: true,


    // Context Menu:
    contextMenu_Root_CustomLabel: '',
    contextMenu_ShowOnTabs: false,

    contextMenu_OpenSidebarInTab_ShowOnTabs: true,
    contextMenu_OpenSidebarInTab_CustomLabel: '',

    contextMenu_OpenSidebarInWindow_ShowOnTabs: true,
    contextMenu_OpenSidebarInWindow_CustomLabel: '',

    contextMenu_OpenSidebarInDockedWindow_ShowOnTabs: true,
    contextMenu_OpenSidebarInDockedWindow_CustomLabel: '',

    contextMenu_OpenSettings_ShowOnTabs: true,
    contextMenu_OpenSettings_CustomLabel: '',


    // Browser action:
    browserAction_OpenInNewWindow: true,
    browserAction_OpenInNewWindow_Docked: true,


    pinTabsBeforeMove: true,
    pinTabsBeforeMove_OnlyAfterCurrent: true,
    openAfterCurrentTab: true,
    openAsChildOfCurrentTab: false,
    delayBeforeWindowSeperationInMilliseconds: 500,



    // Window state:
    newWindow_popup: true,

    // Window as docked sidebar:
    newWindow_besideCurrentWindow: true,
    newWindow_besideCurrentWindow_spaceBetween: -13,

    // Auto detect docked sidebars:
    newWindow_besideCurrentWindow_autoDetectAtStartup: true,
    newWindow_besideCurrentWindow_autoDetectAtStartup_delayBeforeWindowSeparation: 2000,

    // Window sync update rate:
    newWindow_besideCurrentWindow_simulateDocking_slowInterval: 1000,
    newWindow_besideCurrentWindow_simulateDocking_fastInterval: 25,

    // Sync state:
    newWindow_besideCurrentWindow_simulateDocking_minimize: true,
    newWindow_besideCurrentWindow_simulateDocking_autoClose: true,
    newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState: true,
    newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState_onlyLastWindow: true,

    // Sync size:
    newWindow_besideCurrentWindow_simulateDocking_syncWidth: true,
    newWindow_besideCurrentWindow_simulateDocking_syncHeight: true,

    // Layout of multiple sidebar windows:
    newWindow_besideCurrentWindow_simulateDocking_tileHeight: true,
    newWindow_besideCurrentWindow_simulateDocking_tileHeight_heightMargin: -8,

    // Override focus:
    newWindow_besideCurrentWindow_simulateDocking_autoFocus: true,
    newWindow_besideCurrentWindow_simulateDocking_refocusParent: true,

    // Window size:
    newWindow_width: -1,
    newWindow_height: -1,
  };
}


var settings = getDefaultSettings();
let changed = {};
function applySettingChanges(target, changes, fallbackToDefault = true) {
  let defaultSettings;
  let defaultSettingsKeys;

  for (let key of Object.keys(changes)) {
    if (Object.keys(changes[key]).includes('newValue')) {
      target[key] = changes[key].newValue;
    } else {
      if (fallbackToDefault && !defaultSettings) {
        defaultSettings = getDefaultSettings();
        defaultSettingsKeys = Object.keys(defaultSettings);
      }
      if (fallbackToDefault && defaultSettingsKeys.includes(key)) {
        target[key] = defaultSettings[key];
      } else {
        delete target[key];
      }
    }
  }
}
var handleSettingChanges;
browser.storage.onChanged.addListener((changes, areaName) => {
  applySettingChanges(settings, changes);
  if (changed) {
    applySettingChanges(changed, changes);
  }
  if (handleSettingChanges) {
    handleSettingChanges(changes, areaName);
  }
});
let settingsLoaded = browser.storage.local.get(null).then((value) => {
  let changedKeys = Object.keys(changed);
  for (let key of Object.keys(value)) {
    if (!changedKeys.includes(key)) {
      settings[key] = value[key];
    }
  }
  changed = null;
});

// #endregion Settings
