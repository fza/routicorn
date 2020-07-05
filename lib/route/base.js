'use strict';

var _ = require('lodash');
var debug = require('debug')('routicorn:route:base');
var thr = require('format-throw');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var qs = require('qs');
var utils = require('../utils');

var NAME_REGEX = /^[\w@-]+$/;

function parsePattern(pattern, options) {
  if (!_.isString(pattern)) {
    thr(TypeError, 'pattern must be a string');
  }

  options = options || {};

  var params = [];
  var paramData = {};
  var optionalParams = [];
  var mandatoryParams = [];
  var requirements = options.requirements || {};
  var defaults = options.defaults || {};
  var segments = _.trim((pattern || '').replace(/\/+/g, '/'), '/')
    .split('/')
    .map(function (segment) {
      if (segment.charAt(0) !== ':') {
        // Not a param
        return {
          isParam: false,
          value: segment,
          cleanValue: segment.replace(/[\?\*\+\(\)]/g, '')
        };
      }

      var param = segment.substr(1).replace(/\?$/, '');
      var optional = segment.charAt(segment.length - 1) === '?';

      if (!/[\?\*\+\(\)]/.test(param)) {
        params.push(param);
        (optional ? optionalParams : mandatoryParams).push(param);

        var regExp = null;
        if (requirements[param]) {
          var regExpStr = requirements[param];
          if (regExpStr.charAt(0) === '/') {
            regExpStr = regExpStr.substring(1, regExpStr.length - 1);
          }
          regExp = new RegExp(regExpStr);
        }

        return paramData[param] = {
          isParam: true,
          value: segment,
          param: param,
          optional: optional,
          regExp: regExp,
          defaultValue: defaults[param]
        };
      }
    });

  // This one is controversial: Params that are defined in the 'defaults' section of a route
  // config object, but that are not present in the pattern. For now, let's treat these params as
  // being static that only a param handler or a sub-route can override.
  var staticParams = {};
  _.each(defaults, function (val, key) {
    if (!paramData[key]) {
      staticParams[key] = val;
    }
  });

  return {
    pattern: segments.length === 0 ? '/' : pattern,
    segments: segments,
    params: params,
    paramData: paramData,
    optionalParams: optionalParams,
    mandatoryParams: mandatoryParams,
    staticParams: staticParams
  };
}

function callHandlers(handlers, done) {
  var args = [].slice.call(arguments, 2);
  var argsLength = args.length;
  var idx = 0;

  function nextHandler(err) {
    var handler = handlers[idx++];

    if (!err && handler) {
      debug('Call handler: %s', handler.name || '[anonymous function]');

      switch (argsLength) {
        case 0:
          // fn(next)
          return handler(nextHandler);

        case 1:
          // fn(req, next)
          return handler(args[0], nextHandler);

        case 2:
          // fn(req, res, next)
          return handler(args[0], args[1], nextHandler);

        case 3:
          // fn(req, res, next, val)
          return handler(args[0], args[1], nextHandler, args[2]);

        default:
          // fn(req, res, next, …)
          return handler.apply(null, args);
      }
    }

    done(err);
  }

  if (argsLength > 3) {
    var tmp = args.slice(0, 2);
    tmp.push(nextHandler);
    args = tmp.concat(args.slice(2));
  }

  nextHandler();
}

/**
 * Options:
 * - `controllerBasePath`: {string} ["app/controllers"] Base path to load controller script files
 * - `routingFile`: {string} [undefined] Path to a YAML routing file to load initially
 *
 * Events:
 * - `request`: Emitted when a request is about to be handled. Listeners get the request object.
 *
 * @constructor
 * @abstract
 * @private
 * @param {string} routeName Route name
 * @param {string} pattern Pattern
 * @param {?SegmentRoute} parentRoute Parent route. If this is a root route, `parentRoute` should be
 *   a {@link Routicorn} instance.
 * @param {object} options Options
 */
