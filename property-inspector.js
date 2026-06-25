(function () {
  'use strict';

  var STANDARD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
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
    var blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
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
    navigator.clipboard.writeText(JSON.stringify(settings, null, 2)).then(function () {
      setStatus('settings copied');
    }).catch(function () {
      setStatus('copy failed');
    });
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
    byId('copySettings').addEventListener('click', copySettings);
    byId('pasteSettings').addEventListener('click', pasteSettings);
    byId('exportSettings').addEventListener('click', exportSettings);
    byId('importSettings').addEventListener('change', importSettings);
    renderPresetNames();
  });
}());
