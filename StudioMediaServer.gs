/**
 * UnScriptly HTML Studio — Google Drive Media Library Server
 * Hotfix for v8.11.0
 *
 * Create a new Apps Script file named exactly: StudioMediaServer
 * Paste this file into it, save, then deploy a NEW web-app version.
 *
 * Media bytes are persisted only in Google Drive. The browser/app receives
 * metadata and Drive-backed URLs only after each upload finishes.
 */

var HTML_STUDIO_DRIVE_MEDIA_APP_ROOT = 'UnScriptly HTML Studio';
var HTML_STUDIO_DRIVE_MEDIA_ROOT = 'Media';
var HTML_STUDIO_DRIVE_MEDIA_ROOT_KEY = 'UNSCRIPTLY_MEDIA_ROOT_FOLDER_ID';
var HTML_STUDIO_DRIVE_MEDIA_LAST_FOLDER_KEY = 'UNSCRIPTLY_LAST_MEDIA_FOLDER_ID';
var HTML_STUDIO_DRIVE_MEDIA_DEFAULT_FOLDER = 'My Media';
var HTML_STUDIO_DRIVE_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

/** Public RPC: load the shared Drive Media Library. */
function htmlStudioGetMediaLibrary(folderId) {
  var folders = htmlStudioMediaServerListFolders_();
  var active = null;

  if (folderId) {
    active = htmlStudioMediaServerGetFolder_(folderId);
  } else {
    var remembered = '';
    try {
      remembered = PropertiesService.getUserProperties().getProperty(HTML_STUDIO_DRIVE_MEDIA_LAST_FOLDER_KEY) || '';
    } catch (_) {}

    if (remembered) {
      try { active = htmlStudioMediaServerGetFolder_(remembered); }
      catch (_) { active = null; }
    }

    if (!active) {
      active = htmlStudioMediaServerGetOrCreateFolderByName_(HTML_STUDIO_DRIVE_MEDIA_DEFAULT_FOLDER);
    }
  }

  PropertiesService.getUserProperties().setProperty(
    HTML_STUDIO_DRIVE_MEDIA_LAST_FOLDER_KEY,
    active.getId()
  );

  return {
    activeFolderId: active.getId(),
    folders: folders,
    assets: htmlStudioMediaServerListFiles_(active),
    storage: htmlStudioGetMediaStorageInfo()
  };
}

/** Public RPC: create/select a custom Media folder. */
function htmlStudioCreateMediaFolder(name) {
  var safeName = htmlStudioMediaServerSanitizeName_(name, 'Media Folder');
  var folder = htmlStudioMediaServerGetOrCreateFolderByName_(safeName);
  PropertiesService.getUserProperties().setProperty(
    HTML_STUDIO_DRIVE_MEDIA_LAST_FOLDER_KEY,
    folder.getId()
  );
  return {
    id: folder.getId(),
    name: folder.getName(),
    driveUrl: folder.getUrl()
  };
}

/** Public RPC: save an uploaded browser file into Google Drive. */
function htmlStudioSaveMediaFile(request) {
  request = request || {};
  var folder = request.folderId
    ? htmlStudioMediaServerGetFolder_(request.folderId)
    : htmlStudioMediaServerGetOrCreateFolderByName_(HTML_STUDIO_DRIVE_MEDIA_DEFAULT_FOLDER);

  var base64 = String(request.base64 || '');
  if (!base64) throw new Error('Media file data is missing.');

  var bytes;
  try { bytes = Utilities.base64Decode(base64); }
  catch (_) { throw new Error('Media file data could not be decoded.'); }

  if (bytes.length > HTML_STUDIO_DRIVE_MEDIA_MAX_BYTES) {
    throw new Error('This media file is larger than the 25 MB Drive Media Library limit.');
  }

  var mimeType = htmlStudioMediaServerNormalizeMime_(request.mimeType, request.name, request.kind);
  var kind = htmlStudioMediaServerKind_(mimeType, request.name, request.kind);
  if (!kind) {
    throw new Error('Only image, SVG, video, and audio files can be saved to the Media Library.');
  }

  var filename = htmlStudioMediaServerSanitizeFilename_(request.name, kind, mimeType);
  var blob = Utilities.newBlob(bytes, mimeType, filename);
  var file = folder.createFile(blob);
  file.setDescription('UnScriptly HTML Studio Media Library');

  return htmlStudioMediaServerFileDto_(file, folder, kind);
}

