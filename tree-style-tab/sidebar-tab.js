

/**
 * @typedef {Object} SidebarTabInfo
 * @property {string|null} [Info.style] The Tree Style Tab theme/style that this sidebar page is specified to use. If `null` then Tree Style Tab will load this information from its settings.
 * @property {number|undefined} [Info.windowId] The window id that this sidebar page is specified to use. If `null` it will use the window it was loaded in.
 * @property {string|null} [Info.internalId] The internal id for Tree Style Tab. If this is `null` then the sidebar page uses the new sidebar url that is redirected to the internal TST page.
 * @property {string|null} [Info.urlArguments] All arguments that should be suffixed to the group tab URL.
 */
null;


export const kTST_SIDEBAR_URL = 'ext+treestyletab:tabbar';

/**
 * Get the URL for Tree Style Tab's sidebar page.
 *
 * @export
 * @param {Object} Info Info about the sidebar page that should be opened.
 * @param {string|null} [Info.internalId] The internal id for Tree Style Tab. If `null` then the new sidebar url will be used which isn't supported in TST v3.5.5 and earlier.
 * @param {number|null} [Info.windowId] The id of the window that the sidebar page should track. If this isn't provided then Tree Style Tab will track the window that the page is opened in. This is *not* supported in Tree Style Tab version `3.5.5` and earlier.
 * @param {string|null} [Info.style] The Tree Style Tab theme/style that should be used, can for example be `mixed`. If this isn't provided then Tree Style Tab will load this info from its settings.
 * @param {string|null} [Info.title] The title of the page. If this is specified then Tree Style Tab will set the title of the opened page to this string.
 * @returns {string|null} The URL for Tree Style Tab's sidebar page. Will be `null` if `internalId` was `null`.
 */
export function getSidebarURL({ internalId = null, windowId = null, style = null, title = null }) {
    const url = internalId ?
        new URL('moz-extension://' + internalId + '/sidebar/sidebar.html') :
        new URL('ext+treestyletab:tabbar');

    if (style) {
        url.searchParams.append('style', String(style));
    }
    if (windowId || windowId === 0) {
        url.searchParams.append('windowId', String(windowId));
    }
    if (title) {
        url.searchParams.append('title', String(title));
    }
    return url.toString();
}

/**
 * Try to parse a URL as a Tree Style Tab sidebar tab and return the parsed information.
 *
 * @export
 * @param {null|string} url The URL to parse.
 * @returns {SidebarTabInfo|null} Info - Information about the parsed URL or `null` if the URL couldn't be parsed.
 */
export function getSidebarTabInfo(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }
    const removeLength = (string, removeLength) => {
        return string.length <= removeLength ? '' : string.substr(removeLength);
    };

    let internalId = null;

    if (url.startsWith(kTST_SIDEBAR_URL)) {
        url = removeLength(url, kTST_SIDEBAR_URL.length);
    } else {
        const start = 'moz-extension://';
        if (!url.startsWith(start)) {
            return null;
        }
        url = removeLength(url, start.length);

        const separatorIndex = url.indexOf('/');
        if (separatorIndex < 0) {
            return null;
        }
        internalId = url.substr(0, separatorIndex);
        url = removeLength(url, separatorIndex + 1);

        const location = 'sidebar/sidebar.html';
        if (!url.startsWith(location)) {
            return null;
        }
        url = removeLength(url, location.length);
    }

    const info = {
        internalId: internalId,
        urlArguments: url,
    };


    if (url.startsWith('?')) {
        url = removeLength(url, 1);

        const getInfo = (arg, id, key, handleValue) => {
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
        const tests = [
            (arg) => {
                return getInfo(arg, 'windowId=', 'windowId', (value) => {
                    const asNumber = parseInt(value);
                    return isNaN(asNumber) ? value : asNumber;
                });
            },
            (arg) => {
                return getInfo(arg, 'style=', 'style', (value) => {
                    value = value.toLowerCase().trim();
                    return value;
                });
            },
        ];
        for (const arg of url.split('&')) {
            for (const test of tests) {
                if (test(arg)) {
                    break;
                }
            }
        }
    }

    return info;
}