'use strict';

var _ = require('lodash');
var inherits = require('util').inherits;
var debug = require('debug')('routicorn:router');
var thr = require('format-throw');
var shortid = require('shortid');
var request = require('./request');
var response = require('./response');
var BaseRoute = require('./route/base');
var SegmentRoute = require('./route/segment');
var RouteFactory = require('./route/factory');
var ControllerFactory = require('./controller-factory');
var utils = require('./utils');

/**
 * @private
 * @param {Routicorn} routicorn
 * @returns {function}
 */
function createMiddleware(routicorn) {
  var fn = function routicornDispatcher(req, res, next) {
    debug('Dispatching request into router: %s', req.url);

    utils.injectPrototype(req, routicorn.request);
    utils.injectPrototype(res, routicorn.response);

    if (!req._handledParams) {
      utils.defineProp(req, false, 'handledParams', {});
    }

    routicorn._invoke(req, res, function (err) {
      utils.restoreOriginalPrototype(req);
      utils.restoreOriginalPrototype(res);
      next(err);
    });
  };

  Object.defineProperty(fn, 'instance', {
    configurable: false,
    writable: false,
    enumerable: true,
    value: routicorn
  });

  return fn;
}

/**
 * Get an express compatible middleware function that invokes Routicorn. A Routicorn instance is a
 * {@link SegmentRoute}, so it's possible to add middleware and param handlers at the root level.
 * The Routicorn instance is available at the `instance` property of the returned function:
 *
 * ```javascript
 * var routicorn = new Routicorn();
 * routicorn.instance.loadRoutes('routing/main.yml');
 * app.use(routicorn);
 * ```
 *
 * Events:
 * - `route registered`: Emitted when a route is added. Listeners get passed the route instance.
 *
 * @constructor
 * @extends SegmentRoute
 * @param {object} [options={}] Options. See {@link BaseRoute}
 * @returns {function} Middleware function
 */
function Routicorn(options) {
  if (!(this instanceof Routicorn)) {
    return new Routicorn(options);
  }

  options = options || {};

  // Every Routicorn instance gets its own short id, so that nesting Routicorn instances is possible
  SegmentRoute.call(this, '@routicorn-' + shortid.generate() + '@', '/', null, options);

  // Private properties
  var routeFactory;
  utils.defineProps(this, false, {
    /**
     * @memberof Routicorn#
     * @name _routeFactory
     * @type {RouteFactory}
     * @readonly
     * @protected
     */
    routeFactory: function () {
      if (!routeFactory) {
        routeFactory = new RouteFactory(this, new ControllerFactory(options.controllerBasePath));
      }

      return routeFactory;
    },

    /**
     * @memberof Routicorn#
     * @name _routes
     * @type {object}
     * @readonly
     * @private
     */
    routes: {}
  });

  // Public properties
  utils.defineProps(this, true, {
    /**
     * @memberof Routicorn#
     * @type {object}
     * @readonly
     */
    request: _.extend({
      routicorn: this
    }, request),

    /**
     * @memberof Routicorn#
     * @type {object}
     * @readonly
     */
    response: _.extend({
      routicorn: this
    }, response)
  });

  if (options.routingFile) {
    if (!_.isString(options.routingFile)) {
      thr(TypeError, 'options.routingFile must be a string');
    }

    this.loadRoutes(options.routingFile);
  }

  return createMiddleware(this);
}

inherits(Routicorn, SegmentRoute);

/**
 * Load routes from a YAML file or route config objects
 *
 * @param {string|object} source Path to YAML file or an object with route configs
 * @returns {object.<string, BaseRoute>}
 */
SegmentRoute.prototype.loadRoutes = function (source) {
  if (_.isString(source)) {
    return this._routeFactory.createRoutesFromYmlFile(source, this);
  }

  return this._routeFactory.createRoutesFromConfigs(source, this);
};

/**
 * Register a route at the root scope of the router. Sub-routes should be added via
 * {@link BaseRoute#addSubRoute}.
 *
 * @param {BaseRoute} route Route instance
 */
Routicorn.prototype.registerRoute = function (route) {
  if (route === this) {
    return;
  }

  if (!(route instanceof BaseRoute)) {
    thr(TypeError, 'route must be an instance of BaseRoute');
  }

  if (this._routes[route.name]) {
    if (this._routes[route.name] === route) {
      return;
    }

    thr('Cannot add route %s: A route with the same name already exists', route.name);
  }

  utils.defineProp(this._routes, true, route.name, route);

  this.emit('route registered', route);
};

