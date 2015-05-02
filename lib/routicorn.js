'use strict';

var _ = require('lodash'),
  path = require('path'),
  inherits = require('util').inherits,
  EventEmitter = require('eventemitter3'),
  routicornReq = require('./request'),
  routicornRes = require('./response'),
  RouteFactory = require('./route/factory'),
  BaseRoute = require('./route/base'),
  RootRoute = require('./route/root'),
  httpVerbs = require('methods'),
  debug = require('debug')('routicorn:router'),
  thr = require('throw');

/**
 * Routicorn can be extended just like any constructor function in JavaScript. Note that the
 * default `new Routicorn()` call will return an express-compatible middleware function and *not*
 * the Routicorn instance itself. The latter is available at the middleware function's `.instance`
 * property.
 *
 * Options:
 * - `defaultMethod:` {string} [get] When loading routes, this is the default method used when
 * no explicit method was defined for a route.
 * - `controllerBasePath`: {string} [null] The base path for controller script files.
 * - `routerOptions`: {Object} [{mergeParams: true}] Options passed to the shimmed [express
 * Router]{@link http://expressjs.com/4x/api.html#router}.
 *
 * Events:
 * - `addRoute`: Emitted when a route is added. Arguments: route
 * - `beforeMount`: Emitted before a route is mounted onto an express.Router. Arguments: `route`
 * - `mount`: Emitted after a route has been mounted onto an express.Router. Arguments: `route`
 * - `skipMount`: Emitted when a route was skipped for mounting, because it has no sub-routes and
 * is thus useless. Arguments: `route`.
 *
 * @constructor
 *
 * @param {object} [options] Options
 *
 * @returns {function} Middleware function
 */
function Routicorn(options) {
  if (!(this instanceof Routicorn)) {
    return Routicorn.call(Object.create(Routicorn.prototype), options);
  }

  EventEmitter.call(this);

  this._options = options = _.merge({
    defaultMethod: 'get',
    controllerBasePath: null,
    routerOptions: {
      mergeParams: true
    }
  }, options || {});

  options.defaultMethod = options.defaultMethod.toLowerCase();
  options.controllerBasePath = options.controllerBasePath || path.join(process.cwd(), 'app', 'controllers');

  this._routes = {};
  this._controllers = {};
  this._middlewareFn = null;
  this._rootRoute = new RootRoute({
    routerOptions: options.routerOptions
  });

  // Define request and request prototypes
  Object.defineProperties(this, {
    request: {
      configurable: false,
      enumerable: false,
      value: _.extend({
        routicorn: this
      }, routicornReq)
    },

    response: {
      configurable: false,
      enumerable: false,
      value: _.extend({
        routicorn: this
      }, routicornRes)
    }
  });

  if (options.routingFile) {
    this.loadRoutes(options.routingFile, true);
  }

  return this.middleware();
}

inherits(Routicorn, EventEmitter);

