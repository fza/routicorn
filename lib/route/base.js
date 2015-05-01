'use strict';

var _ = require('lodash'),
  qs = require('qs'),
  inherits = require('util').inherits,
  generateExpressRouter = require('express').Router,
  httpVerbs = require('methods'),
  EventEmitter = require('eventemitter3'),
  debug = require('debug')('routicorn:route'),
  thr = require('throw');

var nameRegEx = /^[@-_a-zA-Z0-9]+$/;

/**
 * Abstract base route class
 *
 * Events:
 * - `beforeMount`: Emitted just before mounting sub-routes or actions. Arguments: expressRouter
 * - `mount`: Emitted after mounting sub-routes or actions. Arguments: expressRouter
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

  if (!nameRegEx.test(routeName)) {
    thr('Bad route name "%s": name must match ^[@-_a-zA-Z0-9]+$', routeName);
  }

  self._actionable = false;
  self._root = false;
  self._mounted = false;
  self._parsedPattern = self._parsePattern(pattern, options);
  self._expressRouterOptions = options.routerOptions || {};
  self._middleware = [];
  self._parentRoute = null;
  self._subRoutes = [];
  self._expressRouter = null;
  self._settings = {};

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
     * Whether this is an actionable route (i.e. has action handlers)
     * @memberof BaseRoute#
     * @type {Object}
     * @readonly
     * @protected
     */
    actionable: {
      configurable: false,
      get: function () {
        return self._actionable;
      }
    },

    /**
     * Whether this is a root route
     * @memberof BaseRoute#
     * @type {Object}
     * @readonly
     * @protected
     */
    root: {
      configurable: false,
      get: function () {
        return self._root;
      }
    },

    /**
     * Custom route settings
     * @memberof BaseRoute#
     * @type {Object}
     * @readonly
     */
    settings: {
      configurable: false,
      value: self._settings
    },

    /**
     * Sanitized route pattern relative to parent route pattern
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
    },

    /**
     * Sub-routes
     * @memberof BaseRoute
     * @type {BaseRoute[]}
     * @readonly
     */
    subRoutes: {
      configurable: false,
      value: self._subRoutes
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
    debug('Invoke route %s: %s', this.name, req.url);

    req.routicornRoute = this;
    this._getExpressRouter()(req, res, function (err) {
      delete req.routicornRoute;
      next(err);
    });
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
   * Get the value of a setting
   *
   * @param setting
   */
  get: function (setting) {
    return this._settings[setting];
  },

  /**
   * Set the value of a setting
   *
   * @param setting
   * @param val
   */
  set: function (setting, val) {
    this._settings[setting] = val;
  },

  /**
   * Enable a setting
   *
   * @param setting
   */
  enable: function (setting) {
    this._settings[setting] = true;
  },

  /**
   * Determine if a setting is enabled
   *
   * @param setting
   *
   * @returns {boolean}
   */
  enabled: function (setting) {
    return !!this._settings[setting];
  },

  /**
   * Disable a setting
   *
   * @param setting
   */
  disable: function (setting) {
    this._settings[setting] = false;
  },

  /**
   * Determine if a setting is disabled
   *
   * @param setting
   *
   * @returns {boolean}
   */
  disabled: function (setting) {
    return !!this._settings[setting] === false;
  },

  /**
   * Get attached middleware as `[mountPath, fn]`
   *
   * @return {Array}
   */
  getAllMiddleware: function () {
    return this._middleware;
  },

  /**
   * Add sub routes
   *
   * @param {BaseRoute|BaseRoute[]} subRoutes Sub routes to add
   * @param {boolean} [unshift=false] Unshift the routes
   */
  addSubRoutes: function (subRoutes, unshift) {
    if (this.actionable) {
      thr('Cannot add a sub-route to an actionable route: %s', this.name);
    }

    subRoutes = _.isArray(subRoutes) ? subRoutes : [subRoutes];
    [][unshift ? 'unshift' : 'push'].apply(this._subRoutes, subRoutes);
  },

  /**
   * Check if this route has attached sub-routes
   *
   * @returns {boolean}
   */
  hasSubRoutes: function () {
    return !this.actionable && this._subRoutes.length > 0;
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

    if (this._root) {
      thr('Cannot set another route as parent root of root route: %s', this.name);
    }

    if (parentRoute.actionable) {
      thr('Parent route is actionable and cannot have sub routes: %s', parentRoute.name);
    }

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
   * Get all parent routes beginning with top most route.
   *
   * @param {BaseRoute[]} [untilRoute] The route where to stop iterating, defaults to the top most
   *   route that can be reached from this route. (with mounted routes this is the root route)
   *
   * @return {BaseRoute[]}
   */
  getParentRoutes: function (untilRoute) {
    var route = this, parentRoutes = [];
    while (route !== untilRoute && (route = route.getParentRoute()) !== null) {
      parentRoutes.unshift(route);
    }

    return parentRoutes;
  },

  /**
   * Find the nearest connecting route of this route and another route
   *
   * @param {BaseRoute} route
   */
  findConnectingRoute: function (route) {
    var checkRoute = this;
    do {
      if (checkRoute.root || checkRoute === route || route.isChildRouteOf(checkRoute)) {
        return checkRoute;
      }
    } while (!!(checkRoute = checkRoute.getParentRoute()));

    return null;
  },

  /**
   * Determine if this route is a child of another route
   *
   * @param {BaseRoute} parentRoute Parent route
   * @param {number} [searchDepth=Infinity] Maximum search depth
   */
  isChildRouteOf: function (parentRoute, searchDepth) {
    if (parentRoute.actionable || this === parentRoute) {
      return false;
    }

    if (!searchDepth || searchDepth < 0) {
      searchDepth = Infinity;
    }

    var route = this;
    while (searchDepth-- > 0 && (route = route.getParentRoute()) !== null && route !== parentRoute) {}

    return route === parentRoute;
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
   * Get a proper string representation of route instances
   *
   * @returns {string}
   */
  toString: function () {
    return '[' + this.constructor.name + ' ' + this.name + ']';
  },

  /**
   * Generate an absolute path to this route (without scheme)
   *
   * @param {object} [params={}] Parameter values
   * @param {object} [queryParams={}] Query parameters
   * @param {boolean} [checkRequirements=true] Whether to validate the supplied parameter values
   * @param {BaseRoute|boolean} [mod=false] If this is a BaseRoute, it can be used to set the top
   *   most route to include in the pattern. If this is a boolean, the returned value will be an
   *   array of path segments and corresponding routes with the first element being the complete
   *   path and the second item being the query string, like: `['/foo/bar/baz', '?abc=123', ['/foo',
   *   routeInstance], …]`. The default is to return a single string with all segments from the
   *   current to the root route.
   *
   * @returns {*}
   */
  generatePath: function (params, queryParams, checkRequirements, mod) {
    var self = this;

    if (params instanceof BaseRoute) {
      mod = params;
      params = queryParams = {};
      checkRequirements = true;
    } else if (_.isBoolean(params)) {
      checkRequirements = params;
      params = queryParams = {};
    } else if (_.isBoolean(queryParams)) {
      checkRequirements = queryParams;
      queryParams = {};
    } else if (checkRequirements instanceof BaseRoute) {
      mod = checkRequirements;
      checkRequirements = true;
    }

    params = params || {};
    queryParams = queryParams || {};
    checkRequirements = checkRequirements !== false;

    var topMostRoute = _.isObject(mod) && mod instanceof BaseRoute ? mod : null,
      returnArr = !topMostRoute ? !!mod : false;

    var route = self, segments = [], routes = [];
    do {
      if (_.isRegExp(route.pattern)) {
        thr(
          'Cannot generate path of a true RegExp pattern for route: %s. Route chain: %s',
          route.name,
          self._getRouteChain()
        );
      }

      routes.unshift(route);
      segments.unshift(route._parsedPattern.segments.reduce(function (memo, segment) {
        if (!segment.isParam) {
          return memo + '/' + segment.cleanValue;
        }

        var val = params[segment.param],
          useDefault = false;

        if (!val) {
          if (!segment.defaultValue) {
            if (segment.optional) {
              return memo;
            }

            thr(
              'Cannot generate path: missing param "%s" (defined in %s). Route chain: %s',
              segment.param,
              route.name,
              self._getRouteChain()
            );
          }

          val = segment.defaultValue;
          useDefault = true;
        }

        if (checkRequirements && segment.regExp && !segment.regExp.test(val)) {
          thr(
            'Cannot generate path for route %s: Value "%s"%s does not pass requirement for param "%s". Route chain: %s',
            route.name,
            val,
            useDefault ? ' (=default)' : '',
            segment.param,
            self._getRouteChain()
          );
        }

        return memo + '/' + val;
      }, ''));
    } while (!!(route = route.getParentRoute()) && route !== topMostRoute);

    var queryString = qs.stringify(queryParams);
    if (queryString) {
      queryString = '?' + queryString;
    }

    var path = '/' + _.trim(segments.join('').replace(/\/+/g, '/'), '/') + queryString;

    if (returnArr) {
      return [].concat.call([path, queryString], segments.map(function (segment, idx) {
        return [segment, routes[idx]];
      }));
    }

    return path;
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

    debug('Handle request params for route: %s', this.name);

    if (req._routicornExtraParams) {
      _.defaults(req.params, req._routicornExtraParams);
    }

    var err, newParams = {};
    self._parsedPattern.params.forEach(function (param) {
      var paramData = self._parsedPattern.paramData[param],
        val = req.params[param];

      if (!val && paramData.defaultValue) {
        val = newParams[param] = req.params[param] = paramData.defaultValue;
      }

      if (!val && !paramData.optional) {
        err = new Error('Missing parameter: ' + param);
        debug(err.message);
        return next(err);
      }

      if (val && paramData.regExp && !paramData.regExp.test(val)) {
        err = new Error('Invalid value "' + val + '" for parameter: ' + param);
        debug(err.message);
        return next(err);
      }
    });

    _.each(self._parsedPattern.extraDefaultParams, function (val, key) {
      req.params[key] = newParams[key] = req.params[key] || val;
    });

    req._routicornExtraParams = req._routicornExtraParams || {};
    _.extend(req._routicornExtraParams, newParams);

    next();
  },

  /**
   * Mount middleware
   *
   * @protected
   */
  _mountMiddleware: function () {
    if (this._middleware.length > 0) {
      debug('Mounting middleware for route: %s (%d middlewares found)', this.name, this._middleware.length);
      var expressRouter = this._getExpressRouter();
      this._middleware.forEach(function (middleware) {
        if (middleware[0]) {
          expressRouter.use(middleware[0], middleware[1]);
        } else {
          expressRouter.use(middleware[1]);
        }
      });
    }
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
      debug('Create express router for route: %s', this.name);
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
   * Set this route as a root route
   *
   * @protected
   */
  _setRoot: function () {
    if (this._parentRoute) {
      thr('Cannot set %s as root route, parent route is %s', this.name, this._parentRoute.name);
    }

    this._root = true;
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

// Proxy some more express Router API methods
['handle', 'param', 'all', 'route'].concat(httpVerbs).forEach(function (methodName) {
  BaseRoute.prototype[methodName] = function () {
    if (this.mounted) {
      if (this.mounted) {
        thr('Cannot call express router of already mounted route: %s', this.name);
      }
    }

    var expressRouter = this._getExpressRouter();
    expressRouter[methodName].apply(expressRouter, arguments);
  };
});

// Alias
BaseRoute.prototype.addSubRoute = BaseRoute.prototype.addSubRoutes;

module.exports = BaseRoute;
