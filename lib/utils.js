'use strict';

var _ = require('lodash');
var setPrototypeOf = require('setprototypeof');
var mergeDescriptors = require('merge-descriptors');
var MockRequest = require('readable-mock-req');

var KEY_ORIGINAL_PROTOTYPE = '__originalProto__';
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

/**
 * @namespace Utils
 * @private
 */
module.exports = exports = {};

/**
 * Define a single public or private property of an object
 *
 * @private
 * @param {object} obj
 * @param {boolean} isPublic
 * @param {string} prop
 * @param {*} val
 */
var defineProp = exports.defineProp = function (obj, isPublic, prop, val) {
  var descr = {};

  if (isPublic) {
    descr.enumerable = true;
  }

  if (typeof val === 'function') {
    descr.get = val;
  } else {
    descr.value = val;
  }

  prop = !isPublic && prop.charAt(0) !== '_' ? '_' + prop : prop;

  Object.defineProperty(obj, prop, descr);
};

/**
 * Define public or private properties of an object
 *
 * @private
 * @param {object} obj
 * @param {boolean} isPublic
 * @param {object} props
 */
var defineProps = exports.defineProps = function (obj, isPublic, props) {
  _.each(props, function (val, prop) {
    defineProp(obj, isPublic, prop, val);
  });
};

/**
 * Inject a prototype into an object
 *
 * @private
 * @param {object} obj
 * @param {object} proto
 */
exports.injectPrototype = function (obj, proto) {
  var origProto = Object.getPrototypeOf(obj);
  var protoCopy = _.clone(proto);
  defineProp(protoCopy, false, KEY_ORIGINAL_PROTOTYPE, origProto);
  setPrototypeOf(protoCopy, origProto);
  setPrototypeOf(obj, protoCopy);
};

/**
 * Remove an injected prototype from an object
 *
 * @private
 * @param {object} obj
 */
exports.restoreOriginalPrototype = function (obj) {
  if (obj[KEY_ORIGINAL_PROTOTYPE]) {
    setPrototypeOf(obj, obj[KEY_ORIGINAL_PROTOTYPE]);
  }
};

/**
 * Create a sub-request object
 *
 * @private
 * @param {object} parentReq
 * @param {object} props
 * @returns {MockRequest}
 */
exports.createSubRequest = function (parentReq, props) {
  RESERVED_PROPS.forEach(function (prop) {
    props[prop] = parentReq[prop];
  });

  props.params = props.params || parentReq.params || {};
  props.query = props.query || parentReq.query || {};
  delete props.body; // Reserved, handled below

  var requestDepth = ~~parentReq.requestDepth + 1;
  var originalReq = parentReq.originalReq || parentReq;
  var method = (props.method || parentReq.method || 'GET').toUpperCase();
  var url = props.url || parentReq.url || '/';
  var canHaveBody = ['GET', 'HEAD', 'DELETE'].indexOf(method) === -1;
  var canPipe = originalReq.body === undefined && parentReq.__canPipe !== false;

  if (canHaveBody && !canPipe) {
    props.headers['Content-Length'] = 0;
  }

  var subReq = new MockRequest(method, url, props);

  // Inject additional properties into a separate prototype layer, preserving getters/setters
  if (arguments.length > 2) {
    var proto = Object.create(Object.getPrototypeOf(subReq));
    [].slice.call(arguments, 2).forEach(function (obj) {
      mergeDescriptors(proto, obj);
    });
    setPrototypeOf(subReq, proto);
  }

  defineProps(subReq, true, {
    subRequest: true,
    requestDepth: requestDepth,
    parentReq: parentReq,
    originalReq: originalReq,
    originalUrl: originalReq.originalUrl || originalReq.url
  });

  Object.defineProperties(subReq, {
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

  // Handle body
  subReq._teardownSubRequest = function () {};
  if (canHaveBody) {
    if (!canPipe) {
      subReq.__canPipe = false;

      return subReq;
    }

    var didSetupPipe = false;
    parentReq.__canPipe = false;
    subReq.__canPipe = true;
    subReq._read = function (size) {
      if (subReq.__canPipe && !didSetupPipe) {
        didSetupPipe = true;

        while ((parentReq = subReq.parentReq) && parentReq !== originalReq) {
          parentReq.push(null);
        }

        subReq._setSource(originalReq);
        return subReq._read(size);
      }
    };

    subReq._teardownSubRequest = function () {
      if (!didSetupPipe && this.parentReq !== originalReq) {
        this.parentReq.__canPipe = true;
      }
    };
  }

  return subReq;
};
