'use strict';

var _ = require('lodash'),
  MockRequest = require('./mock-request'),
  debug = require('debug')('routicorn:utils'),
  thr = require('throw');

var RESERVED_PROPS = [
  'trailers',
  'rawTrailers',
  'headers',
  'rawHeaders',
  'httpVersion',
  'httpVersionMajor',
  'httpVersionMinor',
  'connection',
  'client',
  'socket'
];

function noop() {}

function setUpPipe(src, dest) {
  debug('Setting up data pipe from original request to sub-request');

  function onData(data) {
    dest.push(data);
  }

  function onEnd(err) {
    if (err) {
      dest.emit('error', err);
    }

    dest.push(null);

    src.removeListener('data', onData);
    src.removeListener('end', onEnd);
    src.removeListener('close', onEnd);
    src.removeListener('error', onEnd);
  }

  src.on('data', onData);
  src.once('end', onEnd);
  src.once('close', onEnd);
  src.once('error', onEnd);
  src.resume();
}

/**
 * Create a mock sub-request
 *
 * @private
 *
 * @param {object} parentReq Base request
 * @param {object} props Properties
 *
 * @returns {object}
 */
exports.createSubRequest = function createSubRequest(parentReq, props) {
  if (arguments.length < 2) {
    thr('createSubRequest() needs a parentReq object and at least one additional object');
  }

  RESERVED_PROPS.forEach(function (prop) {
    props[prop] = parentReq[prop];
  });

  props.params = props.params || parentReq.params || {};
  props.query = props.query || parentReq.query || {};
  delete props.body; // Reserved, handled below

  var requestDepth = ~~parentReq.requestDepth + 1,
    originalReq = parentReq.originalReq || parentReq,
    method = (props.method || parentReq.method || 'GET').toUpperCase(),
    url = props.url || parentReq.url || '/',
    isBodyMethod = ['GET', 'HEAD', 'DELETE'].indexOf(method) === -1,
    canPipe = originalReq.body === undefined && parentReq.__canPipe !== false;

  if (isBodyMethod && !canPipe) {
    props.headers['content-length'] = 0;
  }

  var req = new MockRequest(method, url, props);

  // Mixin additional properties
  if (arguments.length > 2) {
    var descr, proto = req.__proto__ = Object.create(req.__proto__);
    [].slice.call(arguments, 2).forEach(function (obj) {
      _.keys(obj).forEach(function (key) {
        // Ensure getters/setters stay untouched
        if ((descr = Object.getOwnPropertyDescriptor(obj, key))) {
          Object.defineProperty(proto, key, descr);
        }
      });
    });
  }

  Object.defineProperties(req, {
    subRequest: {
      configurable: false,
      enumerable: true,
      value: true
    },
    requestDepth: {
      configurable: false,
      enumerable: true,
      value: requestDepth
    },
    parentReq: {
      configurable: false,
      enumerable: true,
      value: parentReq
    },
    originalReq: {
      configurable: false,
      enumerable: true,
      value: originalReq
    }
  });

  // Handle body
  req._teardownSubRequest = function () {};
  if (isBodyMethod) {
    Object.defineProperties(req, {
      body: {
        configurable: false,
        enumerable: true,
        get: function () {
          return originalReq.body;
        },
        set: function (val) {
          originalReq.body = val;
        }
      },

      // body-parser compat
      _body: {
        configurable: false,
        enumerable: false,
        get: function () {
          return originalReq._body;
        },
        set: function (val) {
          originalReq._body = val;
        }
      }
    });

    if (!canPipe) {
      req.__canPipe = false;
      req.push(null);

      return req;
    }

    var didSetupPipe = false;
    parentReq.__canPipe = false;
    req.__canPipe = true;
    req._read = function () {
      if (req.__canPipe) {
        didSetupPipe = true;
        req._read = noop;
        setUpPipe(originalReq, req);
      }
    };

    req._teardownSubRequest = function () {
      try {
        req._read = noop;
        if (!didSetupPipe) {
          parentReq.__canPipe = true;
        }
      } catch (e) {}
    };
  }

  return req;
};
