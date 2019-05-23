'use strict';

import {
  DisposableCollection,
} from '../common/disposables.js';

import {
  delay,
  boundDelay,
} from '../common/delays.js';

import {
  getInternalIdCacheChanged,
  setInternalIdCache,
} from '../tree-style-tab/internal-id.js';

import {
  SettingsTracker,
} from '../common/settings.js';



// #region Settings

function getDefaultSettings() {
  return {
    treeStyleTabInternalId: null,

    requestTreeStyleTabPermission_tabs: false,


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
    newWindow_popup_hidden: true,

    // Window as docked sidebar:
    newWindow_besideCurrentWindow: true,
    newWindow_besideCurrentWindow_spaceBetween: -13,

    // Auto detect/open docked sidebars at startup:
    newWindow_besideCurrentWindow_autoOpenAtStartup: false,
    newWindow_besideCurrentWindow_autoDetectAtStartup: false,
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

export const settingsTracker = new SettingsTracker({ defaultValues: getDefaultSettings });
export const settings = settingsTracker.settings;

// #endregion Settings



// #region Tracked Delays

const trackedDelays = new DisposableCollection();

export async function trackedDelay(timeInMilliseconds) {
  if (timeInMilliseconds < 0) {
    return;
  }
  if (timeInMilliseconds < 50) {
    await delay(timeInMilliseconds);
    return true;
  }
  return boundDelay(timeInMilliseconds, trackedDelays);
}

export function cancelAllTrackedDelays() {
  trackedDelays.stop();
}

// #endregion Tracked Delays



// #region Sync cached internal id for Tree Style Tab with settings

getInternalIdCacheChanged().addListener(({ newValue }) => {
  SettingsTracker.set({ treeStyleTabInternalId: newValue });
});
settingsTracker.onChange.addListener((changes) => {
  if (changes.treeStyleTabInternalId) {
    setInternalIdCache(settings.treeStyleTabInternalId);
  }
});

// #endregion Sync cached internal id for Tree Style Tab with settings
