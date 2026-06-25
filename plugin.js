(function () {
  'use strict';

  var ACTION_REQUEST = 'local.streamdock.api.request';
  var ACTION_POLL = 'local.streamdock.api.poll';
  var ACTION_DIAGNOSTICS = 'local.streamdock.api.diagnostics';

  var DEFAULT_SETTINGS = {
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
    presetName: ''
  };

  var streamDockSocket = null;
  var pluginUuid = null;
  var contexts = {};
  var lastRequest = {
    endpoint: '',
    method: '',
    status: '',
    error: '',
    durationMs: ''
  };

  function parseJson(value, fallback) {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (error) {
      return fallback;
    }
  }

  function sendToStreamDock(message) {
    if (streamDockSocket && streamDockSocket.readyState === WebSocket.OPEN) {
      streamDockSocket.send(JSON.stringify(message));
    }
  }

  function setTitle(context, title) {
    sendToStreamDock({ event: 'setTitle', context: context, payload: { title: String(title || '') } });
  }

  function logMessage(message) {
    sendToStreamDock({ event: 'logMessage', payload: { message: '[streamdock-api-request] ' + message } });
  }

  function showOk(context) {
    sendToStreamDock({ event: 'showOk', context: context });
  }

  function showAlert(context) {
    sendToStreamDock({ event: 'showAlert', context: context });
  }

  function settingsFor(context) {
    return Object.assign({}, DEFAULT_SETTINGS, contexts[context] && contexts[context].settings || {});
  }

  function normalizeMethod(method) {
    return String(method || 'GET').trim().toUpperCase() || 'GET';
  }

  function hasRequestBody(method) {
    return method !== 'GET' && method !== 'HEAD';
  }

  function headersFor(settings) {
    var headers = {};
    if (settings.headersJson && settings.headersJson.trim()) {
      var parsed = JSON.parse(settings.headersJson);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('headersJson must be a JSON object');
      }
      Object.keys(parsed).forEach(function (key) {
        if (parsed[key] !== null && parsed[key] !== undefined) {
          headers[key] = String(parsed[key]);
        }
      });
    }
    if (settings.contentType && !hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = settings.contentType;
    }
    return headers;
  }

  function hasHeader(headers, name) {
    var target = name.toLowerCase();
    return Object.keys(headers).some(function (key) {
      return key.toLowerCase() === target;
    });
  }

  function successSet(settings) {
    if (!settings.successStatuses || !String(settings.successStatuses).trim()) {
      return null;
    }
    return String(settings.successStatuses).split(',').map(function (item) {
      return Number(item.trim());
    }).filter(function (item) {
      return Number.isFinite(item);
    });
  }

  function isSuccessStatus(status, settings) {
    var allowed = successSet(settings);
    if (!allowed) {
      return status >= 200 && status < 300;
    }
    return allowed.indexOf(status) !== -1;
  }

  function responseIsJson(response, text) {
    var contentType = response.headers && response.headers.get && response.headers.get('content-type') || '';
    return contentType.toLowerCase().indexOf('json') !== -1 || /^[\s\r\n]*[\[{]/.test(text || '');
  }

  function valueAtPath(source, path) {
    if (!path) {
      return source;
    }
    var current = source;
    var parts = String(path).split('.').filter(Boolean);
    for (var i = 0; i < parts.length; i += 1) {
      if (current === null || current === undefined || !(parts[i] in Object(current))) {
        throw new Error('missing resultPath: ' + path);
      }
      current = current[parts[i]];
    }
    return current;
  }

  function stringifyValue(value, prettyJson) {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value, null, prettyJson ? 2 : 0);
  }

  function truncate(value, maxChars) {
    var text = String(value || '');
    var limit = Number(maxChars) || Number(DEFAULT_SETTINGS.maxChars);
    if (limit > 0 && text.length > limit) {
      return text.slice(0, Math.max(0, limit - 3)) + '...';
    }
    return text;
  }

  function formatDisplay(settings, result) {
    var template = settings.displayTemplate || DEFAULT_SETTINGS.displayTemplate;
    var replacements = {
      status: result.status || '',
      ok: result.ok ? 'true' : 'false',
      value: result.valueText || '',
      body: result.bodyText || '',
      error: result.error || '',
      durationMs: result.durationMs || ''
    };
    var text = template.replace(/\{(status|ok|value|body|error|durationMs)\}/g, function (_, key) {
      return replacements[key];
    });
    return truncate(text, settings.maxChars);
  }

  function resultTitle(result, settings) {
    if (result.error && !(settings.displayTemplate || '').match(/\{error\}/)) {
      return truncate(result.status + '\n' + result.error, settings.maxChars);
    }
    return formatDisplay(settings, result);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function shouldRetry(result) {
    return !result.ok && (result.status === '' || Number(result.status) >= 500 || result.error === 'timeout' || result.error === 'CORS/network error');
  }

  function runRequest(context, options) {
    var settings = settingsFor(context);
    var attempts = Math.max(1, (Number(settings.retryCount) || 0) + 1);
    var retryDelayMs = Math.max(0, Number(settings.retryDelayMs) || 0);

    function attempt(index) {
      var isFinalAttempt = index + 1 >= attempts;
      var attemptOptions = Object.assign({}, options || {}, {
        feedbackMode: isFinalAttempt ? (options && options.feedbackMode) : 'none',
        updateTitle: isFinalAttempt
      });
      return runRequestAttempt(context, settings, attemptOptions).then(function (result) {
        if (index + 1 < attempts && shouldRetry(result)) {
          return delay(retryDelayMs).then(function () {
            return attempt(index + 1);
          });
        }
        return result;
      });
    }

    return attempt(0);
  }

  function runRequestAttempt(context, settings, runOptions) {
    var method = normalizeMethod(settings.method);
    if (!settings.url) {
      return Promise.resolve(finishRequest(context, settings, {
        ok: false,
        status: '',
        valueText: '',
        bodyText: '',
        error: 'missing URL',
        durationMs: 0
      }, runOptions));
    }

    var started = Date.now();
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutMs = Math.max(100, Number(settings.timeoutMs) || Number(DEFAULT_SETTINGS.timeoutMs));
    var timeout = controller ? setTimeout(function () {
      controller.abort();
    }, timeoutMs) : null;

    var requestOptions;
    try {
      requestOptions = {
        method: method,
        headers: headersFor(settings)
      };
      if (controller) {
        requestOptions.signal = controller.signal;
      }
      if (hasRequestBody(method) && settings.body) {
        requestOptions.body = settings.body;
      }
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      return Promise.resolve(finishRequest(context, settings, {
        ok: false,
        status: '',
        valueText: '',
        bodyText: '',
        error: error.message,
        durationMs: Date.now() - started
      }, runOptions));
    }

    return fetch(settings.url, requestOptions).then(function (response) {
      return response.text().then(function (text) {
        var parsed = null;
        var value = text;
        var parseError = '';
        if (responseIsJson(response, text)) {
          try {
            parsed = text ? JSON.parse(text) : null;
            value = settings.resultPath ? valueAtPath(parsed, settings.resultPath) : parsed;
          } catch (error) {
            parseError = settings.resultPath ? error.message : 'invalid response JSON';
          }
        } else if (settings.resultPath) {
          parseError = 'resultPath requires JSON response';
        }

        var ok = isSuccessStatus(response.status, settings) && !parseError;
        return finishRequest(context, settings, {
          ok: ok,
          status: response.status,
          valueText: parseError ? '' : stringifyValue(value, settings.prettyJson),
          bodyText: settings.prettyJson && parsed !== null ? stringifyValue(parsed, true) : text,
          error: parseError || (ok ? '' : 'HTTP ' + response.status),
          durationMs: Date.now() - started
        }, runOptions);
      });
    }).catch(function (error) {
      var isAbort = error && error.name === 'AbortError';
      return finishRequest(context, settings, {
        ok: false,
        status: '',
        valueText: '',
        bodyText: '',
        error: isAbort ? 'timeout' : 'CORS/network error',
        durationMs: Date.now() - started
      }, runOptions);
    }).then(function (result) {
      if (timeout) clearTimeout(timeout);
      return result;
    });
  }

  function finishRequest(context, settings, result, options) {
    var feedbackMode = options && options.feedbackMode || settings.feedbackMode || DEFAULT_SETTINGS.feedbackMode;
    lastRequest = {
      endpoint: settings.url || '',
      method: normalizeMethod(settings.method),
      status: result.status,
      error: result.error,
      durationMs: result.durationMs
    };
    if (contexts[context] && (!options || options.updateTitle !== false)) {
      contexts[context].lastResult = result;
      setTitle(context, resultTitle(result, settings));
    }
    if (!options || options.updateTitle !== false) {
      refreshDiagnostics();
    }
    if (feedbackMode === 'none') {
      return result;
    }
    if (result.ok) {
      if (feedbackMode === 'all') {
        showOk(context);
      }
    } else {
      if (feedbackMode === 'all' || feedbackMode === 'failures') {
        showAlert(context);
      }
      if (feedbackMode !== 'none') {
        logMessage((settings.url || 'request') + ': ' + (result.error || 'request failed'));
      }
    }
    return result;
  }

  function feedbackModeFor(context, settings) {
    if (contexts[context] && contexts[context].action === ACTION_POLL) {
      return settings.feedbackMode || 'failures';
    }
    return settings.feedbackMode || DEFAULT_SETTINGS.feedbackMode;
  }

  function runRequestWithConfiguredFeedback(context) {
    var settings = settingsFor(context);
    return runRequest(context, { feedbackMode: feedbackModeFor(context, settings) });
  }

  function diagnosticsTitle() {
    return truncate([
      lastRequest.method || '-',
      lastRequest.endpoint || '-',
      'status ' + (lastRequest.status || '-'),
      'err ' + (lastRequest.error || '-'),
      String(lastRequest.durationMs || '-') + 'ms'
    ].join('\n'), 120);
  }

  function refreshDiagnostics() {
    Object.keys(contexts).forEach(function (context) {
      if (contexts[context].action === ACTION_DIAGNOSTICS) {
        setTitle(context, diagnosticsTitle());
      }
    });
  }

  function stopPoll(context) {
    if (contexts[context] && contexts[context].timer) {
      clearInterval(contexts[context].timer);
      contexts[context].timer = null;
    }
  }

  function startPoll(context) {
    stopPoll(context);
    var seconds = Math.max(1, Number(settingsFor(context).pollIntervalSec) || Number(DEFAULT_SETTINGS.pollIntervalSec));
    runRequestWithConfiguredFeedback(context);
    if (contexts[context]) {
      contexts[context].timer = setInterval(function () {
        if (contexts[context]) {
          runRequestWithConfiguredFeedback(context);
        }
      }, seconds * 1000);
    }
  }

  function initialTitle(context) {
    var item = contexts[context];
    if (!item) {
      return;
    }
    if (item.action === ACTION_DIAGNOSTICS) {
      setTitle(context, diagnosticsTitle());
      return;
    }
    var settings = settingsFor(context);
    if (!settings.url) {
      setTitle(context, item.action === ACTION_POLL ? 'Poll\nunset' : 'API\nunset');
      return;
    }
    setTitle(context, normalizeMethod(settings.method) + '\n' + truncate(settings.url, 48));
  }

  function rememberContext(message) {
    var previous = contexts[message.context] || {};
    if (previous.timer) {
      clearInterval(previous.timer);
    }
    contexts[message.context] = {
      action: message.action || previous.action,
      settings: message.payload && message.payload.settings || {},
      lastResult: null,
      timer: null
    };
    initialTitle(message.context);
    if (message.action === ACTION_POLL) {
      startPoll(message.context);
    } else if (message.event === 'willAppear' && contexts[message.context].action === ACTION_REQUEST && settingsFor(message.context).runOnAppear) {
      runRequestWithConfiguredFeedback(message.context);
    }
  }

  function handleMessage(event) {
    var message = parseJson(event.data, {});
    if (message.event === 'willAppear' || message.event === 'didReceiveSettings') {
      rememberContext(message);
    } else if (message.event === 'willDisappear') {
      stopPoll(message.context);
      delete contexts[message.context];
    } else if (message.event === 'keyDown' || message.event === 'touchTap') {
      if (contexts[message.context] && contexts[message.context].action === ACTION_DIAGNOSTICS) {
        refreshDiagnostics();
      } else {
        runRequestWithConfiguredFeedback(message.context);
      }
    }
  }

  window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent) {
    pluginUuid = uuid;
    streamDockSocket = new WebSocket('ws://127.0.0.1:' + port);
    streamDockSocket.onopen = function () {
      sendToStreamDock({ event: registerEvent, uuid: pluginUuid });
    };
    streamDockSocket.onmessage = handleMessage;
  };
}());
