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
  chevron: '<path d="m6 9 6 6 6-6"/>',
  settings: '<path d="M4 6h4m4 0h8M4 12h9m4 0h3M4 18h2m4 0h10"/><circle cx="10" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
};

const NAV = ['convert', 'engine'];
const KINDS = ['video', 'audio', 'image'];
const KIND_TITLE = { video: 'videos', audio: 'audios', image: 'images' };
const HEIGHTS = [0, 2160, 1440, 1080, 720, 480];
const FRAME_RATES = [0, 15, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120];
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
// Destructive opt-in belongs to the current batch, never to saved preferences.
let deleteOriginal = false;
// Disclosure state belongs to this session and survives settings/progress renders.
const openOutputSections = new Set();

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
  if (item.originalDeleted) return 'originalDeleted';
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
    const completedCount = items.filter((item) => item.state === 'done').length;
    if (completedCount) actions.push(`<button class="btn ghost" data-act="clear-completed" title="${esc(t('clearCompletedNote'))}">${svg(ICONS.check)}${esc(t('clearCompleted'))}<span class="action-count readout">${completedCount}</span></button>`);
    actions.push(`<button class="btn ghost" data-act="clear"${busy() ? ' disabled' : ''}>${esc(t('clear'))}</button>`);
  }
  $('actions').innerHTML = actions.join('');
}

// Read by updates.js before restarting into a new version.
function updateBlocker() {
  return busy() ? t('updateStopsJobs') : '';
}