function BaseRoute(routeName, pattern, parentRoute, options) {
  if (Object.getPrototypeOf(this) === BaseRoute.prototype) {
    thr('Cannot instanciate abstract class BaseRoute');
  }

  var self = this;

  EventEmitter.call(this);

  if (!NAME_REGEX.test(routeName)) {
    thr('Bad route name "%s": Name must match %s', routeName, NAME_REGEX);
  }

  if (pattern instanceof RegExp) {
    thr(TypeError, 'pattern must be a string');
  }

  // Private/protected properties
  var expressRouter;
  utils.defineProps(this, false, {
    /**
     * @memberof BaseRoute#
     * @name _parsedPattern
     * @type {object}
     * @readonly
     * @private
     */
    parsedPattern: parsePattern(pattern, options),

    /**
     * @memberof BaseRoute#
     * @name _middleware
     * @type {Array}
     * @readonly
     * @private
     */
    middleware: [],

    /**
     * @memberof BaseRoute#
     * @name _paramHandlers
     * @type {object}
     * @readonly
     * @private
     */
    paramHandlers: {},

    /**
     * @memberof BaseRoute#
     * @name _tags
     * @type {string[]}
     * @readonly
     * @private
     */
    tags: [],

    /**
     * @memberof BaseRoute#
     * @name _expressRouter
     * @type {object}
     * @readonly
     * @protected
     */
    expressRouter: function () {
      if (!expressRouter) {
        expressRouter = require('express').Router({ // eslint-disable-line new-cap
          mergeParams: true
        });

        expressRouter.use(function handleRequestParams(req, res, next) {
          self._handleRequestParams(req, res, next);
        });

        // Handle middleware ourselves so it's possible to add middleware that is guaranteed to
        // execute before any action handler or sub-route
        expressRouter.use(function invokeMiddleware(req, res, next) {
          if (self._middleware.length > 0) {
            return callHandlers(self._middleware, next, req, res);
          }

          next();
        });
      }

      return expressRouter;
    }
  });

  // Public properties
  utils.defineProps(this, true, {
    /**
     * Unique name of this route
     * @memberof BaseRoute#
     * @type {string}
     * @readonly
     */
    name: routeName,

    /**
     * Action route flag
     * @memberof BaseRoute#
     * @type {boolean}
     * @readonly
     */
    actionable: function () {
      return !!this.controller;
    },

    /**
     * @memberof BaseRoute#
     * @type {BaseRoute}
     * @readonly
     */
    parentRoute: parentRoute || null,

    /**
     * Route pattern
     * @memberof BaseRoute#
     * @type {string}
     * @readonly
     */
    pattern: this._parsedPattern.pattern
  });

  if (parentRoute) {
    parentRoute.addSubRoute(this);
  }
}

inherits(BaseRoute, EventEmitter);

/**
 * Add middleware to be executed when this route is invoked, before any action handler is called
 * and after all param handlers have been invoked. Multiple functions can be provided either by
 * using multiple arguments or by using arrays.
 *
 * Usage: `route.use(function(req, res, next) {…})`
 *
 * @param {function|function[]} fn Middleware function(s)
 */
BaseRoute.prototype.use = function (fn) {
  var fns = _.flatten([].slice.call(arguments), true);

  if (fns.length === 0) {
    thr(TypeError, 'BaseRoute#use() requires middleware functions');
  }

  fns.forEach(function (handlerFn) {
    if (!_.isFunction(handlerFn)) {
      thr(TypeError, 'middleware must be a function');
    }
  });

  [].push.apply(this._middleware, fns);

  debug('Registered %d middleware at route: %s', fns.length, this.name);
};

/**
 * Add a param handler that will be invoked when a specific param is present in a request, before
 * middleware and action handlers. Every handler must call `next()` or the request will be stale.
 * Multiple handlers can be provided either by using multiple arguments or by using arrays.
 *
 * Usage: `route.param('foo', function (req, res, next, val) {…})`
 *
 * @param {string} param Parameter name
 * @param {function|function[]} fn Middleware function(s)
 */
