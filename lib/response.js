'use strict';

var _ = require('lodash'),
  debug = require('debug')('routicorn:response');

/**
 * Extends express' res.redirect so that it's possible to redirect to named routes. If the
 * routeName (path) argument contains a '/' or a route with this name does not exist, express'
 * redirect will be called.
 *
 * Express' own redirect is has been aliased to `res.redirectPath()`.
 *
 * @param {number} [status] Status code
 * @param {string} routeName Route name
 * @param {object} [params] Params used to generate the path, defaults to request params
 * @param {object} [query={}] Query parameters
 * @param {boolean} [checkRequirements=true] Validate the supplied parameters
 */
exports.redirect = function redirectToRouteOrPath(status, routeName, params, query, checkRequirements) {
  if (_.isString(status)) {
    checkRequirements = query;
    query = params;
    params = routeName;
    routeName = status;
    status = null;
  }

  if (_.isBoolean(params)) {
    checkRequirements = params;
    params = null;
    query = null;
  } else if (_.isBoolean((query))) {
    checkRequirements = query;
    query = null;
  }

  var path = routeName;
  if (path.indexOf('/') === -1) {
    var route = this.routicorn.getRoute(routeName);
    if (route) {
      if (!params) {
        params = this.req.params || {};
      }

      path = this.routicorn.generatePath(routeName, params, query, checkRequirements);
      debug('Redirect to route %s: %s', routeName, path);
    }
  }

  if (status) {
    this.redirectPath(status, path);
  } else {
    this.redirectPath(path);
  }
};

exports.redirectPath = function expressRedirect() {
  this.app.response.redirect.apply(this, arguments);
};