/**
 * Get all routes
 *
 * @param {string} [tag] Tag filter
 * @param {boolean} [asArray=false] Return an array instead of an object
 * @returns {object.<string, BaseRoute>|BaseRoute[]}
 */
Routicorn.prototype.getRoutes = function (tag, asArray) {
  var result = this._routes;

  if (_.isString(tag) && tag) {
    result = {};
    _.each(this._routes, function (route) {
      if (route.hasTag(tag)) {
        result[route.name] = route;
      }
    });
  }

  return asArray ? _.values(result) : result;
};

/**
 * Get a route by name
 *
 * @param {string} routeName Route name
 * @returns {BaseRoute}
 */
Routicorn.prototype.getRoute = function (routeName) {
  var route = this._routes[routeName];

  if (!route) {
    thr('Route does not exist: %s', routeName);
  }

  return route;
};

/**
 * Determine if a route has been attached to this router (at any depth)
 *
 * @param {string|BaseRoute} route Route instance or route name
 * @returns {boolean}
 */
Routicorn.prototype.hasRoute = function (route) {
  if (!_.isString(route) && !(route instanceof BaseRoute)) {
    thr(TypeError, 'route must be a string or an instance of BaseRoute');
  }

  if (!_.isString(route)) {
    route = route.name;
  }

  return !!this._routes[route];
};

/**
 * Generate a path for a named route. Shortcut for `routicorn.getRoute().generatePath()`. See
 * {@link BaseRoute#generatePath}
 *
 * Usage: `routicorn.generatePath(routeName, [params, [query, [options]]]);`
 *
 * @param {string} routeName Route name
 * @param {object} [params={}] Route parameters
 * @param {object} [query={}] Query parameters
 * @param {object} [options={}] Options, see {@link BaseRoute.generatePath}
 * @returns {string}
 */
Routicorn.prototype.generatePath = function (routeName, params, query, options) {
  if (!_.isString(routeName)) {
    thr(TypeError, 'routeName must be a string');
  }

  return this.getRoute(routeName).generatePath(params, query, options);
};

/**
 * Generate an absolute URL to a route. Shortcut for `routicorn.getRoute().generateUrl()`. See
 * {@link BaseRoute#generateUrl}
 *
 * Usage: `routicorn.generateUrl(routeName, [params, [query, [options]]]);`
 *
 * @param {string} routeName Route name
 * @param {object} [params={}] Route parameters
 * @param {object} [query={}] Query parameters
 * @param {object} [options={}] Options, see {@link BaseRoute.generateUrl}
 * @returns {string}
 */
Routicorn.prototype.generateUrl = function (routeName, params, query, options) {
  if (!_.isString(routeName)) {
    thr(TypeError, 'routeName must be a string');
  }

  return this.getRoute(routeName).generateUrl(params, query, options);
};

/**
 * Get a made-up tree representation of this router for debugging
 *
 * @returns {string}
 */
Routicorn.prototype.getRouteTree = function () {
  var result = this.name;
  var indentLevel = 0;

  function addLine(msg) {
    result += '\n' + _.repeat('  ', indentLevel) + '→ ' + msg;
  }

  function printSubRoutes(route) {
    indentLevel++;
    _.each(route.subRoutes, function (subRoute) {
      var info = [];

      var verbs = '';
      if (subRoute.actionable) {
        verbs = _.map(subRoute.verbs, function (verb) {
          return verb.toUpperCase();
        });
      }

      if (subRoute.verbStyle) {
        info.push('verb-style');
      }

      addLine(
        subRoute + ': ' +
        (verbs.length ? (verbs.join(',') + ' ') : '') +
        subRoute.pattern +
        (info.length > 0 ? ' (' + info.join(', ') + ')' : '')
      );

      printSubRoutes(subRoute);
    });
    indentLevel--;
  }

  printSubRoutes(this);

  return result;
};

/**
 * @class SegmentRoute
 */
Routicorn.SegmentRoute = require('./route/segment');

/**
 * @class ActionRoute
 */
Routicorn.ActionRoute = require('./route/action');

module.exports = Routicorn;