/** Public RPC: download a hosted URL server-side and persist it into Drive. */
function htmlStudioSaveMediaUrl(request) {
  request = request || {};
  var rawUrl = String(request.url || '').trim();
  var requestedKind = String(request.kind || '').toLowerCase();
  htmlStudioMediaServerValidateRemoteUrl_(rawUrl);

  var folder = request.folderId
    ? htmlStudioMediaServerGetFolder_(request.folderId)
    : htmlStudioMediaServerGetOrCreateFolderByName_(HTML_STUDIO_DRIVE_MEDIA_DEFAULT_FOLDER);

  var response;
  try {
    response = UrlFetchApp.fetch(rawUrl, {
      followRedirects: true,
      muteHttpExceptions: true,
      validateHttpsCertificates: true,
      headers: { 'User-Agent': 'UnScriptly-HTML-Studio/8.11.0 Media Library' }
    });
  } catch (error) {
    throw new Error('The hosted media URL could not be downloaded: ' + String(error && error.message || error));
  }

  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('The hosted media URL returned HTTP ' + status + '.');
  }

  var blob = response.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > HTML_STUDIO_DRIVE_MEDIA_MAX_BYTES) {
    throw new Error('The hosted media file is larger than the 25 MB Drive Media Library limit.');
  }

  var mimeType = htmlStudioMediaServerNormalizeMime_(blob.getContentType(), rawUrl, requestedKind);
  var kind = htmlStudioMediaServerKind_(mimeType, rawUrl, requestedKind);
  if (!kind) throw new Error('The hosted URL did not return a supported image, SVG, video, or audio file.');

  var candidate = htmlStudioMediaServerFilenameFromUrl_(rawUrl) || ('Imported ' + kind);
  var filename = htmlStudioMediaServerSanitizeFilename_(candidate, kind, mimeType);
  blob.setName(filename);
  blob.setContentType(mimeType);

  var file = folder.createFile(blob);
  file.setDescription('UnScriptly HTML Studio Media Library · imported from ' + rawUrl.slice(0, 500));

  return htmlStudioMediaServerFileDto_(file, folder, kind);
}

/** Public RPC: trash a Drive Media Library file. */
function htmlStudioDeleteMedia(mediaId) {
  var file = htmlStudioMediaServerGetFile_(mediaId);
  file.setTrashed(true);
  return { ok: true, id: String(mediaId || '') };
}

/** Public RPC: return the shared Media root folder. */
function htmlStudioGetMediaStorageInfo() {
  var root = htmlStudioMediaServerGetRootFolder_();
  return {
    folderId: root.getId(),
    folderName: root.getName(),
    driveUrl: root.getUrl()
  };
}

/** Optional diagnostic RPC. */
function htmlStudioMediaServerHealth() {
  var root = htmlStudioMediaServerGetRootFolder_();
  return {
    ok: true,
    module: 'StudioMediaServer',
    version: '8.11.0-media-server-hotfix-20260827',
    rootFolderId: root.getId(),
    rootFolderName: root.getName()
  };
}

