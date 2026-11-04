'use strict';

// CRF/VBR encoders do not promise a file size. These deliberately broad ranges
// describe typical material; live estimates extrapolate bytes actually written.
const OutputEstimate = (() => {
  function range(center, low, high, live = false) {
    return { min: center * low, max: center * high, live };
  }

  function estimate(media, target, options) {
    if (!target || !(media.duration > 0) || !Number.isFinite(media.duration)) return null;
    const quality = options.quality === 'high' ? 0 : options.quality === 'small' ? 2 : 1;
    const pick = (values) => values[quality];
    const audio = (rate, low = 0.85, high = 1.15) => range(media.duration * rate / 8, low, high);
    if (target.kind === 'audio') {
      if (!media.hasAudio) return null;
      switch (target.id) {
        case 'mp3': return audio(pick([245000, 190000, 130000]), 0.7, 1.3);
        case 'm4a': return audio(pick([256000, 192000, 128000]));
        case 'opus': return audio(pick([160000, 128000, 96000]));
        case 'ogg': return audio(pick([224000, 160000, 112000]), 0.7, 1.3);
        case 'wav':
        case 'flac': {
          if (!(media.channels > 0 && media.sampleRate > 0)) return null;
          const pcm = media.duration * media.channels * media.sampleRate * 2;
          // FLAC preserves the source precision (often 24-bit); allow that here.
          return target.id === 'wav' ? range(pcm, 1, 1.01) : range(pcm, 0.35, 1.5);
        }
        default: return null;
      }
    }
    if (target.kind !== 'video' || media.kind !== 'video' || !(media.width > 0 && media.height > 0)) return null;
    const gif = target.id === 'gif';
    const cap = options.maxHeight || (gif ? 480 : media.height);
    const height = Math.min(media.height, cap);
    const width = media.width * height / media.height;
    const fps = options.fps > 0 ? options.fps : gif ? pick([20, 15, 10]) : media.fps;
    if (!(fps > 0 && Number.isFinite(fps))) return null;
    const codec = { mp4: 1, mkv: 1, mov: 1, 'mp4-hevc': 0.65, webm: 0.65, avi: 1.7, gif: 1 }[target.id];
    if (!codec) return null;
    const bitsPerPixel = gif ? 2 : pick([0.11, 0.07, 0.04]) * codec;
    const videoRate = width * height * fps * bitsPerPixel;
    const audioRate = gif || options.mute || !media.hasAudio ? 0
      : target.id === 'webm' ? pick([160000, 128000, 96000])
        : target.id === 'avi' ? pick([190000, 160000, 130000]) : pick([192000, 160000, 128000]);
    return range(media.duration * (videoRate + audioRate) / 8 * 1.02, gif ? 0.3 : 0.5, gif ? 2.5 : 1.8);
  }

  function forItem(item, target, options) {
    if (item.state === 'done' && Number.isFinite(item.result?.size)) {
      return { min: item.result.size, max: item.result.size, live: false };
    }
    // Early samples are dominated by buffering and headers. Wait for five
    // seconds of output AND 1% of the clip before projecting to its end.
    if (item.state === 'working' && item.duration > 0 && item.seconds >= Math.max(5, item.duration * 0.01)
        && item.totalSize > 0 && Number.isFinite(item.totalSize) && Number.isFinite(item.seconds)) {
      return range(item.totalSize * Math.max(1, item.duration / item.seconds), 0.8, 1.25, true);
    }
    return estimate(item, target, options);
  }

  return { estimate, forItem };
})();

if (typeof module !== 'undefined') module.exports = OutputEstimate;
