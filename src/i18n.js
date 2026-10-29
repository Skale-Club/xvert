'use strict';

// Interface texts. Anything missing falls back to English.
const I18N = {
  en: {
    locale: 'en-US',
    ui: {
      tagline: 'Video, audio & image converter', madeBy: 'Made by',
      convert: 'Convert', engine: 'Engine',
      dropTitle: 'Drop videos, music and pictures here',
      dropNote: 'Or add them below. Your originals are never changed: Xvert writes new files next to them.',
      addFiles: 'Add files', addFolder: 'Add folder', clear: 'Clear list', dropHere: 'Drop to add',
      mediaFiles: 'Video, audio and pictures', allFiles: 'All files',
      reading: 'Reading {n} files…', skipped: '{n} files skipped: not video, audio or pictures.', skippedOne: '{name} skipped: not video, audio or a picture.',
      filesSummary: '{n} files · {size}', oneFile: '1 file · {size}',
      videos: 'Videos', audios: 'Music & audio', images: 'Pictures',
      toVideo: 'Video', toAudio: 'Audio only', toImage: 'Picture',
      output: 'Output', quality: 'Quality', high: 'High', balanced: 'Balanced', small: 'Small',
      qualityNote: 'Smaller files lose some detail. Lossless formats ignore this.',
      maxSize: 'Picture size', original: 'Original', mute: 'Remove the sound from videos',
      saveTo: 'Save to', besideOriginals: 'Next to the originals', change: 'Change…', reset: 'Reset',
      convertN: 'Convert {n} files', convertOne: 'Convert 1 file', convertAgain: 'Convert again', cancelAll: 'Cancel all',
      ready: 'Ready', waiting: 'Waiting', working: 'Converting', done: 'Done', failed: 'Failed', cancelled: 'Cancelled',
      left: '{time} left', remove: 'Remove', reveal: 'Show in Explorer', cancel: 'Cancel', retry: 'Try again',
      results: '{done} converted', resultsFailed: '{failed} failed', resultsFailedOne: '1 failed', saved: '{size} smaller', grew: '{size} larger',
      noAudio: 'This video has no sound to extract.', cannotConvert: 'This file cannot become that format.',
      notFound: 'The file is no longer there.', noOutDir: 'The output folder is not available.', notMedia: 'Not a video, audio or picture file.',
      noEngine: 'FFmpeg is missing.',
      engineTitle: 'Conversion engine', engineMissing: 'Xvert needs FFmpeg',
      engineMissingNote: 'FFmpeg is the free, open-source engine that does the converting. Xvert can download it into its Data folder (about 100 MB, once). Or put ffmpeg.exe and ffprobe.exe next to Xvert.exe.',
      download: 'Download FFmpeg', downloading: 'Downloading FFmpeg… {done} of {total}', downloadFailed: 'Download failed: {error}',
      engineReady: 'FFmpeg {v}', recheck: 'Look again', source: 'Found', sourceBeside: 'next to Xvert.exe', sourceData: 'in the Data folder', sourceSystem: 'installed on this PC',
      formatsTitle: 'Formats', formatsNote: 'What this FFmpeg can write. Xvert reads almost any video, audio or picture file.',
      unavailable: 'Not in this FFmpeg build',
      failedGeneric: 'Something went wrong: {error}',
      updateStopsJobs: 'Restarting now cancels the conversions in progress.',
    },
  },
  pt: {
    locale: 'pt-BR',
    ui: {
      tagline: 'Conversor de vídeo, áudio e imagem', madeBy: 'Feito por',
      convert: 'Converter', engine: 'Motor',
      dropTitle: 'Solte aqui vídeos, músicas e imagens',
      dropNote: 'Ou adicione abaixo. Os originais nunca são alterados: o Xvert grava arquivos novos ao lado deles.',
      addFiles: 'Adicionar arquivos', addFolder: 'Adicionar pasta', clear: 'Limpar lista', dropHere: 'Solte para adicionar',
      mediaFiles: 'Vídeo, áudio e imagens', allFiles: 'Todos os arquivos',
      reading: 'Lendo {n} arquivos…', skipped: '{n} arquivos ignorados: não são vídeo, áudio nem imagem.', skippedOne: '{name} foi ignorado: não é vídeo, áudio nem imagem.',
      filesSummary: '{n} arquivos · {size}', oneFile: '1 arquivo · {size}',
      videos: 'Vídeos', audios: 'Músicas e áudio', images: 'Imagens',
      toVideo: 'Vídeo', toAudio: 'Só o áudio', toImage: 'Imagem',
      output: 'Saída', quality: 'Qualidade', high: 'Alta', balanced: 'Equilibrada', small: 'Menor',
      qualityNote: 'Arquivos menores perdem um pouco de detalhe. Formatos sem perda ignoram isto.',
      maxSize: 'Tamanho da imagem', original: 'Original', mute: 'Tirar o som dos vídeos',
      saveTo: 'Salvar em', besideOriginals: 'Ao lado dos originais', change: 'Mudar…', reset: 'Voltar',
      convertN: 'Converter {n} arquivos', convertOne: 'Converter 1 arquivo', convertAgain: 'Converter de novo', cancelAll: 'Cancelar tudo',
      ready: 'Pronto', waiting: 'Na fila', working: 'Convertendo', done: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado',
      left: 'faltam {time}', remove: 'Remover', reveal: 'Mostrar no Explorer', cancel: 'Cancelar', retry: 'Tentar de novo',
      results: '{done} convertidos', resultsFailed: '{failed} falharam', resultsFailedOne: '1 falhou', saved: '{size} menor', grew: '{size} maior',
      noAudio: 'Este vídeo não tem som para extrair.', cannotConvert: 'Este arquivo não pode virar esse formato.',
      notFound: 'O arquivo não está mais lá.', noOutDir: 'A pasta de saída não está disponível.', notMedia: 'Não é um arquivo de vídeo, áudio ou imagem.',
      noEngine: 'Falta o FFmpeg.',
      engineTitle: 'Motor de conversão', engineMissing: 'O Xvert precisa do FFmpeg',
      engineMissingNote: 'O FFmpeg é o motor gratuito e de código aberto que faz a conversão. O Xvert pode baixá-lo para a pasta Data (cerca de 100 MB, uma vez só). Ou coloque ffmpeg.exe e ffprobe.exe ao lado do Xvert.exe.',
      download: 'Baixar o FFmpeg', downloading: 'Baixando o FFmpeg… {done} de {total}', downloadFailed: 'O download falhou: {error}',
      engineReady: 'FFmpeg {v}', recheck: 'Procurar de novo', source: 'Encontrado', sourceBeside: 'ao lado do Xvert.exe', sourceData: 'na pasta Data', sourceSystem: 'instalado neste PC',
      formatsTitle: 'Formatos', formatsNote: 'O que este FFmpeg consegue gravar. O Xvert lê quase qualquer arquivo de vídeo, áudio ou imagem.',
      unavailable: 'Não está nesta versão do FFmpeg',
      failedGeneric: 'Algo deu errado: {error}',
      updateStopsJobs: 'Reiniciar agora cancela as conversões em andamento.',
    },
  },
  es: {
    locale: 'es-ES',
    ui: {
      tagline: 'Conversor de vídeo, audio e imagen', madeBy: 'Hecho por',
      convert: 'Convertir', engine: 'Motor',
      dropTitle: 'Suelta aquí vídeos, música e imágenes',
      dropNote: 'O añádelos abajo. Los originales nunca se modifican: Xvert crea archivos nuevos junto a ellos.',
      addFiles: 'Añadir archivos', addFolder: 'Añadir carpeta', clear: 'Vaciar lista', dropHere: 'Suelta para añadir',
      mediaFiles: 'Vídeo, audio e imágenes', allFiles: 'Todos los archivos',
      reading: 'Leyendo {n} archivos…', skipped: '{n} archivos omitidos: no son vídeo, audio ni imagen.', skippedOne: '{name} se omitió: no es vídeo, audio ni imagen.',
      filesSummary: '{n} archivos · {size}', oneFile: '1 archivo · {size}',
      videos: 'Vídeos', audios: 'Música y audio', images: 'Imágenes',
      toVideo: 'Vídeo', toAudio: 'Solo el audio', toImage: 'Imagen',
      output: 'Salida', quality: 'Calidad', high: 'Alta', balanced: 'Equilibrada', small: 'Menor',
      qualityNote: 'Los archivos más pequeños pierden algo de detalle. Los formatos sin pérdida lo ignoran.',
      maxSize: 'Tamaño de imagen', original: 'Original', mute: 'Quitar el sonido de los vídeos',
      saveTo: 'Guardar en', besideOriginals: 'Junto a los originales', change: 'Cambiar…', reset: 'Restablecer',
      convertN: 'Convertir {n} archivos', convertOne: 'Convertir 1 archivo', convertAgain: 'Convertir de nuevo', cancelAll: 'Cancelar todo',
      ready: 'Listo', waiting: 'En cola', working: 'Convirtiendo', done: 'Hecho', failed: 'Falló', cancelled: 'Cancelado',
      left: 'quedan {time}', remove: 'Quitar', reveal: 'Mostrar en el Explorador', cancel: 'Cancelar', retry: 'Reintentar',
      results: '{done} convertidos', resultsFailed: '{failed} fallaron', resultsFailedOne: '1 falló', saved: '{size} menos', grew: '{size} más',
      noAudio: 'Este vídeo no tiene sonido que extraer.', cannotConvert: 'Este archivo no puede convertirse a ese formato.',
      notFound: 'El archivo ya no está.', noOutDir: 'La carpeta de salida no está disponible.', notMedia: 'No es un archivo de vídeo, audio o imagen.',
      noEngine: 'Falta FFmpeg.',
      engineTitle: 'Motor de conversión', engineMissing: 'Xvert necesita FFmpeg',
      engineMissingNote: 'FFmpeg es el motor libre y gratuito que hace la conversión. Xvert puede descargarlo en su carpeta Data (unos 100 MB, una sola vez). O coloca ffmpeg.exe y ffprobe.exe junto a Xvert.exe.',
      download: 'Descargar FFmpeg', downloading: 'Descargando FFmpeg… {done} de {total}', downloadFailed: 'La descarga falló: {error}',
      engineReady: 'FFmpeg {v}', recheck: 'Buscar de nuevo', source: 'Encontrado', sourceBeside: 'junto a Xvert.exe', sourceData: 'en la carpeta Data', sourceSystem: 'instalado en este PC',
      formatsTitle: 'Formatos', formatsNote: 'Lo que este FFmpeg puede escribir. Xvert lee casi cualquier archivo de vídeo, audio o imagen.',
      unavailable: 'No está en esta versión de FFmpeg',
      failedGeneric: 'Algo salió mal: {error}',
      updateStopsJobs: 'Reiniciar ahora cancela las conversiones en curso.',
    },
  },
};

let language = 'en';

function setLanguage(code) {
  language = I18N[code] ? code : 'en';
  document.documentElement.lang = language;
}

/** Interface text with {placeholders}. */
function t(key, vars = {}) {
  const text = I18N[language].ui[key] ?? I18N.en.ui[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

const locale = () => I18N[language].locale;
