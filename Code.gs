/**
 * UnScriptly HTML Studio
 * Build: 8.11.0-drive-media-library-20260827
 *
 * Architecture:
 * - StudioCore.html is the known-good v1 client engine, unchanged.
 * - All newer features load after the core as isolated extensions.
 */
var HTML_STUDIO_BUILD = '8.11.0-drive-media-library-20260827';

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('StudioApp');
  var params = e && e.parameter ? e.parameter : {};
  var requestedProjectId = params.project ? String(params.project) : '';
  var forceNewProject = String(params.new || '') === '1';
  var rememberedProjectId = '';
  try { rememberedProjectId = PropertiesService.getUserProperties().getProperty('UNSCRIPTLY_LAST_PROJECT_ID') || ''; } catch (_) {}

  template.BUILD_ID = HTML_STUDIO_BUILD;
  template.APP_CONFIG_JSON = JSON.stringify({
    build: HTML_STUDIO_BUILD,
    projectId: forceNewProject ? '' : (requestedProjectId || rememberedProjectId),
    appUrl: ScriptApp.getService().getUrl() || '',
    forceNewProject: forceNewProject
  });

  return template
    .evaluate()
    .setTitle('UnScriptly HTML Studio')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function studioIncludeRequired_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function studioIncludeOptional_(filename, moduleName) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (error) {
    var safeName = String(moduleName || filename || 'optional module').replace(/[<>]/g, '');
    return '<script>console.error("[HTML Studio] Optional module unavailable: ' + safeName.replace(/"/g, '\\"') + '");<\/script>';
  }
}

function htmlStudioGetBuildInfo() {
  return {
    build: HTML_STUDIO_BUILD,
    shell: 'StudioApp.html',
    core: 'immutable-v1-client',
    features: ['drive-projects', 'drive-image-assets', 'drive-global-media-library', 'drive-media-folders', 'drive-media-url-import', 'drive-media-persistence', 'layers-drag-drop', 'layers-canvas-sync', 'wireframe-view', 'editor-notes', 'wireframe-export', 'before-after-widget', 'panel-controls', 'fullscreen-preview', 'preview-device-switching', 'wireframe-safe-fallback', 'global-styles', 'png-export', 'navigation-mapping', 'photo-gallery', 'slideshow', 'components-library', 'drive-custom-components', 'universal-link-toggle', 'social-link-bar', 'element-export', 'element-multi-export', 'transparent-png-element-export', 'jpeg-element-export', 'svg-element-export', 'layer-readable-labels', 'element-export-download-fallback', 'png-same-realm-renderer', 'png-same-realm-capture'],
    runtime: 'Google Apps Script HtmlService'
  };
}

function exportPagesZip(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('No pages were supplied for export.');
  if (pages.length > 100) throw new Error('A maximum of 100 pages can be exported at once.');

  var usedNames = {};
  var blobs = pages.map(function(page, index) {
    var rawName = page && page.name ? String(page.name) : 'page-' + (index + 1) + '.html';
    var safeName = sanitizeHtmlFilename_(rawName, index + 1);
    safeName = uniqueFilename_(safeName, usedNames);
    var html = page && typeof page.html === 'string' ? page.html : '';
    return Utilities.newBlob(html, 'text/html', safeName);
  });

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyyMMdd-HHmmss');
  var zipName = 'html-studio-export-' + stamp + '.zip';
  var zipBlob = Utilities.zip(blobs, zipName);
  return {
    name: zipName,
    mimeType: 'application/zip',
    base64: Utilities.base64Encode(zipBlob.getBytes())
  };
}

