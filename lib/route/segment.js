'use strict';

var _ = require('lodash'),
  inherits = require('util').inherits,
  BaseRoute = require('./base'),
  debug = require('debug')('routicorn:route'),
  thr = require('throw');

/**
 * Segment route
 *
 * Events:
 * - `skipMount`: Emitted when mounting was skipped for this route, because it has no sub-routes.
 *
 * @inheritdoc
 * @constructor
 * @extends BaseRoute
 */
function SegmentRoute(routeName, pattern, options) {
  if (!(this instanceof SegmentRoute)) {
    return new SegmentRoute(routeName, pattern, options);
  }

  BaseRoute.apply(this, arguments);
}

inherits(SegmentRoute, BaseRoute);

_.extend(SegmentRoute.prototype, {

  /**
   * @inheritdoc
   */
  mount: function (expressRouter) {
    var self = this;

    if (self._mounted) {
      thr('Route has already been mounted: %s', self.name);
    }

    if (self._subRoutes.length === 0) {
      debug('Skipped mounting route %s: segment without sub-routes', self.name);

      return this.emit('skipMount');
    }

    debug('Mounting route %s: %s', self.name, self.pattern);

    var parentExpressRouter = expressRouter;
    expressRouter = self._getExpressRouter();
    parentExpressRouter.use(self.pattern, expressRouter);
    expressRouter.use(function handleRequestParams(req, res, next) {
      self._handleRequestParams(req, res, next);
    });

    self.emit('beforeMount', expressRouter);

    self._mountMiddleware();
    self.subRoutes.forEach(function (subRoute) {
      subRoute.mount(expressRouter);
    });

    self._mounted = true;

    self.emit('mount', expressRouter);

    // Free some object references
    delete self._middleware;
  }

});

module.exports = SegmentRoute;
