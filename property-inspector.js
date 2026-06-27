(function () {
  'use strict';

  var STANDARD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  var SENSITIVE_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key|apikey|x-auth-token|cookie|set-cookie)$/i;
  var SENSITIVE_FIELD = /(password|passwd|secret|token|api[_-]?key|authorization|auth)/i;
  var websocket = null;
  var context = null;
  var settings = {
    method: 'GET',
    url: '',
    headersJson: '',
    body: '',
    contentType: '',
    timeoutMs: 5000,
    pollIntervalSec: 60,
    resultPath: '',
    displayTemplate: '{status}\n{value}',
    maxChars: 72,
    successStatuses: '',
    runOnAppear: false,
    feedbackMode: 'all',
    retryCount: 0,
    retryDelayMs: 500,
    prettyJson: false,
    presetsJson: '',
    presetName: '',
    helperEndpoint: '',
    useHelper: false,
    conditionsJson: '',
    sequenceJson: '',
    imageMode: true,
    diffMode: false,
    cooldownMs: 0,
    runningTitle: '',
    onlyFeedbackOnChange: false,
    includeTimestamp: false,
    failOnConditionMiss: false
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    byId('status').textContent = text;
  }

  function selectedMethod() {
    var preset = byId('methodPreset').value;
    if (preset === 'CUSTOM') {
      return byId('method').value.trim().toUpperCase() || 'GET';
    }
    return preset;
  }

  function updateMethodControls(method) {
    var normalized = String(method || 'GET').toUpperCase();
    if (STANDARD_METHODS.indexOf(normalized) === -1) {
      byId('methodPreset').value = 'CUSTOM';
      byId('method').value = normalized;
      byId('method').disabled = false;
    } else {
      byId('methodPreset').value = normalized;
      byId('method').value = '';
      byId('method').disabled = true;
    }
  }

  function readSettingsFromForm() {
    settings.method = selectedMethod();
    settings.url = byId('url').value.trim();
    settings.headersJson = byId('headersJson').value.trim();
    settings.body = byId('body').value;
    settings.contentType = byId('contentType').value.trim();
    settings.timeoutMs = Number(byId('timeoutMs').value) || 5000;
    settings.pollIntervalSec = Number(byId('pollIntervalSec').value) || 60;
    settings.resultPath = byId('resultPath').value.trim();
    settings.displayTemplate = byId('displayTemplate').value || '{status}\n{value}';
    settings.maxChars = Number(byId('maxChars').value) || 72;
    settings.successStatuses = byId('successStatuses').value.trim();
    settings.runOnAppear = byId('runOnAppear').checked;
    settings.feedbackMode = byId('feedbackMode').value;
    settings.retryCount = Number(byId('retryCount').value) || 0;
    settings.cooldownMs = Number(byId('cooldownMs').value) || 0;
    settings.runningTitle = byId('runningTitle').value;
    settings.retryDelayMs = Number(byId('retryDelayMs').value) || 0;
    settings.prettyJson = byId('prettyJson').checked;
    settings.presetsJson = byId('presetsJson').value.trim();
    settings.presetName = byId('presetName').value.trim();
    settings.helperEndpoint = byId('helperEndpoint').value.trim();
    settings.useHelper = byId('useHelper').checked;
    if (settings.useHelper && !settings.helperEndpoint) {
      settings.helperEndpoint = 'http://127.0.0.1:41923/request';
      byId('helperEndpoint').value = settings.helperEndpoint;
    }
    settings.conditionsJson = byId('conditionsJson').value.trim();
    settings.sequenceJson = byId('sequenceJson').value.trim();
    settings.imageMode = byId('imageMode').checked;
    settings.diffMode = byId('diffMode').checked;
    settings.onlyFeedbackOnChange = byId('onlyFeedbackOnChange').checked;
    settings.failOnConditionMiss = byId('failOnConditionMiss').checked;
  }

  function update() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN || !context) {
      return;
    }
    readSettingsFromForm();
    websocket.send(JSON.stringify({ event: 'setSettings', context: context, payload: settings }));
    renderPresetNames();
    renderSecretGuidance();
    renderHelperStatus();
  }

  function applySettings(next) {
    settings = Object.assign({}, settings, next || {});
    updateMethodControls(settings.method);
    [
      'url',
      'headersJson',
      'body',
      'contentType',
      'timeoutMs',
      'pollIntervalSec',
      'resultPath',
      'displayTemplate',
      'maxChars',
      'successStatuses',
      'feedbackMode',
      'retryCount',
      'cooldownMs',
      'runningTitle',
      'retryDelayMs',
      'presetsJson',
      'presetName',
      'helperEndpoint',
      'conditionsJson',
      'sequenceJson'
    ].forEach(function (key) {
      if (byId(key)) {
        byId(key).value = settings[key] === undefined || settings[key] === null ? '' : settings[key];
      }
    });
    byId('runOnAppear').checked = settings.runOnAppear === true || settings.runOnAppear === 'true';
    byId('prettyJson').checked = settings.prettyJson === true || settings.prettyJson === 'true';
    byId('useHelper').checked = settings.useHelper === true || settings.useHelper === 'true';
    byId('imageMode').checked = settings.imageMode !== false && settings.imageMode !== 'false';
    byId('diffMode').checked = settings.diffMode === true || settings.diffMode === 'true';
    byId('onlyFeedbackOnChange').checked = settings.onlyFeedbackOnChange === true || settings.onlyFeedbackOnChange === 'true';
    byId('failOnConditionMiss').checked = settings.failOnConditionMiss === true || settings.failOnConditionMiss === 'true';
    renderPresetNames();
    renderSecretGuidance();
    renderHelperStatus();
  }

  function parsePresets() {
    if (!byId('presetsJson').value.trim()) {
      return {};
    }
    var parsed = JSON.parse(byId('presetsJson').value);
    if (Array.isArray(parsed)) {
      return parsed.reduce(function (map, item) {
        if (item && item.name) {
          map[item.name] = item.settings || item;
        }
        return map;
      }, {});
    }
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return {};
  }

  function renderPresetNames() {
    var list = byId('presetNames');
    list.innerHTML = '';
    try {
      Object.keys(parsePresets()).forEach(function (name) {
        var option = document.createElement('option');
        option.value = name;
        list.appendChild(option);
      });
      setStatus('ready');
    } catch (error) {
      setStatus('invalid presets JSON');
    }
  }

  function applyPreset() {
    try {
      var name = byId('presetName').value.trim();
      var presets = parsePresets();
      if (!name || !presets[name]) {
        setStatus('preset not found');
        return;
      }
      var preserved = {
        presetsJson: byId('presetsJson').value,
        presetName: name
      };
      applySettings(Object.assign({}, settings, presets[name], preserved));
      update();
      setStatus('preset applied');
    } catch (error) {
      setStatus('invalid presets JSON');
    }
  }

  function exportSettings() {
    readSettingsFromForm();
    var blob = new Blob([JSON.stringify(sanitizedSettings(settings), null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'streamdock-api-request-settings.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importSettings(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    file.text().then(function (text) {
      applySettings(JSON.parse(text));
      update();
      setStatus('settings imported');
      event.target.value = '';
    }).catch(function () {
      setStatus('import failed');
    });
  }

  function copySettings() {
    readSettingsFromForm();
    navigator.clipboard.writeText(JSON.stringify(sanitizedSettings(settings), null, 2)).then(function () {
      setStatus('settings copied');
    }).catch(function () {
      setStatus('copy failed');
    });
  }

  function renderSecretGuidance() {
    var element = byId('secretStatus');
    if (!element) return;
    var findings = sensitiveHeaderNames(byId('headersJson').value);
    if (findings.length === 0) {
      element.textContent = 'use {{secret:NAME}} with helper for tokens';
      return;
    }
    element.textContent = 'secret-like header: use helper + {{secret:' + secretName(findings[0]) + '}}';
  }

  function renderHelperStatus() {
    var element = byId('helperStatus');
    if (!element) return;
    var endpoint = byId('helperEndpoint').value.trim();
    if (!endpoint) {
      element.textContent = byId('useHelper').checked ? 'helper URL required' : 'localhost helper';
      return;
    }
    if (!/^https?:\/\//i.test(endpoint)) {
      element.textContent = 'invalid HTTP helper URL';
      return;
    }
    element.textContent = isLoopbackEndpoint(endpoint) ? 'localhost helper' : 'remote helper: sends request data off this PC';
  }

  function isLoopbackEndpoint(endpoint) {
    try {
      var url = new URL(endpoint);
      return ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(url.hostname) !== -1;
    } catch (error) {
      return false;
    }
  }

  function sensitiveHeaderNames(headersJson) {
    if (!headersJson || !headersJson.trim()) {
      return [];
    }
    try {
      var parsed = JSON.parse(headersJson);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        return [];
      }
      return Object.keys(parsed).filter(function (key) {
        return SENSITIVE_HEADER.test(key) && !/\{\{secret:[A-Za-z0-9_.-]+\}\}/.test(String(parsed[key] || ''));
      });
    } catch (error) {
      return [];
    }
  }

  function secretName(name) {
    return String(name || 'TOKEN').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'TOKEN';
  }

  function sanitizedSettings(source) {
    var copy = Object.assign({}, source || {});
    copy.headersJson = sanitizeHeadersJson(copy.headersJson);
    copy.body = sanitizeBody(copy.body);
    copy.presetsJson = sanitizeJsonValue(copy.presetsJson);
    copy.sequenceJson = sanitizeJsonValue(copy.sequenceJson);
    return copy;
  }

  function sanitizeJsonValue(value) {
    if (!value || !String(value).trim()) {
      return value || '';
    }
    try {
      return JSON.stringify(sanitizeObject(JSON.parse(value)), null, 2);
    } catch (error) {
      return '';
    }
  }

  function sanitizeHeadersJson(value) {
    if (!value || !String(value).trim()) {
      return '';
    }
    try {
      return JSON.stringify(sanitizeHeadersObject(JSON.parse(value)), null, 2);
    } catch (error) {
      return '';
    }
  }

  function sanitizeObject(value) {
    if (Array.isArray(value)) {
      return value.map(sanitizeObject);
    }
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (key) {
        if (key === 'headers' || key === 'headersJson') {
          out[key] = key === 'headersJson' ? sanitizeHeadersJson(value[key]) : sanitizeHeadersObject(value[key]);
        } else if (SENSITIVE_FIELD.test(key)) {
          out[key] = '{{secret:' + secretName(key) + '}}';
        } else if (key === 'body') {
          out[key] = sanitizeBody(value[key]);
        } else {
          out[key] = sanitizeObject(value[key]);
        }
      });
      return out;
    }
    return value;
  }

  function sanitizeHeadersObject(headers) {
    if (!headers || Array.isArray(headers) || typeof headers !== 'object') {
      return headers;
    }
    var out = {};
    Object.keys(headers).forEach(function (key) {
      out[key] = SENSITIVE_HEADER.test(key) ? '{{secret:' + secretName(key) + '}}' : headers[key];
    });
    return out;
  }

  function sanitizeBody(value) {
    if (value && typeof value === 'object') {
      return sanitizeObject(value);
    }
    if (!value || !String(value).trim()) {
      return value || '';
    }
    try {
      var parsed = JSON.parse(value);
      return JSON.stringify(sanitizeObject(parsed), null, 2);
    } catch (error) {
      return value;
    }
  }

  function pasteSettings() {
    navigator.clipboard.readText().then(function (text) {
      applySettings(JSON.parse(text));
      update();
      setStatus('settings pasted');
    }).catch(function () {
      setStatus('paste failed');
    });
  }

  function hasRequestBody(method) {
    return method !== 'GET' && method !== 'HEAD';
  }

  function headersForTest(current) {
    var headers = {};
    if (current.headersJson && current.headersJson.trim()) {
      var parsed = JSON.parse(current.headersJson);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('headersJson must be a JSON object');
      }
      Object.keys(parsed).forEach(function (key) {
        if (parsed[key] !== null && parsed[key] !== undefined) {
          headers[key] = String(parsed[key]);
        }
      });
    }
    if (current.contentType && !Object.keys(headers).some(function (key) { return key.toLowerCase() === 'content-type'; })) {
      headers['Content-Type'] = current.contentType;
    }
    return headers;
  }

  function testRequest() {
    readSettingsFromForm();
    if (!settings.url) {
      setStatus('missing URL');
      return;
    }
    var method = String(settings.method || 'GET').toUpperCase();
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var started = Date.now();
    var timeout = controller ? setTimeout(function () {
      controller.abort();
    }, Math.max(100, Number(settings.timeoutMs) || 5000)) : null;
    var options;
    try {
      options = {
        method: method,
        headers: headersForTest(settings)
      };
      if (controller) {
        options.signal = controller.signal;
      }
      if (hasRequestBody(method) && settings.body) {
        options.body = settings.body;
      }
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      setStatus(error.message);
      return;
    }
    setStatus('testing');
    fetch(settings.url, options).then(function (response) {
      return response.text().then(function () {
        setStatus(response.status + ' in ' + String(Date.now() - started) + 'ms');
      });
    }).catch(function (error) {
      setStatus(error && error.name === 'AbortError' ? 'timeout' : 'CORS/network error');
    }).then(function () {
      if (timeout) clearTimeout(timeout);
    });
  }

  function diagnoseSettings() {
    readSettingsFromForm();
    var issues = [];
    if (!settings.url) issues.push('missing URL');
    if (settings.useHelper && !settings.helperEndpoint) issues.push('missing helper');
    ['headersJson', 'conditionsJson', 'sequenceJson', 'presetsJson'].forEach(function (key) {
      if (settings[key]) {
        try {
          JSON.parse(settings[key]);
        } catch (error) {
          issues.push(key + ' invalid');
        }
      }
    });
    try {
      if (settings.body && settings.resultPath) {
        valueAtPath(JSON.parse(settings.body), settings.resultPath);
      }
    } catch (error) {
      issues.push('sample path mismatch');
    }
    var secrets = secretRefs([settings.headersJson, settings.body, settings.presetsJson, settings.sequenceJson].join('\n'));
    if (settings.useHelper && settings.helperEndpoint && secrets.length) {
      fetch(settings.helperEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'diagnose', secrets: secrets })
      }).then(function (response) {
        return response.json();
      }).then(function (data) {
        var missing = secrets.filter(function (name) { return !(data.secrets || {})[name]; });
        setStatus((issues.concat(missing.map(function (name) { return 'missing secret ' + name; }))).join(', ') || 'diagnostics ok');
      }).catch(function () {
        setStatus((issues.concat(['helper diagnose failed'])).join(', '));
      });
      return;
    }
    setStatus(issues.join(', ') || 'diagnostics ok');
  }

  function secretRefs(text) {
    var names = [];
    String(text || '').replace(/\{\{secret:([A-Za-z0-9_.-]+)\}\}/g, function (_, name) {
      if (names.indexOf(name) === -1) names.push(name);
      return '';
    });
    return names;
  }

  function valueAtPath(source, path) {
    var current = source;
    String(path || '').split('.').filter(Boolean).forEach(function (part) {
      if (part === '__proto__' || part === 'prototype' || part === 'constructor' || current === null || current === undefined || !Object.prototype.hasOwnProperty.call(Object(current), part)) {
        throw new Error('missing path');
      }
      current = Object(current)[part];
    });
    return current;
  }

  function resetSettings() {
    applySettings({
      method: 'GET',
      url: '',
      headersJson: '',
      body: '',
      contentType: '',
      timeoutMs: 5000,
      pollIntervalSec: 60,
      resultPath: '',
      displayTemplate: '{status}\n{value}',
      maxChars: 72,
      successStatuses: '',
      runOnAppear: false,
      feedbackMode: 'all',
      retryCount: 0,
      retryDelayMs: 500,
      prettyJson: false,
      presetsJson: '',
      presetName: '',
      helperEndpoint: '',
      useHelper: false,
      conditionsJson: '',
      sequenceJson: '',
      imageMode: true,
      diffMode: false,
      cooldownMs: 0,
      runningTitle: '',
      onlyFeedbackOnChange: false,
      failOnConditionMiss: false
    });
    update();
    setStatus('settings reset');
  }

  window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info, actionInfo) {
    var parsedActionInfo = JSON.parse(actionInfo || '{}');
    context = parsedActionInfo.context || uuid;
    websocket = new WebSocket('ws://127.0.0.1:' + port);
    websocket.onopen = function () {
      websocket.send(JSON.stringify({ event: registerEvent, uuid: uuid }));
      websocket.send(JSON.stringify({ event: 'getSettings', context: context }));
    };
    websocket.onmessage = function (event) {
      var message = JSON.parse(event.data);
      if (message.event === 'didReceiveSettings') {
        applySettings(message.payload && message.payload.settings);
      }
    };
  };

  window.addEventListener('DOMContentLoaded', function () {
    updateMethodControls(settings.method);
    [
      'url',
      'headersJson',
      'body',
      'contentType',
      'timeoutMs',
      'pollIntervalSec',
      'resultPath',
      'displayTemplate',
      'maxChars',
      'successStatuses',
      'feedbackMode',
      'retryCount',
      'cooldownMs',
      'runningTitle',
      'retryDelayMs',
      'presetsJson',
      'presetName',
      'helperEndpoint',
      'conditionsJson',
      'sequenceJson',
      'method'
    ].forEach(function (id) {
      byId(id).addEventListener('input', update);
      byId(id).addEventListener('change', update);
    });
    ['runOnAppear', 'prettyJson', 'useHelper', 'imageMode', 'diffMode', 'onlyFeedbackOnChange', 'failOnConditionMiss'].forEach(function (id) {
      byId(id).addEventListener('change', update);
    });
    byId('methodPreset').addEventListener('change', function () {
      byId('method').disabled = byId('methodPreset').value !== 'CUSTOM';
      update();
    });
    byId('applyPreset').addEventListener('click', applyPreset);
    byId('testRequest').addEventListener('click', testRequest);
    byId('diagnoseSettings').addEventListener('click', diagnoseSettings);
    byId('resetSettings').addEventListener('click', resetSettings);
    byId('copySettings').addEventListener('click', copySettings);
    byId('pasteSettings').addEventListener('click', pasteSettings);
    byId('exportSettings').addEventListener('click', exportSettings);
    byId('importSettings').addEventListener('change', importSettings);
    renderPresetNames();
    renderSecretGuidance();
    renderHelperStatus();
  });
}());
