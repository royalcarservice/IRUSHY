#!/usr/bin/env node
// IRUSHY - browser checks of the real widget on the local site copy.
//   npm run check:ui
//
// The main server runs the DEFAULT local engine with outbound network blocked
// and no mock, so every answer on screen is a real engine answer. Two extra
// servers cover the optional backend's failure states: an "outage" (APInex
// pointed at a closed local port) and "not connected" (APInex without a key).
//
// Browser: Playwright's Chromium (npx playwright install chromium), or any
// Chromium build via IRUSHY_CHROMIUM_PATH=/path/to/chromium.
// Screenshots are written to docs/screenshots/.

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { ROOT, createReporter, startServer } from './lib/harness.mjs';

const R = createReporter('IRUSHY browser checks (npm run check:ui)');
const check = R.check;
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const TEST_KEY = 'sk-apx-ui-check-dummy-key-0000';

function tamilShare(s) {
  const ta = (String(s).match(/[\u0B80-\u0BFF]/g) || []).length;
  const en = (String(s).match(/[A-Za-z]/g) || []).length;
  return ta + en ? ta / (ta + en) : 0;
}

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is not installed. Run: npm install');
  }
  const executablePath = process.env.IRUSHY_CHROMIUM_PATH || undefined;
  const args = executablePath ? ['--no-sandbox', '--no-zygote', '--disable-gpu', '--use-angle=swiftshader'] : [];
  try {
    return await chromium.launch({ headless: true, executablePath, args, env: process.env });
  } catch (err) {
    throw new Error(`Could not start Chromium (${err.message.split('\n')[0]}).\nRun "npx playwright install chromium", or set IRUSHY_CHROMIUM_PATH to a Chromium executable.`);
  }
}

// Ask through the real input box and wait for the reply to render.
async function ask(page, text) {
  const before = await page.locator('#irushy-log .ir-msg-assistant').count();
  await page.fill('#irushy-input', text);
  await page.press('#irushy-input', 'Enter');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#irushy-log .ir-msg-assistant').length > n && !document.querySelector('#irushy-log .ir-typing'),
    before,
    { timeout: 20000 }
  );
  return page.locator('#irushy-log .ir-msg-assistant').last();
}

async function clickAndWait(page, locator) {
  const before = await page.locator('#irushy-log .ir-msg-assistant').count();
  await locator.click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('#irushy-log .ir-msg-assistant').length > n && !document.querySelector('#irushy-log .ir-typing'),
    before,
    { timeout: 20000 }
  );
  return page.locator('#irushy-log .ir-msg-assistant').last();
}

async function openPanel(page) {
  if (await page.locator('#irushy-panel').isHidden()) await page.click('#irushy-launcher');
  await page.waitForSelector('#irushy-panel:not([hidden])');
}