function render() {
  const panelScroll = pageEl.querySelector('.panel-scroll')?.scrollTop || 0;
  pageEl.querySelectorAll('details[data-output-section]').forEach(rememberOutputSection);
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
  const panel = pageEl.querySelector('.panel-scroll');
  if (panel) panel.scrollTop = panelScroll;
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

function sizeEstimate(item) {
  return OutputEstimate.forItem(item, targetFor(item.kind), settings.options);
}

function estimateText(estimate) {
  return estimate ? estimate.min === estimate.max ? bytes(estimate.min)
    : `≈ ${bytes(estimate.min)} – ${bytes(estimate.max)}` : t('estimateUnknown');
}

function estimateCell(item) {
  if (item.kind === 'image' || item.state === 'done' || blocked(item)) return '';
  return `<small class="size-estimate readout" title="${esc(t('estimatedSize'))}">${esc(estimateText(sizeEstimate(item)))}</small>`;
}

function estimateSummary() {
  const pending = items.filter((item) => item.state === 'done' || !blocked(item));
  if (!pending.some((item) => item.state !== 'done' && item.kind !== 'image')) return '';
  const estimates = pending.map(sizeEstimate);
  const known = estimates.filter(Boolean);
  const total = known.length ? known.reduce((sum, value) => ({ min: sum.min + value.min, max: sum.max + value.max }), { min: 0, max: 0 }) : null;
  const missing = estimates.length - known.length;
  return `<div class="estimate-card"><span>${esc(t('estimatedSize'))}</span><b class="readout">${esc(estimateText(total))}</b>` +
    `<small>${esc(t(known.some((value) => value.live) ? 'estimateLiveNote' : 'estimateNote'))}</small>` +
    `${missing ? `<small>${esc(t('estimatePartial', { n: missing }))}</small>` : ''}</div>`;
}

function paintEstimateSummary() {
  const el = pageEl.querySelector('[data-estimate-summary]');
  if (el) el.innerHTML = estimateSummary();
}

function progressInfo(item) {
  const pct = item.duration > 0 ? Math.min(100, (item.seconds / item.duration) * 100) : null;
  const eta = pct !== null && item.speed > 0 ? t('left', { time: clock(Math.max(0, item.duration - item.seconds) / item.speed) }) : '';
  const label = pct === null ? t('working') : `${Math.floor(pct)}%`;
  const detail = `${eta ? ` · ${eta}` : ''}${item.speed ? ` · ${item.speed.toLocaleString(locale(), { maximumFractionDigits: 1 })}×` : ''}`;
  return { pct, label, detail };
}

function statusCell(item) {
  switch (item.state) {
    case 'working': {
      const { pct, label, detail } = progressInfo(item);
      return `<div class="status working"><div class="pbar${pct === null ? ' busy' : ''}"><i style="width:${(pct ?? 35).toFixed(1)}%"></i></div>` +
        `<small class="progress-text readout"><b>${esc(label)}</b><span>${esc(detail)}</span></small>${estimateCell(item)}</div>`;
    }
    case 'waiting':
      return `<div class="status"><span class="tag">${esc(t('waiting'))}</span>${estimateCell(item)}</div>`;
    case 'done': {
      const diff = item.result.size - item.size;
      const delta = diff <= 0 ? t('saved', { size: bytes(-diff) }) : t('grew', { size: bytes(diff) });
      const removal = item.result.originalDeleted ? `<small>${esc(t('originalDeleted'))}</small>`
        : item.result.deleteOriginalError ? `<small class="cleanup-warning" title="${esc(t('deleteOriginalFailed', { error: errText(item.result.deleteOriginalError) }))}">${esc(t('originalKept'))}</small>` : '';
      return `<div class="status done"><span class="tag good">${svg(ICONS.check)}${esc(t('done'))}</span><small class="readout">${esc(bytes(item.result.size))} · ${esc(delta)}</small>${removal}</div>`;
    }
    case 'failed':
      return `<div class="status failed"><span class="tag bad">${svg(ICONS.alert)}${esc(t('failed'))}</span><small title="${esc(item.error)}">${esc(item.error)}</small></div>`;
    case 'cancelled':
      return `<div class="status"><span class="tag">${esc(t('cancelled'))}</span></div>`;
    default: {
      const why = blocked(item);
      return why ? `<div class="status failed"><small>${esc(t(why))}</small></div>` : `<div class="status"><span class="tag">${esc(t('ready'))}</span>${estimateCell(item)}</div>`;
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
  return `<div class="file ${item.state}" data-item="${item.id}" data-state="${item.state}">
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

function rememberOutputSection(el) {
  if (el.open) openOutputSections.add(el.dataset.outputSection);
  else openOutputSections.delete(el.dataset.outputSection);
}

function outputDisclosure(id, title, detail, body, icon, kind = '', count = null) {
  return `<details class="output-fold${kind ? ` k-${kind}` : ''}" data-output-section="${id}"${openOutputSections.has(id) ? ' open' : ''}>
    <summary><span class="fold-icon" aria-hidden="true">${svg(ICONS[icon])}</span>
      <span class="fold-copy"><b>${esc(title)}${count === null ? '' : `<span class="count readout">${count}</span>`}</b><small title="${esc(detail)}">${esc(detail)}</small></span>
      <span class="fold-caret" aria-hidden="true">${svg(ICONS.chevron)}</span>
    </summary>
    <div class="fold-body">${body}</div>
  </details>`;
}

function updateOutputToggle() {
  const button = pageEl.querySelector('[data-act="toggle-options"]');
  if (!button) return;
  const expanded = Array.from(pageEl.querySelectorAll('details[data-output-section]')).some((el) => el.open);
  button.setAttribute('aria-expanded', String(expanded));
  button.querySelector('.toggle-label').textContent = t(expanded ? 'hideOptions' : 'showOptions');
}

function outputPanel() {
  const kinds = KINDS.filter((k) => items.some((i) => i.kind === k));
  const o = settings.options;
  const lock = busy() ? ' disabled' : '';
  const sectionIds = [];
  const sections = kinds.map((kind) => {
    const count = items.filter((i) => i.kind === kind).length;
    const target = targetFor(kind);
    const detail = target ? `${target.label} · ${target.detail}` : t('cannotConvert');
    sectionIds.push(`format-${kind}`);
    if (kind === 'video') {
      sectionIds.push('extract-audio');
      const videoDetail = target?.kind === 'video' ? detail : t('chooseFormat');
      const audioDetail = target?.kind === 'audio' ? detail : t('chooseFormat');
      return outputDisclosure('format-video', t(KIND_TITLE.video), videoDetail, formatChips('video', 'video'), 'video', 'video', count)
        + outputDisclosure('extract-audio', t('extractAudio'), audioDetail, formatChips('video', 'audio'), 'audio', 'audio');
    }
    return outputDisclosure(`format-${kind}`, t(KIND_TITLE[kind]), detail, formatChips(kind, kind), kind, kind, count);
  }).join('');
  const visual = kinds.some((k) => k !== 'audio');
  const quality = ['high', 'balanced', 'small'].map((q) => `<button class="seg${o.quality === q ? ' on' : ''}" data-quality="${q}"${lock}>${esc(t(q))}</button>`).join('');
  const heights = HEIGHTS.map((h) => `<option value="${h}"${o.maxHeight === h ? ' selected' : ''}>${h ? `${h}p` : esc(t('original'))}</option>`).join('');
  const videoOutput = kinds.includes('video') && targetFor('video')?.kind === 'video';
  const frameRates = FRAME_RATES.map((fps) => `<option value="${fps}"${(o.fps || 0) === fps ? ' selected' : ''}>${fps ? `${fps.toLocaleString(locale(), { maximumFractionDigits: 3 })} fps` : esc(t(targetFor('video')?.id === 'gif' ? 'gifAutoFps' : 'original'))}</option>`).join('');
  const where = settings.outDir
    ? `<code title="${esc(settings.outDir)}">${esc(settings.outDir)}</code><button class="btn ghost small" data-act="reset-dir"${lock}>${esc(t('reset'))}</button>`
    : `<span>${esc(t('besideOriginals'))}</span>`;
  const optionSummary = [t(o.quality)];
  if (visual) optionSummary.push(o.maxHeight ? `${o.maxHeight}p` : t('original'));
  if (videoOutput) optionSummary.push(o.fps ? `${o.fps.toLocaleString(locale(), { maximumFractionDigits: 3 })} fps` : t(targetFor('video')?.id === 'gif' ? 'gifAutoFps' : 'originalFps'));
  if (kinds.includes('video') && o.mute) optionSummary.push(t('muted'));
  const expanded = [...sectionIds, 'quality', 'destination'].some((id) => openOutputSections.has(id));

  const runnable = items.filter((i) => i.state !== 'done' && !blocked(i)).length;
  const finished = items.filter((i) => i.state === 'done');
  const failedCount = items.filter((i) => i.state === 'failed').length;
  let main;
  if (busy()) {
    main = `<button class="btn danger big wide" data-act="cancel-all">${svg(ICONS.x)}${esc(t('cancelAll'))}</button>`;
  } else if (runnable) {
    main = `<button class="btn primary big wide" data-act="start">${svg(ICONS.convert)}${esc(runnable === 1 ? t('convertOne') : t('convertN', { n: runnable }))}</button>`;
  } else {
    main = `<button class="btn big wide" data-act="again"${finished.some((item) => !blocked(item)) ? '' : ' disabled'}>${svg(ICONS.retry)}${esc(t('convertAgain'))}</button>`;
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
    <div class="panel-head"><h3>${esc(t('output'))}</h3>
      <button class="panel-toggle" data-act="toggle-options" aria-controls="output-sections" aria-expanded="${expanded}"><span class="toggle-label">${esc(t(expanded ? 'hideOptions' : 'showOptions'))}</span><span class="fold-caret" aria-hidden="true">${svg(ICONS.chevron)}</span></button>
    </div>
    <div class="panel-scroll" id="output-sections">
    ${sections}
    ${outputDisclosure('quality', t(visual ? 'qualityAndPicture' : 'quality'), optionSummary.join(' · '), `
      <label class="sub silk">${esc(t('quality'))}</label><div class="segmented">${quality}</div>
      ${visual ? `<label class="sub silk">${esc(t('maxSize'))}</label><select class="sel" data-act="height"${lock}>${heights}</select>` : ''}
      ${videoOutput ? `<label class="sub silk" for="output-fps">${esc(t('frameRate'))}</label><select id="output-fps" class="sel" data-act="fps"${lock}>${frameRates}</select>` : ''}
      ${kinds.includes('video') ? `<label class="check"><input type="checkbox" data-act="mute"${o.mute ? ' checked' : ''}${lock}><span>${esc(t('mute'))}</span></label>` : ''}
    `, 'settings')}
    ${outputDisclosure('destination', t('saveTo'), settings.outDir || t('besideOriginals'), `<div class="where">${where}<button class="btn small" data-act="out-dir"${lock}>${esc(t('change'))}</button></div>`, 'folder')}
    </div>
    <div class="go">
      <div class="delete-choice">
        <label class="check"><input id="delete-original" type="checkbox" data-act="delete-original" aria-describedby="delete-original-note"${deleteOriginal ? ' checked' : ''}${lock}><span>${esc(t('deleteOriginal'))}</span></label>
        <small id="delete-original-note">${esc(t('deleteOriginalNote'))}</small>
      </div>
      <div data-estimate-summary>${estimateSummary()}</div>${main}${summary}
    </div>
  </aside>`;
}

function convertPage() {
  if (!items.length) return reading ? `<div class="loading">${esc(t('reading', { n: reading }))}</div>` : dropZone();
  return `<div class="convert">
    <div class="files">${items.map(row).join('')}${reading ? `<div class="loading small">${esc(t('reading', { n: reading }))}</div>` : ''}</div>
    ${outputPanel()}
  </div>`;
}

/** Clear list entries only; keep pending jobs and their mounted progress rows. */
function clearCompleted() {
  const ids = items.filter((item) => item.state === 'done').map((item) => item.id);
  if (!ids.length) return;
  const completed = new Set(ids);
  for (let i = items.length - 1; i >= 0; i--) {
    if (!completed.has(items[i].id)) continue;
    pageEl.querySelector(`[data-item="${items[i].id}"]`)?.remove();
    items.splice(i, 1);
  }
  // remove_files releases cached metadata; it does not delete files on disk.
  invoke('remove_files', { ids });
  if (!items.length) {
    deleteOriginal = false;
    render();
    return;
  }
  renderHeader();
  const panel = pageEl.querySelector('.panel');
  if (panel) {
    const scrollTop = panel.querySelector('.panel-scroll').scrollTop;
    panel.querySelectorAll('details[data-output-section]').forEach(rememberOutputSection);
    panel.outerHTML = outputPanel();
    pageEl.querySelector('.panel-scroll').scrollTop = scrollTop;
  }
}

/** Keep the row and progress bar mounted: replacing the row restarts `rise`. */
function paintRow(item) {
  const el = pageEl.querySelector(`[data-item="${item.id}"]`);
  if (!el) return;
  if (el.dataset.state !== item.state) {
    el.className = `file ${item.state}`;
    el.dataset.state = item.state;
    el.querySelector('.status').outerHTML = statusCell(item);
    el.querySelector('.file-actions').innerHTML = rowActions(item);
    el.querySelector('.to b').textContent = item.state === 'done' ? item.result.label : targetFor(item.kind)?.label || '?';
  }
  if (item.thumb && el.querySelector('.thumb img')?.getAttribute('src') !== item.thumb) {
    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';
    img.draggable = false;
    el.querySelector('.thumb').firstElementChild.replaceWith(img);
  }
  if (item.state === 'working') {
    const { pct, label, detail } = progressInfo(item);
    el.querySelector('.pbar').classList.toggle('busy', pct === null);
    el.querySelector('.pbar i').style.width = `${(pct ?? 35).toFixed(1)}%`;
    el.querySelector('.progress-text b').textContent = label;
    el.querySelector('.progress-text span').textContent = detail;
    const estimate = el.querySelector('.size-estimate');
    if (estimate) estimate.textContent = estimateText(sizeEstimate(item));
  }
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
  item.totalSize = 0;
  item.job = ++jobCounter;
  paintRow(item);
  try {
    const result = await invoke('convert', { job: item.job, id: item.id, format: target.id, options: { ...settings.options, deleteOriginal }, outDir: settings.outDir });
    if (result) {
      item.state = 'done';
      item.result = { ...result, label: target.label };
      item.originalDeleted = Boolean(result.originalDeleted);
      if (result.deleteOriginalError) toast(t('deleteOriginalFailed', { error: errText(result.deleteOriginalError) }));
    } else {
      item.state = 'cancelled';
    }
  } catch (e) {
    item.state = 'failed';
    item.error = errText(e);
  }
  item.job = null;
  pump();
  if (busy()) { paintRow(item); paintEstimateSummary(); renderHeader(); }
  else { deleteOriginal = false; render(); } // require a new opt-in for the next batch
}

function cancelItem(item) {
  if (item.state === 'waiting') {
    item.state = 'cancelled';
    paintRow(item);
    if (!busy()) { deleteOriginal = false; render(); }
  } else if (item.job) {
    invoke('cancel', { job: item.job });
  }
}

function cancelAll() {
  for (const item of items) if (item.state === 'waiting') item.state = 'cancelled';
  invoke('cancel_all');
  if (!busy()) deleteOriginal = false;
  render();
}

// ---------- events ----------

async function act(name, el) {
  switch (name) {
    case 'toggle-options': {
      const disclosures = Array.from(pageEl.querySelectorAll('details[data-output-section]'));
      const open = !disclosures.some((section) => section.open);
      disclosures.forEach((section) => { section.open = open; rememberOutputSection(section); });
      updateOutputToggle();
      break;
    }
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
      deleteOriginal = false;
      invoke('remove_files', { ids });
      render();
      break;
    }
    case 'clear-completed': clearCompleted(); break;
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
    if (i >= 0) { invoke('remove_files', { ids: [items[i].id] }); items.splice(i, 1); if (!items.length) deleteOriginal = false; render(); }
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
  if (d.act === 'delete-original') {
    deleteOriginal = e.target.checked;
  } else if (d.act === 'height') {
    settings.options.maxHeight = Number(e.target.value);
    saveSettings();
    render();
  } else if (d.act === 'fps') {
    settings.options.fps = Number(e.target.value);
    saveSettings();
    render();
  } else if (d.act === 'mute') {
    settings.options.mute = e.target.checked;
    saveSettings();
    render();
  }
});

// Native details/summary supports mouse, Enter and Space without custom key handling.
document.addEventListener('toggle', (e) => {
  if (!e.target.matches('details[data-output-section]')) return;
  rememberOutputSection(e.target);
  updateOutputToggle();
}, true);

listen('job', ({ payload }) => {
  const item = items.find((i) => i.job === payload.job);
  if (!item || item.state !== 'working') return;
  item.seconds = payload.seconds;
  item.speed = payload.speed;
  item.totalSize = payload.totalSize || 0;
  paintRow(item);
  paintEstimateSummary();
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
