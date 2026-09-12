/**
 * UnScriptly HTML Studio — GitHub Integration Server
 * Build: 8.12.0-github-drive-media-preview-20260830
 *
 * Authentication model:
 * - User provides a GitHub personal access token from Settings.
 * - The token is validated server-side and stored only in Apps Script UserProperties.
 * - The token is never returned to browser JavaScript after connection.
 *
 * Recommended token: GitHub fine-grained PAT with repository Contents read/write
 * permission for only the repositories the user intends to edit.
 */

var HTML_STUDIO_GITHUB_TOKEN_KEY = 'UNSCRIPTLY_GITHUB_TOKEN';
var HTML_STUDIO_GITHUB_LOGIN_KEY = 'UNSCRIPTLY_GITHUB_LOGIN';
var HTML_STUDIO_GITHUB_REPO_KEY = 'UNSCRIPTLY_GITHUB_REPO';
var HTML_STUDIO_GITHUB_BRANCH_KEY = 'UNSCRIPTLY_GITHUB_BRANCH';
var HTML_STUDIO_GITHUB_MEDIA_PATH_KEY = 'UNSCRIPTLY_GITHUB_MEDIA_PATH';
var HTML_STUDIO_GITHUB_API = 'https://api.github.com';
var HTML_STUDIO_GITHUB_API_VERSION = '2022-11-28';
var HTML_STUDIO_GITHUB_MAX_HTML_BYTES = 2 * 1024 * 1024;
var HTML_STUDIO_GITHUB_MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/** Connect GitHub using a PAT. Token is stored only in UserProperties. */
function htmlStudioGitHubConnect(request) {
  request = request || {};
  var token = String(request.token || '').trim();
  if (!token) throw new Error('GitHub token is required.');
  if (token.length < 20) throw new Error('The GitHub token appears incomplete.');

  var response = htmlStudioGitHubRequest_('get', '/user', null, token);
  var user = htmlStudioGitHubJson_(response, 'GitHub user');
  if (!user || !user.login) throw new Error('GitHub did not return a valid user account.');

  var props = PropertiesService.getUserProperties();
  props.setProperty(HTML_STUDIO_GITHUB_TOKEN_KEY, token);
  props.setProperty(HTML_STUDIO_GITHUB_LOGIN_KEY, String(user.login));

  return {
    connected: true,
    login: String(user.login),
    name: String(user.name || ''),
    avatarUrl: String(user.avatar_url || ''),
    repository: props.getProperty(HTML_STUDIO_GITHUB_REPO_KEY) || '',
    branch: props.getProperty(HTML_STUDIO_GITHUB_BRANCH_KEY) || '',
    mediaPath: props.getProperty(HTML_STUDIO_GITHUB_MEDIA_PATH_KEY) || 'assets/media'
  };
}

/** Remove GitHub credentials/configuration from this Apps Script user. */
function htmlStudioGitHubDisconnect() {
  var props = PropertiesService.getUserProperties();
  [HTML_STUDIO_GITHUB_TOKEN_KEY, HTML_STUDIO_GITHUB_LOGIN_KEY, HTML_STUDIO_GITHUB_REPO_KEY,
   HTML_STUDIO_GITHUB_BRANCH_KEY, HTML_STUDIO_GITHUB_MEDIA_PATH_KEY].forEach(function(key) {
    props.deleteProperty(key);
  });
  return { connected: false };
}

/** Return connection/config status without returning the token. */
function htmlStudioGitHubStatus() {
  var props = PropertiesService.getUserProperties();
  var token = props.getProperty(HTML_STUDIO_GITHUB_TOKEN_KEY) || '';
  var repo = props.getProperty(HTML_STUDIO_GITHUB_REPO_KEY) || '';
  var branch = props.getProperty(HTML_STUDIO_GITHUB_BRANCH_KEY) || '';
  var mediaPath = props.getProperty(HTML_STUDIO_GITHUB_MEDIA_PATH_KEY) || 'assets/media';
  var login = props.getProperty(HTML_STUDIO_GITHUB_LOGIN_KEY) || '';

  if (!token) return { connected: false, repository: repo, branch: branch, mediaPath: mediaPath };

  return {
    connected: true,
    login: login,
    repository: repo,
    branch: branch,
    mediaPath: mediaPath
  };
}

