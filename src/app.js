'use strict';

// Xvert window: the file list, the output choices and the conversion queue.
// Rust probes files and runs FFmpeg; this side keeps the list and decides
// what runs when (one video at a time, a few audio files and pictures).

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const svg = (body) => `<svg class="i" viewBox="0 0 24 24">${body}</svg>`;
const ICONS = {
  convert: '<path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/><path d="M21 21v-5h-5"/>',
  engine: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3z"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
  reveal: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  retry: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
};

const NAV = ['convert', 'engine'];
const KINDS = ['video', 'audio', 'image'];
const KIND_TITLE = { video: 'videos', audio: 'audios', image: 'images' };
const HEIGHTS = [0, 2160, 1440, 1080, 720, 480];
/** How many of each kind may convert at once; videos use every core. */
const LANES = { video: 1, audio: 3, image: 3 };

const $ = (id) => document.getElementById(id);
const pageEl = $('page');

let current = 'convert';
let settings = null;     // Data\xvert.json, see Settings in main.rs
let engine = null;       // engine_status result
let downloading = null;  // { done, total } while FFmpeg downloads
let reading = 0;         // files being read
const items = [];        // files on the list, in order
let jobCounter = 0;

// ---------- formatting ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Binary units like Explorer. */
function bytes(b) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toLocaleString(locale(), { maximumFractionDigits: i === 0 ? 0 : b < 10 ? 2 : 1 })} ${units[i]}`;
}

function clock(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

const CODECS = { h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', mpeg4: 'MPEG-4', mjpeg: 'JPEG', prores: 'ProRes', aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', ac3: 'AC-3', eac3: 'E-AC-3', png: 'PNG', webp: 'WebP', gif: 'GIF', bmp: 'BMP', tiff: 'TIFF' };
const codec = (c) => CODECS[c] || (c.startsWith('pcm_') ? 'PCM' : c.toUpperCase());

/** "1920×1080 · 2:31 · H.264 · AAC" and similar. */
function meta(m) {
  const parts = [];
  if (m.width) parts.push(`${m.width}×${m.height}`);
  if (m.kind !== 'image' && m.duration) parts.push(clock(m.duration));
  if (m.kind === 'video' && m.fps) parts.push(`${Math.round(m.fps * 100) / 100} fps`);
  if (m.videoCodec && m.kind !== 'audio') parts.push(codec(m.videoCodec));
  if (m.audioCodec) parts.push(codec(m.audioCodec));
  if (m.kind === 'audio' && m.sampleRate) parts.push(`${(m.sampleRate / 1000).toLocaleString(locale())} kHz`);
  parts.push(bytes(m.size));
  return parts.join(' · ');
}

/** Errors from Rust are message keys when we know them. */
const errText = (e) => (I18N.en.ui[String(e)] ? t(String(e)) : String(e));

function enter() {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    pageEl.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2, .7, .2, 1)' });
  }
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3600);
}

// ---------- formats ----------

const formatById = (id) => engine?.formats.find((f) => f.id === id);
const canWrite = (id) => engine?.available.includes(id);

/** Video becomes video, audio or GIF; audio only audio; pictures only pictures. */
function accepts(format, kind) {
  if (kind === 'video') return format.kind !== 'image';
  return format.kind === kind;
}

/** The format chosen for this kind, falling back to the first one available. */
function targetFor(kind) {
  const chosen = formatById(settings.targets[kind]);
  if (chosen && canWrite(chosen.id) && accepts(chosen, kind)) return chosen;
  return engine?.formats.find((f) => f.kind === (kind === 'video' ? 'video' : kind) && canWrite(f.id));
}

/** Why an item can't become its target, or null. */
function blocked(item) {
  const target = targetFor(item.kind);
  if (!target) return 'cannotConvert';
  if (target.kind === 'audio' && !item.hasAudio) return 'noAudio';
  return null;
}

function saveSettings() {
  invoke('set_settings', { settings });
}

// ---------- chrome ----------

function renderNav() {
  $('nav').innerHTML = NAV.map((id) => {
    const warn = id === 'engine' && engine && !engine.engine ? '<i class="dot"></i>' : '';
    return `<button class="nav-item${id === current ? ' on' : ''}" data-page="${id}">${svg(ICONS[id])}<span>${esc(t(id))}</span>${warn}</button>`;
  }).join('');
}

const busy = () => items.some((i) => i.state === 'working' || i.state === 'waiting');

function renderHeader() {
  $('title').textContent = t(current === 'convert' ? 'convert' : 'engineTitle');
  const size = items.reduce((sum, i) => sum + i.size, 0);
  $('subtitle').textContent = current === 'convert' && items.length
    ? (items.length === 1 ? t('oneFile', { size: bytes(size) }) : t('filesSummary', { n: items.length.toLocaleString(locale()), size: bytes(size) }))
    : current === 'engine' && engine?.engine ? t('engineReady', { v: engine.engine.version }) : '';
  const actions = [];
  if (current === 'convert' && engine?.engine && items.length) {
    actions.push(`<button class="btn" data-act="add">${svg(ICONS.plus)}${esc(t('addFiles'))}</button>`);
    actions.push(`<button class="btn" data-act="folder">${svg(ICONS.folder)}${esc(t('addFolder'))}</button>`);
    actions.push(`<button class="btn ghost" data-act="clear"${busy() ? ' disabled' : ''}>${esc(t('clear'))}</button>`);
  }
  $('actions').innerHTML = actions.join('');
}

// Read by updates.js before restarting into a new version.
function updateBlocker() {
  return busy() ? t('updateStopsJobs') : '';
}

function render() {
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  renderNav();
  renderHeader();
  if (!engine) {
    pageEl.innerHTML = '<div class="loading"></div>';
  } else if (current === 'engine') {
    pageEl.innerHTML = enginePage();
  } else if (!engine.engine) {
    pageEl.innerHTML = engineMissing();
  } else {
    pageEl.innerHTML = convertPage();
  }
}

// ---------- engine ----------

function downloadCard() {
  const pct = downloading?.total ? (downloading.done / downloading.total) * 100 : 0;
  const progress = downloading
    ? `<div class="pbar"><i style="width:${pct.toFixed(1)}%"></i></div><p class="note">${esc(t('downloading', { done: bytes(downloading.done), total: downloading.total ? bytes(downloading.total) : '…' }))}</p>`
    : `<div class="row"><button class="btn primary" data-act="download">${svg(ICONS.download)}${esc(t('download'))}</button><button class="btn" data-act="recheck">${esc(t('recheck'))}</button></div>`;
  return `<div class="card engine-missing"><span class="big-ico">${svg(ICONS.engine)}</span><h2>${esc(t('engineMissing'))}</h2><p>${esc(t('engineMissingNote'))}</p>${progress}</div>`;
}

function engineMissing() {
  return `<div class="center-wrap">${downloadCard()}</div>`;
}

function enginePage() {
  const e = engine.engine;
  const top = e
    ? `<div class="card engine-card"><span class="big-ico ok">${svg(ICONS.check)}</span><div><h3>${esc(t('engineReady', { v: e.version }))}</h3>` +
      `<p class="note">${esc(t('source'))} ${esc(t({ beside: 'sourceBeside', data: 'sourceData', system: 'sourceSystem' }[e.source]))}: <code>${esc(e.ffmpeg)}</code></p></div>` +
      `<button class="btn" data-act="recheck">${esc(t('recheck'))}</button></div>`
    : downloadCard();
  const groups = KINDS.map((kind) => {
    const list = engine.formats.filter((f) => f.kind === kind);
    return `<div class="card"><h3>${esc(t(KIND_TITLE[kind]))}</h3><div class="format-grid">${list.map((f) => {
      const ok = canWrite(f.id);
      return `<div class="fmt-tile${ok ? '' : ' off'}" title="${ok ? '' : esc(t('unavailable'))}"><b>${esc(f.label)}</b><small>${esc(f.detail)}</small><span class="ext">.${esc(f.ext)}</span></div>`;
    }).join('')}</div></div>`;
  }).join('');
  return `${top}<h2 class="section-title">${esc(t('formatsTitle'))}</h2><p class="note">${esc(t('formatsNote'))}</p><div class="engine-formats">${groups}</div>`;
}

async function refreshEngine() {
  engine = await invoke('engine_status');
  render();
}

async function downloadEngine() {
  downloading = { done: 0, total: 0 };
  render();
  try {
    engine = await invoke('download_engine');
  } catch (e) {
    toast(t('downloadFailed', { error: errText(e) }));
  }
  downloading = null;
  render();
}

// ---------- convert page ----------

function dropZone() {
  const chips = ['MP4', 'MKV', 'MOV', 'AVI', 'WebM', 'MP3', 'WAV', 'FLAC', 'M4A', 'JPG', 'PNG', 'WebP', 'HEIC', 'GIF'];
  return `<div class="dropzone" data-act="add">
    <div class="drop-icons"><span class="k-video">${svg(ICONS.video)}</span><span class="k-audio">${svg(ICONS.audio)}</span><span class="k-image">${svg(ICONS.image)}</span></div>
    <h2>${esc(t('dropTitle'))}</h2>
    <p>${esc(t('dropNote'))}</p>
    <div class="row center"><button class="btn primary big">${svg(ICONS.plus)}${esc(t('addFiles'))}</button><button class="btn big" data-act="folder">${svg(ICONS.folder)}${esc(t('addFolder'))}</button></div>
    <div class="chips">${chips.map((c) => `<span>${c}</span>`).join('')}<span>…</span></div>
  </div>`;
}

function statusCell(item) {
  switch (item.state) {
    case 'working': {
      const pct = item.duration > 0 ? Math.min(100, (item.seconds / item.duration) * 100) : null;
      const eta = pct !== null && item.speed > 0 ? t('left', { time: clock((item.duration - item.seconds) / item.speed) }) : '';
      return `<div class="status working"><div class="pbar${pct === null ? ' busy' : ''}"><i style="width:${(pct ?? 35).toFixed(1)}%"></i></div>` +
        `<small><b>${pct === null ? esc(t('working')) : `${Math.floor(pct)}%`}</b>${eta ? ` · ${esc(eta)}` : ''}${item.speed ? ` · ${item.speed.toLocaleString(locale(), { maximumFractionDigits: 1 })}×` : ''}</small></div>`;
    }
    case 'waiting':
      return `<div class="status"><span class="tag">${esc(t('waiting'))}</span></div>`;
    case 'done': {
      const diff = item.result.size - item.size;
      const delta = diff <= 0 ? t('saved', { size: bytes(-diff) }) : t('grew', { size: bytes(diff) });
      return `<div class="status done"><span class="tag good">${svg(ICONS.check)}${esc(t('done'))}</span><small>${esc(bytes(item.result.size))} · ${esc(delta)}</small></div>`;
    }
    case 'failed':
      return `<div class="status failed"><span class="tag bad">${svg(ICONS.alert)}${esc(t('failed'))}</span><small title="${esc(item.error)}">${esc(item.error)}</small></div>`;
    case 'cancelled':
      return `<div class="status"><span class="tag">${esc(t('cancelled'))}</span></div>`;
    default: {
      const why = blocked(item);
      return why ? `<div class="status failed"><small>${esc(t(why))}</small></div>` : `<div class="status"><span class="tag">${esc(t('ready'))}</span></div>`;
    }
  }
}

function rowActions(item) {
  if (item.state === 'working' || item.state === 'waiting') return `<button class="icon-btn" data-cancel="${item.id}" title="${esc(t('cancel'))}">${svg(ICONS.x)}</button>`;
  const out = [];
  if (item.state === 'done') out.push(`<button class="icon-btn" data-reveal="${esc(item.result.path)}" title="${esc(t('reveal'))}">${svg(ICONS.reveal)}</button>`);
  if (item.state === 'failed' || item.state === 'cancelled') out.push(`<button class="icon-btn" data-retry="${item.id}" title="${esc(t('retry'))}">${svg(ICONS.retry)}</button>`);
  out.push(`<button class="icon-btn" data-remove="${item.id}" title="${esc(t('remove'))}">${svg(ICONS.x)}</button>`);
  return out.join('');
}

function row(item) {
  const target = targetFor(item.kind);
  const thumb = item.thumb
    ? `<img src="${item.thumb}" alt="" draggable="false">`
    : `<span class="k-${item.kind}">${svg(ICONS[item.kind])}</span>`;
  return `<div class="file ${item.state}" data-item="${item.id}">
    <div class="thumb k-${item.kind}">${thumb}<i class="kind-badge">${svg(ICONS[item.kind])}</i></div>
    <div class="file-text"><b title="${esc(item.path)}">${esc(item.name)}</b><small>${esc(meta(item))}</small></div>
    <span class="to">${svg(ICONS.arrow)}<b>${esc(item.state === 'done' ? item.result.label : target ? target.label : '?')}</b></span>
    ${statusCell(item)}
    <div class="file-actions">${rowActions(item)}</div>
  </div>`;
}

function formatChips(kind, group) {
  const list = engine.formats.filter((f) => f.kind === group && canWrite(f.id));
  const chosen = targetFor(kind)?.id;
  return `<div class="fmt-chips">${list.map((f) => `<button class="fmt${f.id === chosen ? ' on' : ''}" data-target="${kind}" data-format="${f.id}" title="${esc(f.detail)}"${busy() ? ' disabled' : ''}><b>${esc(f.label)}</b><small>${esc(f.detail)}</small></button>`).join('')}</div>`;
}

function outputPanel() {
  const kinds = KINDS.filter((k) => items.some((i) => i.kind === k));
  const o = settings.options;
  const lock = busy() ? ' disabled' : '';
  const sections = kinds.map((kind) => {
    const count = items.filter((i) => i.kind === kind).length;
    const head = `<div class="kind-head k-${kind}">${svg(ICONS[kind])}<b>${esc(t(KIND_TITLE[kind]))}</b><span class="count">${count}</span></div>`;
    if (kind === 'video') {
      return `<section>${head}<label class="sub">${esc(t('toVideo'))}</label>${formatChips('video', 'video')}<label class="sub">${esc(t('toAudio'))}</label>${formatChips('video', 'audio')}</section>`;
    }
    return `<section>${head}${formatChips(kind, kind)}</section>`;
  }).join('');
  const visual = kinds.some((k) => k !== 'audio');
  const quality = ['high', 'balanced', 'small'].map((q) => `<button class="seg${o.quality === q ? ' on' : ''}" data-quality="${q}"${lock}>${esc(t(q))}</button>`).join('');
  const heights = HEIGHTS.map((h) => `<option value="${h}"${o.maxHeight === h ? ' selected' : ''}>${h ? `${h}p` : esc(t('original'))}</option>`).join('');
  const where = settings.outDir
    ? `<code title="${esc(settings.outDir)}">${esc(settings.outDir)}</code><button class="btn ghost small" data-act="reset-dir"${lock}>${esc(t('reset'))}</button>`
    : `<span>${esc(t('besideOriginals'))}</span>`;

  const runnable = items.filter((i) => i.state !== 'done' && !blocked(i)).length;
  const finished = items.filter((i) => i.state === 'done');
  const failedCount = items.filter((i) => i.state === 'failed').length;
  let main;
  if (busy()) {
    main = `<button class="btn danger big wide" data-act="cancel-all">${svg(ICONS.x)}${esc(t('cancelAll'))}</button>`;
  } else if (runnable) {
    main = `<button class="btn primary big wide" data-act="start">${svg(ICONS.convert)}${esc(runnable === 1 ? t('convertOne') : t('convertN', { n: runnable }))}</button>`;
  } else {
    main = `<button class="btn big wide" data-act="again"${finished.length ? '' : ' disabled'}>${svg(ICONS.retry)}${esc(t('convertAgain'))}</button>`;
  }
  let summary = '';
  if (finished.length || failedCount) {
    const before = finished.reduce((s, i) => s + i.size, 0), after = finished.reduce((s, i) => s + i.result.size, 0);
    const parts = [t('results', { done: finished.length })];
    if (failedCount) parts.push(failedCount === 1 ? t('resultsFailedOne') : t('resultsFailed', { failed: failedCount }));
    if (finished.length) parts.push(after <= before ? t('saved', { size: bytes(before - after) }) : t('grew', { size: bytes(after - before) }));
    summary = `<p class="summary">${esc(parts.join(' · '))}</p>`;
  }
  return `<aside class="panel">
    <h3>${esc(t('output'))}</h3>
    <div class="panel-scroll">
    ${sections}
    <section class="opts">
      <label class="sub">${esc(t('quality'))}</label><div class="segmented">${quality}</div>
      ${visual ? `<label class="sub">${esc(t('maxSize'))}</label><select class="sel" data-act="height"${lock}>${heights}</select>` : ''}
      ${kinds.includes('video') ? `<label class="check"><input type="checkbox" data-act="mute"${o.mute ? ' checked' : ''}${lock}><span>${esc(t('mute'))}</span></label>` : ''}
      <label class="sub">${esc(t('saveTo'))}</label><div class="where">${where}<button class="btn small" data-act="out-dir"${lock}>${esc(t('change'))}</button></div>
    </section>
    </div>
    <div class="go">${main}${summary}</div>
  </aside>`;
}

function convertPage() {
  if (!items.length) return reading ? `<div class="loading">${esc(t('reading', { n: reading }))}</div>` : dropZone();
  return `<div class="convert">
    <div class="files">${items.map(row).join('')}${reading ? `<div class="loading small">${esc(t('reading', { n: reading }))}</div>` : ''}</div>
    ${outputPanel()}
  </div>`;
}

/** Repaints one row in place, so progress doesn't rebuild the page. */
function paintRow(item) {
  const el = pageEl.querySelector(`[data-item="${item.id}"]`);
  if (el) el.outerHTML = row(item);
}

// ---------- adding files ----------

async function addPaths(paths) {
  if (!paths.length || !engine?.engine) return;
  reading += paths.length;
  if (current !== 'convert') current = 'convert';
  render();
  try {
    const result = await invoke('add_files', { paths });
    const known = new Set(items.map((i) => i.path.toLowerCase()));
    const fresh = result.added.filter((m) => !known.has(m.path.toLowerCase()));
    const dupes = result.added.filter((m) => known.has(m.path.toLowerCase())).map((m) => m.id);
    if (dupes.length) invoke('remove_files', { ids: dupes });
    for (const m of fresh) items.push({ ...m, state: 'ready', thumb: null });
    if (result.skipped.length) toast(result.skipped.length === 1 ? t('skippedOne', { name: result.skipped[0] }) : t('skipped', { n: result.skipped.length }));
    loadThumbs(fresh);
  } catch (e) {
    toast(errText(e));
  }
  reading = Math.max(0, reading - paths.length);
  render();
}

async function loadThumbs(list) {
  const queue = list.filter((m) => m.kind !== 'audio' || m.cover);
  const worker = async () => {
    while (queue.length) {
      const m = queue.shift();
      const url = await invoke('thumbnail', { id: m.id }).catch(() => null);
      const item = items.find((i) => i.id === m.id);
      if (item && url) { item.thumb = url; paintRow(item); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

// ---------- the queue ----------

function startAll(again = false) {
  for (const item of items) {
    if (blocked(item)) continue;
    if (item.state === 'ready' || item.state === 'failed' || item.state === 'cancelled' || (again && item.state === 'done')) {
      item.state = 'waiting';
    }
  }
  pump();
  render();
}

function pump() {
  const running = items.filter((i) => i.state === 'working');
  const counts = { video: 0, audio: 0, image: 0 };
  for (const i of running) counts[i.kind]++;
  let total = running.length;
  for (const item of items) {
    if (item.state !== 'waiting' || total >= 4) continue;
    if (counts[item.kind] >= LANES[item.kind]) continue;
    counts[item.kind]++;
    total++;
    run(item);
  }
}

async function run(item) {
  const target = targetFor(item.kind);
  item.state = 'working';
  item.seconds = 0;
  item.speed = 0;
  item.job = ++jobCounter;
  paintRow(item);
  try {
    const result = await invoke('convert', { job: item.job, id: item.id, format: target.id, options: settings.options, outDir: settings.outDir });
    if (result) {
      item.state = 'done';
      item.result = { ...result, label: target.label };
    } else {
      item.state = 'cancelled';
    }
  } catch (e) {
    item.state = 'failed';
    item.error = errText(e);
  }
  item.job = null;
  pump();
  if (busy()) paintRow(item);
  else render(); // the panel's button and summary change when the queue empties
}

function cancelItem(item) {
  if (item.state === 'waiting') {
    item.state = 'cancelled';
    paintRow(item);
    if (!busy()) render();
  } else if (item.job) {
    invoke('cancel', { job: item.job });
  }
}

function cancelAll() {
  for (const item of items) if (item.state === 'waiting') item.state = 'cancelled';
  invoke('cancel_all');
  render();
}

// ---------- events ----------

async function act(name, el) {
  switch (name) {
    case 'add': {
      const paths = await invoke('pick_files', { mediaLabel: t('mediaFiles'), allLabel: t('allFiles') }).catch(() => []);
      addPaths(paths);
      break;
    }
    case 'folder': {
      const path = await invoke('pick_folder').catch((e) => { toast(errText(e)); return null; });
      if (path) addPaths([path]);
      break;
    }
    case 'clear': {
      const ids = items.map((i) => i.id);
      items.length = 0;
      invoke('remove_files', { ids });
      render();
      break;
    }
    case 'start': startAll(); break;
    case 'again': startAll(true); break;
    case 'cancel-all': cancelAll(); break;
    case 'out-dir': {
      const path = await invoke('pick_folder').catch(() => null);
      if (path) { settings.outDir = path; saveSettings(); render(); }
      break;
    }
    case 'reset-dir': settings.outDir = ''; saveSettings(); render(); break;
    case 'download': downloadEngine(); break;
    case 'recheck': engine = null; render(); refreshEngine(); break;
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-page],[data-act],[data-target],[data-quality],[data-remove],[data-cancel],[data-retry],[data-reveal]');
  if (!el || el.disabled || el.tagName === 'SELECT' || el.type === 'checkbox') return;
  const d = el.dataset;
  if (d.page) {
    current = d.page;
    render();
    enter();
  } else if (d.target) {
    settings.targets[d.target] = d.format;
    saveSettings();
    render();
  } else if (d.quality) {
    settings.options.quality = d.quality;
    saveSettings();
    render();
  } else if (d.remove) {
    const i = items.findIndex((x) => x.id === Number(d.remove));
    if (i >= 0) { invoke('remove_files', { ids: [items[i].id] }); items.splice(i, 1); render(); }
  } else if (d.cancel) {
    const item = items.find((x) => x.id === Number(d.cancel));
    if (item) cancelItem(item);
  } else if (d.retry) {
    const item = items.find((x) => x.id === Number(d.retry));
    if (item) { item.state = 'waiting'; pump(); render(); }
  } else if (d.reveal) {
    invoke('reveal', { path: d.reveal, open: false }).catch((err) => toast(errText(err)));
  } else if (d.act) {
    act(d.act, el);
  }
});

document.addEventListener('change', (e) => {
  const d = e.target.dataset;
  if (d.act === 'height') {
    settings.options.maxHeight = Number(e.target.value);
    saveSettings();
  } else if (d.act === 'mute') {
    settings.options.mute = e.target.checked;
    saveSettings();
  }
});

listen('job', ({ payload }) => {
  const item = items.find((i) => i.job === payload.job);
  if (!item || item.state !== 'working') return;
  item.seconds = payload.seconds;
  item.speed = payload.speed;
  paintRow(item);
});

listen('engine-progress', ({ payload }) => {
  if (!downloading) return;
  downloading = payload;
  const bar = pageEl.querySelector('.engine-missing .pbar i');
  const note = pageEl.querySelector('.engine-missing .note');
  if (bar && payload.total) bar.style.width = `${((payload.done / payload.total) * 100).toFixed(1)}%`;
  if (note) note.textContent = t('downloading', { done: bytes(payload.done), total: payload.total ? bytes(payload.total) : '…' });
});

// Files dragged in from Explorer.
const dropEl = $('drop');
listen('tauri://drag-enter', () => { if (engine?.engine) dropEl.hidden = false; });
listen('tauri://drag-leave', () => { dropEl.hidden = true; });
listen('tauri://drag-drop', ({ payload }) => {
  dropEl.hidden = true;
  addPaths(payload.paths || []);
});

$('skale').addEventListener('click', () => invoke('open_site'));

$('lang').addEventListener('change', (e) => {
  setLanguage(e.target.value);
  settings.language = language;
  saveSettings();
  render();
  updates.render();
});

(async () => {
  settings = await invoke('get_settings');
  setLanguage(settings.language);
  $('lang').value = language;
  updates.render();
  render();
  await refreshEngine();
})();
