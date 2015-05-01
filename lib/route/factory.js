'use strict';

var _ = require('lodash'),
  inherits = require('util').inherits,
  fs = require('fs'),
  path = require('path'),
  yaml = require('js-yaml'),
  EventEmitter = require('eventemitter3'),
  SegmentRoute = require('./segment'),
  ActionRoute = require('./action'),
  debug = require('debug')('routicorn:route-factory'),
  thr = require('throw');

/**
 * Route factory
 *
 * @constructor
 * @private
 *
 * @param {Routicorn} router Routicorn instance
 * @param {object} options Options
 */
function RouteFactory(router, options) {
  EventEmitter.call(this);

  this.router = router;
  this.options = options;
}

inherits(RouteFactory, EventEmitter);

_.extend(RouteFactory.prototype, {

  /**
   * Load routes from a YAML file
   *
   * @param {string} yamlFile Path to the YAML file
   * @param {string} [basePath=null] Explicitly provide a base path to source other yaml files
   *   from. If falsy, will use the dirname of `yamlFile`.
   *
   * @returns {Object.<string, BaseRoute>}
   */
  createRoutesFromYmlFile: function (yamlFile, basePath) {
    basePath = basePath || path.dirname(yamlFile);

    var routingFilePath = path.join(basePath, path.basename(yamlFile)),
      yamlData,
      routeConfigs;

    try {
      yamlData = fs.readFileSync(routingFilePath);
    } catch (e) {
      thr('Cannot read routing config file: %s', routingFilePath);
    }

    try {
      routeConfigs = yaml.safeLoad(yamlData);
    } catch (e) {
      thr('Cannot parse routing config file: %s', routingFilePath);
    }

    return this.createRoutesFromConfigs(routeConfigs, basePath);
  },

  /**
   * Create routes from route configs
   *
   * @param {object} routeConfigs Route configs
   * @param {string} [basePath] Base path to source YAML files from, when `resource` configs are
   *   found.
   *
   * @returns {Object.<string, BaseRoute>}
   */
  createRoutesFromConfigs: function (routeConfigs, basePath) {
    var self = this;

    var route, routes = {};
    _.each(routeConfigs, function (routeConfig, routeName) {
      if (self.router.hasRoute(routeName)) {
        thr('The route "%s" has been defined more than once', routeName);
      }

      if ((route = self._createRoute(routeName, routeConfig, basePath))) {
        routes[route.name] = route;
      }
    });

    return routes;
  },

  /**
   * Create a route instance
   *
   * @private
   *
   * @param {string} routeName Route name
   * @param {object} routeConfig Route config
   * @param {string} [basePath] Base path to source YAML files from, when `resource` configs are
   *   found.
   *
   * @returns {BaseRoute}
   */
  _createRoute: function (routeName, routeConfig, basePath) {
    debug('Create route: %s', routeName);

    routeConfig = _.defaults(routeConfig || {}, {
      pattern: '/'
    });

    var routeOptions = {
      defaults: routeConfig.defaults,
      requirements: routeConfig.requirements,
      routerOptions: this.options.routerOptions
    };

    if (!routeConfig.controller && !routeConfig.resource && !routeConfig.routes) {
      thr('Invalid route configuration: %s', routeName);
    }

    var hasSubRoutes = !!(routeConfig.resource || routeConfig.routes),
      actionRoute,
      route;

    if (routeConfig.controller) {
      // @todo Implement 'my/controller.someGetter.actionMethod' style controller/action definition
      var parsedController = routeConfig.controller.split('.');
      routeOptions.methods = routeConfig.methods || routeConfig.method || [this.options.defaultMethod];
      routeOptions.controller = this.router._getController(
        parsedController[0],
        this.options.controllerFactory
      );
      routeOptions.controllerName = parsedController[0];
      routeOptions.actionName = parsedController[1];

      route = actionRoute = new ActionRoute(routeName, hasSubRoutes ? '/' : routeConfig.pattern, routeOptions);
    }

    if (hasSubRoutes) {
      var subRoutes = {};

      route = new SegmentRoute(actionRoute ? '_' + routeName : routeName, routeConfig.pattern, routeOptions);

      if (actionRoute) {
        actionRoute.setParentRoute(route, true);
      }

      if (_.isString(routeConfig.resource)) {
        _.merge(subRoutes, this.createRoutesFromYmlFile(routeConfig.resource, basePath));
      }

      if (routeConfig.routes) {
        _.merge(subRoutes, this.createRoutesFromConfigs(routeConfig.routes, basePath));
      }

      _.each(subRoutes, function (subRoute) {
        subRoute.setParentRoute(route);
      });
    }

    this.emit('routeCreated', route, routeConfig);

    return route;
  }

});

module.exports = RouteFactory;
