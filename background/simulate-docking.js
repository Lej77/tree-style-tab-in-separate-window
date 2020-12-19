'use strict';

import {
    settings,
    kWINDOW_DATA_KEY_DOCKING_INFO,
} from '../common/common.js';

import {
    delay,
} from '../common/delays.js';

import {
    getTabsFromTST,
    pingTST,
} from '../tree-style-tab/utilities.js';

import {
    getSidebarTabInfo,
} from '../tree-style-tab/sidebar-tab.js';

import {
    EventManager,
    EventListener,
} from '../common/events.js';

import {
    DisposableCollection,
} from '../common/disposables.js';


/**
 * @typedef {import('../common/utilities.js').BrowserWindow} BrowserWindow
 */
null;
/**
 * @typedef { import('../tree-style-tab/utilities.js').TSTTab } TSTTab
 */
null;


// #region Session Data

/**
 * @typedef {Object} DockingInfoInWindowSessionData Docking information that is stored in a window's session data via `browser.sessions.setWindowValue`.
 * @property {string} Info.id A unique id for this window.
 * @property {string} [Info.parentId] The id of the parent window that this window is docked to.
 */


function makeId() {
    const length = 15;

    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

/**
 * Get docking info that is stored in a window's session data.
 *
 * @param {number} windowId The id of the window.
 * @returns {Promise<DockingInfoInWindowSessionData>} The session data.
 */
async function getWindowDockingInfoSessionData(windowId) {
    if (!browser.sessions) {
        return null;
    }
    try {
        return await browser.sessions.getWindowValue(windowId, kWINDOW_DATA_KEY_DOCKING_INFO);
    } catch (error) {
        console.error('Failed to get session data for window.\nWindowId: ', windowId, '\nError: ', error);
        return null;
    }
}
/**
 * Store docking info in a window's session data.
 *
 * @param {number} windowId The id of the window.
 * @param {DockingInfoInWindowSessionData} info The docking info to store.
 */
async function setWindowDockingInfoSessionData(windowId, info) {
    if (!browser.sessions) {
        return;
    }
    try {
        await browser.sessions.setWindowValue(windowId, kWINDOW_DATA_KEY_DOCKING_INFO, info);
    } catch (error) {
        console.error('Failed to set session data for window.\nWindowId: ', windowId, '\nError: ', error);
    }
}

class SessionDataMonitor {
    constructor() {
        /** @type {BrowserWindow[]} */
        this._windows = [];
        /** @type {WeakMap<BrowserWindow, { currentData: DockingInfoInWindowSessionData, currentOp: Promise<any>, uniqueId: string, parentId: string }>} */
        this._extraData = new WeakMap();

        this._disposables = new DisposableCollection([
            new EventListener(browser.windows.onCreated, (window) => {
                this._handleNewWindow(window);
            }),
            new EventListener(browser.windows.onRemoved, (windowId) => {
                for (let iii = 0; iii < this._windows.length; iii++) {
                    if (this._windows[iii].id === windowId) {
                        this._windows.splice(iii, 1);
                        iii--;
                    }
                }
            }),
        ]);

        this._isDisposed = false;
        this._onDisposed = new EventManager();

        this.start = this._start();
    }

    async _start() {
        /** @type {BrowserWindow[]} */
        const allWindows = await browser.windows.getAll({ populate: false });

        if (this.isDisposed) return;

        for (const window of allWindows) {
            if (this._windows.some(w => w.id === window.id)) {
                // Already tracked.
                continue;
            }
            this._handleNewWindow(window);
        }
    }

    /**
     * Start tracking a new window.
     *
     * @param {BrowserWindow} window A window object.
     * @memberof SessionDataMonitor
     */
    _handleNewWindow(window) {
        this._windows.push(window);

        const extraData = {
            currentData: null,
            currentOp: null,
            uniqueId: null,
            parentId: null,
        };
        this._extraData.set(window, extraData);

        extraData.currentOp = (async () => {
            if (this.isDisposed) return;
            const currentSessionData = await getWindowDockingInfoSessionData(window.id);
            extraData.currentData = currentSessionData;

            let uniqueId;
            if (currentSessionData) {
                uniqueId = currentSessionData.id;
            } else {
                uniqueId = makeId();
            }
            extraData.uniqueId = uniqueId;
            if (!currentSessionData) {
                if (this.isDisposed) return;
                const data = {
                    id: uniqueId,
                };
                await setWindowDockingInfoSessionData(window.id, data);
                extraData.currentData = data;
            }
        })();
    }

    /**
     * Set a window's parent window.
     *
     * @param {number} windowId The id of the docked sidebar window.
     * @param {number} parentId The id of the parent window or `null` if the window is no longer docked.
     * @memberof SessionDataMonitor
     */
    async setWindowParent(windowId, parentId) {
        await this.start;
        if (this.isDisposed) return;

        // Wait to ensure that the windows' creation events have triggered. This should hopefully avoid race conditions.
        await delay(1);
        if (this.isDisposed) return;

        const window = this._windows.find(window => window.id === windowId);
        if (!window) {
            console.warn('Window wasn\'t tracked in session data monitor. WindowId: ', windowId);
            return;
        }
        const extraData = this._extraData.get(window);

        const parentWindow = this._windows.find(window => window.id === parentId);
        if (!parentWindow) {
            console.warn('Parent window wasn\'t tracked in session data monitor. WindowId: ', parentId);
            return;
        }
        const parentExtraData = this._extraData.get(parentWindow);

        const previousOp = extraData.currentOp;
        const nextOp = (async () => {
            await previousOp;
            if (this.isDisposed) return;

            if (!parentExtraData.uniqueId) {
                await parentExtraData.currentOp;
                if (this.isDisposed) return;
            }
            if (!parentExtraData.uniqueId) {
                console.warn('Failed to get session data for parent window.');
                return;
            }
            if (extraData.currentData.parentId === parentExtraData.uniqueId) {
                // This parent is already set.
                return;
            }
            const data = Object.assign({}, extraData.currentData, { parentId: parentExtraData.uniqueId });

            if (this.isDisposed) return;
            await setWindowDockingInfoSessionData(window.id, data);
            extraData.currentData = data;
        })();
        extraData.currentOp = nextOp;
        await nextOp;
    }

    async forceSetAllWindowData() {
        await Promise.all(this._windows.map(async (window) => {
            const extraData = this._extraData.get(window);

            const previousOp = extraData.currentOp;
            const nextOp = (async () => {
                await previousOp;
                if (this.isDisposed) return;
                await setWindowDockingInfoSessionData(window.id, extraData.currentData);
            })();
            extraData.currentOp = nextOp;

            await nextOp;
        }));
    }

    dispose() {
        if (this._isDisposed) return;

        this._disposables.dispose();

        this._isDisposed = true;
        this._onDisposed.fire();
    }
    get isDisposed() {
        return this._isDisposed;
    }
    get onDisposed() {
        return this._onDisposed.subscriber;
    }
}

export let isStoringSessionData = false;
/** @type { SessionDataMonitor } */
let sessionDataMonitor = null;

export function setIsStoringSessionData(value) {
    value = Boolean(value);
    if (value === isStoringSessionData) return;

    isStoringSessionData = value;
    if (value) {
        sessionDataMonitor = new SessionDataMonitor();
        for (const trackedSidebar of openSidebarWindows) {
            sessionDataMonitor.setWindowParent(trackedSidebar.windowId, trackedSidebar.parentWindowId);
        }
    } else {
        sessionDataMonitor.dispose();
        sessionDataMonitor = null;
    }
}

export function forceSetAllSessionData() {
    if (sessionDataMonitor) {
        sessionDataMonitor.forceSetAllWindowData();
    }
}

// #endregion Session Data


// #region Active Tracking

/**
 * Info about a docked window that mirrors the movement of a parent window.
 *
 * @typedef {Object} TrackedWindowInfo
 * @property {BrowserWindow} Info.window A WebExtension `windows.Window` object for the docked window.
 * @property {number} Info.windowId The window id for the docked window.
 * @property {BrowserWindow} [Info.parentWindow] A WebExtension `windows.Window` object for the parent window of the docked window.
 * @property {number} Info.parentWindowId The window id for the parent window of the docked window.
 * @property {boolean} [Info.forget] If `true` this indicates that the window is auto closing and shouldn't be tracked anymore.
 * @property {number} [Info.synced_Width] The last "target" width that was seen in the extension's settings. This is used to determine if the settings should be changed or if a window's width should be changed.
 */
null;


/**@type { TrackedWindowInfo[] } Info about opened windows that are used as Tree Style Tab sidebars. */
let openSidebarWindows = [];
let simulateDockingIntervalId = null;
let simulateDockingInterval = 0;
let hasWindowsFocusListener = false;
let hasWindowRemovedListener = false;
let fastSimulatedDocking = false;
let fastSimulatedDocking_TimeoutId = null;

/**
 * Track a window and ensure it stays docked to its parent window.
 *
 * @export
 * @param {TrackedWindowInfo} trackedSidebarInfo Info about the tracked window.
 */
export function addTrackedWindow(trackedSidebarInfo) {
    openSidebarWindows.push(trackedSidebarInfo);
    fastSimulatedDocking = true;
    checkSimulateDocking();
    // Enable fast mode quickly:
    if (simulateDockingIntervalId !== null) {
        simulateDockingBackground();
    }

    if (sessionDataMonitor) {
        sessionDataMonitor.setWindowParent(trackedSidebarInfo.windowId, trackedSidebarInfo.parentWindowId);
    }
}

/**
 * Check if a window is docked to a parent window.
 *
 * @export
 * @param {number} windowId Id for the window that might be docked.
 * @returns {boolean} True if the window is docked to some parent window.
 */
export function isDockedWindow(windowId) {
    return openSidebarWindows.some(info => info.windowId === windowId);
}

/**
 * Check if a window has docked child windows.
 *
 * @export
 * @param {number} windowId Id for the window that might have docked child windows.
 * @returns {boolean} True if there are any windows that is docked to the checked window.
 */
export function isParentWindow(windowId) {
    return openSidebarWindows.some(info => info.parentWindowId === windowId);
}

/**
 * Get an array with info about each tracked window.
 *
 * @export
 * @returns {TrackedWindowInfo[]} Info about each tracked window.
 */
export function getTrackedWindows() {
    return openSidebarWindows.slice();
}


export async function checkSimulateDocking({ reset = false, checkCachedWindowIds = true, checkListeners = true } = {}) {

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
                focus_lastFocusedWindowId = null;
                focus_timeWhenFocusWasLost = 0;

                browser.windows.getLastFocused().then(focusedWindow => {
                    if (!focusedWindow.focused) return; // Not currently focused.
                    if (focus_lastFocusedWindowId === null) {
                        focus_lastFocusedWindowId = focusedWindow.id;
                    }
                }).catch(error => console.error('Failed to get last focused window: ', error));

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

let focus_changingFocus = false;
/**
 * Suppress focus events for the duration of a (possibly async) callback.
 *
 * @template T
 * @param {function(): T | Promise<T>} callback An operation to do while suppressing focus events.
 * @returns {Promise<T>} The value returned from the callback.
 */
async function suppressFocusEvents(callback) {
    if (focus_changingFocus) {
        return await callback();
    }

    focus_changingFocus = true;
    try {
        return await callback();
    } finally {
        focus_changingFocus = false;
    }
}

/**
 * Ensure that the docked sidebar windows of a parent window can be seen and then re-focus the parent window.
 *
 * @param {number} parentWindowId The id of the parent window whose sidebar windows should be brought to the top.
 */
async function bringSidebarWindowsToTopAndFocusParent(parentWindowId) {
    const windowIdsToFocus = openSidebarWindows.filter(info => info.parentWindowId === parentWindowId).map(info => info.windowId);
    if (windowIdsToFocus.length > 0) {
        await suppressFocusEvents(async () => {
            // The window has docked sidebar windows.
            windowIdsToFocus.push(parentWindowId);

            // Focus all sidebar windows and then re-focus the parent window:
            await Promise.all(windowIdsToFocus.map(windowId => browser.windows.update(windowId, { focused: true }).catch(error => null)));
        });
    }
}

let focus_lastFocusedWindowId = null;
let focus_timeWhenFocusWasLost = 0;

async function onWindowFocusChanged(windowId) {
    const timeWhenLastWindowHadFocus = focus_timeWhenFocusWasLost;
    focus_timeWhenFocusWasLost = Date.now();
    if (windowId === browser.windows.WINDOW_ID_NONE) {
        return;
    }

    const previouslyFocusedWindowId = focus_lastFocusedWindowId;
    focus_lastFocusedWindowId = windowId;
    if (focus_changingFocus) {
        return;
    }

    try {
        /** @type { Partial<TrackedWindowInfo>[] } */
        const dockedSidebar = settings.newWindow_besideCurrentWindow_simulateDocking_autoFocus ? openSidebarWindows.filter(info => info.parentWindowId === windowId) : [];
        await suppressFocusEvents(async () => {
            if (dockedSidebar.length === 0) {
                // This window doesn't have any docked sidebar windows.
                if (settings.newWindow_besideCurrentWindow_simulateDocking_refocusParent) {
                    // See if focused window was itself a docked sidebar and in that case focus its parent window:
                    const sidebarInfo = openSidebarWindows.find(info => info.windowId === windowId);
                    if (sidebarInfo) {
                        /** @type {BrowserWindow} */
                        const parentWindow = await browser.windows.get(sidebarInfo.parentWindowId).catch(error => null);

                        if (parentWindow) {
                            if (parentWindow.state !== 'minimized') {
                                const timeSinceLastWindowLostFocus = Date.now() - timeWhenLastWindowHadFocus;
                                const parentWindowJustHadFocus = (previouslyFocusedWindowId === sidebarInfo.parentWindowId) && (timeSinceLastWindowLostFocus < 150);
                                const parentsSidebars = openSidebarWindows.filter(info => info.parentWindowId === sidebarInfo.parentWindowId);

                                if (
                                    // Never be smart about focus, only focus parent.
                                    (!settings.newWindow_besideCurrentWindow_simulateDocking_autoFocus) ||
                                    // The parent was just focused.
                                    parentWindowJustHadFocus ||
                                    // The currently focused window is the only docked window.
                                    parentsSidebars.length <= 1
                                ) {
                                    // We don't need to care about bringing other docked windows to the top.
                                    await browser.windows.update(sidebarInfo.parentWindowId, { focused: true });
                                } else {
                                    // The user likely clicked on a sidebar window for a parent window that hasn't had focus in a while. Ensure all docked sidebar windows for that parent window is visible.
                                    await bringSidebarWindowsToTopAndFocusParent(sidebarInfo.parentWindowId);
                                }
                            } else if (settings.newWindow_besideCurrentWindow_simulateDocking_minimize) {
                                // Parent window was probably just minimized and this window happened to be focused. Just minimize this window too.
                                // This also means that the parent window must be un-minimized for the docked windows to stop being minimized.
                                await browser.windows.update(sidebarInfo.windowId, { state: 'minimized' });
                            }
                        }
                    }
                }
            } else {
                await bringSidebarWindowsToTopAndFocusParent(windowId);
            }
        });
    } catch (error) {
        // Can happen if the window that should be focused was closed.
        console.error('Failed to change window focus!\n Window Focused: ', windowId, '\nError: ', error);
    }
}
function simulateDocking() {
    if (openSidebarWindows.length === 0) {
        // Disable all listeners since there is nothing to check:
        checkSimulateDocking();
        return;
    }

    /** Key: windowId. Value: number of docked sidebar window's (so far). */
    const count = {};
    return openSidebarWindows.map(async function (info, index, array) {
        try {
            if (info.forget) {
                return;
            }

            const tilingWindows = settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight || settings.newWindow_besideCurrentWindow_simulateDocking_tileWidth;

            /** @type {TrackedWindowInfo[]} All docked sidebar windows that have the same parent window as the current sidebar window (including itself). */
            let sidebarWindows = [];
            /** The index (ordering) of this sidebar window if there are multiple sidebar windows for the parent window. */
            let sidebarIndex = 0;

            // Find all other sidebar window with the same parent window:
            if (
                tilingWindows ||
                settings.newWindow_besideCurrentWindow_simulateDocking_restoreLastSidebarToParentState
            ) {
                sidebarIndex = count[info.parentWindowId] || 0;
                count[info.parentWindowId] = sidebarIndex + 1;
                sidebarWindows = array.filter(info2 => info2.parentWindowId === info.parentWindowId);
            }

            let [sidebarWindow, parentWindow] = await Promise.all(
                [info.windowId, info.parentWindowId]
                    .map(id =>
                        (/** @type {BrowserWindow} */ (browser.windows.get(id, { populate: false }).catch(error => null)))
                    )
            );
            if (info.forget) {
                return;
            }
            // Update window info (used later to calculate tiled window layout):
            if (tilingWindows && sidebarWindow) {
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


            // Might have disabled position control:
            if (!settings.newWindow_besideCurrentWindow_simulateDocking_controlPosition) return;


            let x = settings.newWindow_besideCurrentWindow_rightOfWindow ?
                parentWindow.left + parentWindow.width + (+settings.newWindow_besideCurrentWindow_spaceBetween) :
                parentWindow.left - sidebarWindow.width - (+settings.newWindow_besideCurrentWindow_spaceBetween);

            /** @type {number | null} The height used when tiling sidebar windows bellow each other. All windows will have the same height. */
            let tilingHeight = null;
            let height = sidebarWindow.height;
            if (settings.newWindow_besideCurrentWindow_simulateDocking_syncHeight) {
                if (settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight) {
                    tilingHeight = Math.round(parentWindow.height / sidebarWindows.length);
                    height = tilingHeight;
                    if ((sidebarIndex + 1) < sidebarWindows.length) {
                        // Not the last tiled window, so add some margin at the bottom.
                        height -= settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight_heightMargin;
                    }
                } else {
                    height = parentWindow.height;
                }
            }

            let y = parentWindow.top;
            if (sidebarIndex !== 0) {
                if (settings.newWindow_besideCurrentWindow_simulateDocking_tileHeight) {
                    if (tilingHeight !== null) {
                        // All window's will have the same height so just use that height for the y position calculation.
                        y += tilingHeight * sidebarIndex;
                    } else {
                        // Add up the height of all the windows above this one so that it will be placed right under the previous one.
                        for (let iii = 0; iii < sidebarIndex && iii < sidebarWindows.length; iii++) {
                            y += sidebarWindows[iii].window.height;
                        }
                    }
                } else if (settings.newWindow_besideCurrentWindow_simulateDocking_tileWidth) {
                    let tilingOffset = 0;
                    if (settings.newWindow_besideCurrentWindow_simulateDocking_syncWidth) {
                        // All window's will have the same width so just use that width for the x position calculation.
                        tilingOffset += (settings.newWindow_width + settings.newWindow_besideCurrentWindow_spaceBetween) * sidebarIndex;
                    } else {
                        // Add up the width of all the windows before this one so that it will be placed to the left of them all.
                        for (let iii = 0; iii < sidebarIndex && iii < sidebarWindows.length; iii++) {
                            tilingOffset += sidebarWindows[iii].window.width + settings.newWindow_besideCurrentWindow_spaceBetween;
                        }
                    }
                    if (settings.newWindow_besideCurrentWindow_rightOfWindow) {
                        // Move window more to the right:
                        x += tilingOffset;
                    } else {
                        // Move window more to the left:
                        x -= tilingOffset;
                    }
                }
            }


            const wantedPos = { top: y, left: x };
            if (sidebarWindow.height !== height) {
                wantedPos.height = height;
            }

            // Sync window's width with settings:
            if (settings.newWindow_besideCurrentWindow_simulateDocking_syncWidth && sidebarWindow.width !== settings.newWindow_width) {
                if (info.synced_Width === settings.newWindow_width) {
                    // The settings were the same last time this window's width was synced => the window's width has changed => update settings with new width:
                    browser.storage.local.set({ newWindow_width: sidebarWindow.width });
                    settings.newWindow_width = sidebarWindow.width;
                    info.synced_Width = sidebarWindow.width;
                } else {
                    wantedPos.width = settings.newWindow_width;
                    info.synced_Width = settings.newWindow_width;
                }
            }

            if (wantedPos.width < 0) {
                delete wantedPos.width;
            }
            if (wantedPos.height < 0) {
                delete wantedPos.height;
            }

            /** The minimum value for the window's x position. `0` does not
             * necessarily mean the left edge of the screen but it should be
             * close. */
            let minX;
            if (settings.newWindow_besideCurrentWindow_horizontalPosition_min_enabled) {
                minX = Number(settings.newWindow_besideCurrentWindow_horizontalPosition_min);
            } else {
                // Use half of window width, so only half the window can be outside the screen:
                minX = Math.round((wantedPos.width || sidebarWindow.width || 0) / 2) * -1;
            }
            if (wantedPos.left < minX) {
                wantedPos.left = minX;
            }

            if (settings.newWindow_besideCurrentWindow_horizontalPosition_max >= 0) {
                const maxX = settings.newWindow_besideCurrentWindow_horizontalPosition_max - (wantedPos.width || sidebarWindow.width);
                if (wantedPos.left > maxX) {
                    wantedPos.left = maxX;
                }
            }

            // Update window's position:
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
    const wasFast = fastSimulatedDocking;
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

// #endregion Active Tracking


/**
 * Try to find window's that are actually docked sidebar windows.
 *
 * @export
 * @param {Object} Info Configure how windows are found.
 * @param {BrowserWindow[]} [Info.allWindows] An array with all open windows. These windows should be populated so that they contain the `tabs` property.
 * @param {number} [Info.waitForTstTimeoutInMilliseconds] The maximum time in milliseconds to wait for Tree Style Tab to start.
 * @param {number} Info.xSpaceBetweenWindows The horizontal distance between a docked sidebar window and its parent window.
 */
export async function findSidebarWindows({ allWindows, waitForTstTimeoutInMilliseconds = 30000, xSpaceBetweenWindows = 0 }) {
    if (!allWindows) {
        allWindows = browser.windows.getAll({ populate: true });
    }


    // #region Wait for TST to start

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
            timeoutId = setTimeout(() => (timeoutId = null, done()), waitForTstTimeoutInMilliseconds);
            intervalId = setInterval(() => pingTST().then((available) => { if (available) { done(); } }), 1000);
        } catch (error) {
            reject(error);
        }
    });

    // #endregion Wait for TST to start


    const windowsWithOneTab = allWindows.filter(window => window.tabs.length === 1);


    // #region Determine Sidebar Windows via Session data

    /** @type { { window: BrowserWindow, parentWindow: BrowserWindow }[] } */
    const sidebarsFoundViaSessionData = [];
    try {
        if (browser.sessions) {
            const sessionData = await Promise.all(
                allWindows.map(window =>
                    (/** @type {Promise<any>} */ (browser.sessions.getWindowValue(window.id, kWINDOW_DATA_KEY_DOCKING_INFO)))
                        .catch(error => (console.error('Failed to get session data for window.\nWindow: ', window, '\nError: ', error), null))
                        .then(data => ({ window, data: /** @type {DockingInfoInWindowSessionData} */ (data) }))
                )
            );
            for (const { window, data } of sessionData) {
                if (!data) {
                    // Window had no session data.
                    continue;
                }

                // Ignore this window when using simpler methods to find docked sidebar windows:
                for (let iii = 0; iii < windowsWithOneTab.length; iii++) {
                    if (windowsWithOneTab[iii] === window) {
                        windowsWithOneTab.splice(iii, 1);
                        iii--;
                    }
                }

                if (window.tabs.length > 1) {
                    // Do not consider windows with more than 1 tab as sidebar windows since they might be auto closed or other destructive things.
                    continue;
                }

                if (data.parentId) {
                    // This is a sidebar window:
                    const info = {
                        window,
                        parentWindow: null,
                    };
                    sidebarsFoundViaSessionData.push(info);

                    // Try to find its parent window:
                    for (const parentData of sessionData) {
                        if (parentData.data && parentData.data.id === data.parentId) {
                            // Found the parent window!
                            info.parentWindow = parentData.window;
                            break;
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Failed to use data in session storage to determine docking states of windows.\nError: ', error);
    }

    // #endregion Determine Sidebar Windows via Session data


    // #region Find Sidebar Windows

    const windowsWithTSTInfo = await Promise.all(
        windowsWithOneTab.map(window =>
            getTabsFromTST(window.id, true)
                .catch(error => (console.error('Failed to get TST tabs for window with id ' + window.id + '!\nError: ', error), null))
                .then(tstTabs => ({ window, tstTabs: /** @type {TSTTab[] | null} */ (tstTabs) }))
        ));

    // Determine which windows are sidebar windows:
    const sidebarWindows = await (Promise.all(windowsWithTSTInfo.map(async ({ window, tstTabs }) => {
        if (tstTabs) {
            const tabIsSidebarPage = await Promise.all(tstTabs.map(async (tab) => {
                if (!('url' in tab)) {
                    try {
                        // Doesn't have the "tabs" permission in Tree Style Tab's option page.
                        const firefoxTab = await browser.tabs.get(tab.id);
                        // Updated tab info:
                        Object.assign(tab, firefoxTab);
                    } catch (error) {
                        console.error('Failed to get tab from Firefox.\nTabId: ', tab.id, '\nError:\n', error);
                    }
                }
                if (!('url' in tab)) {
                    return false;
                }

                const sidebarUrlInfo = getSidebarTabInfo(tab.url);
                return Boolean(sidebarUrlInfo);
            }));
            if (tabIsSidebarPage.some(isSidebarPage => !isSidebarPage)) {
                // This window had a tab that didn't have the sidebar URL.
                return false;
            }
        } else {
            // Tree Style Tab couldn't provide tabs for this window. If the window type is `panel` the window should only be visible to the extension that created it so in that case it might be a sidebar window:
            if (window.type !== 'panel') {
                return false;
            }
        }
        // Assume this window is a sidebar window:
        return true;
    })).then(filter => windowsWithTSTInfo.filter((value, index) => filter[index])));

    // #endregion Find Sidebar Windows


    // #region Connect sidebar windows to their parent windows

    const possibleParentWindows = allWindows.filter(aWindow =>
        aWindow.type === 'normal' &&
        (!sidebarWindows.some(({ window }) => aWindow.id === window.id)) &&
        (!sidebarsFoundViaSessionData.some(({ window }) => aWindow.id === window.id))
    );


    const sidebarWindowsWithParents = await Promise.all(sidebarWindows.map(async (sidebarWindowInfo) => {
        const window = sidebarWindowInfo.window;

        /** Expected value for `parent.left` or if right of window then `parent.right`. */
        let parentX = settings.newWindow_besideCurrentWindow_rightOfWindow ? window.left - xSpaceBetweenWindows : window.left + window.width + xSpaceBetweenWindows;
        let parentY = window.top;

        let otherPossibleParents = possibleParentWindows
            .filter(parent => parent.id !== window.id && parent.incognito === window.incognito)
            // Distance to parent from expect position:
            .map(parent => /** @type {[BrowserWindow, number, number]} */([
                parent,
                // delta X:
                Math.abs(settings.newWindow_besideCurrentWindow_rightOfWindow ? parent.left + parent.width - parentX : parent.left - parentX),
                // delta Y:
                Math.abs(parent.top - parentY)
            ]))
            // Total distance:
            .map(([parent, x, y]) => /** @type {[BrowserWindow, number, number, number]} */([parent, x, y, Math.sqrt(x * x + y * y)]))
            // Sort based on distance:
            .sort(([, distA], [, distB]) => distA - distB);

        let [[possibleParent, xDistToParent, yDistToParent, distToPossibleParent],] = otherPossibleParents;

        if (distToPossibleParent > 3) {
            otherPossibleParents = otherPossibleParents.sort(([_winA, winAX, _winAY, _winAD], [_winB, winBX, _winBY, _winBD]) => winAX - winBX);
            [[possibleParent, xDistToParent, yDistToParent, distToPossibleParent],] = otherPossibleParents;
        }


        if (xDistToParent > 10) {
            // No parent found:
            possibleParent = null;
        }
        return Object.assign(sidebarWindowInfo, { parentWindow: possibleParent });
    }));

    // #endregion Connect sidebar windows to their parent windows


    return {
        /** Found sidebar windows. Note that their parent windows might not have been found. */
        sidebarWindows: [...sidebarsFoundViaSessionData, ...sidebarWindowsWithParents],
        /** Windows that can be or are parent windows. */
        possibleParentWindows,
    };
}