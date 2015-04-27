'use strict';

var _ = require('lodash'),
  inherits = require('util').inherits,
  generateExpressRouter = require('express').Router,
  EventEmitter = require('eventemitter3'),
  debug = require('debug')('routicorn:route'),
  thr = require('throw');

/**
 * Base Route class
 *
 * @constructor
 * @abstract
 *
 * @param {string} routeName Route name
 * @param {string} pattern Pattern
 * @param {object} options Options
 */
function BaseRoute(routeName, pattern, options) {
  var self = this;

  if (Object.getPrototypeOf(self) === BaseRoute.prototype) {
    thr('Cannot instanciate abstract class BaseRoute');
  }

  EventEmitter.call(self);

  self._actionable = false;
  self._mounted = false;
  self._parsedPattern = self._parsePattern(pattern, options);
  self._expressRouterOptions = options.routerOptions || {};
  self._middleware = [];
  self._expressRouter = null;

  Object.defineProperties(self, {
    /**
     * @memberof BaseRoute#
     * @type {string} Unique name of this route
     * @readonly
     */
    name: {
      configurable: false,
      value: routeName
    },

    /**
     *
     */
    actionable: {
      configurable: false,
      get: function () {
        return self._actionable;
      }
    },

    /**
     * Sanitized route pattern relative to parent route
     * @memberof BaseRoute#
     * @type {string}
     * @readonly
     * @protected
     */
    pattern: {
      configurable: false,
      value: self._parsedPattern.pattern
    },

    /**
     * Whether this route has been mounted on a parent route
     * @memberof BaseRoute#
     * @type {boolean} mounted
     * @readonly
     */
    mounted: {
      configurable: false,
      get: function () {
        return self._mounted;
      }
    }
  });
}

inherits(BaseRoute, EventEmitter);

