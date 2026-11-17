/**
 * test/model-groups.test.mjs
 *
 * Unit tests for src/app/model-groups.js (provider grouping + ranking for the
 * palette "switch model" list).
 *
 * Run: node --test test/model-groups.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelGroups, t, getLocale, setLocale } from './helpers/shim.mjs';

const { rankAndGroupModels, isCurrentModel, visibleEntries, cursorAfterToggle, OTHER_KEY } = ModelGroups;

const m = (provider, id, name = id) => ({ provider, id, name });
const ids = (group) => group.entries.map((e) => e.item.id);

const MODELS = [
  m('anthropic', 'opus', 'Claude Opus'),
  m('openai', 'o1', 'o1'),
  m('anthropic', 'sonnet', 'Claude Sonnet'),
  m('openrouter', 'o1', 'o1'),
  m('', 'local', 'Local Model'),
];

describe('rankAndGroupModels — empty query', () => {
  it('groups by provider in first-appearance order, keeping model order', () => {
    const groups = rankAndGroupModels(MODELS, '', null);
    assert.deepEqual(groups.map((g) => g.key), ['p:anthropic', 'p:openai', 'p:openrouter', OTHER_KEY]);
    assert.deepEqual(ids(groups[0]), ['opus', 'sonnet']);
  });

  it('puts providerless models in one group that cannot collide with a provider named "other"', () => {
    const groups = rankAndGroupModels([m('', 'a'), m('other', 'b')], '', null);
    assert.deepEqual(groups.map((g) => [g.key, g.provider]), [[OTHER_KEY, ''], ['p:other', 'other']]);
  });

  it('keeps same-id models of different providers in separate groups with distinct row keys', () => {
    const groups = rankAndGroupModels(MODELS, '', null);
    const o1Keys = groups.flatMap((g) => g.entries).filter((e) => e.item.id === 'o1').map((e) => e.rowKey);
    assert.deepEqual(o1Keys, ['openai/o1', 'openrouter/o1']);
  });

  it('handles an empty or missing model list', () => {
    assert.deepEqual(rankAndGroupModels([], 'x', null), []);
    assert.deepEqual(rankAndGroupModels(undefined, '', null), []);
  });
});

describe('rankAndGroupModels — search', () => {
  it('drops non-matching models and empty groups', () => {
    const groups = rankAndGroupModels(MODELS, 'sonnet', null);
    assert.equal(groups.length, 1);
    assert.deepEqual(ids(groups[0]), ['sonnet']);
  });

  it('a provider-name query matches the whole provider group', () => {
    const groups = rankAndGroupModels(MODELS, 'anthropic', null);
    assert.equal(groups[0].provider, 'anthropic');
    assert.deepEqual(ids(groups[0]), ['opus', 'sonnet']);
  });

  it('orders groups by their best-ranked model', () => {
    const models = [m('aaa', 'zzz-opus-long-name'), m('bbb', 'opus')];
    const groups = rankAndGroupModels(models, 'opus', null);
    assert.equal(groups[0].provider, 'bbb');
  });

  it('provider length does not skew the score of same-named models', () => {
    // Same model name under providers of different length: original order wins (tie).
    const a = rankAndGroupModels([m('openrouter', 'o1'), m('openai', 'o1')], 'o1', null);
    assert.deepEqual(a.map((g) => g.provider), ['openrouter', 'openai']);
    const b = rankAndGroupModels([m('openai', 'o1'), m('openrouter', 'o1')], 'o1', null);
    assert.deepEqual(b.map((g) => g.provider), ['openai', 'openrouter']);
  });

  it('keeps the score order within a group', () => {
    const models = [m('p', 'xx-opus-yy'), m('p', 'opus')];
    const groups = rankAndGroupModels(models, 'opus', null);
    assert.deepEqual(ids(groups[0]), ['opus', 'xx-opus-yy']);
  });
});

describe('isCurrentModel / hasCurrent', () => {
  it('matches id + provider; same id under another provider is not current', () => {
    const current = { id: 'o1', provider: 'openrouter' };
    assert.equal(isCurrentModel(m('openai', 'o1'), current), false);
    assert.equal(isCurrentModel(m('openrouter', 'o1'), current), true);
    const groups = rankAndGroupModels(MODELS, '', current);
    assert.deepEqual(groups.filter((g) => g.hasCurrent).map((g) => g.provider), ['openrouter']);
  });

  it('falls back to id-only when either side has no provider', () => {
    assert.equal(isCurrentModel(m('openai', 'o1'), { id: 'o1' }), true);
    assert.equal(isCurrentModel(m('', 'o1'), { id: 'o1', provider: 'openai' }), true);
  });

  it('is false without a current id', () => {
    assert.equal(isCurrentModel(m('a', 'x'), null), false);
    assert.equal(isCurrentModel(m('a', 'x'), { provider: 'a' }), false);
  });
});

describe('visibleEntries / cursorAfterToggle', () => {
  const groups = rankAndGroupModels(MODELS, '', null); // anthropic(2) openai(1) openrouter(1) other(1)
  const keys = (set) => visibleEntries(groups, set).map((e) => e.rowKey);

  it('skips collapsed groups', () => {
    assert.deepEqual(keys(new Set()), ['anthropic/opus', 'anthropic/sonnet', 'openai/o1', 'openrouter/o1', '/local']);
    assert.deepEqual(keys(new Set(['p:openai', OTHER_KEY])), ['anthropic/opus', 'anthropic/sonnet', 'openrouter/o1']);
  });

  it('follows the same row when a group above it is collapsed', () => {
    const next = new Set(['p:anthropic']);
    assert.equal(cursorAfterToggle(groups, next, 'openrouter/o1'), 1);
  });

  it('lands on the first row after a group that hides the cursor row', () => {
    const next = new Set(['p:anthropic']);
    assert.equal(cursorAfterToggle(groups, next, 'anthropic/sonnet'), 0); // openai/o1
    assert.equal(cursorAfterToggle(groups, new Set(['p:openrouter']), 'openrouter/o1'), 3); // /local
  });

  it('clamps to the last row when nothing follows the collapsed group', () => {
    assert.equal(cursorAfterToggle(groups, new Set([OTHER_KEY]), '/local'), 3);
  });

  it('returns 0 when every group is collapsed', () => {
    const all = new Set(groups.map((g) => g.key));
    assert.equal(cursorAfterToggle(groups, all, 'openai/o1'), 0);
  });
});

describe('palette.models i18n keys', () => {
  it('provide en and zh-CN strings with the {name} placeholder', () => {
    const expected = {
      en: { other: 'other', expand: 'Expand zzz', collapse: 'Collapse zzz' },
      'zh-CN': { other: '其他', expand: '展开 zzz', collapse: '折叠 zzz' },
    };
    try {
      for (const [locale, want] of Object.entries(expected)) {
        setLocale(locale);
        assert.equal(getLocale(), locale);
        assert.equal(t('palette.models.otherProvider'), want.other);
        assert.equal(t('palette.models.expandGroup', { name: 'zzz' }), want.expand);
        assert.equal(t('palette.models.collapseGroup', { name: 'zzz' }), want.collapse);
      }
    } finally {
      setLocale('en');
    }
  });
});
