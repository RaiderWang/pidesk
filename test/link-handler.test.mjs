import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classify } = require('../src/app/link-target.js');
const { createHandler } = require('../src/app/link-handler.js');

/** Fake DOM event for `<a href=...>` inside (or outside) `.md-content`. */
function fakeEvent({ type = 'click', button = 0, href, inMarkdown = true }) {
  const anchor = {
    getAttribute: (n) => (n === 'href' ? href : null),
    closest: (sel) => (sel === '.md-content' && inMarkdown ? {} : null),
    // `a.href` would be origin-resolved in a real WebView — must never be read.
    get href() { throw new Error('handler must use getAttribute("href")'); },
  };
  return {
    type,
    button,
    prevented: false,
    target: { closest: (sel) => (sel === 'a[href]' ? anchor : null) },
    preventDefault() { this.prevented = true; },
  };
}

function setup({ cwd = '/proj', editor = '', failWith = null } = {}) {
  const calls = [];
  const errors = [];
  const handler = createHandler({
    classify,
    invoke: (cmd, args) => {
      calls.push([cmd, args]);
      return failWith ? Promise.reject(failWith) : Promise.resolve();
    },
    getCwd: () => cwd,
    getEditor: () => editor,
    onError: (target, err) => errors.push([target, err]),
  });
  return { handler, calls, errors };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('link handler', () => {
  it('opens http links externally and cancels navigation', () => {
    const { handler, calls } = setup();
    const e = fakeEvent({ href: 'https://example.com/a' });
    handler(e);
    assert.equal(e.prevented, true);
    assert.deepEqual(calls, [['open_url_external', { url: 'https://example.com/a' }]]);
  });

  it('routes relative file links to open_link_path with the cwd and editor', () => {
    const { handler, calls } = setup({ cwd: 'C:\\proj', editor: 'code' });
    const e = fakeEvent({ href: encodeURI('路由配置说明.md') });
    handler(e);
    assert.equal(e.prevented, true);
    assert.deepEqual(calls, [['open_link_path', { path: 'C:/proj/路由配置说明.md', editor: 'code' }]]);
  });

  it('passes editor as null when none is configured', () => {
    const { handler, calls } = setup();
    handler(fakeEvent({ href: 'a.md' }));
    assert.equal(calls[0][1].editor, null);
  });

  it('cancels but does not open anchors and unsafe schemes', () => {
    const { handler, calls } = setup();
    for (const href of ['#top', 'javascript:alert(1)']) {
      const e = fakeEvent({ href });
      handler(e);
      assert.equal(e.prevented, true);
    }
    assert.equal(calls.length, 0);
  });

  it('handles middle-click (auxclick) but only cancels other aux buttons', () => {
    const { handler, calls } = setup();
    const middle = fakeEvent({ type: 'auxclick', button: 1, href: 'https://x.com' });
    handler(middle);
    assert.equal(middle.prevented, true);
    assert.equal(calls.length, 1);

    const right = fakeEvent({ type: 'auxclick', button: 2, href: 'https://x.com' });
    handler(right);
    assert.equal(right.prevented, true);
    assert.equal(calls.length, 1);
  });

  it('reports open failures through onError with the classified target', async () => {
    const { handler, errors } = setup({ failWith: 'not found: /proj/gone.md' });
    handler(fakeEvent({ href: 'gone.md' }));
    await flush();
    assert.deepEqual(errors, [[{ kind: 'path', path: '/proj/gone.md' }, 'not found: /proj/gone.md']]);
  });

  it('stays silent when nothing is opened or the open succeeds', async () => {
    const { handler, errors } = setup();
    handler(fakeEvent({ href: '#top' }));
    handler(fakeEvent({ href: 'a.md' }));
    await flush();
    assert.equal(errors.length, 0);
  });

  it('ignores links outside Markdown content', () => {
    const { handler, calls } = setup();
    const e = fakeEvent({ href: 'https://x.com', inMarkdown: false });
    handler(e);
    assert.equal(e.prevented, false);
    assert.equal(calls.length, 0);
  });
});
