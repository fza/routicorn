'use strict';

var _ = require('lodash'),
  inherits = require('util').inherits,
  SegmentRoute = require('./segment');

function RootRoute(options) {
  SegmentRoute.call(this, '@routicorn@', '/', options);
  this._setRoot();
}

inherits(RootRoute, SegmentRoute);

_.extend(RootRoute.prototype, {

  /**
   * @inheritdoc
   */
  mount: function () {
    this._mountMiddleware();

    var expressRouter = this._getExpressRouter();
    this._subRoutes.forEach(function (subRoute) {
      subRoute.mount(expressRouter);
    });

    this._mounted = true;
  }

});

module.exports = RootRoute;