_.extend(BaseRoute.prototype, {

  /**
   * Invoke this route manually
   *
   * @param {object} req Request
   * @param {object} res Response
   * @param {function} next Callback
   */
  invoke: function (req, res, next) {
    thr('Method not available: %s#invoke', this.constructor.name);
  },

  /**
   * Mount a sub route
   *
   * @param {object} expressRouter Express router to mount on
   */
  mount: function (expressRouter) {
    thr('Method not available: %s#mount', this.constructor.name);
  },

  /**
   * Proxy express router API: handle
   */
  handle: function () {
    var expressRouter = this._getExpressRouter();
    expressRouter.handle.apply(expressRouter, arguments);
  },

  /**
   * Proxy express router API: param
   */
  param: function () {
    var expressRouter = this._getExpressRouter();
    expressRouter.param.apply(expressRouter, arguments);
  },

  /**
   * Add middleware to the shimmed express router
   *
   * @param {string} [mountPath] Optional mount path
   * @param {function} fn Middleware function
   */
  use: function (mountPath, fn) {
    if (this._mounted) {
      thr('Cannot add middleware to already mounted route: %s', this.name);
    }

    if (_.isFunction(mountPath)) {
      fn = mountPath;
      mountPath = null;
    }

    var order = this._middleware.length;

    debug('Register middleware at route-relative path: %s (position: %d)', mountPath ? mountPath : '/', order);

    this._middleware.push([mountPath, fn]);
  },

  /**
   * Get attached middleware as `[mountPath, fn]`
   *
   * @return {Array}
   */
  middleware: function () {
    return this._middleware;
  },

  /**
   * Generate an absolute path to this route (without scheme)
   *
   * @param {object} [params={}] Parameter values
   * @param {object} [queryParams={}] Query parameters
   * @param {boolean} [checkRequirements=true] Whether to validate the supplied parameter values
   *
   * @returns {string}
   */
  generatePath: function (params, queryParams, checkRequirements) {
    thr('Method not available: %s#generatePath', this.constructor.name);
  },

  /**
   * Get the parent route of this route
   *
   * @returns {BaseRoute}
   */
  getParentRoute: function () {
    return this._parentRoute;
  },

  /**
   * Set the parent route. Fails if this route is already a child of another route.
   *
   * @param {BaseRoute} parentRoute Parent route
   * @param {boolean} [unshift=false] Unshift this route at the parent
   */
  setParentRoute: function (parentRoute, unshift) {
    if (this._parentRoute) {
      // Theoretically, a route could have multiple parents without problem, but then route
      // generation would be impossible as the parent would be ambiguous.
      thr('A route cannot be the child of multiple parent routes');
    }

    if (parentRoute.actionable) {
      thr('Parent route does not allow adding sub routes');
    }

    // This breaks GC
    parentRoute.addSubRoute(this, unshift);
    this._parentRoute = parentRoute;
  },

  /**
   * Determine if this route has a parent route
   *
   * @returns {boolean}
   */
  hasParentRoute: function () {
    return !!this._parentRoute;
  },

  /**
   * Determine if this route is a child of another route
   *
   * @param {BaseRoute} parentRoute Parent route
   */
  isChildRouteOf: function (parentRoute) {
    var route = this;
    while ((route = route.getParentRoute())) {
      if (route === parentRoute) {
        return true;
      }
    }

    return false;
  },

  /**
   * Determine if this route is the parent of another route
   *
   * @param {BaseRoute} subRoute Sub route
   */
  isParentRouteOf: function (subRoute) {
    return subRoute.isChildRouteOf(this);
  },

  /**
   * Determine if this route is a sibling of another route
   *
   * @param {BaseRoute} siblingRoute Sibling route
   */
  isSiblingOf: function (siblingRoute) {
    var siblingParent = siblingRoute.getParentRoute();

    return siblingParent && this._parentRoute && siblingParent === this._parentRoute;
  },

  /**
   * Handle a request, dispatching it into this route
   *
   * @protected
   *
   * @param {function} fn Controller action method to call
   * @param {object} req Request
   * @param {object} res Response
   * @param {function} next Callback
   */
  _invokeAction: function (fn, req, res, next) {
    thr('Method not available: %s#_invokeAction', this.constructor.name);
  },

  /**
   * Parse route pattern
   *
   * @protected
   *
   * @param {string} pattern Pattern
   * @param {object} options Parse options
   *
   * @returns {{pattern: string, segments: object[], params: Array, paramData: object,
   *   optionalParams: string[], mandatoryParams: string[]}}
   */
  _parsePattern: function (pattern, options) {
    var params = [],
      paramData = {},
      optionalParams = [],
      mandatoryParams = [];

    var requirements = options.requirements || {},
      defaults = options.defaults || {};

    var segments =
      _.trim((pattern || '').replace(/\/+/g, '/'), '/')
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

          var param = segment.substr(1).replace(/\?$/, ''),
            optional = segment.charAt(segment.length - 1) === '?';

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

    var extraDefaultParams = {};
    _.each(defaults, function (val, key) {
      if (!paramData[key]) {
        extraDefaultParams[key] = val;
      }
    });

    return {
      pattern: segments.length === 0 ? '/' : pattern,
      segments: segments,
      params: params,
      paramData: paramData,
      optionalParams: optionalParams,
      mandatoryParams: mandatoryParams,
      extraDefaultParams: extraDefaultParams
    };
  },

  /**
   * Internal middleware to process request params
   *
   * @protected
   *
   * @param {object} req Express request object
   * @param {object} res Express response object
   * @param {function} next Callback
   */
  _handleRequestParams: function (req, res, next) {
    var self = this;

    debug('Handle request params: %s', this.name);

    if (req.routicornExtraParams) {
      _.defaults(req.params, req.routicornExtraParams);
    }

    var newParams = {};
    self._parsedPattern.params.forEach(function (param) {
      var paramData = self._parsedPattern.paramData[param],
        val = req.params[param];

      if (!val && paramData.defaultValue) {
        val = newParams[param] = req.params[param] = paramData.defaultValue;
      }

      if (!val && !paramData.optional) {
        return next(new Error('Missing parameter: ' + param));
      }

      if (val && paramData.regExp && !paramData.regExp.test(val)) {
        return next(new Error('Invalid value "' + val + '" for parameter: ' + param));
      }
    });

    _.each(self._parsedPattern.extraDefaultParams, function (val, key) {
      req.params[key] = newParams[key] = req.params[key] || val;
    });

    req.routicornExtraParams = req.routicornExtraParams || {};
    _.extend(req.routicornExtraParams, newParams);

    next();
  },

  /**
   * Get a lazily created express router
   *
   * @protected
   *
   * @returns {object}
   */
  _getExpressRouter: function () {
    if (!this._expressRouter) {
      this._expressRouter = generateExpressRouter(this._expressRouterOptions);
    }

    return this._expressRouter;
  },

  /**
   * Set this route actionable, rendering it a leaf
   *
   * @protected
   */
  _setActionable: function () {
    this._actionable = true;
  },

  /**
   * Get route chain as string for debugging
   *
   * @protected
   *
   * @returns {string}
   */
  _getRouteChain: function getRouteChain() {
    var chain = [this.name], route = this;
    while ((route = route.getParentRoute())) {
      chain.unshift(route.name);
    }

    return chain.join(' → ');
  }

});

module.exports = BaseRoute;
