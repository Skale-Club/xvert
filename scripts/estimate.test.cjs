const { test } = require('node:test');
const assert = require('node:assert/strict');
const { estimate, forItem } = require('../src/estimate.js');

const clip = { kind: 'video', duration: 3600, width: 1920, height: 1080, fps: 60, hasAudio: true, channels: 2, sampleRate: 48000 };
const options = { quality: 'balanced', maxHeight: 0, fps: 0, mute: false };
const mp4 = { id: 'mp4', kind: 'video' };

test('duration, quality, resolution, codec, FPS and audio affect the range', () => {
  const baseline = estimate(clip, mp4, options);
  assert.ok(baseline.min > 0 && baseline.max > baseline.min);
  assert.equal(estimate({ ...clip, duration: 7200 }, mp4, options).min, baseline.min * 2);
  for (const change of [{ quality: 'small' }, { maxHeight: 720 }, { fps: 30 }, { mute: true }]) {
    assert.ok(estimate(clip, mp4, { ...options, ...change }).max < baseline.max);
  }
  assert.ok(estimate(clip, mp4, { ...options, quality: 'high' }).min > baseline.min);
  assert.ok(estimate(clip, { id: 'mp4-hevc', kind: 'video' }, options).max < baseline.max);
  assert.equal(estimate(clip, mp4, { ...options, maxHeight: 2160 }).max, baseline.max);
});

test('GIF defaults and explicit FPS agree with its output settings', () => {
  const gif = { id: 'gif', kind: 'video' };
  const baseline = estimate(clip, gif, options);
  assert.deepEqual(estimate(clip, gif, { ...options, maxHeight: 480, fps: 15 }), baseline);
  assert.equal(estimate(clip, gif, { ...options, fps: 30 }).max, baseline.max * 2);
  assert.deepEqual(estimate(clip, gif, { ...options, mute: true }), baseline);
});

test('audio extraction ignores FPS, resolution and video mute', () => {
  const wav = { id: 'wav', kind: 'audio' };
  const baseline = estimate(clip, wav, options);
  assert.equal(baseline.min, 3600 * 48000 * 2 * 2);
  assert.deepEqual(estimate(clip, wav, { ...options, fps: 30, maxHeight: 480, mute: true }), baseline);
  assert.equal(estimate({ ...clip, hasAudio: false }, wav, options), null);
});

test('missing metadata and still images do not invent a size', () => {
  for (const change of [{ duration: 0 }, { duration: Infinity }, { width: 0 }, { fps: 0 }]) {
    assert.equal(estimate({ ...clip, ...change }, mp4, options), null);
  }
  assert.equal(estimate(clip, null, options), null);
  assert.equal(estimate({ ...clip, kind: 'image' }, { id: 'png', kind: 'image' }, options), null);
});

test('live projection waits for enough output and completed jobs use the real size', () => {
  const working = { ...clip, state: 'working', seconds: 180, totalSize: 100000000 };
  assert.deepEqual(forItem(working, mp4, options), { min: 1600000000, max: 2500000000, live: true });
  assert.deepEqual(forItem({ ...working, seconds: 4 }, mp4, options), estimate(clip, mp4, options));
  assert.deepEqual(forItem({ ...working, seconds: 10 }, mp4, options), estimate(clip, mp4, options));
  assert.deepEqual(forItem({ ...working, totalSize: 0 }, mp4, options), estimate(clip, mp4, options));
  assert.deepEqual(forItem({ ...working, state: 'ready' }, mp4, options), estimate(clip, mp4, options));
  assert.deepEqual(forItem({ ...working, state: 'done', result: { size: 12345 } }, mp4, options), { min: 12345, max: 12345, live: false });
});