function htmlStudioMediaServerListFolders_() {
  var root = htmlStudioMediaServerGetRootFolder_();
  htmlStudioMediaServerGetOrCreateFolderByName_(HTML_STUDIO_DRIVE_MEDIA_DEFAULT_FOLDER);

  var iter = root.getFolders();
  var result = [];
  while (iter.hasNext()) {
    var folder = iter.next();
    var files = folder.getFiles();
    var count = 0;
    while (files.hasNext()) {
      var file = files.next();
      if (htmlStudioMediaServerKind_(file.getMimeType(), file.getName(), '')) count++;
    }
    result.push({
      id: folder.getId(),
      name: folder.getName(),
      mediaCount: count,
      driveUrl: folder.getUrl()
    });
  }

  result.sort(function(a, b) {
    if (a.name === HTML_STUDIO_DRIVE_MEDIA_DEFAULT_FOLDER) return -1;
    if (b.name === HTML_STUDIO_DRIVE_MEDIA_DEFAULT_FOLDER) return 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function htmlStudioMediaServerListFiles_(folder) {
  var iter = folder.getFiles();
  var result = [];
  while (iter.hasNext()) {
    var file = iter.next();
    var kind = htmlStudioMediaServerKind_(file.getMimeType(), file.getName(), '');
    if (!kind) continue;
    result.push(htmlStudioMediaServerFileDto_(file, folder, kind));
  }
  result.sort(function(a, b) {
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
  return result;
}

function htmlStudioMediaServerFileDto_(file, folder, kind) {
  var id = file.getId();
  return {
    id: id,
    folderId: folder.getId(),
    folderName: folder.getName(),
    kind: kind,
    name: file.getName(),
    mimeType: file.getMimeType(),
    size: file.getSize(),
    createdAt: file.getDateCreated().toISOString(),
    updatedAt: file.getLastUpdated().toISOString(),
    driveUrl: file.getUrl(),
    url: 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(id),
    thumbnailUrl: kind === 'image'
      ? ('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w640')
      : ''
  };
}

function htmlStudioMediaServerGetRootFolder_() {
  var props = PropertiesService.getUserProperties();
  var cachedId = props.getProperty(HTML_STUDIO_DRIVE_MEDIA_ROOT_KEY);
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); }
    catch (_) { props.deleteProperty(HTML_STUDIO_DRIVE_MEDIA_ROOT_KEY); }
  }

  var root = DriveApp.getRootFolder();
  var appFolders = root.getFoldersByName(HTML_STUDIO_DRIVE_MEDIA_APP_ROOT);
  var appFolder = appFolders.hasNext()
    ? appFolders.next()
    : root.createFolder(HTML_STUDIO_DRIVE_MEDIA_APP_ROOT);

  var matches = appFolder.getFoldersByName(HTML_STUDIO_DRIVE_MEDIA_ROOT);
  var mediaFolder = matches.hasNext()
    ? matches.next()
    : appFolder.createFolder(HTML_STUDIO_DRIVE_MEDIA_ROOT);

  props.setProperty(HTML_STUDIO_DRIVE_MEDIA_ROOT_KEY, mediaFolder.getId());
  return mediaFolder;
}

function htmlStudioMediaServerGetOrCreateFolderByName_(name) {
  var root = htmlStudioMediaServerGetRootFolder_();
  var safeName = htmlStudioMediaServerSanitizeName_(name, HTML_STUDIO_DRIVE_MEDIA_DEFAULT_FOLDER);
  var matches = root.getFoldersByName(safeName);
  return matches.hasNext() ? matches.next() : root.createFolder(safeName);
}

function htmlStudioMediaServerGetFolder_(folderId) {
  if (!folderId) throw new Error('Media folder ID is required.');
  var folder;
  try { folder = DriveApp.getFolderById(String(folderId)); }
  catch (_) { throw new Error('The media folder could not be found in Google Drive.'); }

  var root = htmlStudioMediaServerGetRootFolder_();
  var parents = folder.getParents();
  var valid = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === root.getId()) {
      valid = true;
      break;
    }
  }
  if (!valid) throw new Error('The requested folder is outside the shared UnScriptly Media directory.');
  return folder;
}