BaseRoute.prototype.param = function (param, fn) {
  if (!_.isString(param)) {
    thr(TypeError, 'param must be a string');
  }

  var fns = _.flatten([].slice.call(arguments, 1), true);

  if (fns.length === 0) {
    thr(TypeError, 'BaseRoute#param() requires handler function(s)');
  }

  fns.forEach(function (handlerFn) {
    if (!_.isFunction(handlerFn)) {
      thr(TypeError, 'param handler must be a function');
    }
  });

  [].push.apply((this._paramHandlers[param] = this._paramHandlers[param] || []), fns);

  debug('Registered %d param handlers for param "%s" at route: %s', fns.length, param, this.name);
};

/**
 * Get all tags
 *
 * @returns {string[]}
 */
BaseRoute.prototype.getTags = function () {
  return this._tags;
};

/**
 * Add a tag
 *
 * @param {string} tag Tag
 */
BaseRoute.prototype.addTag = function (tag) {
  if (!this.hasTag(tag)) {
    this._tags.push(tag);
  }
};

/**
 * Remove a tag
 *
 * @param {string} tag Tag
 */
BaseRoute.prototype.removeTag = function (tag) {
  var idx = this._tags.indexOf(tag);
  if (idx !== -1) {
    this._tags.splice(idx, 1);
  }
};

/**
 * Determine if this route has a specific tag
 *
 * @param {string} tag Tag
 */
BaseRoute.prototype.hasTag = function (tag) {
  return this._tags.indexOf(tag) !== -1;
};

/**
 * Get a list of parent routes
 *
 * @param {BaseRoute} [stopRoute] Top most route where to stop iterating
 * @returns {BaseRoute[]}
 */
BaseRoute.prototype.getParentRoutes = function (stopRoute) {
  var route = this;
  var result = [];
  while ((route = route.parentRoute) !== null && route !== stopRoute) {
    result.unshift(route);
  }

  return result;
};

/**
 * Find the nearest connecting route of this route and another route
 *
 * @param {BaseRoute} route
 * @returns {?BaseRoute}
 */
BaseRoute.prototype.findConnectingRoute = function (route) {
  var checkRoute = this;
  do {
    if (checkRoute.root || checkRoute === route || route.isChildRouteOf(checkRoute)) {
      return checkRoute;
    }
  } while ((checkRoute = checkRoute.parentRoute) !== null);

  return null;
};

/**
 * Determine if this route is a child of another route
 *
 * @param {BaseRoute} parentRoute Parent route
 * @param {number} [searchDepth=Infinity] Maximum search depth
 * @returns {boolean}
 */
BaseRoute.prototype.isChildRouteOf = function (parentRoute, searchDepth) {
  if (parentRoute.actionable || this === parentRoute) {
    return false;
  }

  if (!searchDepth || searchDepth < 1) {
    searchDepth = Infinity;
  }

  var route = this;
  while (searchDepth-- > 0 && (route = route.parentRoute) !== null && route !== parentRoute) {}

  return route === parentRoute;
};

/**
 * Determine if this route is the parent of another route
 *
 * @param {BaseRoute} subRoute Sub-route
 * @returns {boolean}
 */
BaseRoute.prototype.isParentRouteOf = function (subRoute) {
  return subRoute.isChildRouteOf(this);
};

/**
 * Determine if this route is a sibling of another route
 *
 * @param {BaseRoute} siblingRoute Sibling route
 * @returns {boolean}
 */
BaseRoute.prototype.isSiblingOf = function (siblingRoute) {
  var siblingParent = siblingRoute.parentRoute;

  return siblingParent && this._parentRoute && siblingParent === this._parentRoute;
};

/**
 * Get a proper string representation of route instances
 *
 * @returns {string}
 */
BaseRoute.prototype.toString = function () {
  return '[' + this.constructor.name + ' ' + this.name + ']';
};