_.extend(Routicorn.prototype, {

  /**
   * Get an express middleware function that invokes this router and can be supplied to `app.use()`.
   *
   * @returns {function}
   */
  middleware: function () {
    var self = this;

    if (!this._middlewareFn) {
      var fn = function routicornDispatcher(req, res, next) {
        debug('Dispatching request into router: %s', req.url);

        var origReqProto = req.__proto__;
        req.__proto__ = _.clone(self.request);
        req.__proto__.__proto__ = origReqProto;

        var origResProto = res.__proto__;
        res.__proto__ = _.clone(self.response);
        res.__proto__.__proto__ = origResProto;

        self._rootRoute.invoke(req, res, function (err) {
          req.__proto__ = origReqProto;
          res.__proto__ = origResProto;

          next(err);
        });
      };

      fn.__proto__.__proto__ = self;

      Object.defineProperty(fn, 'instance', {
        configurable: false,
        enumerable: true,
        value: self
      });

      self._middlewareFn = fn;
    }

    return self._middlewareFn;
  },

  /**
   * Mount all routes on to the shimmed express router. Must not be called twice.
   *
   * There will be a stream of events: `beforeMount`, `mount` and `skipMount`, each provides the
   * route in question as single argument to the listener.
   */
  mount: function () {
    if (!this.isMounted()) {
      this._rootRoute.mount();
    }
  },

  /**
   * Load routes. If the first argument is a string, it is interpreted as a path to a YAML file. If
   * it is an object, it is treated as route configs, i.e. what is otherwise returned by the YAML
   * parser. This method recursively iterates over all sourced config files and returns the root
   * routes with bound child routes. There will be a stream of 'routeCreated' events. Listeners
   * should have the signature `fn(route, routeConfig)`, where the first argument is the BaseRoute
   * object and the second one the plain config object as provided without alteration.
   *
   * @param {string|Object.<string, object>} source Path to yml file or an object containing route
   *   configs.
   * @param {boolean} [mountRoutes=true] Whether to mount the loaded routes onto the shimmed root
   *   express router.
   * @param {function|Array} [controllerFactory] Optionally provide a function that is called
   *   whenever a new controller must be instanciated: `fn(controllerfn, controllerPath,
   *   absolutePath)`. If this arg is an array, the values are used as arguments supplied to
   *   constructors. This is of course never used with controllers that are plain objects.
   *
   * @returns {Object.<string, BaseRoute>}
   */
  loadRoutes: function (source, mountRoutes, controllerFactory) {
    var self = this;

    if (self.isMounted()) {
      thr('Cannot load routes: Router has already been mounted');
    }

    var routes = {},
      rootRoutes = {},
      routeFactory = new RouteFactory(self, {
        controllerFactory: controllerFactory,
        routerOptions: self._options.routerOptions,
        defaultMethod: self._options.defaultMethod
      });

    var listener = function (route, routeConfig) {
      self.emit('routeCreated', route, routeConfig);
      self._addRoute(route);
      routes[route.name] = route;
    };

    // The route factory streams all created routes
    routeFactory.on('routeCreated', listener);

    if (_.isString(source)) {
      routeFactory.createRoutesFromYmlFile(source, controllerFactory);
    } else {
      routeFactory.createRoutesFromConfigs(source, controllerFactory);
    }

    // Search root routes
    _.each(routes, function (route) {
      if (!route.hasParentRoute()) {
        route.setParentRoute(self._rootRoute);
        rootRoutes[route.name] = route;
      }
    });

    if (mountRoutes !== false) {
      self.mount();
    }

    routeFactory.off('routeCreated', listener); // GC

    return rootRoutes;
  },

  /**
   * Get all routes
   *
   * @returns {Object.<string, BaseRoute>}
   */
  getAllRoutes: function () {
    return this._routes;
  },

  /**
   * Get a route by name
   *
   * @param {string} routeName Route name
   *
   * @returns {BaseRoute}
   */
  getRoute: function (routeName) {
    return this._routes[routeName];
  },

  /**
   * Check if a route exists
   *
   * @param {string} routeName Route name
   *
   * @returns {boolean}
   */
  hasRoute: function (routeName) {
    return !!this._routes[routeName];
  },

  /**
   * Check if the router and all its routes have been mounted
   */
  isMounted: function () {
    return this._rootRoute.mounted;
  },

  /**
   * Generate a path for a named route
   *
   * @param {string} routeName Route name
   * @param {object} [params={}] Route parameters
   * @param {object} [query={}] Query parameters
   * @param {boolean} [checkRequirements=true] Validate the supplied parameters
   *
   * @returns {string}
   */
  generatePath: function (routeName, params, query, checkRequirements) {
    var route = this._routes[routeName];

    if (!route) {
      thr('Cannot generate path for route %s: Route not found', routeName);
    }

    return route.generatePath(params, query, checkRequirements);
  },

  /**
   * Get a made-up tree representation of this router for debugging
   *
   * @returns {string}
   */
  getRouteTree: function () {
    var self = this;

    if (!this.isMounted()) {
      return null;
    }

    var result = 'routicorn',
      indentLevel = 0;

    function addLine(msg) {
      result += '\n' + _.repeat('  ', indentLevel) + '→ ' + msg;
    }

    function printSubRoutes(route) {
      indentLevel++;
      route.subRoutes.forEach(function (subRoute) {
        var info = [];

        var verbs = '';
        if (subRoute.actionable) {
          verbs = _.map(subRoute.methods, function (verb) {
            return verb.toUpperCase();
          }).join(', ');
        }

        var middleware = subRoute.getAllMiddleware();
        if (middleware && middleware.length > 0) {
          info.push('middleware: ' + middleware.length);
        }

        if (subRoute.isVerbStyle) {
          info.push('verb-style');
        }

        addLine(
          subRoute + ': ' +
          verbs + ' ' +
          subRoute.pattern +
          (info.length > 0 ? ' (' + info.join(', ') + ')' : '')
        );

        if (subRoute.hasSubRoutes()) {
          printSubRoutes(subRoute);
        }
      });
      indentLevel--;
    }

    printSubRoutes(self._rootRoute);

    return result;
  },

  /**
   * Add a route
   *
   * @private
   *
   * @param {BaseRoute} route Route to add
   */
  _addRoute: function (route) {
    var self = this;

    if (self.isMounted()) {
      thr('Cannot add a route to an already mounted Routicorn router');
    }

    if (!(route instanceof BaseRoute)) {
      throw new TypeError('route must be an instance of BaseRoute');
    }

    if (self._routes[route.name]) {
      if (self._routes[route.name] === route) {
        return;
      }

      thr('Route "%s" cannot be added: A route with the same name already exists', route.name);
    }

    // Re-emit route events
    var listeners = {
      skipMount: self.emit.bind(self, 'skipMount', route),
      beforeMount: self.emit.bind(self, 'beforeMount', route),
      mount: self.emit.bind(self, 'mount', route)
    };

    _.each(listeners, function (fn, event) {
      var listener = listeners[event] = function () {
        switch (event) {
          case 'skipMount':
            route.off('beforeMount', listeners.beforeMount);
            route.off('mount', listeners.mount);
            break;

          default:
            route.off('skipMount', listeners.skipMount);
        }

        fn.apply(null, arguments);
      };

      route.once(event, listener);
    });

    Object.defineProperty(self._routes, route.name, {
      configurable: false,
      enumerable: true,
      value: route
    });

    self.emit('addRoute', route);
  },

  /**
   * Get a controller either from cache, otherwise load (and instanciate) it.
   *
   * @provided
   *
   * @param {string} controllerPath Controller path without `.js` extension relative to the
   *   `controllerBasePath` given in the constructor options.
   * @param {function|Array} [controllerFactory] See [Routicorn#loadRoutes]{@link
    *   Routicorn#loadRoutes}
   *
   * @returns {object}
   */
  _getController: function (controllerPath, controllerFactory) {
    controllerPath = this._sanitizeControllerPath(controllerPath);

    if (!this._controllers[controllerPath]) {
      this._controllers[controllerPath] = this._createController(controllerPath, controllerFactory);
    }

    return this._controllers[controllerPath];
  },

  /**
   * Sanitize a controller path
   *
   * @private
   *
   * @param {string} controllerPath
   *
   * @returns {string}
   */
  _sanitizeControllerPath: function (controllerPath) {
    var basePath = this._options.controllerBasePath;

    return path
      .relative(basePath, path.normalize(path.resolve(basePath, controllerPath)))
      .replace(/\.js$/, '');
  },

  /**
   * Create a new controller instance
   *
   * @private
   *
   * @param {string} controllerPath
   * @param {function|Array} [controllerFactory]
   *
   * @returns {object}
   */
  _createController: function (controllerPath, controllerFactory) {
    debug('Create controller instance: %s', controllerPath);

    var fullControllerPath = path.join(this._options.controllerBasePath, controllerPath),
      Controller = require(fullControllerPath);

    var controllerInstance;
    if (_.isFunction(Controller)) {
      if (_.isFunction(controllerFactory)) {
        controllerInstance = controllerFactory(Controller, controllerPath, fullControllerPath);
      } else {
        controllerInstance = Object.create(Controller.prototype);
        Controller.apply(controllerInstance, _.isArray(controllerFactory) ? controllerFactory : []);
      }
    } else {
      controllerInstance = Controller;
    }

    if (typeof controllerInstance !== 'object') {
      thr('Cannot create a controller that is neither a constructor nor an object: %s', controllerPath);
    }

    this.emit('createController', controllerInstance);

    return controllerInstance;
  }

});

// Proxy express Router API
['param', 'handle', 'use', 'all', 'route'].concat(httpVerbs).forEach(function (methodName) {
  Routicorn.prototype[methodName] = function () {
    this._rootRoute[methodName].apply(this._rootRoute, arguments);
  };
});

/**
 * @type {SegmentRoute.prototype.constructor}
 */
Routicorn.SegmentRoute = require('./route/segment');

/**
 * @type {ActionRoute.prototype.constructor}
 */
Routicorn.ActionRoute = require('./route/action');

/**
 * @type {MockRequest.prototype.constructor}
 */
Routicorn.MockRequest = require('./mock-request');

module.exports = Routicorn;
