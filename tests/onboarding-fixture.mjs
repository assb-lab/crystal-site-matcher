// Checks of the onboarding guide (#58): the first-visit flag and the guide pages.
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// a minimal localStorage for node; `broken` makes every call throw, as in a blocked private window
const store = new Map();
let broken = false;
globalThis.localStorage = {
  getItem: (k) => { if (broken) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { if (broken) throw new Error('blocked'); store.set(k, String(v)); },
};

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const O = await server.ssrLoadModule('/src/lib/onboarding.ts');
  const { I18nProvider } = await server.ssrLoadModule('/src/i18n/index.tsx');
  const { ja } = await server.ssrLoadModule('/src/i18n/ja.ts');
  const { en } = await server.ssrLoadModule('/src/i18n/en.ts');
  const { default: Onboarding } = await server.ssrLoadModule('/src/components/Onboarding.tsx');

  // first visit: not seen; once marked it stays seen; an older guide version counts as unseen
  assert.equal(O.onboardingSeen(), false);
  O.markOnboardingSeen();
  assert.equal(O.onboardingSeen(), true);
  assert.equal(store.get(O.ONBOARDING_KEY), O.ONBOARDING_VERSION);
  store.set(O.ONBOARDING_KEY, '0');
  assert.equal(O.onboardingSeen(), false);
  // storage that throws: no exception, the guide simply shows again
  broken = true;
  assert.equal(O.onboardingSeen(), false);
  assert.doesNotThrow(() => O.markOnboardingSeen());
  broken = false;

  // every page has a title and its bullet points in both languages
  for (const s of O.TOUR_STEPS) {
    for (const key of [`tour.${s.id}.title`, ...Array.from({ length: s.items }, (_, k) => `tour.${s.id}.${k + 1}`)]) {
      assert.ok(ja[key] && en[key], `missing ${key}`);
    }
    assert.equal(ja[`tour.${s.id}.${s.items + 1}`], undefined, `${s.id}: more bullet points than listed`);
  }

  // the first page: title, bullets, skip and next, no back; English without Japanese text
  const render = (lang) => renderToStaticMarkup(createElement(I18nProvider, { initial: lang }, createElement(Onboarding, { onClose: () => {} })));
  const html = render('ja');
  assert.match(html, /Crystal Site Matcher へようこそ/);
  assert.equal((html.match(/<li>/g) ?? []).length, O.TOUR_STEPS[0].items);
  assert.match(html, /id="tour-skip"[^>]*>スキップ</);
  assert.match(html, /id="tour-next"[^>]*>次へ</);
  assert.doesNotMatch(html, /id="tour-back"/);
  assert.match(html, new RegExp(`1 / ${O.TOUR_STEPS.length}`));
  assert.match(html, /aria-labelledby="onboarding-title"/);
  const enHtml = render('en');
  assert.match(enHtml, /Welcome to Crystal Site Matcher/);
  assert.doesNotMatch(enHtml.replace(/日本語/g, ''), /[぀-ヿ一-鿿]/, 'untranslated Japanese text in the English guide');
} finally {
  await server.close();
}
