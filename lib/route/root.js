'use strict';

var _ = require('lodash'),
  inherits = require('util').inherits,
  SegmentRoute = require('./segment'),
  debug = require('debug')('routicorn:route');

function RootRoute(options) {
  SegmentRoute.call(this, '@routicorn@', '/', options);
}

inherits(RootRoute, SegmentRoute);

_.extend(RootRoute.prototype, {

  /**
   * @inheritdoc
   */
  invoke: function (req, res, next) {
    debug('Dispatching request into router: %s', req.url);

    req.routicornRoute = this;
    this._getExpressRouter()(req, res, next);
  },

  /**
   * @inheritdoc
   */
  mount: function () {
    var expressRouter = this._getExpressRouter();

    this._subRoutes.forEach(function (subRoute) {
      subRoute.mount(expressRouter);
    });

    this._mounted = true;
  }

});

module.exports = RootRoute;
