// 실행 환경 설정
export const SITE_URL = 'https://montaeg0920-lang.github.io/kospi-coaster/';

const host = globalThis.location?.hostname ?? '';

/** 우리 사이트(또는 로컬 개발 서버)에서 열렸는지. 토스 인앱처럼 다른 앱에 번들로 실리면 false */
export const ON_SITE = host.endsWith('github.io') || host === 'localhost' || host === '127.0.0.1';

/**
 * 매시간 바뀌는 지수 데이터의 주소 후보 (앞에서부터 시도).
 * 번들로 실린 경우 안에 든 파일은 빌드 때의 옛 데이터라서, 매시간 갱신되는 사이트의 파일을 먼저 받고
 * 실패하면 번들 안의 파일을 씁니다.
 */
export const LIVE_DATA_URLS = ON_SITE ? ['data/kospi.json'] : [`${SITE_URL}data/kospi.json`, 'data/kospi.json'];

/** 공유할 때 붙일 주소. 다른 앱 안에서는 바깥 사이트로 보내는 링크를 붙이지 않습니다. */
export const SHARE_URL = ON_SITE ? SITE_URL : '';