/** List repositories accessible to the connected token. */
function htmlStudioGitHubListRepos() {
  var token = htmlStudioGitHubRequireToken_();
  var response = htmlStudioGitHubRequest_(
    'get',
    '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
    null,
    token
  );
  var repos = htmlStudioGitHubJson_(response, 'GitHub repositories');
  if (!Array.isArray(repos)) repos = [];

  return repos.map(function(repo) {
    return {
      fullName: String(repo.full_name || ''),
      name: String(repo.name || ''),
      owner: String(repo.owner && repo.owner.login || ''),
      private: Boolean(repo.private),
      visibility: String(repo.visibility || (repo.private ? 'private' : 'public')),
      defaultBranch: String(repo.default_branch || 'main'),
      htmlUrl: String(repo.html_url || ''),
      canPush: Boolean(repo.permissions && (repo.permissions.push || repo.permissions.admin || repo.permissions.maintain))
    };
  }).filter(function(repo) { return repo.fullName; });
}

/** Save the active GitHub repository, branch, and media path. */
function htmlStudioGitHubConfigure(request) {
  request = request || {};
  var token = htmlStudioGitHubRequireToken_();
  var repoRef = htmlStudioGitHubRepoRef_(request.repository);
  var repoResponse = htmlStudioGitHubRequest_('get', '/repos/' + encodeURIComponent(repoRef.owner) + '/' + encodeURIComponent(repoRef.repo), null, token);
  var repo = htmlStudioGitHubJson_(repoResponse, 'GitHub repository');

  var branch = htmlStudioGitHubSafeBranch_(request.branch || repo.default_branch || 'main');
  htmlStudioGitHubRequest_(
    'get',
    '/repos/' + encodeURIComponent(repoRef.owner) + '/' + encodeURIComponent(repoRef.repo) + '/branches/' + encodeURIComponent(branch),
    null,
    token
  );

  var mediaPath = htmlStudioGitHubSafeDirectory_(request.mediaPath || 'assets/media');
  var props = PropertiesService.getUserProperties();
  props.setProperty(HTML_STUDIO_GITHUB_REPO_KEY, repoRef.owner + '/' + repoRef.repo);
  props.setProperty(HTML_STUDIO_GITHUB_BRANCH_KEY, branch);
  props.setProperty(HTML_STUDIO_GITHUB_MEDIA_PATH_KEY, mediaPath);

  return {
    connected: true,
    login: props.getProperty(HTML_STUDIO_GITHUB_LOGIN_KEY) || '',
    repository: repoRef.owner + '/' + repoRef.repo,
    branch: branch,
    mediaPath: mediaPath,
    private: Boolean(repo.private),
    visibility: String(repo.visibility || (repo.private ? 'private' : 'public')),
    repoUrl: String(repo.html_url || '')
  };
}

