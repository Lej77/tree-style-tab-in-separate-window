'use strict';

import {
    settings,
} from '../common/common.js';

import {
    delay,
} from '../common/delays.js';


/**
 * @typedef {import('../common/utilities.js').BrowserWindow} BrowserWindow
 */
null;

/**
 * Info about a docked window that mirrors the movement of a parent window.
 * 
 * @typedef {Object} TrackedWindowInfo
 * @property {BrowserWindow} Info.window A WebExtension `windows.Window` object for the docked window.
 * @property {number} Info.windowId The window id for the docked window.
 * @property {BrowserWindow} Info.parentWindow A WebExtension `windows.Window` object for the parent window of the docked window.
 * @property {number} Info.parentWindowId The window id for the parent window of the docked window.
 * @property {boolean} Info.forget If true this indicates that the window is auto closing and shouldn't be tracked anymore.
 */
null;

/**@type { TrackedWindowInfo[] } */
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
