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
    failOnConditionMiss: false,
    confirmMode: 'off',
    responseHistoryLimit: 10
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
  var responseHistory = [];
  var confirmUntil = {};

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

  function setImage(context, image) {
    sendToStreamDock({ event: 'setImage', context: context, payload: { image: image } });
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

  function resolveSecretRefs(value) {
    return String(value || '').replace(/\{\{secret:([A-Za-z0-9_.-]+)\}\}/g, function (_, name) {
      return '{{secret:' + name + '}}';
    });
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
      var key = parts[i];
      var objectCurrent = Object(current);
      if (!isSafePathSegment(key) || current === null || current === undefined || !Object.prototype.hasOwnProperty.call(objectCurrent, key)) {
        throw new Error('missing resultPath: ' + path);
      }
      current = objectCurrent[key];
    }
    return current;
  }

  function isSafePathSegment(segment) {
    return segment !== '__proto__' && segment !== 'prototype' && segment !== 'constructor';
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
      durationMs: result.durationMs || '',
      previousValue: result.previousValueText || '',
      changed: result.changed ? 'true' : 'false',
      delta: result.deltaText || '',
      timestamp: result.timestamp || ''
    };
    var text = template.replace(/\{(status|ok|value|body|error|durationMs|previousValue|changed|delta|timestamp)\}/g, function (_, key) {
      return replacements[key];
    });
    return truncate(applyConditions(text, settings, result), settings.maxChars);
  }

  function conditionResult(settings, result) {
    if (!settings.conditionsJson || !String(settings.conditionsJson).trim()) {
      return null;
    }
    try {
      var conditions = JSON.parse(settings.conditionsJson);
      if (!Array.isArray(conditions)) {
        return null;
      }
      for (var i = 0; i < conditions.length; i += 1) {
        var item = conditions[i] || {};
        var left = valueAtPath({
          status: result.status,
          ok: result.ok,
          value: result.valueText,
          body: result.bodyText,
          error: result.error,
          durationMs: result.durationMs,
          previousValue: result.previousValueText,
          changed: result.changed,
          delta: result.deltaText
        }, item.path || 'value');
        var expected = item.equals;
        var matched = conditionMatches(left, item, expected);
        if (matched) {
          return item;
        }
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function conditionMatches(left, item, expected) {
    if (item.regex !== undefined) {
      try {
        if (!safeRegexPattern(item.regex)) {
          return false;
        }
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
        return new RegExp(String(item.regex)).test(String(left));
      } catch (error) {
        return false;
      }
    }
    if (item.contains !== undefined) {
      return String(left).indexOf(String(item.contains)) !== -1;
    }
    var numberLeft = Number(left);
    if (item.gt !== undefined) return Number.isFinite(numberLeft) && numberLeft > Number(item.gt);
    if (item.gte !== undefined) return Number.isFinite(numberLeft) && numberLeft >= Number(item.gte);
    if (item.lt !== undefined) return Number.isFinite(numberLeft) && numberLeft < Number(item.lt);
    if (item.lte !== undefined) return Number.isFinite(numberLeft) && numberLeft <= Number(item.lte);
    if (item.notEquals !== undefined) return String(left) !== String(item.notEquals);
    return String(left) === String(expected);
  }

  function safeRegexPattern(pattern) {
    var text = String(pattern || '');
    if (!text || text.length > 128) {
      return false;
    }
    return !/(\([^)]*[+*][^)]*\)|\[[^\]]+\])[+*{]/.test(text) && !/([+*{][^)]*){2,}/.test(text);
  }

  function replacementValue(result, key) {
    if (key === 'value') return result.valueText;
    if (key === 'body') return result.bodyText;
    if (key === 'previousValue') return result.previousValueText;
    if (key === 'changed') return result.changed ? 'true' : 'false';
    if (key === 'delta') return result.deltaText;
    if (key === 'timestamp') return result.timestamp || '';
    return result[key];
  }

  function applyConditions(text, settings, result) {
    var item = conditionResult(settings, result);
    if (item && item.template) {
      return String(item.template).replace(/\{(status|ok|value|body|error|durationMs|previousValue|changed|delta|timestamp)\}/g, function (_, key) {
        return String(replacementValue(result, key) || '');
      });
    }
    if (settings.diffMode && result.changed && result.previousValueText !== '') {
      return text + '\nwas ' + result.previousValueText;
    }
    return text;
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
        durationMs: 0,
        timestamp: new Date().toISOString()
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
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString()
      }, runOptions));
    }

    return executeFetch(settings, method, requestOptions).then(function (response) {
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
          durationMs: Date.now() - started,
          timestamp: new Date().toISOString()
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
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString()
      }, runOptions);
    }).then(function (result) {
      if (timeout) clearTimeout(timeout);
      return result;
    });
  }

  function executeFetch(settings, method, requestOptions) {
    if (settings.useHelper && settings.helperEndpoint) {
      return fetch(settings.helperEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: settings.url,
          method: method,
          headers: requestOptions.headers || {},
          body: requestOptions.body || '',
          timeoutMs: settings.timeoutMs
        })
      });
    }
    Object.keys(requestOptions.headers || {}).forEach(function (key) {
      requestOptions.headers[key] = resolveSecretRefs(requestOptions.headers[key]);
    });
    return fetch(settings.url, requestOptions);
  }

  function sequenceSteps(settings) {
    if (!settings.sequenceJson || !String(settings.sequenceJson).trim()) {
      return null;
    }
    try {
      var parsed = JSON.parse(settings.sequenceJson);
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function runSequence(context, baseSettings, options) {
    var steps = sequenceSteps(baseSettings);
    if (!steps || steps.length === 0) {
      return runRequest(context, options);
    }
    var index = 0;
    var last = null;
    function next() {
      if (index >= steps.length) {
        return Promise.resolve(last);
      }
      var stepSettings = Object.assign({}, baseSettings, steps[index] || {});
      index += 1;
      return runRequestAttempt(context, stepSettings, Object.assign({}, options || {}, {
        feedbackMode: index >= steps.length ? options && options.feedbackMode : 'none',
        updateTitle: index >= steps.length
      })).then(function (result) {
        last = result;
        if (!result.ok) {
          return result;
        }
        return next();
      });
    }
    return next();
  }

  function finishRequest(context, settings, result, options) {
    var feedbackMode = options && options.feedbackMode || settings.feedbackMode || DEFAULT_SETTINGS.feedbackMode;
    var previous = contexts[context] && contexts[context].lastResult;
    result.previousValueText = previous && previous.valueText !== undefined ? previous.valueText : '';
    result.changed = result.previousValueText !== '' && String(result.previousValueText) !== String(result.valueText);
    result.deltaText = numericDelta(result.valueText, result.previousValueText);
    var condition = conditionResult(settings, result);
    if (settings.failOnConditionMiss && result.ok && settings.conditionsJson && !condition) {
      result.ok = false;
      result.error = 'condition miss';
    }
    lastRequest = {
      endpoint: settings.url || '',
      method: normalizeMethod(settings.method),
      status: result.status,
      error: result.error,
      durationMs: result.durationMs
    };
    rememberResponse(settings, result);
    if (contexts[context] && (!options || options.updateTitle !== false)) {
      contexts[context].lastResult = result;
      setTitle(context, resultTitle(result, settings));
      if (settings.imageMode !== false) {
        setImage(context, resultImage(result, settings));
      }
    }
    if (!options || options.updateTitle !== false) {
      refreshDiagnostics();
    }
    if (condition && condition.log) {
      logMessage(String(condition.log).replace(/\{(status|ok|value|body|error|durationMs|previousValue|changed|delta|timestamp)\}/g, function (_, key) {
        return String(replacementValue(result, key) || '');
      }));
    }
    if (condition && condition.showOk === true) {
      showOk(context);
    }
    if (condition && condition.showAlert === true) {
      showAlert(context);
    }
    if (settings.onlyFeedbackOnChange && !result.changed && result.previousValueText !== '') {
      return result;
    }
    if (feedbackMode === 'none' || condition && (condition.showOk === true || condition.showAlert === true)) {
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

  function rememberResponse(settings, result) {
    var limit = Math.max(0, Math.min(50, Number(settings.responseHistoryLimit) || 0));
    if (!limit) {
      responseHistory = [];
      return;
    }
    responseHistory.unshift({
      time: result.timestamp || new Date().toISOString(),
      method: normalizeMethod(settings.method),
      endpoint: settings.url || '',
      status: result.status,
      ok: !!result.ok,
      durationMs: result.durationMs,
      value: truncate(result.valueText || result.bodyText || result.error || '', 120)
    });
    responseHistory = responseHistory.slice(0, limit);
  }

  function isCoolingDown(context, settings) {
    var cooldown = Number(settings.cooldownMs) || 0;
    return cooldown > 0 && contexts[context] && contexts[context].lastRunAt && Date.now() - contexts[context].lastRunAt < cooldown;
  }

  function markRunStarted(context, settings) {
    if (contexts[context]) {
      contexts[context].lastRunAt = Date.now();
    }
  }

  function numericDelta(value, previous) {
    var currentNumber = Number(value);
    var previousNumber = Number(previous);
    if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber)) {
      return '';
    }
    var delta = currentNumber - previousNumber;
    return (delta > 0 ? '+' : '') + String(Math.round(delta * 1000) / 1000);
  }

  function resultImage(result, settings) {
    var imageSpec = imageSpecFromConditions(settings, result);
    var ok = !!result.ok;
    var color = imageSpec.color || (ok ? '#22543d' : '#742a2a');
    var label = imageSpec.label || (ok ? 'OK' : 'ERR');
    var sub = imageSpec.sub || String(result.status || result.error || '');
    return svgImage(color, '#ffffff', label, sub, ok ? 100 : 35);
  }

  function imageSpecFromConditions(settings, result) {
    var item = conditionResult(settings, result);
    return item ? { color: item.imageColor, label: item.imageLabel, sub: item.imageSub } : {};
  }

  function svgImage(background, foreground, main, sub, fillPercent) {
    var fill = Math.max(0, Math.min(100, Number(fillPercent) || 0));
    var barHeight = Math.round(116 * fill / 100);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">' +
      '<rect width="144" height="144" rx="20" fill="' + background + '"/>' +
      '<rect x="14" y="' + (124 - barHeight) + '" width="116" height="' + barHeight + '" rx="10" fill="' + foreground + '" opacity="0.15"/>' +
      '<text x="72" y="66" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="' + foreground + '">' + escapeSvg(main) + '</text>' +
      '<text x="72" y="100" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="' + foreground + '">' + escapeSvg(truncateImageText(sub)) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
  }

  function truncateImageText(value) {
    value = String(value || '');
    return value.length > 12 ? value.slice(0, 12) : value;
  }

  function escapeSvg(value) {
    return String(value || '').replace(/[&<>"]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch];
    });
  }

  function feedbackModeFor(context, settings) {
    if (contexts[context] && contexts[context].action === ACTION_POLL) {
      return settings.feedbackMode || 'failures';
    }
    return settings.feedbackMode || DEFAULT_SETTINGS.feedbackMode;
  }

  function runRequestWithConfiguredFeedback(context) {
    var settings = settingsFor(context);
    if (needsConfirmation(settings) && !confirmReady(context)) {
      setTitle(context, 'Press\nagain');
      return Promise.resolve(null);
    }
    if (isCoolingDown(context, settings)) {
      showAlert(context);
      return Promise.resolve(null);
    }
    markRunStarted(context);
    if (settings.runningTitle) {
      setTitle(context, settings.runningTitle);
    }
    return runSequence(context, settings, { feedbackMode: feedbackModeFor(context, settings) });
  }

  function diagnosticsTitle() {
    var recent = responseHistory.slice(0, 2).map(function (item) {
      return String(item.status || 'ERR') + ' ' + String(item.durationMs || '-') + 'ms';
    }).join('\n');
    return truncate([
      lastRequest.method || '-',
      lastRequest.endpoint || '-',
      'status ' + (lastRequest.status || '-'),
      'err ' + (lastRequest.error || '-'),
      String(lastRequest.durationMs || '-') + 'ms',
      recent
    ].join('\n'), 120);
  }

  function needsConfirmation(settings) {
    return settings.confirmMode === 'secondPress' && /^(POST|PUT|PATCH|DELETE)$/i.test(normalizeMethod(settings.method));
  }

  function confirmReady(context) {
    var now = Date.now();
    if (confirmUntil[context] && confirmUntil[context] > now) {
      confirmUntil[context] = 0;
      return true;
    }
    confirmUntil[context] = now + 3000;
    return false;
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
      setImage(context, svgImage('#2d3748', '#ffffff', 'API', 'DIAG', 100));
      return;
    }
    var settings = settingsFor(context);
    if (!settings.url) {
      setTitle(context, item.action === ACTION_POLL ? 'Poll\nunset' : 'API\nunset');
      setImage(context, svgImage('#3a3a3a', '#cbd5e0', item.action === ACTION_POLL ? 'POLL' : 'API', 'UNSET', 0));
      return;
    }
    setTitle(context, normalizeMethod(settings.method) + '\n' + truncate(settings.url, 48));
    setImage(context, svgImage(item.action === ACTION_POLL ? '#2b6cb0' : '#2d3748', '#ffffff', normalizeMethod(settings.method).slice(0, 4), 'READY', 40));
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
      timer: null,
      lastRunAt: previous.lastRunAt || 0
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