/** Import one HTML/TXT file from the configured GitHub repository. */
function htmlStudioGitHubImportHtml(request) {
  request = request || {};
  var cfg = htmlStudioGitHubRequireConfig_();
  var path = htmlStudioGitHubSafePath_(request.path || 'index.html');
  if (!/\.(?:html?|txt)$/i.test(path)) throw new Error('Choose an HTML, HTM, or TXT file from the GitHub repository.');

  var endpoint = '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents/' +
    htmlStudioGitHubEncodePath_(path) + '?ref=' + encodeURIComponent(cfg.branch);
  var response = htmlStudioGitHubRequest_('get', endpoint, null, cfg.token);
  var item = htmlStudioGitHubJson_(response, 'GitHub HTML file');
  if (!item || item.type !== 'file') throw new Error('The GitHub path does not point to a file.');

  var html = '';
  if (item.encoding === 'base64' && item.content) {
    html = Utilities.newBlob(Utilities.base64Decode(String(item.content).replace(/\s/g, ''))).getDataAsString('UTF-8');
  } else if (item.download_url) {
    var raw = UrlFetchApp.fetch(String(item.download_url), {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github.raw',
        'User-Agent': 'UnScriptly-HTML-Studio/8.12.0'
      }
    });
    if (raw.getResponseCode() < 200 || raw.getResponseCode() >= 300) throw new Error('GitHub raw file returned HTTP ' + raw.getResponseCode() + '.');
    html = raw.getContentText('UTF-8');
  } else {
    throw new Error('GitHub did not return file content for this path.');
  }

  if (Utilities.newBlob(html).getBytes().length > HTML_STUDIO_GITHUB_MAX_HTML_BYTES) {
    throw new Error('This HTML file is larger than the 2 MB GitHub import limit.');
  }

  return {
    name: String(item.name || path.split('/').pop() || 'index.html').replace(/\.txt$/i, '.html'),
    path: path,
    html: html,
    sha: String(item.sha || ''),
    htmlUrl: String(item.html_url || ''),
    downloadUrl: String(item.download_url || '')
  };
}

/** Commit/create the active HTML page in the configured GitHub repository. */
function htmlStudioGitHubCommitHtml(request) {
  request = request || {};
  var cfg = htmlStudioGitHubRequireConfig_();
  var path = htmlStudioGitHubSafePath_(request.path || 'index.html');
  var html = String(request.html || '');
  if (!html) throw new Error('HTML source is empty.');
  if (Utilities.newBlob(html).getBytes().length > HTML_STUDIO_GITHUB_MAX_HTML_BYTES) {
    throw new Error('This HTML file is larger than the 2 MB commit limit.');
  }

  return htmlStudioGitHubPutContent_(cfg, {
    path: path,
    bytes: Utilities.newBlob(html, 'text/html', path.split('/').pop()).getBytes(),
    message: String(request.message || ('Update ' + path + ' from UnScriptly')).trim() || ('Update ' + path + ' from UnScriptly')
  });
}

/** Upload a Drive Media Library asset to GitHub and return its repository/raw URL. */
function htmlStudioGitHubUploadDriveMedia(request) {
  request = request || {};
  var cfg = htmlStudioGitHubRequireConfig_();
  var mediaId = String(request.mediaId || '');
  if (!mediaId) throw new Error('Media file ID is required.');

  var file;
  if (typeof htmlStudioMediaServerGetFile_ === 'function') file = htmlStudioMediaServerGetFile_(mediaId);
  else file = DriveApp.getFileById(mediaId);

  var size = Number(file.getSize() || 0);
  if (size > HTML_STUDIO_GITHUB_MAX_MEDIA_BYTES) throw new Error('This media file is larger than the 25 MB GitHub upload limit.');

  var defaultPath = htmlStudioGitHubSafeDirectory_(cfg.mediaPath || 'assets/media') + '/' + htmlStudioGitHubSafeFilename_(file.getName());
  var path = htmlStudioGitHubSafePath_(request.path || defaultPath);
  var result = htmlStudioGitHubPutContent_(cfg, {
    path: path,
    bytes: file.getBlob().getBytes(),
    message: String(request.message || ('Upload ' + path + ' from UnScriptly')).trim() || ('Upload ' + path + ' from UnScriptly')
  });

  var repoMeta = htmlStudioGitHubRepoMeta_(cfg);
  result.private = Boolean(repoMeta.private);
  result.visibility = String(repoMeta.visibility || (repoMeta.private ? 'private' : 'public'));
  result.publicUrl = repoMeta.private ? '' : result.rawUrl;
  return result;
}