function sanitizeHtmlFilename_(name, fallbackIndex) {
  var cleaned = String(name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  if (!cleaned) cleaned = 'page-' + fallbackIndex + '.html';
  if (!/\.html?$/i.test(cleaned)) cleaned += '.html';
  return cleaned;
}

function uniqueFilename_(name, usedNames) {
  var key = name.toLowerCase();
  if (!usedNames[key]) { usedNames[key] = true; return name; }
  var match = name.match(/^(.*?)(\.(?:html?|HTML?))$/);
  var stem = match ? match[1] : name;
  var ext = match ? match[2] : '.html';
  var counter = 2;
  var candidate;
  do { candidate = stem + '-' + counter + ext; counter++; }
  while (usedNames[candidate.toLowerCase()]);
  usedNames[candidate.toLowerCase()] = true;
  return candidate;
}




/**
 * Packages multiple element exports into a ZIP. Single-element downloads occur
 * in the browser. This helper accepts UTF-8 HTML/TXT or base64 PNG/JPEG.
 */
function htmlStudioExportElementZip(items) {
  if (!Array.isArray(items) || items.length < 2) throw new Error('At least two element files are required for ZIP export.');
  if (items.length > 50) throw new Error('A maximum of 50 elements can be packaged at once.');

  var allowed = { 'text/html': true, 'text/plain': true, 'image/svg+xml': true, 'image/png': true, 'image/jpeg': true };
  var used = {};
  var totalBytes = 0;
  var blobs = items.map(function(item, index) {
    item = item || {};
    var mime = String(item.mimeType || 'text/plain').toLowerCase();
    if (!allowed[mime]) throw new Error('Unsupported element export type: ' + mime);
    var ext = mime === 'text/html' ? '.html' : mime === 'text/plain' ? '.txt' : mime === 'image/svg+xml' ? '.svg' : mime === 'image/png' ? '.png' : '.jpg';
    var safe = String(item.name || ('element-' + (index + 1) + ext)).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    if (!safe) safe = 'element-' + (index + 1) + ext;
    if (safe.toLowerCase().slice(-ext.length) !== ext.toLowerCase()) safe = safe.replace(/\.(?:html?|txt|png|jpe?g)$/i, '') + ext;
    safe = safe.slice(0, 140);

    var base = safe.replace(/(\.[^.]+)$/i, '');
    var extension = safe.slice(base.length);
    var candidate = safe;
    var counter = 2;
    while (used[candidate.toLowerCase()]) { candidate = base + '-' + counter + extension; counter++; }
    used[candidate.toLowerCase()] = true;

    var blob;
    if (mime === 'text/html' || mime === 'text/plain' || mime === 'image/svg+xml') {
      var text = typeof item.text === 'string' ? item.text : '';
      var textBytes = Utilities.newBlob(text).getBytes();
      totalBytes += textBytes.length;
      blob = Utilities.newBlob(text, mime, candidate);
    } else {
      var base64 = String(item.base64 || '');
      if (!base64) throw new Error('Image data is missing for ' + candidate + '.');
      var bytes = Utilities.base64Decode(base64);
      totalBytes += bytes.length;
      blob = Utilities.newBlob(bytes, mime, candidate);
    }
    if (totalBytes > 24 * 1024 * 1024) throw new Error('The element ZIP is too large for one Apps Script response. Export fewer elements or use a lower image scale.');
    return blob;
  });

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyyMMdd-HHmmss');
  var zipName = 'unscriptly-elements-' + stamp + '.zip';
  var zipBlob = Utilities.zip(blobs, zipName);
  return { name: zipName, mimeType: 'application/zip', base64: Utilities.base64Encode(zipBlob.getBytes()) };
}

/**
 * Packages client-rendered PNGs into one ZIP for multi-page image export.
 * The PNG rendering itself happens in the browser so the exported image
 * matches the user's responsive page. Apps Script only packages the bytes.
 */
function exportPngZip(images) {
  if (!Array.isArray(images) || images.length === 0) throw new Error('No PNG images were supplied for export.');
  if (images.length > 20) throw new Error('A maximum of 20 PNG pages can be packaged at once.');

  var usedNames = {};
  var totalBytes = 0;
  var blobs = images.map(function(image, index) {
    var rawName = image && image.name ? String(image.name) : 'page-' + (index + 1) + '.png';
    var safeName = sanitizePngFilename_(rawName, index + 1);
    safeName = uniquePngFilename_(safeName, usedNames);
    var base64 = image && image.base64 ? String(image.base64) : '';
    if (!base64) throw new Error('PNG data is missing for ' + safeName + '.');
    var bytes = Utilities.base64Decode(base64);
    totalBytes += bytes.length;
    if (totalBytes > 24 * 1024 * 1024) throw new Error('The PNG ZIP is too large for one Apps Script export. Try Standard quality, a smaller render width, or export fewer pages at a time.');
    return Utilities.newBlob(bytes, 'image/png', safeName);
  });

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyyMMdd-HHmmss');
  var zipName = 'html-studio-png-' + stamp + '.zip';
  var zipBlob = Utilities.zip(blobs, zipName);
  return {
    name: zipName,
    mimeType: 'application/zip',
    base64: Utilities.base64Encode(zipBlob.getBytes())
  };
}

function sanitizePngFilename_(name, fallbackIndex) {
  var cleaned = String(name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  if (!cleaned) cleaned = 'page-' + fallbackIndex + '.png';
  cleaned = cleaned.replace(/\.(?:html?|txt)$/i, '');
  if (!/\.png$/i.test(cleaned)) cleaned += '.png';
  return cleaned;
}

function uniquePngFilename_(name, usedNames) {
  var key = name.toLowerCase();
  if (!usedNames[key]) { usedNames[key] = true; return name; }
  var stem = name.replace(/\.png$/i, '');
  var counter = 2;
  var candidate;
  do { candidate = stem + '-' + counter + '.png'; counter++; }
  while (usedNames[candidate.toLowerCase()]);
  usedNames[candidate.toLowerCase()] = true;
  return candidate;
}

/* -------------------------------------------------------------------------
 * Drive-backed projects
 *
 * Storage layout in the current user's Google Drive:
 *   UnScriptly HTML Studio/
 *     Projects/
 *       <Project Name>/
 *         .unscriptly-project.json
 *         index.html
 *         about.html
 *         ...
 *
 * The project layer is deliberately server-side and separate from the
 * immutable v1 editor core. Each page is saved in an individual RPC so a
 * multi-page project does not have to cross the Apps Script bridge as one
 * very large request.
 * ---------------------------------------------------------------------- */
var HTML_STUDIO_PROJECT_ROOT = 'UnScriptly HTML Studio';
var HTML_STUDIO_PROJECTS_FOLDER = 'Projects';
var HTML_STUDIO_PROJECT_MANIFEST = '.unscriptly-project.json';
var HTML_STUDIO_PROJECTS_FOLDER_KEY = 'UNSCRIPTLY_PROJECTS_FOLDER_ID';
var HTML_STUDIO_LAST_PROJECT_KEY = 'UNSCRIPTLY_LAST_PROJECT_ID';
var HTML_STUDIO_MAX_PAGE_BYTES = 9 * 1024 * 1024;
var HTML_STUDIO_ASSETS_FOLDER = 'assets';
var HTML_STUDIO_IMAGE_ASSETS_FOLDER = 'images';
var HTML_STUDIO_MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;

function htmlStudioListProjects() {
  var parent = htmlStudioGetProjectsFolder_();
  var folders = parent.getFolders();
  var projects = [];
  while (folders.hasNext()) {
    var folder = folders.next();
    var manifest = htmlStudioReadProjectManifest_(folder);
    if (!manifest) continue;
    projects.push({
      id: folder.getId(),
      name: manifest.name || folder.getName(),
      updatedAt: manifest.updatedAt || manifest.createdAt || '',
      createdAt: manifest.createdAt || '',
      pageCount: Array.isArray(manifest.pages) ? manifest.pages.length : 0,
      imageAssetCount: manifest.assets && Array.isArray(manifest.assets.images) ? manifest.assets.images.length : 0,
      noteCount: htmlStudioReviewNoteCount_(manifest.review),
      activePage: manifest.activePage || '',
      driveUrl: folder.getUrl()
    });
  }
  projects.sort(function(a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
  return projects;
}

function htmlStudioGetProject(projectId) {
  var folder = htmlStudioGetProjectFolder_(projectId);
  var manifest = htmlStudioReadProjectManifest_(folder);
  if (!manifest) throw new Error('This folder is not a valid UnScriptly project.');
  PropertiesService.getUserProperties().setProperty(HTML_STUDIO_LAST_PROJECT_KEY, folder.getId());
  return {
    id: folder.getId(),
    name: manifest.name || folder.getName(),
    createdAt: manifest.createdAt || '',
    updatedAt: manifest.updatedAt || '',
    activePage: manifest.activePage || '',
    pages: Array.isArray(manifest.pages) ? manifest.pages.map(function(page) {
      return { name: page.name, bytes: Number(page.bytes || 0) };
    }) : [],
    imageAssetCount: manifest.assets && Array.isArray(manifest.assets.images) ? manifest.assets.images.length : 0,
    noteCount: htmlStudioReviewNoteCount_(manifest.review),
    review: htmlStudioNormalizeReview_(manifest.review),
    driveUrl: folder.getUrl()
  };
}

function htmlStudioLoadProjectPage(projectId, pageName) {
  var folder = htmlStudioGetProjectFolder_(projectId);
  var manifest = htmlStudioReadProjectManifest_(folder);
  if (!manifest) throw new Error('Project manifest is missing.');
  var safeName = sanitizeHtmlFilename_(pageName, 1);
  var allowed = (manifest.pages || []).some(function(page) { return String(page.name).toLowerCase() === safeName.toLowerCase(); });
  if (!allowed) throw new Error('That page is not part of this project.');
  var file = htmlStudioFindFileByName_(folder, safeName);
  if (!file) throw new Error('The Drive file for ' + safeName + ' is missing.');
  return { name: safeName, html: file.getBlob().getDataAsString('UTF-8') };
}

function htmlStudioBeginProjectSave(request) {
  request = request || {};
  var lock = LockService.getUserLock();
  lock.waitLock(20000);
  try {
    var projectName = htmlStudioSanitizeProjectName_(request.name || 'Untitled Project');
    var folder;
    var existingManifest = null;
    if (request.projectId) {
      folder = htmlStudioGetProjectFolder_(request.projectId);
      existingManifest = htmlStudioReadProjectManifest_(folder);
      folder.setName(projectName);
    } else {
      folder = htmlStudioGetProjectsFolder_().createFolder(projectName);
    }

    var now = new Date().toISOString();
    var manifest = existingManifest || {
      schemaVersion: 3,
      createdAt: now,
      pages: []
    };
    manifest.name = projectName;
    manifest.updatedAt = now;
    manifest.build = HTML_STUDIO_BUILD;
    manifest.saveState = 'saving';
    htmlStudioWriteProjectManifest_(folder, manifest);
    PropertiesService.getUserProperties().setProperty(HTML_STUDIO_LAST_PROJECT_KEY, folder.getId());

    return { id: folder.getId(), name: projectName, driveUrl: folder.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

function htmlStudioSaveProjectPage(projectId, pageName, html) {
  var folder = htmlStudioGetProjectFolder_(projectId);
  var safeName = sanitizeHtmlFilename_(pageName, 1);
  html = typeof html === 'string' ? html : '';
  var bytes = Utilities.newBlob(html, 'text/html').getBytes().length;
  if (bytes > HTML_STUDIO_MAX_PAGE_BYTES) {
    throw new Error(safeName + ' is larger than the 9 MB Drive project-save limit. Export that page separately or reduce embedded media.');
  }
  var file = htmlStudioFindFileByName_(folder, safeName);
  if (file) file.setContent(html);
  else file = folder.createFile(safeName, html, MimeType.HTML);
  return { name: safeName, bytes: bytes, fileId: file.getId() };
}

function htmlStudioFinalizeProjectSave(projectId, request) {
  request = request || {};
  var lock = LockService.getUserLock();
  lock.waitLock(20000);
  try {
    var folder = htmlStudioGetProjectFolder_(projectId);
    var oldManifest = htmlStudioReadProjectManifest_(folder) || {};
    var requestedPages = Array.isArray(request.pages) ? request.pages : [];
    var normalized = [];
    var keep = {};

    requestedPages.forEach(function(page, index) {
      var name = sanitizeHtmlFilename_(page && page.name ? page.name : 'page-' + (index + 1) + '.html', index + 1);
      keep[name.toLowerCase()] = true;
      normalized.push({ name: name, bytes: Number(page && page.bytes || 0) });
    });

    (oldManifest.pages || []).forEach(function(page) {
      var oldName = sanitizeHtmlFilename_(page && page.name ? page.name : '', 1);
      if (!oldName || keep[oldName.toLowerCase()]) return;
      var oldFile = htmlStudioFindFileByName_(folder, oldName);
      if (oldFile) oldFile.setTrashed(true);
    });

    var now = new Date().toISOString();
    var manifest = {
      schemaVersion: 3,
      name: htmlStudioSanitizeProjectName_(request.name || oldManifest.name || folder.getName()),
      createdAt: oldManifest.createdAt || now,
      updatedAt: now,
      build: HTML_STUDIO_BUILD,
      activePage: request.activePage || (normalized[0] && normalized[0].name) || '',
      pages: normalized,
      assets: oldManifest.assets || { images: [] },
      imageArchive: request.imageArchive || oldManifest.imageArchive || null,
      review: htmlStudioNormalizeReviewForPages_(request.review || oldManifest.review, keep),
      saveState: 'saved'
    };
    folder.setName(manifest.name);
    htmlStudioWriteProjectManifest_(folder, manifest);
    PropertiesService.getUserProperties().setProperty(HTML_STUDIO_LAST_PROJECT_KEY, folder.getId());
    return {
      id: folder.getId(),
      name: manifest.name,
      updatedAt: manifest.updatedAt,
      pageCount: normalized.length,
      imageAssetCount: manifest.assets && Array.isArray(manifest.assets.images) ? manifest.assets.images.length : 0,
      noteCount: htmlStudioReviewNoteCount_(manifest.review),
      activePage: manifest.activePage,
      driveUrl: folder.getUrl()
    };
  } finally {
    lock.releaseLock();
  }
}

function htmlStudioNormalizeReview_(review) {
  var source = review && review.notes && typeof review.notes === 'object' ? review.notes : {};
  var normalized = { schemaVersion: 1, notes: {} };
  var total = 0;
  Object.keys(source).slice(0, 100).forEach(function(pageName) {
    if (total >= 500) return;
    var list = Array.isArray(source[pageName]) ? source[pageName] : [];
    var safePage = sanitizeHtmlFilename_(String(pageName || 'page.html'), 1);
    normalized.notes[safePage] = [];
    list.slice(0, 100).forEach(function(note) {
      if (total >= 500 || !note) return;
      normalized.notes[safePage].push({
        id: String(note.id || ('note-' + (total + 1))).slice(0, 100),
        page: safePage,
        path: String(note.path || '').slice(0, 500),
        label: String(note.label || '').slice(0, 200),
        domId: String(note.domId || '').slice(0, 200),
        sourceSelector: String(note.sourceSelector || '').slice(0, 1000),
        tag: String(note.tag || '').slice(0, 80),
        classes: Array.isArray(note.classes) ? note.classes.slice(0, 6).map(function(value) { return String(value).slice(0, 120); }) : [],
        title: String(note.title || 'Editor note').slice(0, 300),
        body: String(note.body || '').slice(0, 8000),
        status: note.status === 'resolved' ? 'resolved' : 'open',
        createdAt: String(note.createdAt || '').slice(0, 60),
        updatedAt: String(note.updatedAt || '').slice(0, 60)
      });
      total++;
    });
    if (!normalized.notes[safePage].length) delete normalized.notes[safePage];
  });
  return normalized;
}

function htmlStudioReviewNoteCount_(review) {
  var normalized = htmlStudioNormalizeReview_(review);
  var count = 0;
  Object.keys(normalized.notes).forEach(function(pageName) { count += normalized.notes[pageName].length; });
  return count;
}

function htmlStudioNormalizeReviewForPages_(review, keep) {
  var normalized = htmlStudioNormalizeReview_(review);
  keep = keep || {};
  Object.keys(normalized.notes).forEach(function(pageName) {
    if (!keep[String(pageName).toLowerCase()]) delete normalized.notes[pageName];
  });
  return normalized;
}

function htmlStudioRenameProject(projectId, newName) {
  var folder = htmlStudioGetProjectFolder_(projectId);
  var manifest = htmlStudioReadProjectManifest_(folder);
  if (!manifest) throw new Error('Project manifest is missing.');
  var name = htmlStudioSanitizeProjectName_(newName);
  folder.setName(name);
  manifest.name = name;
  manifest.updatedAt = new Date().toISOString();
  htmlStudioWriteProjectManifest_(folder, manifest);
  return { id: folder.getId(), name: name, updatedAt: manifest.updatedAt, driveUrl: folder.getUrl() };
}

function htmlStudioDeleteProject(projectId) {
  var folder = htmlStudioGetProjectFolder_(projectId);
  var name = folder.getName();
  folder.setTrashed(true);
  var props = PropertiesService.getUserProperties();
  if (props.getProperty(HTML_STUDIO_LAST_PROJECT_KEY) === projectId) props.deleteProperty(HTML_STUDIO_LAST_PROJECT_KEY);
  return { id: projectId, name: name, deleted: true };
}

function htmlStudioArchiveProjectImage(projectId, request) {
  request = request || {};
  var sourceUrl = String(request.url || '').trim();
  htmlStudioValidateRemoteImageUrl_(sourceUrl);
  var folder = htmlStudioGetProjectFolder_(projectId);
  var lock = LockService.getUserLock();
  lock.waitLock(20000);
  try {
    var manifest = htmlStudioReadProjectManifest_(folder) || { schemaVersion: 3, name: folder.getName(), pages: [] };
    manifest.assets = manifest.assets || {};
    manifest.assets.images = Array.isArray(manifest.assets.images) ? manifest.assets.images : [];

    var existing = null;
    for (var i = 0; i < manifest.assets.images.length; i++) {
      if (String(manifest.assets.images[i].sourceUrl || '').toLowerCase() === sourceUrl.toLowerCase()) {
        existing = manifest.assets.images[i];
        break;
      }
    }
    if (existing && existing.fileId) {
      try {
        var existingFile = DriveApp.getFileById(existing.fileId);
        return {
          saved: false,
          reused: true,
          sourceUrl: sourceUrl,
          fileId: existing.fileId,
          name: existing.name || existingFile.getName(),
          bytes: Number(existing.bytes || existingFile.getSize() || 0),
          driveUrl: existing.driveUrl || existingFile.getUrl()
        };
      } catch (_) {
        /* The previously archived file was removed; fetch a replacement. */
      }
    }

    var response = UrlFetchApp.fetch(sourceUrl, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      validateHttpsCertificates: true,
      headers: { 'User-Agent': 'UnScriptly-HTML-Studio/8.11.0' }
    });
    var status = Number(response.getResponseCode() || 0);
    if (status < 200 || status >= 300) throw new Error('Image request returned HTTP ' + status + '.');

    var blob = response.getBlob();
    var bytes = blob.getBytes();
    if (!bytes.length) throw new Error('The image response was empty.');
    if (bytes.length > HTML_STUDIO_MAX_REMOTE_IMAGE_BYTES) throw new Error('Remote image exceeds the 20 MB project-asset limit.');

    var headers = response.getAllHeaders ? response.getAllHeaders() : {};
    var contentType = String((headers && (headers['Content-Type'] || headers['content-type'])) || blob.getContentType() || '').split(';')[0].trim().toLowerCase();
    if (!/^image\//i.test(contentType)) throw new Error('The URL did not return an image content type.');

    var imagesFolder = htmlStudioGetImageAssetsFolder_(folder);
    var filename = htmlStudioSanitizeImageFilename_(request.suggestedName || sourceUrl, contentType);
    filename = htmlStudioUniqueDriveFilename_(imagesFolder, filename);
    blob.setName(filename);
    blob.setContentType(contentType);
    var file = imagesFolder.createFile(blob);
    file.setDescription('Archived by UnScriptly HTML Studio from ' + sourceUrl);

    var record = {
      sourceUrl: sourceUrl,
      fileId: file.getId(),
      name: filename,
      contentType: contentType,
      bytes: bytes.length,
      driveUrl: file.getUrl(),
      pageNames: Array.isArray(request.pageNames) ? request.pageNames.slice(0, 50) : [],
      archivedAt: new Date().toISOString()
    };
    if (existing) {
      var index = manifest.assets.images.indexOf(existing);
      manifest.assets.images[index] = record;
    } else {
      manifest.assets.images.push(record);
    }
    manifest.schemaVersion = 3;
    manifest.updatedAt = new Date().toISOString();
    htmlStudioWriteProjectManifest_(folder, manifest);
    return {
      saved: true,
      reused: false,
      sourceUrl: sourceUrl,
      fileId: record.fileId,
      name: record.name,
      bytes: record.bytes,
      driveUrl: record.driveUrl
    };
  } finally {
    lock.releaseLock();
  }
}

function htmlStudioGetImageAssetsFolder_(projectFolder) {
  var assetFolders = projectFolder.getFoldersByName(HTML_STUDIO_ASSETS_FOLDER);
  var assets = assetFolders.hasNext() ? assetFolders.next() : projectFolder.createFolder(HTML_STUDIO_ASSETS_FOLDER);
  var imageFolders = assets.getFoldersByName(HTML_STUDIO_IMAGE_ASSETS_FOLDER);
  return imageFolders.hasNext() ? imageFolders.next() : assets.createFolder(HTML_STUDIO_IMAGE_ASSETS_FOLDER);
}

function htmlStudioValidateRemoteImageUrl_(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only HTTP or HTTPS image URLs can be archived.');
  var match = url.match(/^https?:\/\/([^\/?#]+)/i);
  if (!match) throw new Error('The image URL is invalid.');
  var authority = String(match[1] || '');
  /* Strip optional userinfo before inspecting the actual host. */
  if (authority.indexOf('@') >= 0) authority = authority.split('@').pop();
  var host = authority;
  if (host.charAt(0) === '[') {
    var close = host.indexOf(']');
    if (close < 0) throw new Error('The image URL contains an invalid IPv6 host.');
    host = host.slice(1, close);
  } else {
    host = host.split(':')[0];
  }
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || /\.localhost$/.test(host) || /\.local$/.test(host) || host === '::1') {
    throw new Error('Local or private network URLs cannot be fetched.');
  }
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
    throw new Error('Private or link-local IPv6 image URLs cannot be fetched.');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    var p = host.split('.').map(Number);
    if (p.some(function(part) { return part < 0 || part > 255 || isNaN(part); })) throw new Error('The image URL contains an invalid IPv4 address.');
    if (p[0] === 10 || p[0] === 127 || p[0] === 0 ||
        (p[0] === 169 && p[1] === 254) ||
        (p[0] === 192 && p[1] === 168) ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31)) {
      throw new Error('Private or link-local image URLs cannot be fetched.');
    }
  }
}

function htmlStudioSanitizeImageFilename_(value, contentType) {
  var raw = String(value || 'remote-image');
  try { raw = decodeURIComponent(raw); } catch (_) {}
  raw = raw.split('?')[0].split('#')[0].split('/').pop() || 'remote-image';
  raw = raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  var extMap = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/avif': '.avif',
    'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico'
  };
  var desiredExt = extMap[String(contentType || '').toLowerCase()] || '';
  if (!raw) raw = 'remote-image';
  if (desiredExt && !/\.[a-z0-9]{2,6}$/i.test(raw)) raw += desiredExt;
  else if (desiredExt && !raw.toLowerCase().endsWith(desiredExt)) raw = raw.replace(/\.[a-z0-9]{2,6}$/i, '') + desiredExt;
  return raw.slice(0, 160);
}

function htmlStudioUniqueDriveFilename_(folder, filename) {
  if (!folder.getFilesByName(filename).hasNext()) return filename;
  var match = filename.match(/^(.*?)(\.[^.]+)?$/);
  var stem = match && match[1] ? match[1] : 'image';
  var ext = match && match[2] ? match[2] : '';
  var index = 2;
  var candidate = stem + '-' + index + ext;
  while (folder.getFilesByName(candidate).hasNext()) {
    index++;
    candidate = stem + '-' + index + ext;
  }
  return candidate;
}

function htmlStudioGetProjectStorageInfo() {
  var folder = htmlStudioGetProjectsFolder_();
  return { folderId: folder.getId(), folderName: folder.getName(), driveUrl: folder.getUrl() };
}

function htmlStudioGetProjectsFolder_() {
  var props = PropertiesService.getUserProperties();
  var cachedId = props.getProperty(HTML_STUDIO_PROJECTS_FOLDER_KEY);
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (_) { props.deleteProperty(HTML_STUDIO_PROJECTS_FOLDER_KEY); }
  }

  var root = DriveApp.getRootFolder();
  var appFolders = root.getFoldersByName(HTML_STUDIO_PROJECT_ROOT);
  var appFolder = appFolders.hasNext() ? appFolders.next() : root.createFolder(HTML_STUDIO_PROJECT_ROOT);
  var projectFolders = appFolder.getFoldersByName(HTML_STUDIO_PROJECTS_FOLDER);
  var projectsFolder = projectFolders.hasNext() ? projectFolders.next() : appFolder.createFolder(HTML_STUDIO_PROJECTS_FOLDER);
  props.setProperty(HTML_STUDIO_PROJECTS_FOLDER_KEY, projectsFolder.getId());
  return projectsFolder;
}

function htmlStudioGetProjectFolder_(projectId) {
  if (!projectId) throw new Error('Project ID is required.');
  var folder;
  try { folder = DriveApp.getFolderById(String(projectId)); }
  catch (_) { throw new Error('The requested project could not be found in Google Drive.'); }

  var projectsFolder = htmlStudioGetProjectsFolder_();
  var parents = folder.getParents();
  var valid = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === projectsFolder.getId()) { valid = true; break; }
  }
  if (!valid) throw new Error('The requested folder is outside the UnScriptly Projects directory.');
  return folder;
}

function htmlStudioReadProjectManifest_(folder) {
  var file = htmlStudioFindFileByName_(folder, HTML_STUDIO_PROJECT_MANIFEST);
  if (!file) return null;
  try { return JSON.parse(file.getBlob().getDataAsString('UTF-8')); }
  catch (_) { return null; }
}

function htmlStudioWriteProjectManifest_(folder, manifest) {
  var content = JSON.stringify(manifest, null, 2);
  var file = htmlStudioFindFileByName_(folder, HTML_STUDIO_PROJECT_MANIFEST);
  if (file) file.setContent(content);
  else folder.createFile(HTML_STUDIO_PROJECT_MANIFEST, content, MimeType.PLAIN_TEXT);
}

function htmlStudioFindFileByName_(folder, name) {
  var files = folder.getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function htmlStudioSanitizeProjectName_(name) {
  var cleaned = String(name || '').replace(/[\\/:*?\"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  if (!cleaned) cleaned = 'Untitled Project';
  return cleaned.slice(0, 120);
}



/* -------------------------------------------------------------------------
 * Global Google Drive Media Library
 *
 * Storage layout (shared by every UnScriptly project owned by the user):
 *   UnScriptly HTML Studio/
 *     Media/
 *       My Media/
 *       <Custom Folder>/
 *
 * Important: media bytes are never persisted in browser storage, project
 * manifests, Script Properties, or UnScriptly client state. The browser keeps
 * metadata only. File bytes live in Google Drive. Upload base64 is transient
 * and discarded after the Drive file is created.
 * ---------------------------------------------------------------------- */
var HTML_STUDIO_MEDIA_FOLDER = 'Media';
var HTML_STUDIO_MEDIA_FOLDER_KEY = 'UNSCRIPTLY_MEDIA_ROOT_FOLDER_ID';
var HTML_STUDIO_LAST_MEDIA_FOLDER_KEY = 'UNSCRIPTLY_LAST_MEDIA_FOLDER_ID';
var HTML_STUDIO_DEFAULT_MEDIA_FOLDER = 'My Media';
var HTML_STUDIO_MAX_MEDIA_BYTES = 25 * 1024 * 1024;

function htmlStudioGetMediaLibrary(folderId) {
  var folders = htmlStudioListMediaFolders_();
  var active;
  if (folderId) {
    active = htmlStudioGetMediaFolder_(folderId);
  } else {
    var remembered = '';
    try { remembered = PropertiesService.getUserProperties().getProperty(HTML_STUDIO_LAST_MEDIA_FOLDER_KEY) || ''; } catch (_) {}
    if (remembered) {
      try { active = htmlStudioGetMediaFolder_(remembered); } catch (_) { active = null; }
    }
    if (!active) active = htmlStudioGetOrCreateMediaFolderByName_(HTML_STUDIO_DEFAULT_MEDIA_FOLDER);
  }
  PropertiesService.getUserProperties().setProperty(HTML_STUDIO_LAST_MEDIA_FOLDER_KEY, active.getId());
  return {
    activeFolderId: active.getId(),
    folders: folders,
    assets: htmlStudioListMediaFiles_(active),
    storage: htmlStudioGetMediaStorageInfo()
  };
}

function htmlStudioCreateMediaFolder(name) {
  var safeName = htmlStudioSanitizeMediaName_(name, 'Media Folder');
  var folder = htmlStudioGetOrCreateMediaFolderByName_(safeName);
  PropertiesService.getUserProperties().setProperty(HTML_STUDIO_LAST_MEDIA_FOLDER_KEY, folder.getId());
  return { id: folder.getId(), name: folder.getName(), driveUrl: folder.getUrl() };
}

function htmlStudioSaveMediaFile(request) {
  request = request || {};
  var folder = request.folderId ? htmlStudioGetMediaFolder_(request.folderId) : htmlStudioGetOrCreateMediaFolderByName_(HTML_STUDIO_DEFAULT_MEDIA_FOLDER);
  var base64 = String(request.base64 || '');
  if (!base64) throw new Error('Media file data is missing.');
  var bytes;
  try { bytes = Utilities.base64Decode(base64); }
  catch (_) { throw new Error('Media file data could not be decoded.'); }
  if (bytes.length > HTML_STUDIO_MAX_MEDIA_BYTES) throw new Error('This media file is larger than the 25 MB Drive Media Library limit.');

  var mimeType = htmlStudioNormalizeMediaMime_(request.mimeType, request.name, request.kind);
  var kind = htmlStudioMediaKind_(mimeType, request.name, request.kind);
  if (!kind) throw new Error('Only image, SVG, video, and audio files can be saved to the Media Library.');
  var filename = htmlStudioSanitizeMediaFilename_(request.name, kind, mimeType);
  filename = htmlStudioUniqueDriveFilename_(folder, filename);
  var blob = Utilities.newBlob(bytes, mimeType, filename);
  var file = folder.createFile(blob);
  file.setDescription('UnScriptly HTML Studio Media Library');
  PropertiesService.getUserProperties().setProperty(HTML_STUDIO_LAST_MEDIA_FOLDER_KEY, folder.getId());
  return htmlStudioMediaFileDto_(file, folder, kind);
}

function htmlStudioSaveMediaUrl(request) {
  request = request || {};
  var rawUrl = String(request.url || '').trim();
  htmlStudioValidateRemoteMediaUrl_(rawUrl);
  var folder = request.folderId ? htmlStudioGetMediaFolder_(request.folderId) : htmlStudioGetOrCreateMediaFolderByName_(HTML_STUDIO_DEFAULT_MEDIA_FOLDER);

  var response = UrlFetchApp.fetch(rawUrl, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
    validateHttpsCertificates: true,
    headers: { 'User-Agent': 'UnScriptly-HTML-Studio/8.11.0 Media Library' }
  });
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('The hosted media URL returned HTTP ' + status + '.');

  var blob = response.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > HTML_STUDIO_MAX_MEDIA_BYTES) throw new Error('The hosted media file is larger than the 25 MB Drive Media Library limit.');
  var requestedKind = String(request.kind || '').toLowerCase();
  var mimeType = htmlStudioNormalizeMediaMime_(blob.getContentType(), rawUrl, requestedKind);
  var kind = htmlStudioMediaKind_(mimeType, rawUrl, requestedKind);
  if (!kind) throw new Error('The hosted URL did not return a supported image, video, or audio file.');

  var candidate = htmlStudioFilenameFromUrl_(rawUrl) || ('Hosted ' + kind);
  var filename = htmlStudioSanitizeMediaFilename_(candidate, kind, mimeType);
  filename = htmlStudioUniqueDriveFilename_(folder, filename);
  blob.setName(filename).setContentType(mimeType);
  var file = folder.createFile(blob);
  file.setDescription('UnScriptly HTML Studio Media Library · imported from ' + rawUrl.slice(0, 500));
  PropertiesService.getUserProperties().setProperty(HTML_STUDIO_LAST_MEDIA_FOLDER_KEY, folder.getId());
  return htmlStudioMediaFileDto_(file, folder, kind);
}

function htmlStudioDeleteMedia(mediaId) {
  var file = htmlStudioGetMediaFile_(mediaId);
  var name = file.getName();
  file.setTrashed(true);
  return { deleted: true, id: String(mediaId), name: name };
}

function htmlStudioGetMediaStorageInfo() {
  var root = htmlStudioGetMediaRootFolder_();
  return { folderId: root.getId(), folderName: root.getName(), driveUrl: root.getUrl() };
}

function htmlStudioListMediaFolders_() {
  var root = htmlStudioGetMediaRootFolder_();
  htmlStudioGetOrCreateMediaFolderByName_(HTML_STUDIO_DEFAULT_MEDIA_FOLDER);
  var iter = root.getFolders();
  var result = [];
  while (iter.hasNext()) {
    var folder = iter.next();
    var files = folder.getFiles();
    var count = 0;
    while (files.hasNext()) {
      var file = files.next();
      if (htmlStudioMediaKind_(file.getMimeType(), file.getName(), '')) count++;
    }
    result.push({ id: folder.getId(), name: folder.getName(), mediaCount: count, driveUrl: folder.getUrl() });
  }
  result.sort(function(a, b) {
    if (a.name === HTML_STUDIO_DEFAULT_MEDIA_FOLDER) return -1;
    if (b.name === HTML_STUDIO_DEFAULT_MEDIA_FOLDER) return 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function htmlStudioListMediaFiles_(folder) {
  var iter = folder.getFiles();
  var result = [];
  while (iter.hasNext()) {
    var file = iter.next();
    var kind = htmlStudioMediaKind_(file.getMimeType(), file.getName(), '');
    if (!kind) continue;
    result.push(htmlStudioMediaFileDto_(file, folder, kind));
  }
  result.sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  return result;
}

function htmlStudioMediaFileDto_(file, folder, kind) {
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
    thumbnailUrl: kind === 'image' ? ('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w640') : ''
  };
}

function htmlStudioGetMediaRootFolder_() {
  var props = PropertiesService.getUserProperties();
  var cachedId = props.getProperty(HTML_STUDIO_MEDIA_FOLDER_KEY);
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); }
    catch (_) { props.deleteProperty(HTML_STUDIO_MEDIA_FOLDER_KEY); }
  }
  var root = DriveApp.getRootFolder();
  var appFolders = root.getFoldersByName(HTML_STUDIO_PROJECT_ROOT);
  var appFolder = appFolders.hasNext() ? appFolders.next() : root.createFolder(HTML_STUDIO_PROJECT_ROOT);
  var matches = appFolder.getFoldersByName(HTML_STUDIO_MEDIA_FOLDER);
  var folder = matches.hasNext() ? matches.next() : appFolder.createFolder(HTML_STUDIO_MEDIA_FOLDER);
  props.setProperty(HTML_STUDIO_MEDIA_FOLDER_KEY, folder.getId());
  return folder;
}

function htmlStudioGetOrCreateMediaFolderByName_(name) {
  var root = htmlStudioGetMediaRootFolder_();
  var safeName = htmlStudioSanitizeMediaName_(name, HTML_STUDIO_DEFAULT_MEDIA_FOLDER);
  var matches = root.getFoldersByName(safeName);
  return matches.hasNext() ? matches.next() : root.createFolder(safeName);
}

function htmlStudioGetMediaFolder_(folderId) {
  if (!folderId) throw new Error('Media folder ID is required.');
  var folder;
  try { folder = DriveApp.getFolderById(String(folderId)); }
  catch (_) { throw new Error('The media folder could not be found in Google Drive.'); }
  var root = htmlStudioGetMediaRootFolder_();
  var parents = folder.getParents();
  var valid = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === root.getId()) { valid = true; break; }
  }
  if (!valid) throw new Error('The requested folder is outside the shared UnScriptly Media directory.');
  return folder;
}

function htmlStudioGetMediaFile_(mediaId) {
  if (!mediaId) throw new Error('Media file ID is required.');
  var file;
  try { file = DriveApp.getFileById(String(mediaId)); }
  catch (_) { throw new Error('The media file could not be found in Google Drive.'); }
  var parents = file.getParents();
  var valid = false;
  while (parents.hasNext()) {
    try { htmlStudioGetMediaFolder_(parents.next().getId()); valid = true; break; }
    catch (_) {}
  }
  if (!valid) throw new Error('The requested file is outside the shared UnScriptly Media directory.');
  return file;
}

function htmlStudioSanitizeMediaName_(name, fallback) {
  var cleaned = String(name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  if (!cleaned) cleaned = String(fallback || 'Media');
  return cleaned.slice(0, 100);
}

function htmlStudioSanitizeMediaFilename_(name, kind, mimeType) {
  var cleaned = String(name || '').split('?')[0].split('#')[0].replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  if (!cleaned) cleaned = 'Media';
  var ext = htmlStudioMediaExtension_(mimeType, kind);
  if (ext && !new RegExp('\\.' + ext.replace('.', '') + '$', 'i').test(cleaned)) {
    if (!/\.[a-z0-9]{2,5}$/i.test(cleaned)) cleaned += ext;
  }
  return cleaned.slice(0, 140);
}

function htmlStudioMediaExtension_(mimeType, kind) {
  var map = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg', 'audio/flac': '.flac'
  };
  return map[String(mimeType || '').toLowerCase()] || (kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : kind === 'audio' ? '.mp3' : '');
}

function htmlStudioNormalizeMediaMime_(mimeType, name, requestedKind) {
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
  return String(requestedKind || '') === 'image' ? 'image/png' : String(requestedKind || '') === 'video' ? 'video/mp4' : String(requestedKind || '') === 'audio' ? 'audio/mpeg' : mime;
}

function htmlStudioMediaKind_(mimeType, name, requestedKind) {
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

function htmlStudioFilenameFromUrl_(url) {
  try {
    var path = String(url || '').split('?')[0].split('#')[0];
    var name = decodeURIComponent(path.substring(path.lastIndexOf('/') + 1));
    return name || '';
  } catch (_) { return ''; }
}

function htmlStudioValidateRemoteMediaUrl_(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only HTTP or HTTPS media URLs can be saved.');
  var host = String(url).replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
  if (!host || host === 'localhost' || host === '0.0.0.0' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    throw new Error('That media URL points to a private or local network address.');
  }
  var match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) throw new Error('That media URL points to a private network address.');
}


/* -------------------------------------------------------------------------
 * Reusable component library (Google Drive)
 *
 * Storage layout:
 *   UnScriptly HTML Studio/
 *     Components/
 *       My Components/
 *         Hero Banner.component.html
 *       Headers/
 *         Marketing Header.component.html
 *
 * Built-in components remain client-side and require no Drive storage.
 * Custom components are stored as plain HTML snippets so they stay portable.
 * ---------------------------------------------------------------------- */
var HTML_STUDIO_COMPONENTS_FOLDER = 'Components';
var HTML_STUDIO_COMPONENTS_FOLDER_KEY = 'UNSCRIPTLY_COMPONENTS_FOLDER_ID';
var HTML_STUDIO_DEFAULT_COMPONENT_FOLDER = 'My Components';
var HTML_STUDIO_COMPONENT_SUFFIX = '.component.html';
var HTML_STUDIO_MAX_COMPONENT_BYTES = 2 * 1024 * 1024;

function htmlStudioListComponentFolders() {
  var root = htmlStudioGetComponentsFolder_();
  htmlStudioGetOrCreateComponentFolderByName_(HTML_STUDIO_DEFAULT_COMPONENT_FOLDER);
  var folders = root.getFolders();
  var result = [];
  while (folders.hasNext()) {
    var folder = folders.next();
    var files = folder.getFiles();
    var count = 0;
    while (files.hasNext()) {
      var file = files.next();
      if (/\.component\.html$/i.test(file.getName())) count++;
    }
    result.push({
      id: folder.getId(),
      name: folder.getName(),
      componentCount: count,
      driveUrl: folder.getUrl()
    });
  }
  result.sort(function(a, b) {
    if (a.name === HTML_STUDIO_DEFAULT_COMPONENT_FOLDER) return -1;
    if (b.name === HTML_STUDIO_DEFAULT_COMPONENT_FOLDER) return 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function htmlStudioCreateComponentFolder(name) {
  var safeName = htmlStudioSanitizeComponentName_(name, 'Component Folder');
  var folder = htmlStudioGetOrCreateComponentFolderByName_(safeName);
  return { id: folder.getId(), name: folder.getName(), driveUrl: folder.getUrl() };
}

function htmlStudioListComponents(folderId) {
  var folder = folderId ? htmlStudioGetComponentFolder_(folderId) : htmlStudioGetOrCreateComponentFolderByName_(HTML_STUDIO_DEFAULT_COMPONENT_FOLDER);
  var files = folder.getFiles();
  var result = [];
  while (files.hasNext()) {
    var file = files.next();
    if (!/\.component\.html$/i.test(file.getName())) continue;
    result.push({
      id: file.getId(),
      folderId: folder.getId(),
      folderName: folder.getName(),
      name: file.getName().replace(/\.component\.html$/i, ''),
      filename: file.getName(),
      updatedAt: file.getLastUpdated().toISOString(),
      size: file.getSize(),
      driveUrl: file.getUrl()
    });
  }
  result.sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  return result;
}

function htmlStudioSaveComponent(request) {
  request = request || {};
  var html = String(request.html || '');
  if (!html.trim()) throw new Error('Component HTML is empty.');
  var bytes = Utilities.newBlob(html, MimeType.HTML).getBytes().length;
  if (bytes > HTML_STUDIO_MAX_COMPONENT_BYTES) throw new Error('This component is larger than the 2 MB custom-component limit. Save a smaller frame or section.');

  var folder = request.folderId
    ? htmlStudioGetComponentFolder_(request.folderId)
    : htmlStudioGetOrCreateComponentFolderByName_(HTML_STUDIO_DEFAULT_COMPONENT_FOLDER);
  var name = htmlStudioSanitizeComponentName_(request.name, 'Custom Component');
  var filename = name + HTML_STUDIO_COMPONENT_SUFFIX;
  var existing = htmlStudioFindFileByName_(folder, filename);
  var file;
  if (existing) {
    existing.setContent(html);
    file = existing;
  } else {
    file = folder.createFile(filename, html, MimeType.HTML);
  }
  return {
    id: file.getId(),
    folderId: folder.getId(),
    folderName: folder.getName(),
    name: name,
    filename: filename,
    updatedAt: file.getLastUpdated().toISOString(),
    size: file.getSize(),
    driveUrl: file.getUrl()
  };
}

function htmlStudioLoadComponent(componentId) {
  var file = htmlStudioGetComponentFile_(componentId);
  return {
    id: file.getId(),
    name: file.getName().replace(/\.component\.html$/i, ''),
    filename: file.getName(),
    html: file.getBlob().getDataAsString('UTF-8'),
    updatedAt: file.getLastUpdated().toISOString(),
    size: file.getSize(),
    driveUrl: file.getUrl()
  };
}

function htmlStudioDeleteComponent(componentId) {
  var file = htmlStudioGetComponentFile_(componentId);
  var name = file.getName().replace(/\.component\.html$/i, '');
  file.setTrashed(true);
  return { deleted: true, id: String(componentId), name: name };
}

function htmlStudioGetComponentStorageInfo() {
  var folder = htmlStudioGetComponentsFolder_();
  return { folderId: folder.getId(), folderName: folder.getName(), driveUrl: folder.getUrl() };
}

function htmlStudioGetComponentsFolder_() {
  var props = PropertiesService.getUserProperties();
  var cachedId = props.getProperty(HTML_STUDIO_COMPONENTS_FOLDER_KEY);
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); }
    catch (_) { props.deleteProperty(HTML_STUDIO_COMPONENTS_FOLDER_KEY); }
  }
  var root = DriveApp.getRootFolder();
  var appFolders = root.getFoldersByName(HTML_STUDIO_PROJECT_ROOT);
  var appFolder = appFolders.hasNext() ? appFolders.next() : root.createFolder(HTML_STUDIO_PROJECT_ROOT);
  var componentFolders = appFolder.getFoldersByName(HTML_STUDIO_COMPONENTS_FOLDER);
  var folder = componentFolders.hasNext() ? componentFolders.next() : appFolder.createFolder(HTML_STUDIO_COMPONENTS_FOLDER);
  props.setProperty(HTML_STUDIO_COMPONENTS_FOLDER_KEY, folder.getId());
  return folder;
}

function htmlStudioGetOrCreateComponentFolderByName_(name) {
  var root = htmlStudioGetComponentsFolder_();
  var safeName = htmlStudioSanitizeComponentName_(name, HTML_STUDIO_DEFAULT_COMPONENT_FOLDER);
  var matches = root.getFoldersByName(safeName);
  return matches.hasNext() ? matches.next() : root.createFolder(safeName);
}

function htmlStudioGetComponentFolder_(folderId) {
  if (!folderId) throw new Error('Component folder ID is required.');
  var folder;
  try { folder = DriveApp.getFolderById(String(folderId)); }
  catch (_) { throw new Error('The component folder could not be found in Google Drive.'); }
  var root = htmlStudioGetComponentsFolder_();
  var parents = folder.getParents();
  var valid = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === root.getId()) { valid = true; break; }
  }
  if (!valid) throw new Error('The requested folder is outside the UnScriptly Components directory.');
  return folder;
}

