
const kTST_ID = 'treestyletab@piro.sakura.ne.jp';


async function delay(timeInMilliseconds) {
  return await new Promise((resolve, reject) => timeInMilliseconds < 0 ? resolve() : setTimeout(resolve, timeInMilliseconds));
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


// #region Tree Style Tab

function getSidebarURL(internalId) {
  return 'moz-extension://' + internalId + '/sidebar/sidebar.html';
}

function getGroupTabURL(name = null, temporary = undefined, internalId = null) {
  let url = internalId ? 'moz-extension://' + internalId + '/resources/group-tab.html' : 'about:treestyletab-group';
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

  let info = {};

  if (internalId) {
    info.internalId = internalId;
  }

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
// #endregion Tree Style Tab


// #region Settings

function getDefaultSettings() {
  return {
    treeStyleTabInternalId: null,

    
    fixSidebarStyle: true,
    
    browserAction_OpenInNewWindow: true,

    openAfterCurrentTab: true,
    openAsChildOfCurrentTab: false,
    tab_ContextMenu: false,
    delayBeforeWindowSeperationInMilliseconds: 500,
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