/** List files/directories for lightweight repository browsing. */
function htmlStudioGitHubListDirectory(request) {
  request = request || {};
  var cfg = htmlStudioGitHubRequireConfig_();
  var path = request.path ? htmlStudioGitHubSafeDirectory_(request.path) : '';
  var endpoint = '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents' +
    (path ? '/' + htmlStudioGitHubEncodePath_(path) : '') + '?ref=' + encodeURIComponent(cfg.branch);
  var response = htmlStudioGitHubRequest_('get', endpoint, null, cfg.token);
  var items = htmlStudioGitHubJson_(response, 'GitHub directory');
  if (!Array.isArray(items)) items = [items];
  return items.map(function(item) {
    return {
      name: String(item.name || ''),
      path: String(item.path || ''),
      type: String(item.type || ''),
      size: Number(item.size || 0),
      sha: String(item.sha || ''),
      htmlUrl: String(item.html_url || ''),
      downloadUrl: String(item.download_url || '')
    };
  });
}

function htmlStudioGitHubHealth() {
  var status = htmlStudioGitHubStatus();
  return {
    ok: true,
    module: 'StudioGitHubServer',
    version: '8.12.0-github-drive-media-preview-20260830',
    connected: Boolean(status.connected),
    repository: String(status.repository || ''),
    branch: String(status.branch || '')
  };
}

function htmlStudioGitHubPutContent_(cfg, input) {
  var path = htmlStudioGitHubSafePath_(input.path);
  var endpoint = '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents/' + htmlStudioGitHubEncodePath_(path);
  var existingSha = '';

  var existing = htmlStudioGitHubRequest_('get', endpoint + '?ref=' + encodeURIComponent(cfg.branch), null, cfg.token, true);
  if (existing.getResponseCode() >= 200 && existing.getResponseCode() < 300) {
    var existingItem = htmlStudioGitHubJson_(existing, 'GitHub existing file');
    existingSha = String(existingItem && existingItem.sha || '');
  } else if (existing.getResponseCode() !== 404) {
    htmlStudioGitHubThrowResponse_(existing, 'read existing GitHub file');
  }

  var payload = {
    message: String(input.message || ('Update ' + path + ' from UnScriptly')),
    content: Utilities.base64Encode(input.bytes || []),
    branch: cfg.branch
  };
  if (existingSha) payload.sha = existingSha;

  var response = htmlStudioGitHubRequest_('put', endpoint, payload, cfg.token);
  var result = htmlStudioGitHubJson_(response, 'GitHub commit');
  var branchPath = String(cfg.branch).split('/').map(encodeURIComponent).join('/');
  var rawPath = path.split('/').map(encodeURIComponent).join('/');

  return {
    created: !existingSha,
    repository: cfg.owner + '/' + cfg.repo,
    branch: cfg.branch,
    path: path,
    sha: String(result && result.content && result.content.sha || ''),
    commitSha: String(result && result.commit && result.commit.sha || ''),
    htmlUrl: String(result && result.content && result.content.html_url || ''),
    downloadUrl: String(result && result.content && result.content.download_url || ''),
    rawUrl: 'https://raw.githubusercontent.com/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/' + branchPath + '/' + rawPath
  };
}

function htmlStudioGitHubRepoMeta_(cfg) {
  var response = htmlStudioGitHubRequest_('get', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo), null, cfg.token);
  return htmlStudioGitHubJson_(response, 'GitHub repository');
}

function htmlStudioGitHubRequireToken_() {
  var token = PropertiesService.getUserProperties().getProperty(HTML_STUDIO_GITHUB_TOKEN_KEY) || '';
  if (!token) throw new Error('GitHub is not connected. Open Settings → GitHub and connect first.');
  return token;
}

