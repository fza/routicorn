'use strict';

var _ = require('lodash');
var debug = require('debug')('routicorn:response');

/**
 * @namespace Response
 */
module.exports = exports = {};

/**
 * Redirect to a named route. Overrides express' `res.redirect()`, which is still available at
 * `res.redirectUrl()`. This method is fully compatible to the express API. If the routeName
 * (path) argument contains a '/' or a route with this name does not exist, the original redirect
 * function will be called.
 *
 * Options:
 * - `absolute`: Redirects using and absolute URL. Will use the current (sub-)request to determine
 * the default values for protocol, host and port. See {@link BaseRoute#generateUrl} for
 * customization.
 *
 * Usage: `res.redirect([status], routeName, [params, [query]], [options])`
 *
 * @param {number} [status] Status code
 * @param {string} routeName Route name
 * @param {object} [params] Params used to generate the path, defaults to request params
 * @param {object} [query={}] Query parameters
 * @param {object} [options={}] Options
 */
exports.redirect = function (status, routeName, params, query, options) {
  if (_.isString(status)) {
    options = query || params || routeName || {};
    query = arguments.length === 4 ? params : null;
    params = arguments.length >= 3 ? routeName : null;
    routeName = status;
    status = null;
  } else {
    options = query || params || {};
    query = arguments.length === 5 ? query : null;
    params = arguments.length >= 4 ? params : null;
  }

  var location = routeName;
  if (location.indexOf('/') === -1) {
    var route = this.routicorn.getRoute(routeName);
    if (route) {
      if (!params) {
        params = this.req.params || {};
      }

      if (options.absolute) {
        location = this.routicorn.generateUrl(routeName, params, query, options);
      } else {
        location = this.routicorn.generatePath(routeName, params, query, options);
      }

      debug('Redirect to route %s: %s', routeName, location);
    }
  }

  if (status) {
    return this.redirectUrl(status, location);
  }

  this.redirectUrl(location);
};

/**
 * Redirect to a URL or path. See express'
 * [res.redirect]{http://expressjs.com/4x/api.html#res.redirect}
 */
exports.redirectUrl = function () {
  return this.app.response.redirect.apply(this, arguments);
};
