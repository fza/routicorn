'use strict';

var _ = require('lodash');
var debug = require('debug')('routicorn:route:segment');
var thr = require('format-throw');
var inherits = require('util').inherits;
var BaseRoute = require('./base');
var utils = require('../utils');

/**
 * @inheritdoc
 * @constructor
 * @extends BaseRoute
 * @private
 */
function SegmentRoute(routeName, pattern, parentRoute, options) {
  if (!(this instanceof SegmentRoute)) {
    return new SegmentRoute(routeName, pattern, parentRoute, options);
  }

  BaseRoute.apply(this, arguments);

  utils.defineProps(this, true, {
    /**
     * Sub-routes attached to this segment
     * @memberof BaseRoute#
     * @type {string}
     * @readonly
     */
    subRoutes: {}
  });
}

inherits(SegmentRoute, BaseRoute);

/**
 * @inheritdoc
 */
SegmentRoute.prototype.handlesMethod = function () {
  // Segment routes handle all methods
  return true;
};

/**
 * Add sub route(s)
 *
 * @param {BaseRoute|BaseRoute[]} subRoutes Sub route(s) to add
 */
SegmentRoute.prototype.addSubRoutes = function (subRoutes) {
  var self = this;

  _.flatten([subRoutes]).forEach(function (subRoute) {
    if (!(subRoute instanceof BaseRoute)) {
      thr('route must be an instance of BaseRoute');
    }

    if (subRoute.parentRoute !== self) {
      thr('Cannot add a sub-route to a different parent route: %s', subRoute.name);
    }

    if (self.subRoutes[subRoute.name] === subRoute) {
      return;
    }

    self.subRoutes[subRoute.name] = subRoute;

    debug(
      'Mounting sub-route "%s" at parent route "%s" with pattern: %s',
      subRoute.name,
      self.name,
      subRoute.pattern
    );

    self._expressRouter.use(subRoute.pattern, function invokeRoute(req, res, next) {
      subRoute._invoke(req, res, next);
    });
  });
};

/**
 * @alias SegmentRoute#addSubRoutes
 */
SegmentRoute.prototype.addSubRoute = SegmentRoute.prototype.addSubRoutes;

module.exports = SegmentRoute;
