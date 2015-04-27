'use strict';

var _ = require('lodash'),
  inherits = require('util').inherits,
  BaseRoute = require('./base'),
  httpVerbs = require('methods'),
  debug = require('debug')('routicorn:route'),
  thr = require('throw');

/**
 * Segment router
 * @inheritdoc
 * @constructor
 * @extends BaseRoute
 */
function SegmentRoute(name, pattern, options) {
  var self = this;

  BaseRoute.apply(self, arguments);

  self._subRoutes = [];

  Object.defineProperties(self, {
    /**
     * Sub-routes of this segment router
     * @memberof SegmentRoute.prototype
     * @type {BaseRoute[]}
     * @readonly
     */
    subRoutes: {
      configurable: false,
      value: self._subRoutes
    }
  });
}

inherits(SegmentRoute, BaseRoute);

_.extend(SegmentRoute.prototype, {

  /**
   * @inheritdoc
   */
  invoke: function (req, res, next) {
    debug('Invoke route %s: %s', this.name, req.url);

    req.routicornRoute = this;
    this._getExpressRouter()(req, res, next);
  },

  /**
   * Add sub routes
   *
   * @param {BaseRoute|BaseRoute[]} subRoutes Sub routes to add
   * @param {boolean} [unshift=false] Unshift the routes
   */
  addSubRoutes: function (subRoutes, unshift) {
    subRoutes = _.isArray(subRoutes) ? subRoutes : [subRoutes];
    [][unshift ? 'unshift' : 'push'].apply(this._subRoutes, subRoutes);
  },

  /**
   * @inheritdoc
   */
  mount: function (expressRouter) {
    var self = this;

    if (self._mounted) {
      thr('Route has already been mounted: %s', this.name);
    }

    if (self._subRoutes.length === 0) {
      debug('Skipped mounting route %s: segment without sub-routes', self.name, self.pattern);
      this.emit('skipMount');

      return;
    }

    debug('Mounting route %s: %s', self.name, self.pattern);

    var actualExpressRouter = this._getExpressRouter();
    expressRouter.use(self.pattern, actualExpressRouter);
    actualExpressRouter.use(self._handleRequestParams.bind(self));

    self.emit('beforeMount', actualExpressRouter);

    self._middleware.forEach(function (middleware) {
      if (middleware[0]) {
        actualExpressRouter.use(middleware[0], middleware[1]);
      } else {
        actualExpressRouter.use(middleware[1]);
      }
    });

    self._subRoutes.forEach(function (subRoute) {
      subRoute.mount(actualExpressRouter);
    });

    self.emit('mount', actualExpressRouter);

    this._mounted = true;

    // Free some object references
    delete this._middleware;
  },

  /**
   * @inheritdoc
   */
  generatePath: function (params, checkRequirements) {
    thr('Segment routes are not directly routable, refusing to generate path: %s', this.name);
  }

});

// Proxy some express Router API methods, excluding 'handle', 'param' and 'use', which are handled
// explicitly in BaseRoute.
['all', 'route'].concat(httpVerbs).forEach(function (methodName) {
  SegmentRoute.prototype[methodName] = function () {
    var expressRouter = this._getExpressRouter();
    expressRouter[methodName].apply(expressRouter, arguments);
  };
});

// Alias
SegmentRoute.prototype.addSubRoute = SegmentRoute.prototype.addSubRoutes;

module.exports = SegmentRoute;
