import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  FALLBACK_TITLE,
  FALLBACK_DESC,
  resolveReviewLoadingTexts,
} = require('../src/review/review-loading-state.js');

describe('ReviewLoadingState', () => {
  it('falls back to default english text when no t function or custom options provided', () => {
    const res = resolveReviewLoadingTexts({});
    assert.equal(res.title, FALLBACK_TITLE);
    assert.equal(res.desc, FALLBACK_DESC);
  });

  it('uses custom title and desc overrides when provided', () => {
    const res = resolveReviewLoadingTexts({
      title: 'Custom Title',
      desc: 'Custom Description',
    });
    assert.equal(res.title, 'Custom Title');
    assert.equal(res.desc, 'Custom Description');
  });

  it('resolves i18n keys using provided t function', () => {
    const mockT = (key) => {
      if (key === 'review.loading.title') return '正在分析代码改动差异';
      if (key === 'review.loading.desc') return '正在对比工作区改动并准备逐行审查数据…';
      return key;
    };

    const res = resolveReviewLoadingTexts({ t: mockT });
    assert.equal(res.title, '正在分析代码改动差异');
    assert.equal(res.desc, '正在对比工作区改动并准备逐行审查数据…');
  });

  it('allows overriding title while keeping i18n desc', () => {
    const mockT = (key) => (key === 'review.loading.desc' ? 'Mock desc' : key);
    const res = resolveReviewLoadingTexts({
      title: 'Special Title',
      t: mockT,
    });
    assert.equal(res.title, 'Special Title');
    assert.equal(res.desc, 'Mock desc');
  });
});