/**
 * Generate a path to this route
 *
 * Usage: `route.generatePath([params, [query, [options]]])`
 *
 * Options:
 *
 * - `separated`: {boolean} [false] If true, the return value will be an object with the
 * properties `result` (as expected), `path` (without query string), `query` (query string) and
 * `segments` (array, left-to-right order). Each segment is again an array with the first element
 * being the generated string segment and the second being the route instance. Example: `{result:
 * '/foo/bar/baz?abc=123', path: '/foo/bar/baz', query: '?abc=123', segments: [['/foo',
 * routeInstance], …]}`
 * - `fromRoute`: {BaseRoute} [undefined] Pass a route instance. If it is a parent of the current
 * route, ancestors of this given route will be excluded.
 *
 * @param {object} [params={}] Parameter values
 * @param {object} [query={}] Query parameters
 * @param {object} [options={}] Options
 * @returns {string|object}
 */
BaseRoute.prototype.generatePath = function (params, query, options) {
  var self = this;

  params = params || {};
  query = query || {};
  options = options || {};

  var stopRoute = options.fromRoute || null;

  if (stopRoute && !(stopRoute instanceof BaseRoute)) {
    thr(TypeError, 'options.fromRoute must be an instance of BaseRoute');
  }

  var returnObj = !!options.separated;
  var route = self;
  var segments = [];
  var routes = [];

  do {
    routes.unshift(route);
    segments.unshift(route._parsedPattern.segments.reduce(function (memo, segment) {
      if (!segment.isParam) {
        return memo + '/' + segment.cleanValue;
      }

      var val = params[segment.param];
      var useDefault = false;

      if (!val) {
        if (!segment.defaultValue) {
          if (segment.optional) {
            return memo;
          }

          thr(
            'Cannot generate path: missing param "%s" (defined in route "%s"). History: %s',
            segment.param,
            route.name,
            self.getRouteHistory()
          );
        }

        val = segment.defaultValue;
        useDefault = true;
      }

      if (segment.regExp && !segment.regExp.test(val)) {
        thr(
          'Cannot generate path for route "%s": Value "%s"%s does not pass requirement ' +
          'for param "%s". History: %s',
          route.name,
          val,
          useDefault ? '(=default)' : '',
          segment.param,
          self.getRouteHistory()
        );
      }

      return memo + '/' + val;
    }, ''));
  } while ((route = route.parentRoute) !== null && route !== stopRoute);

  var queryString = qs.stringify(query);
  if (queryString) {
    queryString = '?' + queryString;
  }

  var fullPath = '/' + _.trim(segments.join('').replace(/\/+/g, '/'), '/');

  if (returnObj) {
    return {
      result: fullPath + queryString,
      path: fullPath,
      query: queryString,
      segments: segments.map(function (segment, idx) {
        return [segment, routes[idx]];
      })
    };
  }

  return fullPath + queryString;
};

/**
 *
 * Options:
 *
 * - `protoRelative`: {boolean} false True forces the generation of a protocol relative URL.
 * - `secure`: {boolean} false True forces the use of "https", false forces "http".
 * - `host`: {string} undefined Hostname/domain (FQDN). This is a mandatory setting.
 * - `port`: {number} null Either `null` to leave the port out in every case or an integer
 * number. By default, a port is never included in the URL if it matches the protocol's default
 * port (80/443). Routicorn cannot reliably lookup the public port of a gateway server, only if
 * there is a `X-Forwarded-For` header, the port is left unset by default.
 *
 * @param {object} [params={}] Parameter values
 * @param {object} [query={}] Query parameters
 * @param {object} options Options. The `host` setting is mandatory.
 * @returns {string}
 */
BaseRoute.prototype.generateUrl = function (params, query, options) {
  options = options || {};

  if (!_.isBoolean(options.secure)) {
    options.secure = false;
  }

  if (!_.isString(options.hostname)) {
    thr('options.hostname must be a string');
  }

  if (!_.isNumber(options.port)) {
    options.port = null;
  }

  var fullPath = this.generatePath(params, query);
  var secure = options.secure;
  var protocol = options.protoRelative !== true ? ('http' + (secure ? 's' : '')) : '';
  var port = options.port;
  port = (port === null || (secure && port === 443) || (!secure && port === 80)) ? '' : ':' + port;

  return protocol + '://' + options.hostname + port + fullPath;
};