function htmlStudioGitHubRequireConfig_() {
  var props = PropertiesService.getUserProperties();
  var token = htmlStudioGitHubRequireToken_();
  var repoRef = htmlStudioGitHubRepoRef_(props.getProperty(HTML_STUDIO_GITHUB_REPO_KEY) || '');
  var branch = htmlStudioGitHubSafeBranch_(props.getProperty(HTML_STUDIO_GITHUB_BRANCH_KEY) || 'main');
  var mediaPath = htmlStudioGitHubSafeDirectory_(props.getProperty(HTML_STUDIO_GITHUB_MEDIA_PATH_KEY) || 'assets/media');
  return { token: token, owner: repoRef.owner, repo: repoRef.repo, branch: branch, mediaPath: mediaPath };
}

function htmlStudioGitHubRepoRef_(value) {
  var cleaned = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  var parts = cleaned.split('/');
  if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) {
    throw new Error('Choose a GitHub repository in owner/repository format.');
  }
  return { owner: parts[0], repo: parts[1] };
}

function htmlStudioGitHubSafeBranch_(value) {
  var branch = String(value || 'main').trim();
  if (!branch || branch.length > 200 || /[~^:?*\[\\\s]/.test(branch) || /\.\./.test(branch) || /@\{/.test(branch)) {
    throw new Error('The GitHub branch name is invalid.');
  }
  return branch;
}

function htmlStudioGitHubSafeDirectory_(value) {
  var path = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!path) return '';
  return htmlStudioGitHubSafePath_(path);
}

function htmlStudioGitHubSafePath_(value) {
  var path = String(value || '').trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!path || path.length > 900) throw new Error('GitHub file path is required.');
  var parts = path.split('/');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part || part === '.' || part === '..') throw new Error('The GitHub file path is invalid.');
    if (/[\0\r\n]/.test(part)) throw new Error('The GitHub file path contains unsupported characters.');
  }
  return parts.join('/');
}

function htmlStudioGitHubSafeFilename_(value) {
  var name = String(value || 'media').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return (name || 'media').slice(0, 160);
}

function htmlStudioGitHubEncodePath_(path) {
  return String(path || '').split('/').map(function(part) { return encodeURIComponent(part); }).join('/');
}

function htmlStudioGitHubRequest_(method, endpoint, payload, token, muteFailure) {
  var options = {
    method: String(method || 'get').toLowerCase(),
    muteHttpExceptions: true,
    followRedirects: true,
    contentType: 'application/json',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + String(token || ''),
      'X-GitHub-Api-Version': HTML_STUDIO_GITHUB_API_VERSION,
      'User-Agent': 'UnScriptly-HTML-Studio/8.12.0'
    }
  };
  if (payload != null) options.payload = JSON.stringify(payload);
  var response = UrlFetchApp.fetch(HTML_STUDIO_GITHUB_API + endpoint, options);
  var code = response.getResponseCode();
  if (!muteFailure && (code < 200 || code >= 300)) htmlStudioGitHubThrowResponse_(response, 'GitHub request');
  return response;
}

function htmlStudioGitHubJson_(response, label) {
  try { return JSON.parse(response.getContentText() || '{}'); }
  catch (_) { throw new Error((label || 'GitHub response') + ' returned invalid JSON.'); }
}

function htmlStudioGitHubThrowResponse_(response, action) {
  var code = response.getResponseCode();
  var message = '';
  try {
    var parsed = JSON.parse(response.getContentText() || '{}');
    message = String(parsed.message || '');
  } catch (_) {
    message = String(response.getContentText() || '').slice(0, 300);
  }
  if (code === 401) message = 'GitHub rejected the token. Reconnect with a valid token.';
  else if (code === 403 && !message) message = 'GitHub denied this operation. Check repository permissions and rate limits.';
  else if (code === 404 && !message) message = 'The GitHub repository, branch, or file could not be found.';
  throw new Error('GitHub API error (' + code + ') while trying to ' + String(action || 'complete the request') + ': ' + (message || 'Unknown error'));
}
