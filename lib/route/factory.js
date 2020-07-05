'use strict';

var _ = require('lodash');
var debug = require('debug')('routicorn:route-factory');
var thr = require('format-throw');
var fs = require('fs');
var path = require('path');
var yaml = require('js-yaml');
var SegmentRoute = require('./segment');
var ActionRoute = require('./action');
var utils = require('../utils');

/**
 * @constant {string} DEFAULT_ROUTING_BASE_PATH
 */
var DEFAULT_BASE_PATH = 'app/routing';

/**
 * Route factory
 *
 * @constructor
 * @private
 * @param {Routicorn} router
 * @param {ControllerFactory} controllerFactory
 */
function RouteFactory(router, controllerFactory) {
  // Private properties
  utils.defineProps(this, false, {
    /**
     * @memberof RouteFactory#
     * @name _router
     * @type {Routicorn}
     * @private
     * @readonly
     */
    router: router,

    /**
     * @memberof RouteFactory#
     * @name _controllerFactory
     * @type {ControllerFactory}
     * @private
     * @readonly
     */
    controllerFactory: controllerFactory
  });
}

/**
 * Load routes from a YAML file
 *
 * @param {string} routingFile
 * @param {BaseRoute} [parentRoute] Parent route, defaults to the {@link Routicorn} instance that
 *   owns the route factory.
 * @returns {object.<string, BaseRoute>}
 */
RouteFactory.prototype.createRoutesFromYmlFile = function (routingFile, parentRoute) {
  var yamlData = fs.readFileSync(routingFile);

  var routeConfigs;
  try {
    routeConfigs = yaml.safeLoad(yamlData);
  } catch (e) {
    thr('Cannot parse routing config file: %s', routingFile);
  }

  return this.createRoutesFromConfigs(routeConfigs, parentRoute, path.dirname(routingFile));
};

/**
 * Create routes from route config objects
 *
 * @param {object} routeConfigs
 * @param {BaseRoute} [parentRoute] Parent route, defaults to the {@link Routicorn} instance that
 *   owns the route factory.
 * @param {string} [basePath="app/routing"]
 * @returns {object.<string, BaseRoute>}
 */
RouteFactory.prototype.createRoutesFromConfigs = function (routeConfigs, parentRoute, basePath) {
  var self = this;

  parentRoute = parentRoute || this._router;

  var routes = {};
  var route;
  _.each(routeConfigs, function (config, name) {
    name = _.trim(name);

    if (self._router.hasRoute(name)) {
      thr('Route name is ambiguous: %s', name);
    }

    if ((route = self._createRoute(name, config, parentRoute, basePath))) {
      routes[route.name] = route;
    }
  });

  return routes;
};

/**
 * Create a route instance
 *
 * @private
 * @param {string} name
 * @param {object} routeConfig
 * @param {SegmentRoute} parentRoute Parent route
 * @param {?string} basePath
 * @returns {BaseRoute}
 */
RouteFactory.prototype._createRoute = function (name, routeConfig, parentRoute, basePath) {
  debug('Create route: %s', name);

  routeConfig = routeConfig || {};

  if (!routeConfig.controller && !routeConfig.resource && !routeConfig.routes) {
    thr('Invalid route configuration: %s', name);
  }

  var segmentRoute;
  var actionRoute;
  var hasSubRoutes = !!(routeConfig.resource || routeConfig.routes);
  var pattern = routeConfig.pattern || '/';
  var routeOptions = {
    defaults: routeConfig.defaults,
    requirements: routeConfig.requirements,
    tags: _(_.flatten([routeConfig.tags, routeConfig.tag], true))
      .compact()
      .unique()
      .value()
  };

  // SegmentRoute
  if (hasSubRoutes) {
    segmentRoute = new SegmentRoute(name, pattern, parentRoute, routeOptions);
  }

  // ActionRoute, could be implicit
  if (routeConfig.controller) {
    var methods = _.compact(_.flatten([routeConfig.methods, routeConfig.method], true));
    var actionRouteOptions = _.extend({}, routeOptions, {
      methods: methods.length > 0 ? methods : ['GET'],
      controller: routeConfig.controller
    });

    actionRoute = this._createActionRoute(
      name,
      hasSubRoutes ? '/' : pattern,
      segmentRoute || parentRoute,
      actionRouteOptions
    );

    this._router.registerRoute(actionRoute);
  }

  // Load sub-routes after creating the action route, as an implicit action route should come first.
  if (hasSubRoutes) {
    basePath = basePath || DEFAULT_BASE_PATH;

    if (routeConfig.routes) {
      this.createRoutesFromConfigs(routeConfig.routes, segmentRoute, basePath);
    }

    if (_.isString(routeConfig.resource)) {
      this.createRoutesFromYmlFile(path.join(basePath, routeConfig.resource), segmentRoute);
    }

    this._router.registerRoute(segmentRoute);
  }

  return segmentRoute || actionRoute;
};

/**
 * Create an ActionRoute
 *
 * @private
 * @param {string} name
 * @param {string} pattern
 * @param {SegmentRoute} parentRoute
 * @param {object} options
 * @returns {ActionRoute}
 */
RouteFactory.prototype._createActionRoute = function (name, pattern, parentRoute, options) {
  var parsedController = options.controller.split('.');
  options.controller = this._controllerFactory.getController(parsedController[0]);
  options.controllerName = parsedController[0];
  options.actionName = parsedController[1];

  return new ActionRoute(name, pattern, parentRoute, options);
};

module.exports = RouteFactory;
