import { defineConfig } from '@apps-in-toss/web-framework/config';
import { APP_NAME } from './toss/app.mjs';

export default defineConfig({
  appName: APP_NAME,
  // 게임은 화면 전체를 쓰므로 토스의 위쪽 바를 투명하게 둡니다.
  navigationBar: {
    transparentBackground: true,
  },
  webView: {
    bounces: false,
    pullToRefreshEnabled: false,
    overScrollMode: 'never',
    allowsInlineMediaPlayback: true,
    allowsBackForwardNavigationGestures: false,
  },
  permissions: [],
  // npm run toss:bundle 이 만드는 폴더
  webBundleDir: 'dist-toss',
});
