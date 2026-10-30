import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'YouTube Comment Lyrics',
    description: 'Finds lyrics pasted in YouTube comments and shows them in the sidebar.',
    permissions: ['storage', 'contextMenus'],
    host_permissions: ['https://lrclib.net/*'],
    action: { default_title: 'YouTube Comment Lyrics', default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' } },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: { id: 'yt-comment-lyrics@local', data_collection_permissions: { required: ['none'] } },
      },
    }),
  }),
});