function htmlStudioGetComponentFile_(componentId) {
  if (!componentId) throw new Error('Component ID is required.');
  var file;
  try { file = DriveApp.getFileById(String(componentId)); }
  catch (_) { throw new Error('The component could not be found in Google Drive.'); }
  if (!/\.component\.html$/i.test(file.getName())) throw new Error('The requested file is not an UnScriptly component.');
  var parents = file.getParents();
  var valid = false;
  while (parents.hasNext()) {
    var parent = parents.next();
    try { htmlStudioGetComponentFolder_(parent.getId()); valid = true; break; }
    catch (_) {}
  }
  if (!valid) throw new Error('The requested component is outside the UnScriptly Components directory.');
  return file;
}

function htmlStudioSanitizeComponentName_(name, fallback) {
  var cleaned = String(name || '').replace(/[\\/:*?\"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  if (!cleaned) cleaned = String(fallback || 'Component');
  return cleaned.slice(0, 100);
}


/**
 * Returns the pinned html2canvas renderer source to the browser.
 *
 * Why this exists:
 * Apps Script/iPad deployments can block or stall a direct browser request to a
 * third-party CDN. Fetching the renderer with UrlFetchApp gives PNG export a
 * server-side fallback while keeping the actual page rasterization in the browser.
 */
function htmlStudioGetPngRendererSource() {
  var url = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
    validateHttpsCertificates: true,
    headers: { 'User-Agent': 'UnScriptly-HTML-Studio/8.11.0' }
  });

  var status = Number(response.getResponseCode() || 0);
  if (status < 200 || status >= 300) {
    throw new Error('PNG renderer request returned HTTP ' + status + '.');
  }

  var source = String(response.getContentText() || '');
  if (source.length < 10000 || source.indexOf('html2canvas') === -1) {
    throw new Error('PNG renderer response was empty or invalid.');
  }
  return source;
}
