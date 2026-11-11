import { defineConfig } from '@apps-in-toss/web-framework/config';
import { APP_NAME } from './toss/app.mjs';

export default defineConfig({
  appName: APP_NAME,
  // 게임은 화면 전체를 쓰므로 토스의 위쪽 바를 투명하게 두고, 왼쪽 위 뒤로가기 버튼과 앱 이름은 숨깁니다
  // (게임 화면과 겹치지 않게). 오른쪽 위 닫기 버튼과 기기의 뒤로가기는 그대로 동작합니다.
  navigationBar: {
    transparentBackground: true,
    withBackButton: false,
    withTitle: false,
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