async function loadHome(page, srv) {
  await page.goto(srv.base + '/', { waitUntil: 'load' });
  await page.waitForSelector('#irushy-launcher', { timeout: 15000 });
  await page.waitForFunction(() => window.IRUSHY !== undefined);
}

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, name) });
  return name;
};

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(SHOTS, { recursive: true });
  const closedPort = await freePort(); // nothing listens here: a real "provider down"
  const S = await startServer({ name: 'local', env: { IRUSHY_RATE_LIMIT_MAX: '100000' } });
  const OUT = await startServer({
    name: 'outage',
    denyNetwork: false,
    env: { IRUSHY_ENGINE: 'apinex', APINEX_API_KEY: TEST_KEY, APINEX_BASE_URL: `http://127.0.0.1:${closedPort}/v1`, IRUSHY_RATE_LIMIT_MAX: '100000', IRUSHY_MAX_PROVIDER_RETRIES: '0', IRUSHY_REQUEST_TIMEOUT_MS: '3000' }
  });
  const NC = await startServer({ name: 'not-connected', env: { IRUSHY_ENGINE: 'apinex', IRUSHY_RATE_LIMIT_MAX: '100000' } });
  const servers = [S, OUT, NC];
  const browser = await launchBrowser();
  const pageErrors = [];
  const shots = [];

  try {
    // ======================================================== desktop
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/youtube|ERR_|net::|Failed to load resource/i.test(m.text())) pageErrors.push(m.text());
    });

    R.section('Desktop: the site copy and the launcher');
    await loadHome(page, S);
    const frameBox = await page.locator('#site-frame').boundingBox();
    check('the site frameset loads inside the shell page', frameBox && frameBox.width >= 1270 && frameBox.height >= 880);
    const frames = page.frames().map((f) => f.url());
    check('the original frames are loaded (frameset, top, admin, slideshow)', ['site-home.html', 'IrushyFrameHome.html', 'AdminPageHome.html'].every((n) => frames.some((u) => u.includes(n))), frames);
    const adminFrame = page.frames().find((f) => f.url().includes('AdminPageHome.html'));
    check('Teacher and Student Registration choices are still there', adminFrame && (await adminFrame.content()).includes('Teacher Registration') && (await adminFrame.content()).includes('Student Registration'));
    check('launcher visible, panel hidden on load', (await page.locator('#irushy-launcher').isVisible()) && (await page.locator('#irushy-panel').isHidden()));
    const lb = await page.locator('#irushy-launcher').boundingBox();
    check('launcher sits in the bottom-right corner', lb && lb.x > 1280 - 260 && lb.y > 900 - 160);
    shots.push(await shot(page, '01-homepage-desktop-closed.png'));

    R.section('Desktop: opening the panel');
    await page.click('#irushy-launcher');
    await page.waitForSelector('#irushy-panel:not([hidden])');
    check('the panel opens on click', await page.locator('#irushy-panel').isVisible());
    await page.waitForTimeout(250); // let the 150 ms open animation finish before measuring
    const pb = await page.locator('#irushy-panel').boundingBox();
    const layoutWidth = await page.$eval('#irushy-panel', (n) => n.offsetWidth);
    check('panel opens at the compact 384 px width', layoutWidth === 384 && pb && Math.round(pb.width) === 384, { layoutWidth, pb });
    check('panel stays inside the viewport', pb && pb.x >= 0 && pb.y >= 0 && pb.x + pb.width <= 1280 && pb.y + pb.height <= 900);
    await page.waitForTimeout(80);
    check('focus moves to the message box', await page.evaluate(() => document.activeElement && document.activeElement.id === 'irushy-input'));
    check('language and mode selectors are labelled', (await page.locator('label[for="irushy-lang"]').count()) === 1 && (await page.locator('label[for="irushy-mode"]').count()) === 1);
    check('close and clear buttons have accessible names', (await page.locator('#irushy-panel button[aria-label]').count()) >= 3);
    check('launcher reports aria-expanded=true', (await page.getAttribute('#irushy-launcher', 'aria-expanded')) === 'true');
    await page.waitForFunction(() => document.getElementById('irushy-status').getAttribute('data-show') === '1');
    const status = await page.textContent('#irushy-status');
    check('the local engine shows as connected (no "not connected" banner)', /Connected/.test(status) && !/not connected/i.test(status), status);
    const after = await page.locator('#site-frame').boundingBox();
    check('opening the panel does not resize the site frame', after && after.width === frameBox.width && after.height === frameBox.height);
    check('the site frame stays visible behind the panel', await page.locator('#site-frame').isVisible());
    shots.push(await shot(page, '02-panel-open-desktop.png'));

    R.section('Desktop: a real local-engine answer (English)');
    const startBtn = page.locator('.ir-empty button.ir-action', { hasText: 'Where are the materials?' });
    const a1 = await clickAndWait(page, startBtn);
    const card1 = a1.locator('.ir-card');
    const t1 = await card1.textContent();
    check('answer comes from the verified FAQ, with its citation', /Materials/.test(t1) && t1.includes('[faq.find-materials]'), t1);
    check('answer card holds plain text only (no child elements)', (await card1.evaluate((n) => n.children.length)) === 0);
    check('verified Materials link shown', (await a1.locator('.ir-links a[href="https://tnhhsscta.com/AmmaURL.asp"]').count()) === 1);
    check('Approved chip shown, no Sample chip', (await a1.locator('.ir-chip-approved').count()) === 1 && (await a1.locator('.ir-chip-sample').count()) === 0);
    shots.push(await shot(page, '03-answer-desktop.png'));
    // Same request = same message AND same (empty) history: clear, then ask again.
    await page.click('#irushy-panel .ir-header-actions button:first-child');
    const again = await ask(page, 'Where are the materials?');
    check('the same request again gives the identical answer', (await again.locator('.ir-card').textContent()) === t1);

    R.section('Desktop: Tamil');
    await page.selectOption('#irushy-lang', 'ta');
    const a2 = await ask(page, 'பாடக்குறிப்புகள் எங்கே?');
    const t2 = await a2.locator('.ir-card').textContent();
    check('Tamil question answered in Tamil script', tamilShare(t2) > 0.4, t2.slice(0, 80));
    check('Tamil answer keeps the verified link', (await a2.locator('.ir-links a[href="https://tnhhsscta.com/AmmaURL.asp"]').count()) === 1);
    const a3 = await ask(page, 'எண் முறைமைகளை விளக்குங்கள்');
    const t3 = await a3.locator('.ir-card').textContent();
    check('Tamil topic explanation from the local engine', tamilShare(t3) > 0.4 && t3.includes('[concept.number-systems]'));
    check('Tamil sample note is labelled (chip + notice)', (await a3.locator('.ir-chip-sample').count()) >= 1 && /அங்கீகரிக்க/.test(await a3.textContent()));
    shots.push(await shot(page, '04-tamil-answer-desktop.png'));

    R.section('Desktop: student topic, diagram and lazy video');
    await page.click('#irushy-panel .ir-header-actions button:first-child');
    await page.selectOption('#irushy-lang', 'en');
    await page.selectOption('#irushy-mode', 'student');
    const a4 = await ask(page, 'Explain number systems with a diagram and a video');
    check('sample content chip and bilingual notice shown', (await a4.locator('.ir-chip-sample').count()) >= 1 && /not been approved|not approved/i.test(await a4.textContent()));
    check('diagram renders as inline SVG', (await a4.locator('.ir-figure svg').count()) === 1);
    check('no video iframe exists before the click', (await page.locator('iframe[src*="youtube"]').count()) === 0);
    shots.push(await shot(page, '05-diagram-and-video-desktop.png'));
    await a4.locator('button.ir-action-primary', { hasText: 'Load video' }).click();
    const vf = page.locator('iframe[src*="youtube-nocookie.com/embed/"]');
    await vf.waitFor({ state: 'attached', timeout: 5000 });
    check('after the click the player is a youtube-nocookie iframe with a title', (await vf.count()) === 1 && !!(await vf.getAttribute('title')));

    R.section('Desktop: follow-ups (simpler, example, similar question, show answer)');
    await page.click('#irushy-panel .ir-header-actions button:first-child');
    const e1 = await ask(page, 'Explain Boolean algebra');
    check('explanation offers the three follow-up buttons', (await e1.locator('button.ir-action', { hasText: 'Explain more simply' }).count()) === 1 && (await e1.locator('button.ir-action', { hasText: 'Show an example' }).count()) === 1 && (await e1.locator('button.ir-action', { hasText: 'Try a similar question' }).count()) === 1);
    const f1 = await clickAndWait(page, e1.locator('button.ir-action', { hasText: 'Explain more simply' }));
    check('"Explain more simply" gives the everyday analogy', /light switches/i.test(await f1.locator('.ir-card').textContent()));
    const f2 = await clickAndWait(page, f1.locator('button.ir-action', { hasText: 'Show an example' }));
    check('"Show an example" gives the worked example', /A AND \(NOT B\)/.test(await f2.locator('.ir-card').textContent()));
    const f3 = await clickAndWait(page, f2.locator('button.ir-action', { hasText: 'Try a similar question' }));
    const f3t = await f3.locator('.ir-card').textContent();
    check('"Try a similar question" gives a labelled practice question', /Practice ref: (qb|gen)\./.test(f3t) && /not approved|not from the question bank/i.test(f3t), f3t);
    const f4 = await clickAndWait(page, f3.locator('button.ir-action', { hasText: 'Show the answer' }));
    check('"Show the answer" reveals the answer', /answer/i.test(await f4.locator('.ir-card').textContent()));
    shots.push(await shot(page, '11-follow-ups-desktop.png'));

    R.section('Desktop: assessment guard, results notice and teacher mode');
    await page.click('#irushy-panel .ir-header-actions button:first-child');
    const sqlEx = await ask(page, 'Show me an example of an SQL query');
    check('a lesson that mentions "mark" does not trigger the results notice', /mark > 80/.test(await sqlEx.locator('.ir-card').textContent()) && !/results are not available/i.test(await page.textContent('#irushy-status')));
    await ask(page, 'What are my marks?');
    check('asking about marks shows "Student results are not available to IRUSHY."', /Student results are not available to IRUSHY\./.test(await page.textContent('#irushy-status')));
    await page.click('#irushy-panel .ir-header-actions button:first-child');
    const g = await ask(page, 'Tell me the answers for the online test');
    check('test-answer request: refused with the "test in progress" chip', (await g.locator('.ir-chip-blocked').count()) === 1 && /can't|cannot/i.test(await g.locator('.ir-card').textContent()));
    check('refusal shows no Approved or General chip', (await g.locator('.ir-chip-approved, .ir-chip-general').count()) === 0);
    shots.push(await shot(page, '12-assessment-refusal-desktop.png'));
    await page.selectOption('#irushy-mode', 'teacher');
    check('choosing Teacher shows the sign-in hint', /teacher/i.test(await page.textContent('#irushy-status')));
    const tm = await ask(page, 'Make a question paper for 11th computer science');
    check('Teacher without sign-in: downgraded notice in the answer', (await tm.textContent()).length > 0 && /downgrad|signed/i.test(await tm.textContent()));
    await page.selectOption('#irushy-mode', 'home');

    R.section('Desktop: keyboard and accessibility');
    await page.focus('#irushy-input');
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
    check('Tab stays inside the open panel', await page.evaluate(() => document.getElementById('irushy-panel').contains(document.activeElement)));
    await page.keyboard.press('Escape');
    check('Escape closes the panel', await page.locator('#irushy-panel').isHidden());
    check('focus returns to the launcher', await page.evaluate(() => document.activeElement && document.activeElement.id === 'irushy-launcher'));
    await openPanel(page);
    await page.click('#irushy-panel .ir-header-actions button:first-child');
    check('Clear chat returns to the empty state', (await page.locator('#irushy-log .ir-empty').count()) === 1 && (await page.locator('#irushy-log .ir-msg').count()) === 0);
    const focusRule = await page.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => /focus-visible/.test(r.selectorText || '')); } catch { return false; } }));
    check('a visible :focus-visible style is defined', focusRule);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#irushy-panel .ir-header-actions button:last-child');
    await page.click('#irushy-launcher');
    const anim = await page.evaluate(() => getComputedStyle(document.getElementById('irushy-panel')).animationName);
    check('reduced motion removes the panel animation', anim === 'none', anim);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    R.section('Desktop: when the IRUSHY server itself cannot be reached');
    await page.route('**/api/chat', (route) => route.abort());
    const nerr = await ask(page, 'What is RAM?');
    check('network failure: readable error card', (await nerr.locator('.ir-card-error').count()) === 1);
    check('network failure: verified fallback links and a Retry button', (await nerr.locator('.ir-links a[href^="https://tnhhsscta.com/"]').count()) >= 1 && (await nerr.locator('button', { hasText: 'Retry' }).count()) === 1);
    await page.unroute('**/api/chat');
    const retried = await clickAndWait(page, nerr.locator('button', { hasText: 'Retry' }));
    check('Retry succeeds once the server is reachable again', (await retried.locator('.ir-card:not(.ir-card-error)').count()) === 1);
    const html = await page.content();
    const js = await (await page.request.get(S.base + '/irushy/irushy.js')).text();
    check('no key material anywhere in the page or the widget', ![TEST_KEY, 'sk-apx', 'APINEX_API_KEY'].some((k) => html.includes(k) || js.includes(k)));
    await ctx.close();

    // ======================================================== optional backend states
    R.section('Optional APInex backend: outage and not connected');
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => pageErrors.push(String(e)));
    await loadHome(p2, OUT);
    await openPanel(p2);
    const o = await ask(p2, 'Where are the materials?');
    check('provider outage: readable error card', (await o.locator('.ir-card-error').count()) === 1 && /AI service/i.test(await o.locator('.ir-card-error').textContent()));
    check('provider outage: verified links and Retry', (await o.locator('.ir-links a[href^="https://tnhhsscta.com/"]').count()) >= 1 && (await o.locator('button', { hasText: 'Retry' }).count()) === 1);
    shots.push(await shot(p2, '06-provider-outage-desktop.png'));
    await loadHome(p2, NC);
    await openPanel(p2);
    await p2.waitForFunction(() => document.getElementById('irushy-status').getAttribute('data-show') === '1');
    check('IRUSHY_ENGINE=apinex without a key: "IRUSHY is not connected yet."', /IRUSHY is not connected yet\./.test(await p2.textContent('#irushy-status')));
    const nc = await ask(p2, 'Where are the materials?');
    check('not connected: chat shows the message and the verified links', /not connected/i.test(await nc.textContent()) && (await nc.locator('.ir-links a[href^="https://tnhhsscta.com/"]').count()) >= 1);
    check('not connected: the server error (not a canned client reply) drives the warning card', (await nc.locator('.ir-card-warn').count()) === 1 && (await nc.locator('.ir-card-error').count()) === 1);
    shots.push(await shot(p2, '10-not-connected-desktop.png'));
    await ctx2.close();

    // ======================================================== mobile
    R.section('Mobile (390 x 844)');
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'en-US' });
    const m = await mctx.newPage();
    m.on('pageerror', (e) => pageErrors.push(String(e)));
    await loadHome(m, S);
    const ml = await m.locator('#irushy-launcher').boundingBox();
    check('launcher is at least 44 px (touch target)', ml && ml.height >= 44 && ml.width >= 44, ml);
    check('launcher is inside the phone viewport', ml && ml.x >= 0 && ml.y >= 0 && ml.x + ml.width <= 390 && ml.y + ml.height <= 844);
    check('viewport meta is width=device-width', /width=device-width/.test((await m.getAttribute('meta[name="viewport"]', 'content')) || ''));
    await m.tap('#irushy-launcher');
    await m.waitForSelector('#irushy-panel:not([hidden])');
    await m.waitForTimeout(250); // open animation
    const mp = await m.locator('#irushy-panel').boundingBox();
    check('panel uses the full width on a phone', mp && mp.width >= 380, mp);
    check('panel does not exceed the phone viewport', mp && mp.x >= 0 && mp.x + mp.width <= 390.5 && mp.y + mp.height <= 844.5, mp);
    const closeBox = await m.locator('#irushy-panel .ir-header-actions button:last-child').boundingBox();
    const inputBox = await m.locator('#irushy-input').boundingBox();
    check('close button and message box both on screen', closeBox && inputBox && closeBox.y >= 0 && inputBox.y + inputBox.height <= 844);
    check('composer is at least 40 px tall', inputBox && inputBox.height >= 40, inputBox);
    check('message box font is at least 16 px (no zoom on focus)', parseFloat(await m.$eval('#irushy-input', (n) => getComputedStyle(n).fontSize)) >= 16);
    shots.push(await shot(m, '07-mobile-panel-empty.png'));
    const mans = await ask(m, 'How do I take the online one word test?');
    check('mobile: real answer renders with the verified link', /ONE WORD TEST/i.test(await mans.locator('.ir-card').textContent()) && (await mans.locator('.ir-links a[href="https://tnhhsscta.com/QuestionChangeIrushy.asp"]').count()) === 1);
    shots.push(await shot(m, '08-mobile-answer.png'));
    await m.setViewportSize({ width: 390, height: 420 });
    await m.waitForTimeout(150);
    const kbPanel = await m.locator('#irushy-panel').boundingBox();
    const kbClose = await m.locator('#irushy-panel .ir-header-actions button:last-child').boundingBox();
    const kbInput = await m.locator('#irushy-input').boundingBox();
    check('keyboard open (420 px visible): panel fits the visible height', kbPanel && kbPanel.height <= 420 + 1, kbPanel);
    check('keyboard open: close button and message box still on screen', kbClose && kbInput && kbClose.y >= 0 && kbInput.y + kbInput.height <= 421);
    shots.push(await shot(m, '09-mobile-keyboard-open.png'));
    await m.setViewportSize({ width: 390, height: 844 });
    await m.selectOption('#irushy-lang', 'ta');
    const mta = await ask(m, 'Python அடிப்படைகள் பற்றி விளக்குங்கள்');
    check('mobile Tamil explanation renders in Tamil with the sample label', tamilShare(await mta.locator('.ir-card').textContent()) > 0.3 && (await mta.locator('.ir-chip-sample').count()) >= 1);
    shots.push(await shot(m, '13-mobile-tamil-explanation.png'));
    await mctx.close();

    R.section('Page health');
    check('no JavaScript errors on any page', pageErrors.length === 0, pageErrors.slice(0, 3));
  } finally {
    await browser.close();
    for (const s of servers) await s.stop();
  }

  R.section('Server side during the UI run');
  check('local server: zero outbound network attempts', /NETWORK_ATTEMPTS 0/.test(S.stderr()) && !/NETWORK_BLOCKED/.test(S.stderr()));
  check('no key in any server log', ![S, OUT, NC].some((s) => s.logs().includes(TEST_KEY)));
  process.stdout.write(`\nScreenshots (${shots.length}) in docs/screenshots/: ${shots.join(', ')}\n`);
  const ok = R.summary();
  process.stdout.write(`\nTime: ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`\nUI CHECK CRASHED: ${err && err.stack ? err.stack : err}\n`);
  R.summary();
  process.exit(1);
});