/**
 * Get the route hierarchy as string for debugging
 *
 * @returns {string}
 */
BaseRoute.prototype.getRouteHierarchy = function getRouteChain() {
  var chain = [this.name], route = this;
  while ((route = route.parentRoute)) {
    chain.unshift('' + route);
  }

  return chain.join(' → ');
};

/**
 * Invoke this route
 *
 * @protected
 * @param {object} req Request
 * @param {object} res Response
 * @param {function} next Callback
 */
BaseRoute.prototype._invoke = function (req, res, next) {
  // Mark current route
  req.routicornRoute = this;

  // Make sure extra params array exists
  req._routicornExtraParams = req._routicornExtraParams || [];

  debug('Invoke route %s: %s', this.name, req.url);

  this.emit('request', req);

  this._expressRouter(req, res, function (err) {
    if (!err) {
      delete req.routicornRoute;
      req._routicornExtraParams.pop();
    }

    next(err);
  });
};

/**
 * Process request params
 *
 * @protected
 * @param {object} req Express request object
 * @param {object} res Express response object
 * @param {function} next Callback
 */
BaseRoute.prototype._handleRequestParams = function (req, res, next) {
  var self = this;

  // Extra params that express forgets when giving control to the next router, see
  // https://github.com/strongloop/express/blob/591e89ed1890c3f519c9a732e164e64e758f6dbb/lib/router/index.js#L255
  // Extra params are those that are optional and have a default value in the route config, but are
  // not handled by express when the param was not found in the actual url. Just like express, we
  // provide these params only to the current route and its descendants, but when giving control
  // back to a higher-order route, the extra params of this route will be not be carried over.

  // One hash of extra params per layer
  var extraParamLayers = req._routicornExtraParams;
  var parentExtraParams = extraParamLayers[extraParamLayers.length - 1]; // or undefined
  var currentExtraParams = parentExtraParams ? _.clone(parentExtraParams) : {};
  extraParamLayers.push(currentExtraParams);

  // Mixin extra params from ancestor routes via _default. Express' params always have precedence.
  if (parentExtraParams) {
    _.defaults(req.params, parentExtraParams);
  }

  var paramData;
  var val;
  var error;

  // Inspect all explicit params of this route
  this._parsedPattern.params.forEach(function (param) {
    paramData = self._parsedPattern.paramData[param];
    val = req.params[param];

    if (!val && paramData.defaultValue) {
      // Express didn't recognize this param, but we have a default value
      val = currentExtraParams[param] = req.params[param] = paramData.defaultValue;
    }

    // Throw if the param is mandatory, but missing and there is no default value
    if (!val && !paramData.optional) {
      error = thr.make('Missing parameter: %s', param);
      debug(error.message);
      return next(error);
    }

    // Validate the value
    if (val && paramData.regExp && !paramData.regExp.test(val)) {
      error = thr.make('Invalid value "%s" for parameter: %s', '' + val, param);
      debug(error.message);
      return next(error);
    }
  });

  // Mixin static params, that express has no knowledge about at all
  _.each(this._parsedPattern.staticParams, function (v, k) {
    req.params[k] = currentExtraParams[k] = v;
  });

  // Call param handlers. Express could do this for us, but since there could be additional
  // parameters, we should invoke all param callbacks ourselves.
  var paramName;
  var paramIdx = 0;
  var handleableParams = Object.keys(this._paramHandlers);
  var handlers;

  // No handlers attached
  if (handleableParams.length === 0) {
    return next();
  }

  function nextParamHandlers(err) {
    if (!err) {
      paramName = handleableParams[paramIdx++];
      handlers = self._paramHandlers[paramName];
      if (handlers) {
        val = req.params[paramName];

        // Only call handlers when the param exists in the request at the current route level
        if (val !== undefined) {
          return callHandlers(handlers, nextParamHandlers, req, res, val);
        }

        return nextParamHandlers();
      }
    }

    next(err);
  }

  nextParamHandlers();
};

module.exports = BaseRoute;
