'use strict';

import {
    getPromiseWithResolve,
} from '../common/utilities.js';

import {
    EventListener,
    PassthroughEventManager,
} from '../common/events.js';


/**
 * @typedef {import('../common/events.js').EventSubscriber<T>} EventSubscriber<T>
 * @template T
 */
null;


let gOnClicked = null;
let gOnClosed = null;

/**
 * Get an `EventSubscriber` for the `browser.notifications.onClicked` event.
 *
 * @returns {EventSubscriber} A subscriber for the event.
 */
export function getOnNotificationClicked() {
    if (!gOnClicked) {
        gOnClicked = new PassthroughEventManager(browser.notifications.onClicked);
    }
    return gOnClicked.subscriber;
}
/**
 * Get an `EventSubscriber` for the `browser.notifications.onClosed` event.
 *
 * @returns {EventSubscriber} A subscriber for the event.
 */
export function getOnNotificationClosed() {
    if (!gOnClosed) {
        gOnClosed = new PassthroughEventManager(browser.notifications.onClosed);
    }
    return gOnClosed.subscriber;
}

/**
 * Show a "basic" notification to the user.
 *
 * @export
 * @param {Object} Options Configuration for the shown notification.
 * @param {string} Options.title Title of the shown notification.
 * @param {string} Options.message The text content of the shown notification.
 * @param {string | null} Options.iconUrl A URL to an icon that should be shown in the notification.
 * @returns {Promise<string>} The notifications id.
 */
export async function showBasicNotification({ title, message, iconUrl = null }) {
    const notificationOptions = {
        type: 'basic',
        title,
        message,
    };
    if (iconUrl) {
        notificationOptions.iconUrl = iconUrl;
    }

    return browser.notifications.create(notificationOptions);
}

/**
 * Show a notification to the user and return `true` if it was clicked and `false` if it was closed.
 *
 * @export
 * @param {Object} Options Configuration for the shown notification.
 * @param {string} Options.title Title of the shown notification.
 * @param {string} Options.message The text content of the shown notification.
 * @param {string | null} Options.iconUrl A URL to an icon that should be shown in the notification.
 * @returns {Promise<boolean>} `true` if the notification was clicked and `false` if it was closed.
 */
export async function confirmWithNotification({ title, message, iconUrl = null }) {
    let promiseInfo;
    let onClick;
    let onClose;
    try {
        promiseInfo = await getPromiseWithResolve();

        let id = null;
        onClick = new EventListener(getOnNotificationClicked(), (notificationId) => {
            if (id !== null && notificationId === id) {
                promiseInfo.resolve(true);
            }
        });
        onClose = new EventListener(getOnNotificationClosed(), (notificationId) => {
            if (id !== null && notificationId === id) {
                promiseInfo.resolve(false);
            }
        });

        id = await showBasicNotification({ title, message, iconUrl });

        return await promiseInfo.promise;
    } finally {
        if (promiseInfo)
            promiseInfo.resolve(false);

        if (onClick)
            onClick.dispose();
        if (onClose)
            onClose.dispose();
    }
}