function htmlStudioMediaServerGetFile_(mediaId) {
  if (!mediaId) throw new Error('Media file ID is required.');
  var file;
  try { file = DriveApp.getFileById(String(mediaId)); }
  catch (_) { throw new Error('The media file could not be found in Google Drive.'); }

  var parents = file.getParents();
  var valid = false;
  while (parents.hasNext()) {
    try {
      htmlStudioMediaServerGetFolder_(parents.next().getId());
      valid = true;
      break;
    } catch (_) {}
  }
  if (!valid) throw new Error('The requested file is outside the shared UnScriptly Media directory.');
  return file;
}

function htmlStudioMediaServerSanitizeName_(name, fallback) {
  var cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) cleaned = String(fallback || 'Media');
  return cleaned.slice(0, 100);
}

function htmlStudioMediaServerSanitizeFilename_(name, kind, mimeType) {
  var cleaned = String(name || '')
    .split('?')[0]
    .split('#')[0]
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) cleaned = 'Media';

  var ext = htmlStudioMediaServerExtension_(mimeType, kind);
  if (ext && !new RegExp('\\.' + ext.replace('.', '') + '$', 'i').test(cleaned)) {
    if (!/\.[a-z0-9]{2,5}$/i.test(cleaned)) cleaned += ext;
  }
  return cleaned.slice(0, 140);
}

function htmlStudioMediaServerExtension_(mimeType, kind) {
  var map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac'
  };
  return map[String(mimeType || '').toLowerCase()] ||
    (kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : kind === 'audio' ? '.mp3' : '');
}

function htmlStudioMediaServerNormalizeMime_(mimeType, name, requestedKind) {
  var mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (/^(image|video|audio)\//.test(mime)) return mime;

  var value = String(name || '').toLowerCase().split('?')[0];
  if (/\.svg$/.test(value)) return 'image/svg+xml';
  if (/\.png$/.test(value)) return 'image/png';
  if (/\.jpe?g$/.test(value)) return 'image/jpeg';
  if (/\.gif$/.test(value)) return 'image/gif';
  if (/\.webp$/.test(value)) return 'image/webp';
  if (/\.mp4$/.test(value)) return 'video/mp4';
  if (/\.webm$/.test(value)) return 'video/webm';
  if (/\.mov$/.test(value)) return 'video/quicktime';
  if (/\.mp3$/.test(value)) return 'audio/mpeg';
  if (/\.m4a$/.test(value)) return 'audio/mp4';
  if (/\.wav$/.test(value)) return 'audio/wav';
  if (/\.ogg$/.test(value)) return String(requestedKind || '') === 'video' ? 'video/ogg' : 'audio/ogg';

  return String(requestedKind || '') === 'image'
    ? 'image/png'
    : String(requestedKind || '') === 'video'
      ? 'video/mp4'
      : String(requestedKind || '') === 'audio'
        ? 'audio/mpeg'
        : mime;
}

function htmlStudioMediaServerKind_(mimeType, name, requestedKind) {
  var mime = String(mimeType || '').toLowerCase();
  if (mime.indexOf('image/') === 0) return 'image';
  if (mime.indexOf('video/') === 0) return 'video';
  if (mime.indexOf('audio/') === 0) return 'audio';

  var value = String(name || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(value)) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(value)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(value)) return 'audio';

  var kind = String(requestedKind || '').toLowerCase();
  return /^(image|video|audio)$/.test(kind) ? kind : '';
}

function htmlStudioMediaServerFilenameFromUrl_(url) {
  try {
    var path = String(url || '').split('?')[0].split('#')[0];
    var name = decodeURIComponent(path.substring(path.lastIndexOf('/') + 1));
    return name || '';
  } catch (_) {
    return '';
  }
}

function htmlStudioMediaServerValidateRemoteUrl_(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) {
    throw new Error('Only HTTP or HTTPS media URLs can be saved.');
  }

  var host = String(url)
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase();

  if (!host ||
      host === 'localhost' ||
      host === '0.0.0.0' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host)) {
    throw new Error('That media URL points to a private or local network address.');
  }

  var match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) {
    throw new Error('That media URL points to a private network address.');
  }
}
