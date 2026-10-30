import { findLyrics, toQuery } from '@/utils/lrclib';
import {
  SET_SELECTION,
  STATUS,
  TOGGLE,
  type SetSelectionMessage,
  type StatusMessage,
  type ToggleMessage,
  type ToggleScope,
} from '@/utils/messages';

const MENU_ID = 'ytl-set-selection';
const CHANNEL_MENUS: Record<string, ToggleScope> = {
  'ytl-channel-on': 'channel-on',
  'ytl-channel-off': 'channel-off',
};
const TITLE = 'YouTube Comment Lyrics';

// Firefox builds as MV2, where the toolbar button is browserAction
const action = browser.action ?? browser.browserAction;
const ACTION_CONTEXT = import.meta.env.MANIFEST_VERSION === 3 ? 'action' : 'browser_action';

const sendToTab = async (tabId: number, msg: SetSelectionMessage | ToggleMessage) => {
  try {
    await browser.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch {
    // not a YouTube tab, or it was open before the extension loaded; nothing listening
  }
};

const showStatus = async (tabId: number, { enabled, via }: StatusMessage) => {
  await action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
  await action.setBadgeBackgroundColor({ tabId, color: '#065fd4' });
  const detail = !enabled
    ? 'off — click to enable for this tab'
    : { channel: 'on (always on for this channel)', tab: 'on for this tab — click to turn off', video: 'on for this video — click to turn off' }[via ?? 'video'];
  await action.setTitle({ tabId, title: `${TITLE}: ${detail}` });
};

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: 'Set selection as lyrics',
      contexts: ['selection'],
      documentUrlPatterns: ['*://www.youtube.com/*'],
    });
    browser.contextMenus.create({ id: 'ytl-channel-on', title: 'Always on for this channel', contexts: [ACTION_CONTEXT] });
    browser.contextMenus.create({ id: 'ytl-channel-off', title: 'Stop always-on for this channel', contexts: [ACTION_CONTEXT] });
  });

  action.onClicked.addListener((tab) => {
    if (tab.id != null) void sendToTab(tab.id, { type: TOGGLE, scope: 'video' });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (tab?.id == null) return;
    const scope = CHANNEL_MENUS[String(info.menuItemId)];
    if (scope) return sendToTab(tab.id, { type: TOGGLE, scope });
    if (info.menuItemId !== MENU_ID) return;
    // content script prefers window.getSelection() (keeps line breaks); selectionText is the fallback
    // for selections inside iframes such as live chat
    await sendToTab(tab.id, { type: SET_SELECTION, fallback: info.selectionText ?? '' });
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const tabId = sender.id === browser.runtime.id ? sender.tab?.id : undefined;
    if (tabId == null) return;

    const status = msg as Partial<StatusMessage> | undefined;
    if (status?.type === STATUS) {
      const via = status.via === 'channel' || status.via === 'tab' ? status.via : 'video';
      if (sender.frameId === 0) void showStatus(tabId, { type: STATUS, enabled: status.enabled === true, via });
      return;
    }

    // fetched here, not in the content script, so YouTube's page context never matters
    const query = toQuery(msg);
    if (!query) return;
    findLyrics(query).then(sendResponse, () => sendResponse(null));
    return true; // async response
  });
});
