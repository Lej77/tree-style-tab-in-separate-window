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



// #region Constants

/** The key for session data stored in windows about a window's docking state. */
export const kWINDOW_DATA_KEY_DOCKING_INFO = 'docking-info';

/** Messages that can be sent to the background page via a Port connection. */
export const messageTypes = Object.freeze({
  /** Notify that a permission might have been granted or revoked. */
  permissionsChanged: 'permissionsChanged',
  /** Request that the background page requests a permission from the user. */
  requestPermission: 'requestPermission',
  handleFailedToGetInternalId: 'handle-failed-get-internal-id',
  getTstStyle: 'get-tst-style',
});

// #endregion Constants



// #region Settings

function getDefaultSettings() {
  return {
    /** Cache for Tree Style Tab's internal id. */
    treeStyleTabInternalId: null,

    /**
     * Use the newer sidebar URL that doesn't require knowing Tree Style Tab's internal id.
     *
     * Note that the newer URL isn't supported in Tree Style Tab v3.5.5 and earlier.
     */
    useModernSidebarUrl: true,
    requestTreeStyleTabPermission_tabs: false,

    /** The title of Tree Style Tab's sidebar page when opened as a tab (also affects the name of windows when it is the active/selected tab). */
    tstSidebarPageTitle: 'Tree Style Tab Sidebar',


    fixSidebarStyle: false,

    optionsPage_disableDarkTheme: false,


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
    useTemporaryTabWhenOpeningNewWindow: false,

    // Window state:
    /** Determines if the new sidebar window shouldn't have most of the UI items of a normal browser window such as a URL bar. */
    newWindow_popup: true,
    /** Enhances `newWindow_popup` to also attempt to hide the created window from other extensions. */
    newWindow_popup_hidden: true,

    // Window as docked sidebar:
    newWindow_besideCurrentWindow: true,
    newWindow_besideCurrentWindow_spaceBetween: -13,

    /** Open the window to the right of the main window instead of the left. */
    newWindow_besideCurrentWindow_rightOfWindow: false,

    // Position limits:
    newWindow_besideCurrentWindow_horizontalPosition_min_enabled: false,
    newWindow_besideCurrentWindow_horizontalPosition_min: -8,
    newWindow_besideCurrentWindow_horizontalPosition_max: -1,

    /** Set a title preface for the created window (leave empty to disable). */
    newWindow_besideCurrentWindow_titlePreface: '',

    // Auto detect/open docked sidebars at startup:
    newWindow_besideCurrentWindow_autoOpenAtStartup: false,
    newWindow_besideCurrentWindow_autoDetectAtStartup: false,
    newWindow_besideCurrentWindow_autoDetectAtStartup_SessionData: true,
    newWindow_besideCurrentWindow_autoDetectAtStartup_delayBeforeWindowSeparation: 2000,

    // Window sync update rate:
    /** Time time in milliseconds between each check of the docked windows' states. If a change is detected then switches to the fast interval for a while for smoother updates. */
    newWindow_besideCurrentWindow_simulateDocking_slowInterval: 1000,
    newWindow_besideCurrentWindow_simulateDocking_fastInterval: 25,

    /** Control the docked window's position. */
    newWindow_besideCurrentWindow_simulateDocking_controlPosition: true,

    // Sync state:
    newWindow_besideCurrentWindow_simulateDocking_minimize: true,
    newWindow_besideCurrentWindow_simulateDocking_autoClose: true,
    newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState: true,
    newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState_onlyLastWindow: true,

    // Sync size:
    /** Sync the width of docked sidebar windows with the `newWindow_width` setting. */
    newWindow_besideCurrentWindow_simulateDocking_syncWidth: true,
    /** Sync the height of a docked sidebar window with its parent window. */
    newWindow_besideCurrentWindow_simulateDocking_syncHeight: true,

    // Layout of multiple sidebar windows:
    newWindow_besideCurrentWindow_simulateDocking_tileHeight: false,
    newWindow_besideCurrentWindow_simulateDocking_tileHeight_heightMargin: -8,

    newWindow_besideCurrentWindow_simulateDocking_tileWidth: true,

    // Override focus:
    /** Auto switch focus to parent window every time a docked sidebar window gets focus, no matter the reason. */
    newWindow_besideCurrentWindow_simulateDocking_autoFocus: true,
    /** Refocus parent window after creating a new sidebar window. */
    newWindow_besideCurrentWindow_simulateDocking_refocusParent: true,

    // Window size:
    newWindow_width: -1,
    newWindow_height: -1,
  };
}

export const settingsTracker = new SettingsTracker({ defaultValues: getDefaultSettings });
export const settings = settingsTracker.settings;

// eslint-disable-next-line valid-jsdoc
/**
 * Load a specific setting as fast as possible.
 *
 * @template {keyof ReturnType<typeof getDefaultSettings>} K
 * @param {K} key The key of the setting that should be loaded.
 * @returns {Promise<(ReturnType<typeof getDefaultSettings>[K])>} The value for the loaded setting.
 */
export function quickLoadSetting(key) {
  // @ts-ignore
  return SettingsTracker.get(key, getDefaultSettings()[key]);
}

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
  settings.treeStyleTabInternalId = newValue;
  SettingsTracker.set({ treeStyleTabInternalId: newValue });
});
settingsTracker.onChange.addListener((changes) => {
  if (changes.treeStyleTabInternalId) {
    setInternalIdCache(settings.treeStyleTabInternalId);
  }
});
settingsTracker.start.then(() => {
  setInternalIdCache(settings.treeStyleTabInternalId);
});

// #endregion Sync cached internal id for Tree Style Tab with settings
